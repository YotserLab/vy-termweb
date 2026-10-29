// Panel authentication client helpers.
// The token is a stateless HMAC token issued by the Go backend; it is sent as
// `Authorization: Bearer` on API fetches and as ?token= on file URLs and the
// socket.io handshake query (media tags and downloads cannot send headers).
import { io, type Socket } from "socket.io-client";

const KEY = "vy-termweb:auth-token";
export const AUTH_EXPIRED = "vy-termweb:auth-expired";

export const getAuthToken = (): string => localStorage.getItem(KEY) ?? "";
export const setAuthToken = (token: string) => localStorage.setItem(KEY, token);
export const clearAuthToken = () => localStorage.removeItem(KEY);

export interface AuthStatus {
  required: boolean;
  needsSetup: boolean;
  authenticated: boolean;
  disabled?: boolean;
}

export const authHeaders = (): Record<string, string> => {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export async function authStatus(): Promise<AuthStatus> {
  const r = await fetch("/api/auth/status", { headers: authHeaders() });
  return r.json();
}

/** fetch() wrapper: attaches the bearer token; a 401 on a request that
 * carried one means the token expired — drop it and notify App. */
export async function apiFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const hadToken = !!getAuthToken();
  const r = await fetch(input, {
    ...init,
    headers: { ...init?.headers, ...authHeaders() },
  });
  if (r.status === 401 && hadToken) {
    clearAuthToken();
    window.dispatchEvent(new Event(AUTH_EXPIRED));
  }
  return r;
}

/** Appends the token query param to an /api URL (img/video/iframe/a href). */
export function withAuthToken(url: string): string {
  const token = getAuthToken();
  if (!token) return url;
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

/** socket.io client with the token merged into the handshake query — the
 * backend gate sees it on every polling/websocket request. */
export function connectSocket(): Socket {
  return io({
    transports: ["websocket", "polling"],
    query: { token: getAuthToken() },
  });
}

async function postAuth(path: string, body: unknown): Promise<{ token: string }> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

export async function authLogin(password: string): Promise<void> {
  const d = await postAuth("/api/auth/login", { password });
  setAuthToken(d.token);
}

export async function authSetup(password: string): Promise<void> {
  const d = await postAuth("/api/auth/setup", { password });
  setAuthToken(d.token);
}

/** Returns a fresh token (old ones are invalidated by the password change). */
export async function authChangePassword(current: string, next: string): Promise<void> {
  const d = await postAuth("/api/auth/change", { current, new: next });
  setAuthToken(d.token);
}
