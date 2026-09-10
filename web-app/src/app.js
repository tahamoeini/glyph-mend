import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import DOMPurify from "dompurify";
import { strToU8, zipSync } from "fflate";
import { marked } from "marked";
import { registerSW } from "virtual:pwa-register";
import {
  cleanupDocument,
  documentMetrics,
  parsePageRange,
  plainText,
  qualityAudit,
} from "./features/extraction/cleanup.js";
import {
  appendStoredLog,
  clearWorkspace,
  deserializeWorkspace,
  loadWorkspace,
  resetClientStorage,
  savePage,
  saveResult,
  serializeWorkspace,
  startWorkspace,
} from "./storage/workspace-db.js";
import { download, stem } from "./shared/download.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
registerSW({ immediate: true });
const $ = (id) => document.getElementById(id);
// OCR runtime cache and structural recovery changed in this release. Existing
// checkpoints must not be presented as results from the current pipeline.
const EXTRACTION_VERSION = 8;
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
  abortBatch: null,
  previewScale: 1.2,
  options: {},
  logs: [],
  warnings: [],
  startedAt: null,
  audit: { status: "pass", issues: [] },
  engine: "mupdf-wasm",
  previewUrls: [],
  previewRenderTask: null,
  previewRenderToken: 0,
  checkpointWrites: new Set(),
  checkpointError: null,
};
const optionIds = [
  "removeHeaders",
  "removeFooters",
  "joinParagraphs",
  "detectHeadings",
  "detectTables",
  "extractEquations",
  "preserveVisuals",
  "useOcr",
  "forceOcr",
  "taskLists",
  "flows",
  "placeholders",
  "preserveMarkers",
  "strict",
];
const appearanceStorageKey = "pdf-sanitizer-theme";
const media = {
  colorScheme: queryMedia("(prefers-color-scheme: dark)"),
  reducedMotion: queryMedia("(prefers-reduced-motion: reduce)"),
  reducedTransparency: queryMedia("(prefers-reduced-transparency: reduce)"),
  highContrast: queryMedia("(prefers-contrast: more)"),
  forcedColors: queryMedia("(forced-colors: active)"),
  coarsePointer: queryMedia("(pointer: coarse)"),
  mobileSidebar: queryMedia("(max-width: 820px)"),
};

function queryMedia(query) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return {
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    };
  }
  return window.matchMedia(query);
}

function onMediaChange(queryList, listener) {
  if (typeof queryList.addEventListener === "function") {
    queryList.addEventListener("change", listener);
    return;
  }
  if (typeof queryList.addListener === "function") queryList.addListener(listener);
}

function readStoredTheme() {
  try {
    const storedTheme = localStorage.getItem(appearanceStorageKey);
    return storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : null;
  } catch {
    return null;
  }
}

function systemTheme() {
  return media.colorScheme.matches ? "dark" : "light";
}

function syncAdaptivePreferences() {
  const root = document.documentElement;
  root.dataset.motion = media.reducedMotion.matches ? "reduce" : "normal";
  root.dataset.transparency = media.reducedTransparency.matches
    ? "reduce"
    : "normal";
  root.dataset.contrast = media.highContrast.matches ? "more" : "normal";
  root.dataset.forcedColors = media.forcedColors.matches ? "active" : "none";
  root.dataset.pointer = media.coarsePointer.matches ? "coarse" : "fine";
}

function syncThemePreference() {
  const storedTheme = readStoredTheme();
  document.documentElement.dataset.appearance = storedTheme
    ? "manual"
    : "system";
  applyTheme(storedTheme || systemTheme());
}

function syncTabIndicator(container = document.querySelector(".tabs")) {
  if (!container) return;
  const indicator = container.querySelector(".liquid-selection-indicator");
  const activeTab = container.querySelector(".tab.active");
  if (!indicator || !activeTab) return;
  if (!activeTab.offsetWidth) {
    indicator.style.opacity = "0";
    return;
  }
  indicator.style.width = `${activeTab.offsetWidth}px`;
  indicator.style.transform = `translate3d(${activeTab.offsetLeft}px, 0, 0)`;
  indicator.style.borderRadius = getComputedStyle(activeTab).borderRadius;
  indicator.style.opacity = "1";
}

function toast(message, error = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = error ? "show error" : "show";
  setTimeout(() => (el.className = ""), 3500);
}
function log(stage, message, details = {}, level = "info", store = true) {
  const event = {
    time: new Date().toISOString(),
    level,
    stage,
    message,
    details,
  };
  state.logs.push(event);
  if (store) appendStoredLog(event).catch(() => {});
  renderLog();
}
function renderLog() {
  const verbose = $("logLevel")?.value === "debug";
  $("logOutput").textContent = state.logs
    .filter((e) => verbose || e.level !== "debug")
    .map(
      (e) =>
        `${e.time} [${e.level.toUpperCase()}] [${e.stage}] ${e.message}${Object.keys(e.details || {}).length ? ` ${JSON.stringify(e.details)}` : ""}`,
    )
    .join("\n");
  $("logOutput").scrollTop = $("logOutput").scrollHeight;
}
function setStatus(message, done = 0, total = 0) {
  $("statusText").textContent = message;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("progress").value = pct;
  $("progress").textContent = `${pct}%`;
  $("progressText").textContent = `${pct}%`;
  const page = message.match(/page\s+(\d+)/i)?.[1];
  $("progressPage").textContent = total
    ? page
      ? `Page ${page} of ${total}`
      : `${done} of ${total} pages processed`
    : message === "Ready"
      ? "Configure the document, then start extraction."
      : "Preparing the document workspace";
  $("progressStage").textContent = /ocr/i.test(message)
    ? "OCR"
    : /complete|finished/i.test(message)
      ? "Complete"
      : /failed|cancel/i.test(message)
        ? "Needs attention"
        : /pause/i.test(message)
          ? "Paused"
          : /open|start|read|extract/i.test(message)
            ? "Extracting document"
            : "Document status";
}
function options() {
  return {
    ...Object.fromEntries(optionIds.map((id) => [id, $(id).checked])),
    ocrLanguage: $("ocrLanguage").value,
    ocrDpi: Number($("ocrDpi").value) || 300,
  };
}
function setWorking(value) {
  state.running = value;
  $("extractButton").disabled = value;
  $("extractButtonLabel").textContent = value
    ? "Extraction in progress"
    : "Extract document";
  $("pauseButton").classList.toggle("hidden", !value);
  $("cancelButton").classList.toggle("hidden", !value);
  $("workspace").setAttribute("aria-busy", String(value));
}
function saveCheckpoint(checkpoint) {
  const write = savePage(checkpoint);
  write.catch((error) => {
    state.checkpointError = error;
    log("checkpoint-error", error.message, { page: checkpoint.page }, "error");
  });
  state.checkpointWrites.add(write);
  write.then(
    () => state.checkpointWrites.delete(write),
    () => state.checkpointWrites.delete(write),
  );
}
async function waitForCheckpointWrites() {
  await Promise.allSettled([...state.checkpointWrites]);
  if (state.checkpointError) throw state.checkpointError;
}
function activateWorkspace() {
  $("welcome").classList.add("hidden");
  $("workspace").classList.remove("hidden");
  $("fileName").textContent = state.fileName;
  $("fileMeta").textContent =
    `${state.pageCount} pages · ${(state.fileSize / 1048576).toFixed(1)} MB`;
  $("topFileName").textContent = state.fileName || "Markdown workspace";
  $("topFileMeta").textContent = state.pageCount
    ? `${state.pageCount} pages · ${(state.fileSize / 1048576).toFixed(1)} MB`
    : "Review and export imported Markdown";
  closeMobileSidebar();
  updateOutput();
  renderLog();
  requestAnimationFrame(() => syncTabIndicator());
}
function wasmUrl() {
  return new URL("./wasm/", location.href).href;
}

async function preparePdf(buffer) {
  await state.pdf?.destroy?.();
  state.pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    isEvalSupported: false,
    wasmUrl: wasmUrl(),
    password: $("pdfPassword").value || undefined,
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
    const maxBytes = (Number($("maxFileMb").value) || 512) * 1048576;
    if (file.size > maxBytes)
      throw new Error(
        `PDF is ${(file.size / 1048576).toFixed(1)} MB; configured maximum is ${Math.round(maxBytes / 1048576)} MB.`,
      );
    setStatus("Opening PDF…");
    const bytes = await file.arrayBuffer();
    Object.assign(state, {
      fileName: file.name,
      fileSize: file.size,
      pdfBytes: bytes,
      pages: {},
      markdown: "",
      logs: [],
      warnings: [],
      startedAt: new Date().toISOString(),
      audit: { status: "pass", issues: [] },
    });
    await preparePdf(bytes);
    const max = Number($("maxPages").value) || 2000;
    if (state.pageCount > max)
      throw new Error(
        `PDF has ${state.pageCount} pages; configured maximum is ${max}.`,
      );
    await startWorkspace(
      {
        fileName: state.fileName,
        fileSize: state.fileSize,
        pageCount: state.pageCount,
        markdown: "",
        options: {},
        warnings: [],
        extractionVersion: EXTRACTION_VERSION,
        engine: state.engine,
      },
      bytes,
    );
    log("validate", "PDF opened", {
      name: file.name,
      bytes: file.size,
      pages: state.pageCount,
      engine: state.engine,
      extractionVersion: EXTRACTION_VERSION,
    });
    activateWorkspace();
    renderSource(1);
    toast("PDF opened locally.");
  } catch (error) {
    log("error", "Could not open PDF", { error: error.message }, "error");
    toast(`Could not open PDF: ${error.message}`, true);
  }
}
function selectedPages() {
  const custom =
    document.querySelector("input[name=rangeMode]:checked").value === "custom";
  return custom
    ? parsePageRange($("pageRange").value, state.pageCount)
    : Array.from({ length: state.pageCount }, (_, i) => i + 1);
}
function runBatch(batch, wanted) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./features/extraction/extract-worker.js", import.meta.url),
      {
      type: "module",
      },
    );
    state.worker = worker;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      worker.terminate();
      state.worker = null;
      state.abortBatch = null;
      error ? reject(error) : resolve();
    };
    const startupTimeout = setTimeout(
      () =>
        finish(
          new Error(
            "The extraction engine did not start within 45 seconds. Verify that /mupdf/mupdf.js and /mupdf/mupdf-wasm.wasm are deployed and reload the application.",
          ),
        ),
      45000,
    );
    state.abortBatch = (reason) =>
      finish(Object.assign(new Error(reason), { aborted: true }));
    worker.onmessage = ({ data }) => {
      if (data.type === "worker-started") {
        log("worker-start", "Extraction worker started", {}, "debug");
        return;
      }
      if (data.type === "engine-ready") {
        clearTimeout(startupTimeout);
        log("engine-ready", "MuPDF WebAssembly engine loaded", {}, "debug");
        return;
      }
      if (data.type === "page-start") {
        setStatus(
          `Reading page ${data.page}`,
          wanted.filter((page) => state.pages[page]).length,
          wanted.length,
        );
        return;
      }
      if (data.type === "page") {
        const checkpoint = {
          page: data.page,
          text: data.text,
          bodySize: data.bodySize,
          assets: data.assets || [],
          edges: data.edges || {},
          quality: data.quality || {},
          engine: data.engine || state.engine,
        };
        state.pages[data.page] = checkpoint;
        saveCheckpoint(checkpoint);
        const done = wanted.filter((page) => state.pages[page]).length;
        setStatus(`Extracting page ${data.page}`, done, wanted.length);
        log(
          "page-complete",
          `Extracted page ${data.page}`,
          {
            ...checkpoint.quality,
            percent: Math.round((done / wanted.length) * 100),
          },
          "debug",
        );
      }
      if (data.type === "ocr-progress") {
        setStatus(
          `OCR page ${data.page}: ${data.status}`,
          wanted.filter((page) => state.pages[page]).length,
          wanted.length,
        );
        if (data.progress === 1 && data.status === "recognizing text")
          log("ocr", `OCR completed for page ${data.page}`, {}, "debug");
      }
      if (data.type === "ocr-error") {
        log(
          "ocr-error",
          `OCR failed for page ${data.page}`,
          { error: data.message },
          "error",
        );
      }
      if (data.type === "page-error") {
        state.warnings.push(data);
        log(
          "page-error",
          `Skipped page ${data.page}`,
          { error: data.message },
          "warning",
        );
      }
      if (data.type === "done") finish();
      if (data.type === "error") finish(new Error(data.message));
    };
    worker.onerror = (event) =>
      finish(
        Object.assign(
          new Error(
            event.message || "The extraction worker stopped unexpectedly.",
          ),
          { workerCrash: true, filename: event.filename, lineno: event.lineno },
        ),
      );
    const bytes = state.pdfBytes.slice(0);
    worker.postMessage(
      {
        type: "extract",
        buffer: bytes,
        pages: batch,
        options: state.options,
        password: $("pdfPassword").value,
        ocrPaths: {
          workerPath: new URL("./tesseract/worker.min.js", location.href).toString(),
          corePath: new URL("./tesseract-core", location.href).toString(),
          langPath: new URL("./tessdata", location.href).toString(),
        },
      },
      [bytes],
    );
  });
}
async function extract() {
  if (!state.pdfBytes) return;
  let wanted;
  try {
    wanted = selectedPages();
  } catch (error) {
    return toast(error.message, true);
  }
  const remaining = wanted.filter((page) => !state.pages[page]);
  if (!remaining.length) {
    finalize(wanted);
    return toast("Selected pages are already extracted.");
  }
  state.options = options();
  state.checkpointError = null;
  state.startedAt = new Date().toISOString();
  setWorking(true);
  setStatus(
    "Starting extraction…",
    wanted.length - remaining.length,
    wanted.length,
  );
  const batchSize = Math.max(
    1,
    Math.min(100, Number($("checkpointPages").value) || 20),
  );
  log("extract-start", "Starting browser extraction", {
    selectedPages: wanted.length,
    resumedPages: wanted.length - remaining.length,
    batchSize,
    options: state.options,
  });
  try {
    for (let offset = 0; offset < remaining.length; offset += batchSize) {
      if (!state.running) break;
      const batch = remaining.slice(offset, offset + batchSize);
      log(
        "batch-start",
        "Starting bounded extraction batch",
        { firstPage: batch[0], lastPage: batch.at(-1), pages: batch.length },
        "debug",
      );
      await runBatch(batch, wanted);
      await waitForCheckpointWrites();
      log("checkpoint-write", "Extraction batch committed", {
        completedPages: wanted.filter((page) => state.pages[page]).length,
      });
      await persist();
    }
    if (!state.running) return;
    finalize(wanted);
    const completed = wanted.filter((page) => state.pages[page]).length;
    const skipped = wanted.length - completed;
    setStatus(
      skipped
        ? `Extraction finished with ${skipped} skipped page${skipped === 1 ? "" : "s"}`
        : "Extraction complete",
      completed,
      wanted.length,
    );
    await persist();
    log("complete", "Extraction complete", {
      processed: Object.keys(state.pages).length,
      warnings: state.warnings.length,
      quality: state.audit.status,
      seconds: (Date.now() - Date.parse(state.startedAt)) / 1000,
    });
    toast("Extraction complete.");
  } catch (error) {
    if (!error.aborted) {
      setStatus(
        error.workerCrash ? "Extraction worker failed" : "Extraction failed",
      );
      log(
        error.workerCrash ? "worker-crash" : "fatal",
        error.message,
        { filename: error.filename, lineno: error.lineno },
        "error",
      );
      toast(error.message, true);
    }
  } finally {
    setWorking(false);
  }
}
async function stop(cancel = false) {
  state.running = false;
  state.abortBatch?.(cancel ? "cancelled" : "paused");
  state.abortBatch = null;
  state.worker = null;
  setWorking(false);
  setStatus(cancel ? "Cancelled" : "Paused");
  if (cancel) {
    state.pages = {};
    state.markdown = "";
    await startWorkspace(
      {
        fileName: state.fileName,
        fileSize: state.fileSize,
        pageCount: state.pageCount,
        markdown: "",
        options: state.options,
        warnings: [],
        extractionVersion: EXTRACTION_VERSION,
        engine: state.engine,
      },
      state.pdfBytes,
    );
  } else await persist();
  log(
    cancel ? "cancel" : "pause",
    cancel
      ? "Extraction cancelled and checkpoints removed"
      : "Extraction paused",
    { preservedPages: Object.keys(state.pages).length },
  );
  updateOutput();
}
function finalize(
  wanted = Object.keys(state.pages)
    .map(Number)
    .sort((a, b) => a - b),
) {
  state.markdown = cleanupDocument(
    wanted.map((page) => state.pages[page]).filter(Boolean),
    state.options || options(),
  );
  updateOutput();
}
function updateOutput() {
  if (state.markdown && !$("markdownEditor").matches(":focus"))
    $("markdownEditor").value = state.markdown;
  const enabled = !!state.markdown;
  [
    "downloadMarkdown",
    "downloadDocx",
    "downloadText",
    "downloadReport",
    "downloadBundle",
  ].forEach((id) => ($(id).disabled = !enabled));
  const m = documentMetrics(state.markdown);
  state.metrics = m;
  state.audit = qualityAudit(
    Object.values(state.pages),
    state.markdown,
    state.warnings,
  );
  const issueCount = state.warnings.length + state.audit.issues.length;
  $("documentStats").textContent = enabled
    ? `${m.words.toLocaleString()} words · ${Object.keys(state.pages).length} pages · ${state.audit.status}`
    : "";
  const statusClass = String(state.audit.status)
    .toLowerCase()
    .replace(/[^a-z-]/g, "");
  $("qualityBadge").className = `status-badge ${enabled ? statusClass : "neutral"}`;
  $("qualityBadge").textContent = enabled ? state.audit.status : "Waiting";
  $("qualityReport").innerHTML =
    `<div class="metric-card metric-status"><dt>Quality status</dt><dd>${state.audit.status}</dd></div><div class="metric-card"><dt>Pages</dt><dd>${Object.keys(state.pages).length}</dd></div><div class="metric-card"><dt>Words</dt><dd>${m.words.toLocaleString()}</dd></div><div class="metric-card${issueCount ? " quality-issue warning" : ""}"><dt>Issues</dt><dd>${issueCount}</dd></div><div class="metric-card"><dt>Headings</dt><dd>${m.headings}</dd></div><div class="metric-card"><dt>Tables</dt><dd>${m.tables}</dd></div><div class="metric-card"><dt>Equations</dt><dd>${m.equations}</dd></div><div class="metric-card"><dt>Visuals</dt><dd>${m.sourceVisuals}</dd></div>${state.audit.issues.map((issue) => `<div class="metric-card quality-issue ${issue.severity || "warning"}"><dt>${issue.code}</dt><dd>${issue.count}</dd></div>`).join("")}`;
  renderMarkdown();
}
function renderMarkdown() {
  state.previewUrls.forEach(URL.revokeObjectURL);
  state.previewUrls = [];
  const source = (state.markdown || "*Extract a document to begin.*").replace(
    /^\[SOURCE_VISUAL\s+[^\]]*id="([^"]+)"[^\]]*kind="([^"]+)"[^\]]*\]$/gm,
    (_all, id, kind) =>
      `<figure class="source-visual-preview" data-asset="${encodeURIComponent(id)}"><figcaption>Preserved source ${kind}</figcaption></figure>`,
  );
  $("renderedPreview").innerHTML = DOMPurify.sanitize(
    marked.parse(source, { gfm: true }),
  );
  const assets = assetMap();
  $("renderedPreview")
    .querySelectorAll("[data-asset]")
    .forEach((figure) => {
      const asset = assets.get(decodeURIComponent(figure.dataset.asset));
      if (!asset?.data) return;
      const url = URL.createObjectURL(
        new Blob([asset.data], { type: "image/png" }),
      );
      state.previewUrls.push(url);
      const image = new Image();
      image.src = url;
      image.alt = `Preserved source ${asset.kind}`;
      figure.prepend(image);
    });
}
async function renderSource(pageNumber) {
  if (!state.pdf) return;
  const number = Math.max(
    1,
    Math.min(state.pageCount, Number(pageNumber) || 1),
  );
  $("previewPage").value = number;
  const renderToken = ++state.previewRenderToken;
  const previousTask = state.previewRenderTask;
  if (previousTask) {
    previousTask.cancel();
    try {
      await previousTask.promise;
    } catch {}
    if (renderToken !== state.previewRenderToken) return;
  }
  try {
    const page = await state.pdf.getPage(number),
      viewport = page.getViewport({ scale: state.previewScale }),
      canvas = $("pdfCanvas"),
      ctx = canvas.getContext("2d");
    if (renderToken !== state.previewRenderToken) {
      page.cleanup();
      return;
    }
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const renderTask = page.render({ canvasContext: ctx, viewport });
    state.previewRenderTask = renderTask;
    await renderTask.promise;
    if (state.previewRenderTask === renderTask) state.previewRenderTask = null;
    page.cleanup();
  } catch (error) {
    if (error?.name === "RenderingCancelledException") return;
    state.previewRenderTask = null;
    log(
      "render-error",
      `Could not render page ${number}`,
      { error: error.message },
      "error",
    );
  }
}
async function persist() {
  if (state.pdfBytes)
    await saveResult({
      fileName: state.fileName,
      fileSize: state.fileSize,
      pageCount: state.pageCount,
      markdown: state.markdown,
      options: state.options,
      warnings: state.warnings,
    });
}
async function restore(value) {
  value ||= await loadWorkspace();
  if (!value) return toast("No saved workspace was found.", true);
  Object.assign(state, value);
  state.logs = value.logs || [];
  state.warnings = value.warnings || [];
  if (value.extractionVersion !== EXTRACTION_VERSION) {
    state.pages = {};
    state.markdown = "";
    state.warnings.push({
      code: "STALE_CHECKPOINT",
      message:
        "Older extraction checkpoints were invalidated by the structured extraction upgrade.",
    });
  }
  await preparePdf(state.pdfBytes);
  if (value.exportedAt) {
    await startWorkspace(
      {
        fileName: state.fileName,
        fileSize: state.fileSize,
        pageCount: state.pageCount,
        markdown: state.markdown,
        options: state.options,
        warnings: state.warnings,
        extractionVersion: EXTRACTION_VERSION,
        engine: state.engine,
      },
      state.pdfBytes,
    );
    await Promise.all(Object.values(state.pages).map(savePage));
  }
  optionIds.forEach((id) => {
    if (id in (state.options || {})) $(id).checked = state.options[id];
  });
  if (state.options?.ocrLanguage)
    $("ocrLanguage").value = state.options.ocrLanguage;
  if (state.options?.ocrDpi) $("ocrDpi").value = state.options.ocrDpi;
  activateWorkspace();
  renderSource(1);
  log("resume", "Workspace restored", {
    completedPages: Object.keys(state.pages).length,
    extractionVersion: EXTRACTION_VERSION,
  });
  toast(
    state.pages && Object.keys(state.pages).length
      ? "Workspace restored."
      : "Workspace opened; re-extraction is required after the engine upgrade.",
  );
}
function snapshot() {
  return {
    fileName: state.fileName,
    fileSize: state.fileSize,
    pageCount: state.pageCount,
    pdfBytes: state.pdfBytes,
    pages: state.pages,
    markdown: state.markdown,
    options: state.options,
    warnings: state.warnings,
    logs: state.logs,
  };
}
function report() {
  return {
    schema: 2,
    createdAt: new Date().toISOString(),
    engine: state.engine,
    extractionVersion: EXTRACTION_VERSION,
    document: {
      name: state.fileName,
      bytes: state.fileSize,
      pages: state.pageCount,
    },
    processedPages: Object.keys(state.pages).map(Number),
    options: state.options,
    metrics: state.metrics,
    audit: state.audit,
    pageQuality: Object.values(state.pages).map(({ page, quality }) => ({
      page,
      ...quality,
    })),
    warnings: state.warnings,
    events: state.logs,
  };
}
function assetMap() {
  return new Map(
    Object.values(state.pages)
      .flatMap((page) => page.assets || [])
      .map((asset) => [asset.id, asset]),
  );
}
function logText() {
  return state.logs
    .map(
      (e) =>
        `${e.time} [${e.level.toUpperCase()}] [${e.stage}] ${e.message} ${JSON.stringify(e.details || {})}`,
    )
    .join("\n");
}
function save(kind) {
  const base = stem(state.fileName || "document.pdf");
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
  if (kind === "workspace")
    download(
      new Blob(
        [
          serializeWorkspace({
            ...snapshot(),
            extractionVersion: EXTRACTION_VERSION,
            engine: state.engine,
          }),
        ],
        { type: "application/json" },
      ),
      `${base}.pdfsanitizer.json`,
    );
  if (kind === "report")
    download(
      new Blob([JSON.stringify(report(), null, 2)], {
        type: "application/json",
      }),
      `${base}.report.json`,
    );
  if (kind === "log")
    download(new Blob([logText()], { type: "text/plain" }), `${base}.log`);
  if (kind === "bundle") {
    const files = {
      [`${base}.md`]: strToU8(state.markdown),
      [`${base}.txt`]: strToU8(plainText(state.markdown)),
      [`${base}.report.json`]: strToU8(JSON.stringify(report(), null, 2)),
      [`${base}.log`]: strToU8(logText()),
    };
    for (const asset of assetMap().values())
      files[`assets/${asset.id}.png`] = asset.data;
    download(
      new Blob([zipSync(files, { level: 6 })], { type: "application/zip" }),
      `${base}.browser-export.zip`,
    );
  }
}
async function saveDocx() {
  try {
    $("downloadDocx").disabled = true;
    $("downloadDocx").querySelector("small").textContent =
      "Building document…";
    const { markdownToDocx } = await import("./features/export/docx-export.js");
    download(
      await markdownToDocx(
        state.markdown,
        $("docxTitle").value || stem(state.fileName),
        { pageBreaks: $("docxPageBreaks").checked, assets: assetMap() },
      ),
      `${stem(state.fileName || "document.pdf")}.docx`,
    );
    log("docx", "Word document created", {
      pageBreaks: $("docxPageBreaks").checked,
      embeddedVisuals: assetMap().size,
    });
    toast("Word document created.");
  } catch (error) {
    log("docx-error", error.message, {}, "error");
    toast(`DOCX export failed: ${error.message}`, true);
  } finally {
    $("downloadDocx").disabled = false;
    $("downloadDocx").querySelector("small").textContent =
      "Headings, tables, lists, equations, and source visuals";
  }
}

const tabViews = {
  markdown: "markdownEditor",
  preview: "renderedPreview",
  source: "sourcePreview",
  log: "activityLog",
};

function activateTab(tab) {
  document.querySelectorAll(".tab").forEach((candidate) => {
    const isActive = candidate === tab;
    candidate.classList.toggle("active", isActive);
    candidate.setAttribute("aria-selected", String(isActive));
    candidate.tabIndex = isActive ? 0 : -1;
  });
  document
    .querySelectorAll(".tab-view")
    .forEach((view) => view.classList.add("hidden"));
  $(tabViews[tab.dataset.tab]).classList.remove("hidden");
  tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  requestAnimationFrame(() => syncTabIndicator(tab.closest(".tabs")));
  if (tab.dataset.tab === "source") renderSource($("previewPage").value);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("themeButton").setAttribute(
    "aria-label",
    `Switch to ${theme === "dark" ? "light" : "dark"} mode`,
  );
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#171a1f" : "#f2f5f8");
}

function setSidebarExpanded(isExpanded) {
  $("sidebarToggle").setAttribute("aria-expanded", String(isExpanded));
}

function closeMobileSidebar() {
  document.body.classList.remove("sidebar-open");
  if (media.mobileSidebar.matches) setSidebarExpanded(false);
}

function toggleSidebar() {
  if (media.mobileSidebar.matches) {
    const isOpen = document.body.classList.toggle("sidebar-open");
    setSidebarExpanded(isOpen);
    return;
  }
  const isCollapsed = document.body.classList.toggle("sidebar-collapsed");
  setSidebarExpanded(!isCollapsed);
  try {
    localStorage.setItem("pdf-sanitizer-sidebar", isCollapsed ? "collapsed" : "open");
  } catch {}
}

function restoreSidebarPreference() {
  let isCollapsed = false;
  try {
    isCollapsed = localStorage.getItem("pdf-sanitizer-sidebar") === "collapsed";
  } catch {}
  document.body.classList.toggle("sidebar-collapsed", isCollapsed);
  syncSidebarResponsiveState();
}

function syncSidebarResponsiveState() {
  setSidebarExpanded(
    media.mobileSidebar.matches
      ? document.body.classList.contains("sidebar-open")
      : !document.body.classList.contains("sidebar-collapsed"),
  );
  if (!media.mobileSidebar.matches) document.body.classList.remove("sidebar-open");
}

function bind() {
  syncAdaptivePreferences();
  syncThemePreference();
  restoreSidebarPreference();
  requestAnimationFrame(() => syncTabIndicator());
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
      state.logs = [];
      renderLog();
      toast("Saved workspace removed.");
    }
  };
  $("resetClientStorageButton").onclick = async () => {
    if (state.running) {
      toast("Stop extraction before resetting local data.", true);
      return;
    }
    const message =
      "Reset all local PDF Sanitizer data in this browser? This removes saved documents, checkpoints, OCR language data, offline cache, and appearance preferences. Export anything you want to keep first.";
    if (!confirm(message)) return;
    try {
      await resetClientStorage();
      location.reload();
    } catch (error) {
      toast(`Could not reset local data: ${error.message}`, true);
    }
  };
  $("exportWorkspaceButton").onclick = () => save("workspace");
  $("workspaceInput").onchange = async (e) => {
    try {
      await restore(deserializeWorkspace(await e.target.files[0].text()));
    } catch (error) {
      toast(error.message, true);
    }
  };
  $("markdownInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    Object.assign(state, {
      fileName: file.name.replace(/\.md$/i, ".pdf"),
      fileSize: 0,
      pageCount: 0,
      pdfBytes: null,
      pdf: null,
      pages: {},
      markdown: await file.text(),
      logs: [],
      warnings: [],
    });
    activateWorkspace();
    log("markdown-open", "Markdown opened for review and DOCX export", {
      name: file.name,
    });
  };
  $("markdownEditor").oninput = (e) => {
    state.markdown = e.target.value;
    updateOutput();
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(persist, 700);
  };
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => activateTab(tab);
    tab.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll(".tab")];
      const current = tabs.indexOf(tab);
      const target =
        event.key === "Home"
          ? tabs[0]
          : event.key === "End"
            ? tabs.at(-1)
            : tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      activateTab(target);
      target.focus();
    };
  });
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
  $("downloadReport").onclick = () => save("report");
  $("downloadBundle").onclick = () => save("bundle");
  $("downloadLog").onclick = () => save("log");
  $("downloadDocx").onclick = saveDocx;
  $("clearLog").onclick = () => {
    state.logs = [];
    renderLog();
  };
  $("logLevel").onchange = renderLog;
  $("themeButton").onclick = () => {
    const theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    try {
      localStorage.setItem(appearanceStorageKey, theme);
    } catch {}
    document.documentElement.dataset.appearance = "manual";
  };
  $("sidebarToggle").onclick = toggleSidebar;
  $("sidebarBackdrop").onclick = closeMobileSidebar;
  onMediaChange(media.colorScheme, () => {
    syncAdaptivePreferences();
    if (!readStoredTheme()) {
      document.documentElement.dataset.appearance = "system";
      applyTheme(systemTheme());
    }
  });
  [
    media.reducedMotion,
    media.reducedTransparency,
    media.highContrast,
    media.forcedColors,
    media.coarsePointer,
  ].forEach((queryList) => onMediaChange(queryList, syncAdaptivePreferences));
  onMediaChange(media.mobileSidebar, syncSidebarResponsiveState);
  window.addEventListener("resize", () => {
    syncSidebarResponsiveState();
    syncTabIndicator();
  });
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      $("searchInput").focus();
    }
    if (event.key === "Escape") closeMobileSidebar();
  });
  let installPrompt;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    $("installButton").classList.remove("hidden");
  });
  $("installButton").onclick = () => installPrompt?.prompt();
}
bind();
