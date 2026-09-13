import { expect, it } from "vitest";
import {
  coalesceStructuredBlocks,
  coalesceStructuredLines,
  mergeAdjacentStructuredLines,
} from "./structured-lines.js";

const line = (text, x0, y0, x1, y1 = y0 + 10) => ({
  text,
  bbox: [x0, y0, x1, y1],
  size: 10,
});

it("coalesces same-baseline visual spans without inserting letter breaks", () => {
  const lines = coalesceStructuredLines([
    line("T", 10, 20, 15),
    line("his", 15, 20, 32),
    line("is", 36, 20, 45),
    line("a", 49, 20, 55),
    line("title", 59, 20, 84),
  ]);

  expect(lines).toHaveLength(1);
  expect(lines[0].text).toBe("This is a title");
});

it("keeps real vertical lines separate", () => {
  const lines = coalesceStructuredLines([
    line("Heading", 10, 20, 70),
    line("Paragraph", 10, 42, 80),
  ]);

  expect(lines.map((value) => value.text)).toEqual(["Heading", "Paragraph"]);
});

it("deduplicates overlaid blocks and merges adjacent spans across blocks", () => {
  const blocks = coalesceStructuredBlocks([
    { bbox: [10, 20, 32, 30], lines: [line("This", 10, 20, 32)] },
    { bbox: [10, 20, 32, 30], lines: [line("This", 10, 20, 32)] },
    { bbox: [32, 20, 52, 30], lines: [line(" works", 32, 20, 52)] },
  ]);

  expect(blocks).toHaveLength(1);
  expect(blocks[0].lines[0].text).toBe("This works");
});

it("can join a wrapped structural heading only when the caller opts in", () => {
  const result = mergeAdjacentStructuredLines(
    [line("Recommended Communication", 10, 20, 180), line("Model", 10, 36, 55)],
    () => true,
    "space",
  );

  expect(result).toHaveLength(1);
  expect(result[0].text).toBe("Recommended Communication Model");
});
