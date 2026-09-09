import { expect, it } from "vitest";
import { captionFor, latexMarkdown } from "./extract-worker.js";

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
