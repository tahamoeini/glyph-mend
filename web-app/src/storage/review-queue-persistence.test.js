import { describe, expect, it } from "vitest";
import { deserializeWorkspace, serializeWorkspace } from "./workspace-db.js";

describe("review queue persistence", () => {
  it("round-trips review queue state through workspace serialization", () => {
    const value = {
      schema: 4,
      extractionVersion: 10,
      pdfBytes: new Uint8Array([1, 2, 3]),
      pages: {
        1: {
          page: 1,
          reviewItems: [
            {
              id: "eq-1",
              page: 1,
              disposition: "review",
              sourceAsset: { id: "source-1", page: 1, bbox: [1, 2, 3, 4] },
              candidate: { latex: "x + 1 = 2", provider: "mock", version: "1" },
              validation: { sourcePreserved: true },
            },
          ],
        },
      },
      reviewQueue: [
        {
          id: "eq-1",
          page: 1,
          disposition: "review",
          sourceAsset: { id: "source-1", page: 1, bbox: [1, 2, 3, 4] },
          candidate: { latex: "x + 1 = 2", provider: "mock", version: "1" },
          validation: { sourcePreserved: true },
        },
      ],
    };

    const restored = deserializeWorkspace(serializeWorkspace(value));
    expect(restored.reviewQueue).toHaveLength(1);
    expect(restored.reviewQueue[0].sourceAsset.id).toBe("source-1");
  });

  it("preserves the ability to revert accepted reconstructions back to source evidence", () => {
    const restored = deserializeWorkspace(
      serializeWorkspace({
        schema: 4,
        extractionVersion: 10,
        pdfBytes: new Uint8Array([1]),
        pages: {},
        reviewQueue: [
          {
            id: "eq-2",
            page: 2,
            disposition: "accepted",
            sourceAsset: { id: "source-2", page: 2, bbox: [10, 20, 30, 40] },
            candidate: { latex: "x + 1 = 2", provider: "mock", version: "1" },
            validation: { sourcePreserved: true },
          },
        ],
      }),
    );

    expect(restored.reviewQueue[0].sourceAsset.id).toBe("source-2");
    expect(restored.reviewQueue[0].disposition).toBe("accepted");
  });
});