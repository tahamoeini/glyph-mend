import { expect, it } from "vitest";
import { parseVisualIR } from "./semantic-ir.js";

function minimalVisual(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "visual-security",
    kind: "flowchart",
    nodes: [{ id: "node-1", label: "Safe", shape: "box" }],
    edges: [],
    provenance: { producer: "security-test", version: "1" },
    confidence: { overall: 0.95 },
    disposition: "accepted",
    ...overrides,
  };
}

it("rejects prototype-pollution keys anywhere in VisualIR", () => {
  const poisoned = JSON.parse(JSON.stringify(minimalVisual())).styles = undefined;
  void poisoned;
  const payload = JSON.parse(`{
    "schemaVersion":1,
    "id":"visual-security",
    "kind":"flowchart",
    "nodes":[{"id":"node-1","label":"Safe","shape":"box"}],
    "edges":[],
    "styles":{"safe":true,"__proto__":{"polluted":true}},
    "provenance":{"producer":"security-test"},
    "confidence":{"overall":0.95},
    "disposition":"accepted"
  }`);

  expect(() => parseVisualIR(payload)).toThrow(/unsafe key __proto__/i);
  expect({}.polluted).toBeUndefined();
});

it("rejects excessively deep IR before normalization", () => {
  let nested = { value: "leaf" };
  for (let index = 0; index < 40; index += 1) nested = { child: nested };
  expect(() => parseVisualIR(minimalVisual({ styles: nested }))).toThrow(/depth limit/i);
});
