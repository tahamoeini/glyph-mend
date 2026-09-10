import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const html = readFileSync("index.html", "utf8");
const document = new JSDOM(html).window.document;

const legacyControlIds = [
  "pdfInput",
  "workspaceInput",
  "markdownInput",
  "restoreButton",
  "pageRange",
  "removeHeaders",
  "removeFooters",
  "joinParagraphs",
  "detectHeadings",
  "detectTables",
  "extractEquations",
  "preserveVisuals",
  "taskLists",
  "flows",
  "placeholders",
  "preserveMarkers",
  "useOcr",
  "forceOcr",
  "ocrLanguage",
  "ocrDpi",
  "pdfPassword",
  "maxFileMb",
  "maxPages",
  "checkpointPages",
  "strict",
  "extractButton",
  "pauseButton",
  "cancelButton",
  "exportWorkspaceButton",
  "clearWorkspaceButton",
  "markdownEditor",
  "renderedPreview",
  "sourcePreview",
  "activityLog",
  "searchInput",
  "previewPage",
  "previousPage",
  "nextPage",
  "zoomOut",
  "zoomIn",
  "logLevel",
  "downloadLog",
  "clearLog",
  "docxTitle",
  "docxPageBreaks",
  "downloadMarkdown",
  "downloadDocx",
  "downloadText",
  "downloadReport",
  "downloadBundle",
];

const enabledOptionIds = [
  "removeHeaders",
  "removeFooters",
  "joinParagraphs",
  "detectHeadings",
  "detectTables",
  "extractEquations",
  "preserveVisuals",
  "taskLists",
  "flows",
  "placeholders",
  "preserveMarkers",
  "useOcr",
];

describe("application UI contract", () => {
  it("preserves every interactive control ID without duplicates", () => {
    const ids = [...document.querySelectorAll("[id]")].map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    legacyControlIds.forEach((id) => expect(document.getElementById(id)).not.toBeNull());
  });

  it("preserves extraction defaults and keeps technical settings advanced", () => {
    enabledOptionIds.forEach((id) =>
      expect(document.getElementById(id).checked).toBe(true),
    );
    expect(document.getElementById("forceOcr").checked).toBe(false);
    expect(document.getElementById("strict").checked).toBe(false);
    expect(document.getElementById("ocrDpi").value).toBe("300");
    expect(document.getElementById("maxFileMb").value).toBe("512");
    expect(document.getElementById("maxPages").value).toBe("2000");
    expect(document.getElementById("checkpointPages").value).toBe("20");
    expect(
      document.getElementById("ocrDpi").closest("details").classList.contains("advanced"),
    ).toBe(true);
  });

  it("exposes accessible document tabs and local export actions", () => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];

    expect(tabs.map((tab) => tab.dataset.tab)).toEqual([
      "markdown",
      "preview",
      "source",
      "log",
    ]);
    tabs.forEach((tab) => {
      expect(tab.getAttribute("aria-controls")).toBeTruthy();
      expect(document.getElementById(tab.getAttribute("aria-controls"))).not.toBeNull();
    });
    expect(document.querySelectorAll(".downloads > button")).toHaveLength(5);
  });
});
