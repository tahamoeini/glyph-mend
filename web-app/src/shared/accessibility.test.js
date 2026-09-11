import { expect, it } from "vitest";
import { renderAccessibleMathMarkdown } from "./math-accessibility.js";
import { visualIRToAccessibleDescription } from "./visual-accessibility.js";

it("renders math source as semantic MathML with a textual label", () => {
  const html = renderAccessibleMathMarkdown("Before\n\n$$\nx^2 + y^2 = z^2\n$$");
  expect(html).toContain('role="math"');
  expect(html).toContain("<math display=\"block\"");
  expect(html).toContain("Equation: x^2 + y^2 = z^2");
  expect(html).not.toContain("<script");
});

it("describes VisualIR nodes and edges without relying on visual styling", () => {
  const description = visualIRToAccessibleDescription({
    schemaVersion: 1,
    id: "flow-1",
    kind: "flowchart",
    nodes: [
      { id: "start", label: "Start", shape: "box", geometry: { bbox: [0, 0, 10, 10] } },
      { id: "finish", label: "Finish", shape: "ellipse", geometry: { bbox: [20, 0, 30, 10] } },
    ],
    edges: [{ source: "start", target: "finish", directed: true, label: "next" }],
    provenance: { producer: "test", version: "1" },
    confidence: { overall: 0.9 },
    disposition: "accepted",
  });
  expect(description).toContain("flowchart with 2 nodes and 1 connection");
  expect(description).toContain("Start (rectangle)");
  expect(description).toContain("Start leads to Finish (next)");
});
