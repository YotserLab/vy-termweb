// Integration test: SSH jump host chain + dynamic (-D) SOCKS5 tunnel.
// Requires: a running VY-TermWEB server and SSH access to 127.0.0.1:22 for the
// current user (VY_TERMWEB_TEST_KEY must point to an authorized private key).
//   VY_TERMWEB_URL=http://127.0.0.1:32240 VY_TERMWEB_TEST_KEY=~/.ssh/id_ed25519_1panel node tests/ssh-jump-socks.mjs
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { io } from "socket.io-client";
import { authToken } from "./lib/auth.mjs";

const baseUrl = process.env.VY_TERMWEB_URL || "http://127.0.0.1:32240";
const keyPath = process.env.VY_TERMWEB_TEST_KEY || path.join(os.homedir(), ".ssh", "id_ed25519_1panel");
const user = process.env.VY_TERMWEB_TEST_USER || os.userInfo().username;
const socksPort = 18099;

if (!keyPath) {
  console.error("set VY_TERMWEB_TEST_KEY");
  process.exit(2);
}

const token = await authToken(baseUrl);
const socket = io(baseUrl, { transports: ["websocket"], query: { token } });
const once = (ev) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout waiting ${ev}`)), 30000);
  socket.once(ev, (d) => { clearTimeout(t); res(d); });
});
socket.on("tunnel-error", (d) => console.error("tunnel-error:", d));
socket.on("ssh-error", (d) => console.error("ssh-error:", d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await once("connect");

  const hop = { host: "127.0.0.1", port: 22, user, privateKeyPath: keyPath };
  // tunnel-ready arrives BEFORE ssh-ready (tunnels start right after connect)
  const tunnelReadyP = once("tunnel-ready");
  socket.emit("ssh-connect", {
    host: "127.0.0.1",
    port: 22,
    user,
    privateKeyPath: keyPath,
    hops: [hop], // jump through self — exercises the hop dial path
    tunnels: [{ id: "t1", type: "dynamic", localPort: socksPort }],
    cols: 120,
    rows: 30,
    resumeId: `jump-test-${Date.now()}`,
  });

  await once("ssh-ready");
  const tunnel = await tunnelReadyP;
  assert.equal(tunnel.type, "dynamic");
  assert.equal(tunnel.localPort, socksPort);

  await sleep(300);
  // SOCKS5 via raw socket: greeting + CONNECT to 127.0.0.1:32240 then HTTP GET
  // (fetches our own status endpoint THROUGH the SSH dynamic tunnel)
  const net = await import("node:net");
  const body = await new Promise((res, rej) => {
    const c = net.connect(socksPort, "127.0.0.1", () => {
      c.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    let stage = 0;
    const chunks = [];
    c.on("data", (d) => {
      chunks.push(d);
      const all = Buffer.concat(chunks);
      if (stage === 0 && all.length >= 2) {
        assert.equal(all[0], 0x05);
        assert.equal(all[1], 0x00);
        stage = 1;
        chunks.length = 0;
        // CONNECT 127.0.0.1:32240
        const req = Buffer.from([0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, 32240 >> 8, 32240 & 0xff]);
        c.write(req);
      } else if (stage === 1 && all.length >= 10) {
        assert.equal(all[1], 0x00, `SOCKS5 connect failed rep=${all[1]}`);
        stage = 2;
        chunks.length = 0;
        c.write("GET /api/system/status HTTP/1.0\r\nHost: x\r\n\r\n");
      } else if (stage === 2 && all.includes("version")) {
        c.end();
        res(all.toString());
      }
    });
    c.on("error", rej);
    setTimeout(() => { c.destroy(); rej(new Error("socks timeout")); }, 10000);
  });
  assert.ok(body.includes('"process"'), "no JSON through SOCKS5 tunnel");

  console.log("ssh-jump-socks OK — SOCKS5 tunnel works through a jump host");
  socket.close();
  process.exit(0);
} catch (e) {
  console.error("ssh-jump-socks FAILED:", e);
  socket.close();
  process.exit(1);
}
