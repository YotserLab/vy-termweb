// Shared auth helper for tests.
// The server now gates every /api/* route and the socket.io transports behind
// a master password. Run the test server with VY_MASTER_PASSWORD set and pass
// the same value to tests via VY_TERMWEB_PASS:
//
//   VY_MASTER_PASSWORD=test PORT=32240 go -C backend run .
//   VY_TERMWEB_PASS=test node tests/session-log.mjs
//
// A server in first-run setup state is REJECTED on purpose — silently
// completing setup would hijack the panel password on a real machine.

export async function authToken(baseUrl) {
  const s = await fetch(`${baseUrl}/api/auth/status`).then((r) => r.json()).catch(() => null);
  if (!s || s.disabled || (!s.required && !s.needsSetup)) return ""; // auth off (dev/disabled or old server)
  if (s.needsSetup) {
    throw new Error(
      "server is in first-run setup — start it with VY_MASTER_PASSWORD=<pass> " +
      "(tests never set the panel password themselves)"
    );
  }
  const pw = process.env.VY_TERMWEB_PASS;
  if (!pw) throw new Error("server requires auth — set VY_TERMWEB_PASS");
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
  return (await r.json()).token;
}
