import { expect, it } from "vitest";
import { inlineEquationCandidates, splitEquationProse } from "./math-markdown.js";

it("isolates trailing prose from a display equation", () => {
  expect(
    splitEquationProse(
      "0.284 × (33 + 0.162 × 33) + 0.162 × 33 = 16.23. This is higher than given",
    ),
  ).toEqual({
    equation: "0.284 × (33 + 0.162 × 33) + 0.162 × 33 = 16.23",
    prose: "This is higher than given",
  });
});

it("identifies explicit and conservative inline equation candidates", () => {
  const candidates = inlineEquationCandidates(
    "The result is $E = mc^2$ and the measured value x_i = 3 remains in prose.",
  );
  expect(candidates.map((candidate) => candidate.mode)).toEqual(["inline", "inline"]);
  expect(candidates[0].explicit).toBe(true);
  expect(candidates[0].latex).toContain("E = mc^2");
  expect(candidates[1].latex).toContain("x_i = 3");
});

it("does not split ordinary prose with an incidental comparison", () => {
  expect(splitEquationProse("The value is 3 = 3. This is explanatory prose")).toBeNull();
});
