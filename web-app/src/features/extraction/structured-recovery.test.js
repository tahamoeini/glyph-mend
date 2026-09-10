import { describe, expect, it } from "vitest";
import {
  enrichStructuredTextOptions,
  installMuPdfStructuredRecovery,
  jsonImageRects,
} from "./structured-recovery.js";

describe("structured text recovery", () => {
  it("adds paragraph and table analysis without dropping caller options", () => {
    const options = enrichStructuredTextOptions("preserve-whitespace,segment");
    const values = new Set(options.split(","));
    expect(values).toEqual(
      new Set([
        "preserve-whitespace",
        "preserve-images",
        "preserve-spans",
        "segment",
        "paragraph-break",
        "table-hunt",
        "vectors",
      ]),
    );
  });

  it("recovers and deduplicates nested image regions from structured JSON", () => {
    const structured = {
      asJSON: () =>
        JSON.stringify({
          blocks: [
            { type: "image", bbox: { x: 10, y: 20, w: 100, h: 50 } },
            {
              type: "structure",
              children: [
                { type: "image", bbox: [10, 20, 110, 70] },
                { type: "image", bbox: { x: 40, y: 90, w: 150, h: 80 } },
              ],
            },
          ],
        }),
    };
    expect(jsonImageRects(structured)).toEqual([
      [10, 20, 110, 70],
      [40, 90, 190, 170],
    ]);
  });

  it("replays JSON images omitted by walk while preserving native callbacks", () => {
    class Page {
      toStructuredText(options) {
        return options;
      }
    }
    class StructuredText {
      asJSON() {
        return JSON.stringify({
          blocks: [
            { type: "image", bbox: { x: 50, y: 60, w: 80, h: 40 } },
          ],
        });
      }
      walk(walker) {
        walker.beginTextBlock?.([0, 0, 10, 10]);
        walker.endTextBlock?.();
      }
    }

    const fakeMuPdf = { Page, StructuredText };
    installMuPdfStructuredRecovery(fakeMuPdf);

    const page = new Page();
    expect(page.toStructuredText("preserve-whitespace")).toContain("paragraph-break");

    const images = [];
    new StructuredText().walk({
      onImageBlock(bbox, _transform, image) {
        images.push(bbox);
        expect(typeof image.destroy).toBe("function");
      },
    });
    expect(images).toEqual([[50, 60, 130, 100]]);
  });
});
