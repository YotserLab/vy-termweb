import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.VY_TERMWEB_URL || "http://127.0.0.1:32240";
const fixture = await mkdtemp(path.join(os.tmpdir(), "vy-termweb-file-manager-"));

import { authToken } from "./lib/auth.mjs";
const token = await authToken(baseUrl);
const authHdr = token ? { Authorization: `Bearer ${token}` } : {};

const request = async (route, init) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: { ...authHdr, ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
};

try {
  await writeFile(path.join(fixture, "source.txt"), "source");
  await writeFile(path.join(fixture, "existing.txt"), "existing");

  const listing = await request(`/api/local-fs?path=${encodeURIComponent(fixture)}`);
  assert.equal(listing.response.status, 200);
  const source = listing.body.files.find((entry) => entry.name === "source.txt");
  assert.match(source.owner, /^.+$/);
  assert.match(source.permissions, /^[-dl][rwx-]{9}$/);

  const copy = await request("/api/local-copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sources: [path.join(fixture, "source.txt")], destination: fixture }),
  });
  assert.equal(copy.response.status, 200);
  assert.equal(await readFile(path.join(fixture, "source - Copy.txt"), "utf8"), "source");

  const destination = path.join(fixture, "destination");
  const mkdir = await request("/api/local-mkdir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir: fixture, name: "destination" }),
  });
  assert.equal(mkdir.response.status, 200);

  const move = await request("/api/local-move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sources: [path.join(fixture, "existing.txt")], destination }),
  });
  assert.equal(move.response.status, 200);
  assert.equal(await readFile(path.join(destination, "existing.txt"), "utf8"), "existing");

  console.log("local file manager API tests passed");
} finally {
  await rm(fixture, { recursive: true, force: true });
}
