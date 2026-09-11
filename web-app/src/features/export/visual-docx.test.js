import { expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { markdownToDocx } from "./docx-export.js";
import {
  DOCX_VISUAL_EXPORT_TIERS,
  mapVisualIRToDrawingML,
} from "./visual-docx.js";

async function contents(blob) {
  const bytes = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return unzipSync(new Uint8Array(bytes));
}

const fallbackPng = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

function acceptedVisual(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "native-flow",
    kind: "flowchart",
    nodes: [
      { id: "start", label: "Start", shape: "rounded-box", bbox: [0, 0, 80, 40], geometry: { bbox: [0, 0, 80, 40] } },
      { id: "decision", label: "Ready?", shape: "diamond", bbox: [140, 0, 220, 60], geometry: { bbox: [140, 0, 220, 60] } },
      { id: "end", label: "End", shape: "text-box", bbox: [280, 0, 360, 40], geometry: { bbox: [280, 0, 360, 40] } },
    ],
    edges: [
      { id: "e1", source: "start", target: "decision", directed: true, geometry: { type: "straight" } },
      { id: "e2", source: "decision", target: "end", directed: false, geometry: { type: "elbow", points: [[220, 30], [250, 30], [250, 20], [280, 20]] } },
    ],
    provenance: { producer: "test" },
    confidence: { overall: 0.96 },
    disposition: "accepted",
    ...overrides,
  };
}

it("maps only the supported VisualIR subset to editable DrawingML shapes", () => {
  const mapped = mapVisualIRToDrawingML(acceptedVisual());

  expect(mapped.ok).toBe(true);
  expect(mapped.tier).toBe(DOCX_VISUAL_EXPORT_TIERS.native);
  expect(mapped.xml).toContain("<wpg:wgp>");
  expect(mapped.xml).toContain('prst="roundRect"');
  expect(mapped.xml).toContain('prst="diamond"');
  expect(mapped.xml).toContain('prst="line"');
  expect(mapped.xml).toContain('type="triangle"');
  expect(mapped.xml).toContain("Ready?");
});

it("writes native shapes into the generated DOCX XML", async () => {
  const files = await contents(
    await markdownToDocx(
      '[SOURCE_VISUAL page=5 id="native-1" kind="graphic" bbox="0,0,360,60"]',
      "Native test",
      { assets: new Map([["native-1", { visualIR: acceptedVisual() }]]) },
    ),
  );
  const xml = strFromU8(files["word/document.xml"]);

  expect(xml).toContain("<wpg:wgp>");
  expect(xml).toContain('prst="roundRect"');
  expect(xml).toContain('prst="diamond"');
  expect(xml).toContain('prst="line"');
  expect(xml).toContain('type="triangle"');
});
it("rejects ambiguous native cases instead of approximating them", () => {
  const mapped = mapVisualIRToDrawingML(acceptedVisual({ warnings: ["ambiguous connector"] }));

  expect(mapped.ok).toBe(false);
  expect(mapped.reason).toMatch(/warnings|preservation/i);
});

it("embeds supplied SVG assets as SVG media with a raster compatibility fallback", async () => {
  const files = await contents(
    await markdownToDocx(
      '[SOURCE_VISUAL page=3 id="svg-1" kind="graphic" bbox="0,0,80,40"]',
      "SVG test",
      {
        assets: new Map([[
          "svg-1",
          {
            id: "svg-1",
            svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><rect width="80" height="40"/></svg>',
            fallbackData: fallbackPng,
            width: 80,
            height: 40,
          },
        ]]),
      },
    ),
  );
  const mediaNames = Object.keys(files).filter((name) => name.startsWith("word/media/"));

  expect(mediaNames.some((name) => name.endsWith(".svg"))).toBe(true);
  expect(strFromU8(files["word/document.xml"])).toContain("svgBlip");
});

it("falls back to the supplied SVG when native VisualIR is unsupported", async () => {
  const files = await contents(
    await markdownToDocx(
      '[SOURCE_VISUAL page=4 id="freeform-1" kind="graphic" bbox="0,0,80,40"]',
      "Fallback test",
      {
        assets: new Map([[
          "freeform-1",
          {
            visualIR: acceptedVisual({ nodes: acceptedVisual().nodes.map((node) => ({ ...node, shape: "hexagon" })) }),
            svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><path d="M0 0h80v40H0z"/></svg>',
            fallbackData: fallbackPng,
            width: 80,
            height: 40,
          },
        ]]),
      },
    ),
  );
  const xml = strFromU8(files["word/document.xml"]);

  expect(xml).not.toContain("<wpg:wgp>");
  expect(Object.keys(files).some((name) => name.endsWith(".svg"))).toBe(true);
});

it("embeds a supported Mermaid fence as SVG when a compatibility fallback is supplied", async () => {
  const fence = String.fromCharCode(96).repeat(3);
  const markdown = fence + "mermaid\nflowchart LR\n  n1[\"Alpha\"]\n  n2[\"Beta\"]\n  n1 --> n2\n" + fence;
  const files = await contents(
    await markdownToDocx(markdown, "Mermaid test", {
      mermaidAsset: { fallbackData: fallbackPng, width: 160, height: 80 },
    }),
  );

  expect(Object.keys(files).some((name) => name.endsWith(".svg"))).toBe(true);
  expect(strFromU8(files["word/document.xml"])).toContain("svgBlip");
});