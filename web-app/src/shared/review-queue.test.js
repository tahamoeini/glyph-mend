import { describe, expect, it } from "vitest";
import { buildReviewQueue, normalizeReviewItem, reviewQueueDecide, reviewQueueSummary } from "./review-queue.js";

describe("review queue model", () => {
  it("normalizes equation review items without losing source evidence", () => {
    const item = normalizeReviewItem({
      id: "eq-1",
      page: 2,
      sourceAsset: { id: "source-1", page: 2, bbox: [1, 2, 3, 4] },
      candidate: { latex: "x + 1 = 2", provider: "mock", version: "1" },
      validation: { sourcePreserved: true },
    });

    expect(item.sourceAsset.id).toBe("source-1");
    expect(item.disposition).toBe("queued");
    expect(item.validation.sourcePreserved).toBe(true);
  });

  it("keeps low-confidence items in review when accept is requested", () => {
    const item = normalizeReviewItem({
      id: "eq-2",
      page: 1,
      candidate: { latex: "x =", provider: "mock", version: "1" },
      validation: { mandatoryPassed: false },
      disposition: "review",
    });

    const next = reviewQueueDecide(item, "accept");
    expect(next.disposition).toBe("review");
    expect(next.status).toBe("review");
  });

  it("revalidates edited latex and preserves original source when edited text still passes", () => {
    const item = normalizeReviewItem({
      id: "eq-3",
      page: 3,
      candidate: { latex: "x + 1 = 2", provider: "mock", version: "1" },
      validation: { mandatoryPassed: true },
      disposition: "review",
    });

    const next = reviewQueueDecide(item, "edit");
    expect(next.validation.sourcePreserved).toBe(true);
    expect(["review", "preserved"]).toContain(next.disposition);
  });

  it("summarizes queue dispositions and builds ordered items from page checkpoints", () => {
    const queue = buildReviewQueue({
      1: { page: 1, reviewItems: [{ id: "a", page: 1, disposition: "review", kind: "equation" }] },
      2: { page: 2, reviewItems: [{ id: "b", page: 2, disposition: "preserved", kind: "equation" }] },
    });

    expect(queue.map((item) => item.id)).toEqual(["a", "b"]);
    expect(reviewQueueSummary(queue)).toMatchObject({ total: 2, review: 1, preserved: 1 });
  });
});