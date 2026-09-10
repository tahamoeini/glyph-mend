import { expect, it } from "vitest";
import { captionFor, latexMarkdown, looksLikeOcrEquation } from "./extract-worker.js";

it("reconstructs equation candidates as LaTeX instead of visual assets", () => {
  expect(latexMarkdown("p ≤ μ + ½")).toBe("p \\leq \\mu + \\frac{1}{2}");
});

it("associates a nearby figure caption with its visual placeholder", () => {
  const blocks = [
    {
      lines: [
        {
          text: "Figure 3.2. Booking curve by fare class",
          bbox: [70, 240, 320, 254],
        },
      ],
    },
  ];
  expect(captionFor(blocks, [60, 100, 340, 230], 12)).toBe(
    "Figure 3.2. Booking curve by fare class",
  );
});

it("rejects Revenue Management prose and headings as equations", () => {
  expect(looksLikeOcrEquation("2.2.2.1 Dynamic Programming Formulation")).toBe(false);
  expect(
    looksLikeOcrEquation(
      "chosen to present all problems in discrete time. This eliminates several",
    ),
  ).toBe(false);
  expect(looksLikeOcrEquation("p2 = p1 P(D1 > y1)")).toBe(true);
});
