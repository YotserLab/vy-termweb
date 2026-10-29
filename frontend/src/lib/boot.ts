// Server boot tracking — each server start has a unique bootId.
// When it changes (restart or a different machine serving the same URL),
// cached data from the previous server is invalid: thumbnails keyed by URL,
// sessionStorage handoffs, and in-memory listings must be refreshed.

const KEY = "vy-termweb:boot-id";
export const BOOT_EVENT = "vy-termweb:boot";

/** One-time migration: copy `termweb:*` keys to `vy-termweb:*`. */
export function migrateLegacyKeys() {
  for (const legacy of ["termweb:"]) {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(legacy)) continue;
      const target = `vy-termweb:${key.slice(legacy.length)}`;
      if (localStorage.getItem(target) === null) {
        const v = localStorage.getItem(key);
        if (v !== null) localStorage.setItem(target, v);
      }
      localStorage.removeItem(key);
    }
  }
}

let bootId = localStorage.getItem(KEY) ?? "0";

export const getBootId = () => bootId;

/** Cache-buster query param tied to the current server instance. */
export const bust = () => `v=${bootId}`;

let reloading = false;

export function applyBootId(id: string | undefined | null) {
  if (!id || id === bootId) return;
  const hadPrevious = localStorage.getItem(KEY) !== null;
  bootId = id;
  localStorage.setItem(KEY, id);
  // sessionStorage handoffs (e.g. pending file-open paths) point at the old
  // server's filesystem — drop them.
  sessionStorage.clear();
  if (!hadPrevious || reloading) return;
  // A different server instance is now serving this origin — everything in
  // memory and every cached URL belongs to the old process. Reload once so
  // the browser refetches index.html/assets and starts clean.
  reloading = true;
  window.dispatchEvent(new Event(BOOT_EVENT));
  setTimeout(() => location.reload(), 50);
}

/** Attach to a socket.io socket so any view detects a new server fast. */
export function trackBoot(socket: { on: (ev: string, fn: (v: string) => void) => void }) {
  socket.on("server-boot", applyBootId);
}
