import { openDB } from "idb";
import {
  parseUntrustedJson,
  SECURITY_LIMITS,
  validateWorkspacePayload,
} from "../security/validation.js";
// Keep the existing IndexedDB name so the GlyphMend rebrand does not orphan
// users' resumable workspaces. This is a persistence compatibility identifier,
// not the current product name.
const DB = "pdf-sanitizer-browser",
  META = "metadata",
  PAGES = "pages",
  PDF = "pdf",
  LOGS = "logs",
  CURRENT = "current";
const OCR_CACHE_DB = "keyval-store";
const LOCAL_PREFERENCES = [
  "pdf-sanitizer-theme",
  "pdf-sanitizer-sidebar",
  "glyphmend-theme",
  "glyphmend-sidebar",
  "glyphmend-runtime-brand-v1",
];
export const CHECKPOINT_REVISION = 1;
let database;
async function db() {
  return (database ||= openDB(DB, 4, {
    upgrade(value) {
      for (const name of [META, PAGES, PDF, LOGS])
        if (!value.objectStoreNames.contains(name))
          value.createObjectStore(name, { autoIncrement: name === LOGS });
      if (value.objectStoreNames.contains("workspaces"))
        value.deleteObjectStore("workspaces");
    },
  }));
}
function currentMeta(meta) {
  return {
    ...meta,
    schema: 4,
    checkpointRevision: CHECKPOINT_REVISION,
    updatedAt: new Date().toISOString(),
  };
}
export async function startWorkspace(meta, pdfBytes) {
  const value = await db(),
    tx = value.transaction([META, PAGES, PDF, LOGS], "readwrite");
  await Promise.all([
    tx.objectStore(META).put(currentMeta(meta), CURRENT),
    tx.objectStore(PDF).put(pdfBytes, CURRENT),
    tx.objectStore(PAGES).clear(),
    tx.objectStore(LOGS).clear(),
  ]);
  await tx.done;
}
export async function savePage(page) {
  const value = await db();
  await value.put(PAGES, page, page.page);
}
export async function saveResult(meta) {
  const value = await db(),
    previous = await value.get(META, CURRENT);
  await value.put(META, currentMeta({ ...previous, ...meta }), CURRENT);
}
export async function appendStoredLog(event) {
  await (await db()).add(LOGS, event);
}
export async function loadWorkspace() {
  const value = await db(),
    meta = await value.get(META, CURRENT);
  if (!meta) return null;
  const compatible = meta.checkpointRevision === CHECKPOINT_REVISION;
  if (!compatible) await value.clear(PAGES);
  const [pdfBytes, pageValues, logs] = await Promise.all([
    value.get(PDF, CURRENT),
    compatible ? value.getAll(PAGES) : Promise.resolve([]),
    value.getAll(LOGS),
  ]);
  return {
    ...meta,
    // app.js already has the canonical extraction-version mismatch path. Mark
    // pre-revision workspaces incompatible so stale v10 pages cannot be resumed
    // after the structured-fidelity fix, without changing the public report schema.
    extractionVersion: compatible ? meta.extractionVersion : -1,
    checkpointRevision: compatible ? CHECKPOINT_REVISION : 0,
    pdfBytes,
    pages: Object.fromEntries(pageValues.map((page) => [page.page, page])),
    logs,
  };
}
export async function clearWorkspace() {
  const value = await db(),
    tx = value.transaction([META, PAGES, PDF, LOGS], "readwrite");
  await Promise.all(
    [META, PAGES, PDF, LOGS].map((name) => tx.objectStore(name).clear()),
  );
  await tx.done;
}
export async function resetClientStorage() {
  database?.close();
  database = undefined;
  await Promise.all([
    deleteDatabase(DB),
    deleteDatabase(OCR_CACHE_DB),
    clearAppCaches(),
  ]);
  try {
    LOCAL_PREFERENCES.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage can be unavailable in private browsing modes.
  }
}

function deleteDatabase(name) {
  if (!globalThis.indexedDB) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

async function clearAppCaches() {
  if (!globalThis.caches) return;
  const names = await caches.keys();
  await Promise.all(
    names
      .filter(
        (name) =>
          name.startsWith("workbox-") ||
          name.startsWith("glyphmend") ||
          name.startsWith("pdf-sanitizer"),
      )
      .map((name) => caches.delete(name)),
  );
}
export function serializeWorkspace(value) {
  return JSON.stringify(
    {
      ...value,
      schema: 4,
      checkpointRevision: CHECKPOINT_REVISION,
      exportedAt: new Date().toISOString(),
    },
    (_key, item) => {
      if (item instanceof ArrayBuffer)
        return { __binary: "array-buffer", base64: arrayToBase64(item) };
      if (item instanceof Uint8Array)
        return { __binary: "uint8-array", base64: arrayToBase64(item) };
      return item;
    },
  );
}
export function deserializeWorkspace(text) {
  const value = parseUntrustedJson(text, (_key, item) => {
    if (item?.__binary === "array-buffer") return base64ToArray(item.base64);
    if (item?.__binary === "uint8-array")
      return new Uint8Array(base64ToArray(item.base64));
    return item;
  });
  if (![2, 3, 4].includes(value.schema))
    throw new Error("Unsupported workspace format.");
  if (typeof value.pdfBytes === "string")
    value.pdfBytes = base64ToArray(value.pdfBytes);
  const compatible = value.checkpointRevision === CHECKPOINT_REVISION;
  return validateWorkspacePayload({
    ...value,
    schema: 4,
    checkpointRevision: compatible ? CHECKPOINT_REVISION : 0,
    extractionVersion: compatible ? value.extractionVersion : -1,
  });
}
function arrayToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let value = "";
  for (let i = 0; i < bytes.length; i += 32768)
    value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
}
function base64ToArray(value) {
  if (typeof value !== "string") throw new Error("Workspace binary payload is invalid.");
  const maxEncodedChars = Math.ceil((SECURITY_LIMITS.workspacePdfBytes * 4) / 3) + 8;
  if (value.length > maxEncodedChars)
    throw new Error("Workspace binary payload exceeds the import byte ceiling.");
  const binary = atob(value),
    bytes = new Uint8Array(binary.length);
  if (bytes.byteLength > SECURITY_LIMITS.workspacePdfBytes)
    throw new Error("Workspace binary payload exceeds the import byte ceiling.");
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
