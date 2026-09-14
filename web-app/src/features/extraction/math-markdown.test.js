import { expect, it } from "vitest";
import { splitEquationProse } from "./math-markdown.js";

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

it("does not split ordinary prose with an incidental comparison", () => {
  expect(splitEquationProse("The value is 3 = 3. This is explanatory prose")).toBeNull();
});
