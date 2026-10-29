// Integration test: session logging via socket.io local-shell.
// Requires a running server: VY_TERMWEB_URL=http://127.0.0.1:32240 node tests/session-log.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { io } from "socket.io-client";
import { authToken } from "./lib/auth.mjs";

const baseUrl = process.env.VY_TERMWEB_URL || "http://127.0.0.1:32240";
const marker = `LOGMARK${Date.now()}`;

const token = await authToken(baseUrl);
const socket = io(baseUrl, { transports: ["websocket"], query: { token } });
const once = (ev) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout waiting ${ev}`)), 15000);
  socket.once(ev, (d) => { clearTimeout(t); res(d); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await once("connect");
  socket.emit("local-shell", { cols: 120, rows: 30, logging: "clean", resumeId: `log-test-${Date.now()}` });

  const [ready, started] = await Promise.all([once("shell-ready"), once("ssh-log-started")]);
  assert.ok(started.path.endsWith(".log"), `unexpected log path ${started.path}`);
  assert.equal(started.format, "clean");

  socket.emit("ssh-input", `echo ${marker}\r`);
  await sleep(800); // let output flow through the log writer

  const content = await readFile(started.path, "utf8");
  assert.ok(content.includes(marker), "marker missing from log file");
  assert.ok(!/\x1b\[/.test(content), "clean log still contains ANSI escapes");

  socket.emit("ssh-log-stop");
  await once("ssh-log-stopped");

  console.log(`session-log OK — ${started.path}`);
  socket.close();
  process.exit(0);
} catch (e) {
  console.error("session-log FAILED:", e);
  socket.close();
  process.exit(1);
}
