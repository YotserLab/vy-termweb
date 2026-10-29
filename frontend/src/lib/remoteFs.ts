import { type Socket } from "socket.io-client";
import { connectSocket } from "./auth";
import { buildConnectPayload } from "./session";
import type { Session } from "../types";

const readJson = <T,>(key: string): T[] => {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]") as T[];
  } catch {
    return [];
  }
};

export function findSessionById(id: string): Session | undefined {
  return (
    readJson<Session>("vy-termweb:sessions").find((s) => s.id === id) ??
    readJson<Session>("vy-termweb:history").find((s) => s.id === id)
  );
}

// One dedicated SFTP socket per session, shared by remote editor operations.
// resumeId is stable so a parked backend session is resumed, not re-authed.
const conns = new Map<string, Promise<Socket>>();

function remoteConnect(sessionId: string): Promise<Socket> {
  const cached = conns.get(sessionId);
  if (cached) return cached;
  const p = (async () => {
    const session = findSessionById(sessionId);
    if (!session) throw new Error("Session not found");
    const payload = await buildConnectPayload(
      session,
      readJson("vy-termweb:sessions"),
      readJson("vy-termweb:ssh-keys"),
      readJson("vy-termweb:groups")
    );
    const socket = connectSocket();
    return await new Promise<Socket>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error("SFTP connect timeout"));
      }, 20000);
      const fail = (msg: string) => {
        clearTimeout(timer);
        socket.disconnect();
        reject(new Error(msg));
      };
      socket.on("connect", () =>
        socket.emit("ssh-connect", { ...payload, resumeId: `editor-${sessionId}`, seen: -1 })
      );
      socket.on("sftp-ready", () => {
        clearTimeout(timer);
        // Drop the connect-phase error listeners — per-op listeners take over.
        socket.off("sftp-error");
        socket.off("ssh-error");
        socket.off("ssh-close");
        socket.off("connect_error");
        resolve(socket);
      });
      socket.on("sftp-error", (e: string) => fail(String(e)));
      socket.on("ssh-error", (e: string) => fail("SSH: " + e));
      socket.on("ssh-close", () => fail("SSH connection closed"));
      socket.on("connect_error", () => fail("Transport unreachable"));
    });
  })().catch((e) => {
    conns.delete(sessionId);
    throw e;
  });
  conns.set(sessionId, p);
  // Evict from cache if the socket dies later so the next op reconnects.
  p.then((s) =>
    s.on("disconnect", () => {
      if (conns.get(sessionId) === p) conns.delete(sessionId);
    })
  ).catch(() => {});
  return p;
}

export async function remoteReadFile(sessionId: string, path: string): Promise<string> {
  const socket = await remoteConnect(sessionId);
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => done(() => reject(new Error("Read timeout"))), 30000);
    const done = (cb: () => void) => {
      socket.off("sftp-read-result", onResult);
      socket.off("sftp-error", onErr);
      clearTimeout(timer);
      cb();
    };
    const onResult = (r: any) => {
      if (r?.path !== path) return;
      done(() => {
        const bytes =
          r.content instanceof ArrayBuffer ? new Uint8Array(r.content) : new Uint8Array(r.content ?? []);
        const text = new TextDecoder().decode(bytes);
        if (text.includes("\0")) reject(new Error("Binary file — cannot edit as text"));
        else resolve(text);
      });
    };
    const onErr = (e: string) => done(() => reject(new Error(String(e))));
    socket.on("sftp-read-result", onResult);
    socket.on("sftp-error", onErr);
    socket.emit("sftp-read", path);
  });
}

// socket.io binary attachments inside a payload map do not reach the Go
// server (they arrive as placeholders) — always send base64 strings.
export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export async function remoteWriteFile(sessionId: string, path: string, text: string): Promise<void> {
  const socket = await remoteConnect(sessionId);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(() => reject(new Error("Write timeout"))), 30000);
    const done = (cb: () => void) => {
      socket.off("sftp-action-success", onSuccess);
      socket.off("sftp-error", onErr);
      clearTimeout(timer);
      cb();
    };
    const onSuccess = (r: any) => {
      if (r?.action !== "write" || r.path !== path) return;
      done(resolve);
    };
    const onErr = (e: string) => done(() => reject(new Error(String(e))));
    socket.on("sftp-action-success", onSuccess);
    socket.on("sftp-error", onErr);
    socket.emit("sftp-write", { path, content: bytesToB64(new TextEncoder().encode(text)) });
  });
}
