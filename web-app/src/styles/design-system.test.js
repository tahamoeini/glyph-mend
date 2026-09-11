import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/styles/style.css", "utf8");
const fixture = new JSDOM(readFileSync("design-system.html", "utf8")).window.document;

describe("design-system surface contract", () => {
  it("uses the small semantic content and glass vocabulary in both themes", () => {
    ["--surface-content-background", "--surface-content-elevated", "--surface-content-inset"].forEach((token) => {
      expect(css).toMatch(new RegExp(`${token}:`, "g"));
    });
    ["--glass-regular-fill", "--glass-clear-fill", "--glass-selected-overlay-fill"].forEach((token) => {
      expect(css).toMatch(new RegExp(`${token}:`, "g"));
    });
    expect(css).not.toContain("--material-content");
    expect(css).not.toMatch(/liquid-glass-(toolbar|sidebar|capsule)/);
  });

  it("keeps glass on navigation and compact controls rather than content", () => {
    expect(fixture.querySelectorAll(".liquid-glass")).toHaveLength(3);
    expect(fixture.querySelector(".content-panel.liquid-glass")).toBeNull();
    expect(fixture.querySelector(".liquid-glass-selected-overlay")).not.toBeNull();
  });
});
