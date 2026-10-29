import { type Session, type SessionGroup, type SSHKey } from "../types";
import { decryptField, isEncryptedField } from "./vault";

// Merge group defaults into a session: the session's own values win; empty
// fields fall back to the group's defaults. Pure function — no side effects.
export function effectiveSession(s: Session, groups: SessionGroup[]): Session {
  const g = groups.find((x) => x.id === s.groupId);
  if (!g?.defaults) return s;
  const d = g.defaults;
  return {
    ...s,
    user: s.user || d.user,
    port: s.port || d.port,
    authType: s.authType || d.authType,
    privateKeyId: s.privateKeyId || d.privateKeyId,
    jumpChain: s.jumpChain?.length ? s.jumpChain : d.jumpChain,
    startupMacroId: s.startupMacroId || d.startupMacroId,
    logging: s.logging ?? d.logging,
  };
}

const decryptMaybe = (v: string | undefined) => (isEncryptedField(v) ? decryptField(v) : Promise.resolve(v));

async function keyMaterial(
  s: Session,
  sshKeys: SSHKey[]
): Promise<{ privateKey?: string }> {
  const raw = s.privateKeyId ? sshKeys.find((k) => k.id === s.privateKeyId)?.content : undefined;
  return { privateKey: await decryptMaybe(raw) };
}

/** Resolves session -> ssh-connect payload, expanding group defaults,
 *  decrypting vault fields and resolving the jump-host chain (cycle-safe). */
export async function buildConnectPayload(
  session: Session,
  allSessions: Session[],
  sshKeys: SSHKey[],
  groups: SessionGroup[]
): Promise<Record<string, unknown>> {
  const eff = effectiveSession(session, groups);

  const hops: Record<string, unknown>[] = [];
  const seenIds = new Set([eff.id]);
  for (const hopId of (eff.jumpChain || []).slice(0, 5)) {
    const hop = allSessions.find((x) => x.id === hopId);
    if (!hop || seenIds.has(hop.id)) break; // missing or cycle — stop there
    seenIds.add(hop.id);
    const heff = effectiveSession(hop, groups);
    hops.push({
      host: heff.host,
      port: heff.port || 22,
      user: heff.user || "root",
      password: await decryptMaybe(heff.password),
      privateKey: (await keyMaterial(heff, sshKeys)).privateKey,
      privateKeyPath: heff.privateKeyPath,
    });
  }

  return {
    host: eff.host,
    port: eff.port,
    user: eff.user || "root",
    password: await decryptMaybe(eff.password),
    privateKey: (await keyMaterial(eff, sshKeys)).privateKey,
    privateKeyPath: eff.privateKeyPath,
    tunnels: eff.tunnels || [],
    hops,
  };
}

/** Quote a value for POSIX shell export lines. */
export const shQuote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/** env map -> "export A='x'; export B='y'" (empty string when no env). */
export function envExports(env: Record<string, string> | undefined): string {
  if (!env) return "";
  return Object.entries(env)
    .filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
    .map(([k, v]) => `export ${k}=${shQuote(v)};`)
    .join(" ");
}
