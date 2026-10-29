// Master-password vault: credentials (session passwords, private keys,
// passphrases) are AES-GCM-encrypted client-side before touching localStorage.
//
// Storage layout (localStorage["vy-termweb:vault"]):
//   { v: 1, kdf: "PBKDF2", iter, salt, verifyIv, verify, hint }
// verify is the AES-GCM ciphertext of a known constant — decrypting it proves
// the password without storing it.
//
// Encrypted fields use the "enc:v1:<base64(iv|ct)>" prefix so ciphertext can
// stay mixed with plaintext in the sessions/keys collections.
//
// The master key lives only in memory. There is no recovery: losing the
// password means resetting the vault (secrets are dropped, sessions kept).

const LS_KEY = "vy-termweb:vault";
const ENC_PREFIX = "enc:v1:";
const VERIFY_PLAIN = "vytw-vault-ok";
const KDF_ITERATIONS = 310_000;

interface VaultMeta {
  v: 1;
  kdf: "PBKDF2";
  iter: number;
  salt: string; // base64
  verifyIv: string; // base64
  verify: string; // base64
  hint: string;
}

let masterKey: CryptoKey | null = null;
let requestUnlock: (() => void) | null = null;
const waiters: { resolve: (ok: boolean) => void; reject: (e: Error) => void }[] = [];

const readMeta = (): VaultMeta | null => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as VaultMeta) : null;
  } catch {
    return null;
  }
};

const writeMeta = (meta: VaultMeta | null) => {
  if (meta) localStorage.setItem(LS_KEY, JSON.stringify(meta));
  else localStorage.removeItem(LS_KEY);
};

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};

const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: iter, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export const hasVault = () => readMeta() !== null;
export const isUnlocked = () => masterKey !== null;
export const vaultHint = () => readMeta()?.hint ?? "";
export const isEncryptedField = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith(ENC_PREFIX);

/** App registers the modal opener so locked operations can ask for the password. */
export function setUnlockRequestHandler(fn: () => void) {
  requestUnlock = fn;
}

/** Resolves once the vault is unlocked (or already was / doesn't exist). */
export function ensureUnlocked(): Promise<boolean> {
  if (masterKey || !hasVault()) return Promise.resolve(true);
  requestUnlock?.();
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
}

/** Called by the UI after a successful unlock (or cancel=false → reject waiters). */
function flushWaiters(ok: boolean, err?: Error) {
  while (waiters.length) {
    const w = waiters.shift()!;
    if (ok) w.resolve(true);
    else w.reject(err ?? new Error("Vault unlock cancelled"));
  }
}

export async function setupVault(password: string, hint: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(VERIFY_PLAIN)
  );
  writeMeta({ v: 1, kdf: "PBKDF2", iter: KDF_ITERATIONS, salt: b64(salt), verifyIv: b64(iv), verify: b64(ct), hint });
  masterKey = key;
  flushWaiters(true);
}

export async function unlockVault(password: string): Promise<boolean> {
  const meta = readMeta();
  if (!meta) return true;
  try {
    const key = await deriveKey(password, unb64(meta.salt), meta.iter);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(meta.verifyIv) as BufferSource },
      key,
      unb64(meta.verify) as BufferSource
    );
    if (new TextDecoder().decode(plain) !== VERIFY_PLAIN) return false;
    masterKey = key;
    flushWaiters(true);
    return true;
  } catch {
    return false;
  }
}

/** Cancel pending ensureUnlocked() callers (e.g. user closed the modal). */
export function cancelUnlockRequests() {
  flushWaiters(false);
}

export function lockVault() {
  masterKey = null;
}

/** Wipes the vault metadata. Callers must strip enc: fields afterwards. */
export function resetVault() {
  masterKey = null;
  writeMeta(null);
  flushWaiters(false, new Error("Vault reset"));
}

export async function changePassword(newPassword: string, hint: string): Promise<void> {
  if (!masterKey) throw new Error("Vault is locked");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(newPassword, salt, KDF_ITERATIONS);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(VERIFY_PLAIN)
  );
  writeMeta({ v: 1, kdf: "PBKDF2", iter: KDF_ITERATIONS, salt: b64(salt), verifyIv: b64(iv), verify: b64(ct), hint });
  masterKey = key;
}

export async function encryptField(plain: string): Promise<string> {
  if (!plain || !masterKey) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    masterKey,
    new TextEncoder().encode(plain)
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return ENC_PREFIX + b64(out);
}

export async function decryptField(stored: string | undefined): Promise<string | undefined> {
  if (stored === undefined || stored === "") return stored;
  if (!isEncryptedField(stored)) return stored;
  await ensureUnlocked();
  if (!masterKey) throw new Error("Vault is locked");
  const buf = unb64(stored.slice(ENC_PREFIX.length));
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, masterKey, ct as BufferSource);
  return new TextDecoder().decode(plain);
}
