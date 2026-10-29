// Integration test: remote file editing roundtrip via sftp-read/sftp-write
// (backs the "Edit in editor" flow for remote files in Sidebar/SFTPView).
// Requires: a running VY-TermWEB server and SSH access to 127.0.0.1:22 for the
// current user (VY_TERMWEB_TEST_KEY must point to an authorized private key).
//   VY_TERMWEB_URL=http://127.0.0.1:32255 VY_TERMWEB_TEST_KEY=~/.ssh/id_ed25519_1panel node tests/sftp-edit.mjs
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { io } from "socket.io-client";
import { authToken } from "./lib/auth.mjs";

const baseUrl = process.env.VY_TERMWEB_URL || "http://127.0.0.1:32255";
const keyPath = process.env.VY_TERMWEB_TEST_KEY || path.join(os.homedir(), ".ssh", "id_ed25519_1panel");
const user = process.env.VY_TERMWEB_TEST_USER || os.userInfo().username;
const remotePath = `/tmp/vy-termweb-edit-${Date.now()}.txt`;

const token = await authToken(baseUrl);
const socket = io(baseUrl, { transports: ["websocket"], query: { token } });
const once = (ev) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout waiting ${ev}`)), 30000);
  socket.once(ev, (d) => { clearTimeout(t); res(d); });
});
const errors = [];
socket.on("sftp-error", (d) => errors.push(d));
socket.on("ssh-error", (d) => errors.push("ssh:" + d));

try {
  await once("connect");
  socket.emit("ssh-connect", {
    host: "127.0.0.1", port: 22, user, privateKeyPath: keyPath,
    cols: 120, rows: 30, resumeId: `edit-test-${Date.now()}`,
  });
  await once("sftp-ready");

  // 1. create remote file via sftp-write (base64 — binary attachments inside
  //    a payload map never reach the Go server)
  const w1 = once("sftp-action-success");
  socket.emit("sftp-write", { path: remotePath, content: Buffer.from("linha um\nlinha dois\n").toString("base64") });
  const ok1 = await w1;
  assert.equal(ok1.action, "write");
  assert.equal(ok1.path, remotePath);

  // 2. read it back via sftp-read
  const r1 = once("sftp-read-result");
  socket.emit("sftp-read", remotePath);
  const res1 = await r1;
  const text1 = Buffer.from(res1.content.data ?? res1.content).toString("utf8");
  assert.equal(text1, "linha um\nlinha dois\n");

  // 3. overwrite (edit) and re-read — UTF-8 content
  const w2 = once("sftp-action-success");
  socket.emit("sftp-write", { path: remotePath, content: Buffer.from("editado ✓ çãõ\n").toString("base64") });
  await w2;
  const r2 = once("sftp-read-result");
  socket.emit("sftp-read", remotePath);
  const res2 = await r2;
  const text2 = Buffer.from(res2.content.data ?? res2.content).toString("utf8");
  assert.equal(text2, "editado ✓ çãõ\n");

  // 4. cleanup remote file
  socket.emit("sftp-rm", { path: remotePath, type: "file" });
  await once("sftp-action-success");

  assert.deepEqual(errors, []);
  console.log("sftp-edit OK — sftp-write/sftp-read roundtrip works");
  socket.close();
  process.exit(0);
} catch (e) {
  console.error("sftp-edit FAILED:", e, errors);
  socket.close();
  process.exit(1);
}
