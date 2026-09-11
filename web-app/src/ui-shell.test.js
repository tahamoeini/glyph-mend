import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const html = readFileSync("index.html", "utf8");
const document = new JSDOM(html).window.document;
const contentSurfaceIds = [
  "welcome",
  "dropZone",
  "markdownEditor",
  "renderedPreview",
  "sourcePreview",
  "activityLog",
  "qualityReport",
  "reviewQueuePanel",
];

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
  "resetClientStorageButton",
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
  "reviewQueueTotal",
  "reviewQueueAccepted",
  "reviewQueueReview",
  "reviewQueuePreserved",
  "reviewQueueList",
  "reviewQueueDetails",
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
    expect(document.getElementById("reviewQueuePanel")).not.toBeNull();
  });

  it("keeps liquid glass restricted to functional chrome", () => {
    expect(document.querySelectorAll(".liquid-glass")).toHaveLength(3);
    expect(document.querySelector(".topbar.liquid-glass-toolbar")).not.toBeNull();
    expect(document.getElementById("settingsSidebar").classList.contains("liquid-glass-sidebar")).toBe(true);
    expect(document.querySelector(".page-controls.liquid-glass-capsule")).not.toBeNull();

    contentSurfaceIds.forEach((id) => {
      const element = document.getElementById(id);
      expect(element?.classList.contains("liquid-glass")).toBe(false);
      expect(element?.className.includes("glass-panel")).toBe(false);
    });
  });

  it("uses a shared selection indicator for tabs and preserves roving tabindex", () => {
    const tablist = document.querySelector('.tabs[role="tablist"]');
    const indicator = tablist.querySelector(".liquid-selection-indicator");
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];

    expect(indicator).not.toBeNull();
    expect(tablist.firstElementChild).toBe(indicator);
    expect(tabs).toHaveLength(4);
    expect(tabs.filter((tab) => tab.classList.contains("active"))).toHaveLength(1);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].tabIndex).toBe(0);
    tabs.slice(1).forEach((tab) => {
      expect(tab.getAttribute("aria-selected")).toBe("false");
      expect(tab.tabIndex).toBe(-1);
    });
  });

  it("provides a consistent inline svg icon system for interactive chrome", () => {
    const sprite = document.querySelector(".icon-sprite");

    expect(sprite).not.toBeNull();
    expect(sprite.querySelectorAll("symbol").length).toBeGreaterThanOrEqual(8);
    [
      "themeButton",
      "sidebarToggle",
      "extractButton",
      "previousPage",
      "nextPage",
      "zoomOut",
      "zoomIn",
    ].forEach((id) => {
      expect(document.getElementById(id)?.querySelector("svg.icon")).not.toBeNull();
    });
  });
});
