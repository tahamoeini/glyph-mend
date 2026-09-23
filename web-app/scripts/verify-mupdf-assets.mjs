import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { missingMupdfRuntimeAssets, MUPDF_RUNTIME_ASSETS } from "../src/features/extraction/mupdf-assets.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const mupdfDirectory = join(dist, "mupdf");
const presentAssets = await readdir(mupdfDirectory).catch(() => []);
const missing = missingMupdfRuntimeAssets(presentAssets);
if (missing.length) throw new Error("Build is missing MuPDF runtime assets: " + missing.join(", "));

for (const asset of MUPDF_RUNTIME_ASSETS) {
  const details = await stat(join(mupdfDirectory, asset));
  if (!details.isFile() || details.size === 0) throw new Error("Built MuPDF asset is empty or not a file: " + asset);
}

const wasm = await readFile(join(mupdfDirectory, "mupdf-wasm.wasm"));
if (!wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) {
  throw new Error("Built MuPDF WASM file has an invalid WebAssembly signature.");
}

const serviceWorker = await readFile(join(dist, "sw.js"), "utf8");
for (const asset of MUPDF_RUNTIME_ASSETS) {
  const precachePath = "mupdf/" + asset;
  if (!serviceWorker.includes(precachePath)) throw new Error("Service worker does not precache " + precachePath + ".");
}

let server;
try {
  server = await preview({
    configFile: join(root, "vite.config.js"),
    logLevel: "silent",
    preview: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Local production preview did not bind a TCP port.");
  const baseUrl = "http://127.0.0.1:" + address.port;

  for (const asset of MUPDF_RUNTIME_ASSETS) {
    const response = await fetch(new URL("/mupdf/" + asset, baseUrl));
    if (!response.ok) throw new Error("Local preview returned HTTP " + response.status + " for /mupdf/" + asset + ".");
    const contentType = response.headers.get("content-type") || "";
    if (asset.endsWith(".wasm") && !contentType.toLowerCase().includes("application/wasm")) {
      throw new Error("Local preview served /mupdf/" + asset + " with unexpected content type: " + (contentType || "missing") + ".");
    }
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.length === 0) throw new Error("Local preview returned an empty response for /mupdf/" + asset + ".");
    if (asset.endsWith(".wasm") && !body.slice(0, 4).every((byte, index) => byte === [0, 97, 115, 109][index])) {
      throw new Error("Local preview returned an invalid MuPDF WASM response.");
    }
    console.log("Verified /mupdf/" + asset + ": HTTP " + response.status + ", " + body.length + " bytes, " + (contentType || "unknown content type") + ".");
  }
} finally {
  await server?.close();
}

console.log("MuPDF build, precache, and local preview asset checks passed.");
