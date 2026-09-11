import {
  importReconstructableBundle,
  reconstructableBundleToWorkspace,
} from "./shared/reconstructable-bundle-import.js";
import { serializeWorkspace } from "./storage/workspace-db.js";

function toast(message, error = false) {
  const element = document.getElementById("toast");
  if (!element) return;
  element.textContent = message;
  element.className = error ? "show error" : "show";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    if (element.textContent === message) element.className = "";
  }, 3600);
}

function replaceInputFile(input, file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function handOffMarkdown(markdown, baseName = "document") {
  const input = document.getElementById("markdownInput");
  if (!input) throw new Error("Markdown import control is unavailable.");
  replaceInputFile(
    input,
    new File([markdown], `${baseName || "document"}.md`, {
      type: "text/markdown;charset=utf-8",
    }),
  );
}

function handOffWorkspace(workspace, baseName = "document") {
  const input = document.getElementById("workspaceInput");
  if (!input) throw new Error("Workspace import control is unavailable.");
  replaceInputFile(
    input,
    new File([serializeWorkspace(workspace)], `${baseName || "document"}.glyphmend.json`, {
      type: "application/json",
    }),
  );
}

function isZipFile(file) {
  return !!file && (
    /\.(?:zip|reconstructable\.zip)$/i.test(file.name || "") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

export function initBundleImport() {
  const input = document.getElementById("workspaceInput");
  if (!input || input.dataset.bundleImportBound === "true") return;
  input.dataset.bundleImportBound = "true";
  input.accept = "application/json,.json,application/zip,.zip";
  input.setAttribute("aria-label", "Import GlyphMend workspace JSON or reconstructable ZIP bundle");
  const label = input.closest("label");
  const textNode = label ? [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE) : null;
  if (textNode) textNode.textContent = "Import workspace or bundle";

  input.addEventListener(
    "change",
    async (event) => {
      const file = event.target.files?.[0];
      if (!isZipFile(file)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        toast("Validating reconstructable bundle…");
        const imported = await importReconstructableBundle(await file.arrayBuffer());
        const baseName = imported.manifest.exportName || file.name.replace(/\.reconstructable\.zip$/i, "") || "document";
        const workspace = reconstructableBundleToWorkspace(imported);
        if (workspace.pdfBytes && workspace.extractionVersion >= 0) {
          handOffWorkspace(workspace, baseName);
          toast("Reconstructable bundle restored with source evidence.");
        } else {
          handOffMarkdown(imported.markdown, baseName);
          toast("Bundle Markdown restored. Source PDF/checkpoint state was not present in this bundle.");
        }
      } catch (error) {
        toast(`Bundle import rejected: ${error?.message || String(error)}`, true);
      } finally {
        input.value = "";
      }
    },
    true,
  );
}
