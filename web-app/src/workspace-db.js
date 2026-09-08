import { openDB } from "idb";
const DB = "pdf-sanitizer-browser";
const STORE = "workspaces";
const CURRENT = "current";
let database;
async function db() {
  return (database ||= openDB(DB, 2, {
    upgrade(value) {
      if (!value.objectStoreNames.contains(STORE))
        value.createObjectStore(STORE);
    },
  }));
}
export async function saveWorkspace(value) {
  const safe = {
    ...value,
    pdfBytes: value.pdfBytes
      ? Array.from(new Uint8Array(value.pdfBytes))
      : null,
    updatedAt: new Date().toISOString(),
    schema: 2,
  };
  await (await db()).put(STORE, safe, CURRENT);
}
export async function loadWorkspace() {
  const value = await (await db()).get(STORE, CURRENT);
  if (value?.pdfBytes) value.pdfBytes = new Uint8Array(value.pdfBytes).buffer;
  return value || null;
}
export async function clearWorkspace() {
  await (await db()).delete(STORE, CURRENT);
}
export function serializeWorkspace(value) {
  return JSON.stringify({
    ...value,
    pdfBytes: value.pdfBytes ? arrayToBase64(value.pdfBytes) : null,
    schema: 2,
    exportedAt: new Date().toISOString(),
  });
}
export function deserializeWorkspace(text) {
  const value = JSON.parse(text);
  if (value.schema !== 2) throw new Error("Unsupported workspace format.");
  if (value.pdfBytes) value.pdfBytes = base64ToArray(value.pdfBytes);
  return value;
}
function arrayToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let value = "";
  for (let i = 0; i < bytes.length; i += 32768)
    value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
}
function base64ToArray(value) {
  const binary = atob(value),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
