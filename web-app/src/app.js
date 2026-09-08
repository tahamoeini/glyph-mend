import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { registerSW } from "virtual:pwa-register";
import {
  cleanupDocument,
  documentMetrics,
  parsePageRange,
  plainText,
} from "./cleanup.js";
import {
  clearWorkspace,
  deserializeWorkspace,
  loadWorkspace,
  saveWorkspace,
  serializeWorkspace,
} from "./workspace-db.js";
import { download, stem } from "./download.js";
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
registerSW({ immediate: true });
const $ = (id) => document.getElementById(id);
const state = {
  fileName: "",
  fileSize: 0,
  pdfBytes: null,
  pdf: null,
  pageCount: 0,
  pages: {},
  markdown: "",
  worker: null,
  running: false,
  paused: false,
  previewScale: 1.2,
  options: {},
};
const optionIds = [
  "removeHeaders",
  "joinParagraphs",
  "detectHeadings",
  "detectTables",
  "preserveMarkers",
];
function toast(message, error = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = error ? "show error" : "show";
  setTimeout(() => (el.className = ""), 3500);
}
function setStatus(message, done, total) {
  $("statusText").textContent = message;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("progress").value = pct;
  $("progressText").textContent = `${pct}%`;
}
function options() {
  return Object.fromEntries(optionIds.map((id) => [id, $(id).checked]));
}
function setWorking(value) {
  state.running = value;
  $("extractButton").disabled = value;
  $("pauseButton").classList.toggle("hidden", !value);
  $("cancelButton").classList.toggle("hidden", !value);
}
function activateWorkspace() {
  $("welcome").classList.add("hidden");
  $("workspace").classList.remove("hidden");
  $("fileName").textContent = state.fileName;
  $("fileMeta").textContent =
    `${state.pageCount} pages · ${(state.fileSize / 1048576).toFixed(1)} MB`;
  updateOutput();
}
async function preparePdf(buffer) {
  state.pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    isEvalSupported: false,
  }).promise;
  state.pageCount = state.pdf.numPages;
  $("previewPage").max = state.pageCount;
}
async function openFile(file) {
  if (!file) return;
  if (
    file.type &&
    file.type !== "application/pdf" &&
    !/\.pdf$/i.test(file.name)
  )
    return toast("Choose a PDF file.", true);
  try {
    setStatus("Opening PDF…", 0, 0);
    const bytes = await file.arrayBuffer();
    state.fileName = file.name;
    state.fileSize = file.size;
    state.pdfBytes = bytes;
    state.pages = {};
    state.markdown = "";
    await preparePdf(bytes);
    await persist();
    activateWorkspace();
    renderSource(1);
    toast("PDF opened locally.");
  } catch (e) {
    toast(`Could not open PDF: ${e.message}`, true);
  }
}
function selectedPages() {
  const custom =
    document.querySelector("input[name=rangeMode]:checked").value === "custom";
  return custom
    ? parsePageRange($("pageRange").value, state.pageCount)
    : Array.from({ length: state.pageCount }, (_, i) => i + 1);
}
async function extract() {
  if (!state.pdfBytes) return;
  let wanted;
  try {
    wanted = selectedPages();
  } catch (e) {
    return toast(e.message, true);
  }
  const remaining = wanted.filter((p) => !state.pages[p]);
  if (!remaining.length) {
    finalize(wanted);
    return toast("The selected pages are already extracted.");
  }
  state.options = options();
  state.paused = false;
  setWorking(true);
  setStatus(
    "Starting extraction…",
    wanted.length - remaining.length,
    wanted.length,
  );
  const worker = new Worker(new URL("./extract-worker.js", import.meta.url), {
    type: "module",
  });
  state.worker = worker;
  worker.onmessage = async ({ data }) => {
    if (data.type === "page") {
      state.pages[data.page] = {
        page: data.page,
        text: data.text,
        bodySize: data.bodySize,
      };
      const done = wanted.filter((p) => state.pages[p]).length;
      setStatus(`Extracting page ${data.page}`, done, wanted.length);
      if (done % 5 === 0 || done === wanted.length) await persist();
    }
    if (data.type === "done") {
      worker.terminate();
      state.worker = null;
      setWorking(false);
      finalize(wanted);
      await persist();
      toast("Extraction complete.");
    }
    if (data.type === "error") {
      worker.terminate();
      state.worker = null;
      setWorking(false);
      setStatus("Extraction failed", 0, 0);
      toast(data.message, true);
    }
  };
  const workerBytes = state.pdfBytes.slice(0);
  worker.postMessage(
    {
      type: "extract",
      buffer: workerBytes,
      pages: remaining,
      options: state.options,
    },
    [workerBytes],
  );
}
function stop(cancel = false) {
  state.worker?.terminate();
  state.worker = null;
  setWorking(false);
  state.paused = !cancel;
  setStatus(cancel ? "Cancelled" : "Paused", 0, 0);
  if (cancel) state.pages = {};
  persist();
  updateOutput();
}
function finalize(
  wanted = Object.keys(state.pages)
    .map(Number)
    .sort((a, b) => a - b),
) {
  const pages = wanted.map((p) => state.pages[p]).filter(Boolean);
  state.markdown = cleanupDocument(pages, state.options || options());
  updateOutput();
}
function updateOutput() {
  if (state.markdown && !$("markdownEditor").matches(":focus"))
    $("markdownEditor").value = state.markdown;
  const enabled = !!state.markdown;
  ["downloadMarkdown", "downloadDocx", "downloadText"].forEach(
    (id) => ($(id).disabled = !enabled),
  );
  const m = documentMetrics(state.markdown);
  $("documentStats").textContent = enabled
    ? `${m.words.toLocaleString()} words · ${Object.keys(state.pages).length} pages`
    : "";
  $("qualityReport").innerHTML =
    `<div><dt>Pages processed</dt><dd>${Object.keys(state.pages).length}</dd></div><div><dt>Headings</dt><dd>${m.headings}</dd></div><div><dt>Tables</dt><dd>${m.tables}</dd></div><div><dt>Equations</dt><dd>${m.equations}</dd></div><div><dt>Visual placeholders</dt><dd>${m.visuals}</dd></div>`;
  renderMarkdown();
}
function renderMarkdown() {
  const html = marked.parse(
    state.markdown || "*Extract a document to begin.*",
    { gfm: true, breaks: false },
  );
  $("renderedPreview").innerHTML = DOMPurify.sanitize(html);
}
async function renderSource(pageNumber) {
  if (!state.pdf) return;
  const number = Math.max(
    1,
    Math.min(state.pageCount, Number(pageNumber) || 1),
  );
  $("previewPage").value = number;
  const page = await state.pdf.getPage(number),
    viewport = page.getViewport({ scale: state.previewScale }),
    canvas = $("pdfCanvas"),
    ctx = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
}
async function persist() {
  if (!state.pdfBytes) return;
  await saveWorkspace({
    fileName: state.fileName,
    fileSize: state.fileSize,
    pageCount: state.pageCount,
    pdfBytes: state.pdfBytes,
    pages: state.pages,
    markdown: state.markdown,
    options: state.options,
  });
}
async function restore(value) {
  value ||= await loadWorkspace();
  if (!value) return toast("No saved workspace was found.", true);
  Object.assign(state, value);
  await preparePdf(state.pdfBytes);
  optionIds.forEach((id) => {
    if (id in (state.options || {})) $(id).checked = state.options[id];
  });
  activateWorkspace();
  renderSource(1);
  toast("Workspace restored.");
}
function save(kind) {
  const base = stem(state.fileName);
  if (kind === "md")
    download(
      new Blob([state.markdown], { type: "text/markdown;charset=utf-8" }),
      `${base}.md`,
    );
  if (kind === "txt")
    download(
      new Blob([plainText(state.markdown)], {
        type: "text/plain;charset=utf-8",
      }),
      `${base}.txt`,
    );
  if (kind === "workspace") {
    const snapshot = {
      fileName: state.fileName,
      fileSize: state.fileSize,
      pageCount: state.pageCount,
      pdfBytes: state.pdfBytes,
      pages: state.pages,
      markdown: state.markdown,
      options: state.options,
    };
    download(
      new Blob([serializeWorkspace(snapshot)], { type: "application/json" }),
      `${base}.pdfsanitizer.json`,
    );
  }
}
async function saveDocx() {
  try {
    $("downloadDocx").disabled = true;
    $("downloadDocx").querySelector("span").textContent = "Building document…";
    const { markdownToDocx } = await import("./docx-export.js");
    download(
      await markdownToDocx(state.markdown, stem(state.fileName)),
      `${stem(state.fileName)}.docx`,
    );
    toast("Word document created.");
  } catch (e) {
    toast(`DOCX export failed: ${e.message}`, true);
  } finally {
    $("downloadDocx").disabled = false;
    $("downloadDocx").querySelector("span").textContent =
      "Headings, tables, lists, and equations";
  }
}
function bind() {
  $("pdfInput").onchange = (e) => openFile(e.target.files[0]);
  const dz = $("dropZone");
  ["dragenter", "dragover"].forEach((n) =>
    dz.addEventListener(n, (e) => {
      e.preventDefault();
      dz.classList.add("dragging");
    }),
  );
  ["dragleave", "drop"].forEach((n) =>
    dz.addEventListener(n, (e) => {
      e.preventDefault();
      dz.classList.remove("dragging");
    }),
  );
  dz.addEventListener("drop", (e) => openFile(e.dataTransfer.files[0]));
  document
    .querySelectorAll("input[name=rangeMode]")
    .forEach(
      (el) =>
        (el.onchange = () => ($("pageRange").disabled = el.value !== "custom")),
    );
  $("extractButton").onclick = extract;
  $("pauseButton").onclick = () => stop(false);
  $("cancelButton").onclick = () => stop(true);
  $("restoreButton").onclick = () => restore();
  $("clearWorkspaceButton").onclick = async () => {
    if (confirm("Remove the saved browser workspace?")) {
      await clearWorkspace();
      toast("Saved workspace removed.");
    }
  };
  $("exportWorkspaceButton").onclick = () => save("workspace");
  $("workspaceInput").onchange = async (e) => {
    try {
      restore(deserializeWorkspace(await e.target.files[0].text()));
    } catch (err) {
      toast(err.message, true);
    }
  };
  $("markdownEditor").oninput = (e) => {
    state.markdown = e.target.value;
    updateOutput();
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(persist, 700);
  };
  document.querySelectorAll(".tab").forEach(
    (tab) =>
      (tab.onclick = () => {
        document
          .querySelectorAll(".tab")
          .forEach((t) => t.classList.toggle("active", t === tab));
        document
          .querySelectorAll(".tab-view")
          .forEach((v) => v.classList.add("hidden"));
        $(
          {
            markdown: "markdownEditor",
            preview: "renderedPreview",
            source: "sourcePreview",
          }[tab.dataset.tab],
        ).classList.remove("hidden");
        if (tab.dataset.tab === "source") renderSource($("previewPage").value);
      }),
  );
  $("previewPage").onchange = (e) => renderSource(e.target.value);
  $("previousPage").onclick = () =>
    renderSource(Number($("previewPage").value) - 1);
  $("nextPage").onclick = () =>
    renderSource(Number($("previewPage").value) + 1);
  $("zoomOut").onclick = () => {
    state.previewScale = Math.max(0.5, state.previewScale - 0.2);
    renderSource($("previewPage").value);
  };
  $("zoomIn").onclick = () => {
    state.previewScale = Math.min(3, state.previewScale + 0.2);
    renderSource($("previewPage").value);
  };
  $("searchInput").oninput = (e) => {
    const value = e.target.value;
    if (!value) return;
    const editor = $("markdownEditor"),
      at = editor.value
        .toLowerCase()
        .indexOf(value.toLowerCase(), editor.selectionEnd);
    if (at >= 0) {
      editor.focus();
      editor.setSelectionRange(at, at + value.length);
    }
  };
  $("downloadMarkdown").onclick = () => save("md");
  $("downloadText").onclick = () => save("txt");
  $("downloadDocx").onclick = saveDocx;
  let installPrompt;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    $("installButton").classList.remove("hidden");
  });
  $("installButton").onclick = async () => {
    await installPrompt?.prompt();
  };
}
bind();
