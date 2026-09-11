import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";

const indexHtml = readFileSync("index.html", "utf8");
const appSource = readFileSync("src/app.js", "utf8");
const styleSource = readFileSync("src/styles/style.css", "utf8");

it("keeps the core workspace controls labelled and keyboard-oriented", () => {
  const document = new JSDOM(indexHtml).window.document;
  expect(document.querySelector("#progressAnnouncement")?.getAttribute("aria-live")).toBe("polite");
  expect(document.querySelector("#reviewQueueAnnouncement")?.getAttribute("aria-live")).toBe("polite");
  expect(document.querySelector("#reviewQueueList")?.getAttribute("role")).toBe("list");
  expect(document.querySelector("#pdfCanvas")?.getAttribute("aria-label")).toBe("Source page preview");
  expect(document.querySelector("#sidebarBackdrop")?.getAttribute("aria-label")).toBe("Close settings");
  expect(document.querySelector("#inspectorBackdrop")?.getAttribute("aria-label")).toBe("Close quality and export");
  const positiveTabStops = [...document.querySelectorAll("[tabindex]")].filter(
    (element) => Number(element.getAttribute("tabindex")) > 0,
  );
  expect(positiveTabStops).toHaveLength(0);
});

it("keeps preference adaptation and sheet focus behavior explicit", () => {
  expect(appSource).toContain('root.dataset.transparency = media.reducedTransparency.matches');
  expect(appSource).toContain("const inert = compact && !modal;");
  expect(appSource).toContain('element.setAttribute("role", "dialog")');
  expect(appSource).toContain('event.key === "Tab" && isCompactLayout()');
  expect(styleSource).toContain(':root[data-transparency="reduce"] .liquid-glass');
  expect(styleSource).toContain(':root[data-forced-colors="active"]');
  expect(styleSource).toContain("transition-property: opacity;");
});
