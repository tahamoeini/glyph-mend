import { expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { Document, Packer } from "docx";
import { equationFromLatex } from "../../shared/equation-ir.js";
import { equationIRParagraph, markdownToDocx, semanticDocumentToDocx } from "./docx-export.js";
import { SEMANTIC_DOCUMENT_IR_V2_FIXTURE } from "../../shared/semantic-document-ir.fixtures.js";
import { shouldUseStreamingDocx } from "./streaming-docx.js";
async function contents(blob) {
  const bytes = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return Object.fromEntries(
    Object.entries(unzipSync(new Uint8Array(bytes))).map(([name, data]) => [
      name,
      Uint8Array.from(data),
    ]),
  );
}
it("creates a DOCX with structural content and native math", async () => {
  const blob = await markdownToDocx(
    "# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$$\n\\frac{1}{2}\n$$",
    "Test",
  );
  const files = await contents(blob);
  expect(blob.type).toContain("officedocument");
  expect(strFromU8(files["word/document.xml"])).toContain("<m:oMath>");
  expect(strFromU8(files["word/document.xml"])).toContain('w:val="Heading1"');
});

it("accepts Semantic Document IR v2 through the DOCX compatibility adapter", async () => {
  const files = await contents(
    await semanticDocumentToDocx(SEMANTIC_DOCUMENT_IR_V2_FIXTURE, "Semantic v2"),
  );
  const xml = strFromU8(files["word/document.xml"]);
  expect(xml).toContain("Capacity Control");
  expect(xml).toContain("Demand");
  expect(xml).toContain("<m:oMath>");
});

it("keeps escaped Markdown table pipes inside their source cell", async () => {
  const markdown = "| Header | Value |\n| --- | --- |\n| A | left\\|right |";
  for (const options of [{ streaming: false }, { streaming: true }]) {
    const files = await contents(await markdownToDocx(markdown, "Table", options));
    const xml = strFromU8(files["word/document.xml"]);
    expect(xml).toContain("left|right");
    expect(xml.match(/<w:tr>/g)).toHaveLength(2);
    expect(xml.match(/<w:tc>/g)).toHaveLength(4);
  }
});

it("exports unlabelled diagram fences as preserved monospaced blocks", async () => {
  for (const fence of [String.fromCharCode(96).repeat(3), "~~~"]) {
    const markdown = `The diagram follows.\n${fence}\nStart --> Decision\n| yes |\n${fence}`;
    for (const options of [{ streaming: false }, { streaming: true }]) {
      const files = await contents(await markdownToDocx(markdown, "Diagram", options));
      const xml = strFromU8(files["word/document.xml"]);
      expect(xml).not.toContain("```\\n");
      expect(xml).not.toContain("~~~\\n");
      expect(xml).toContain("[text source preserved]");
      expect(xml).toContain("Start --&gt; Decision");
      expect(xml).toContain("<w:br/>");
    }
  }
});

it("separates legacy inline page markers before DOCX export", async () => {
  for (const options of [{ streaming: false }, { streaming: true }]) {
    const files = await contents(
      await markdownToDocx("Before <!-- page: 2 --> After", "Markers", {
        ...options,
        pageBreaks: true,
      }),
    );
    const xml = strFromU8(files["word/document.xml"]);
    expect(xml).toContain("Before");
    expect(xml).toContain("After");
    expect(xml).toContain('<w:br w:type="page"/>');
  }
});
it("maps nested math structures to native OMML nodes", async () => {
  const blob = await markdownToDocx(
    "$$\n\\frac{1}{1 + \\frac{1}{x}}\\sum_{i=1}^n i^2\\sqrt{x^2 + 1}\n$$",
    "Test",
  );
  const files = await contents(blob);
  const xml = strFromU8(files["word/document.xml"]);
  expect(xml).toContain("<m:f>");
  expect(xml).toContain("<m:nary>");
  expect(xml).toContain("<m:rad>");
  expect(xml).toContain("<m:sub>");
  expect(xml).toContain("<m:sup>");
});

it("maps validated EquationIR directly to native OMML", async () => {
  const equation = equationFromLatex({
    id: "docx-equation-1",
    page: 1,
    bbox: [10, 20, 200, 60],
    mode: "display",
    latex: "\\frac{a_1}{\\sqrt{b}}",
    source: {
      kind: "vector",
      page: 1,
      bbox: [10, 20, 200, 60],
      cropIds: ["equation-crop-1"],
      cropAvailable: true,
    },
    confidence: {
      detection: 0.95,
      recognition: 0.95,
      structure: 0.95,
      validation: 0.95,
      reconstruction: 0.95,
      export: 0.95,
    },
  });
  const paragraph = await equationIRParagraph(equation);
  const blob = await Packer.toBlob(new Document({ sections: [{ children: [paragraph] }] }));
  const xml = strFromU8((await contents(blob))["word/document.xml"]);
  expect(xml).toContain("<m:f>");
  expect(xml).toContain("<m:rad>");
});

it("maps a validated matrix EquationIR to native OMML matrix rows", async () => {
  const equation = equationFromLatex({
    id: "docx-matrix-1",
    page: 1,
    bbox: [10, 20, 200, 80],
    mode: "display",
    latex: "\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}",
    source: { kind: "vector", page: 1, bbox: [10, 20, 200, 80], cropIds: ["matrix-crop"] },
    confidence: {
      detection: 0.95,
      recognition: 0.95,
      structure: 0.95,
      validation: 0.95,
      reconstruction: 0.95,
      export: 0.95,
    },
  });
  const paragraph = await equationIRParagraph(equation);
  const blob = await Packer.toBlob(new Document({ sections: [{ children: [paragraph] }] }));
  const xml = strFromU8((await contents(blob))["word/document.xml"]);
  expect(xml).toContain("<m:m>");
  expect(xml.match(/<m:mr>/g)).toHaveLength(2);
  expect(xml.match(/<m:e>/g)).toHaveLength(4);
});

it("exports products with the product operator instead of a summation glyph", async () => {
  const files = await contents(
    await markdownToDocx("$$\n\\prod_{i=1}^n i\n$$", "Test"),
  );
  const xml = strFromU8(files["word/document.xml"]);
  expect(xml).toMatch(/m:val="(?:∏|&#x220F;|&#8719;)"/u);
});

it("preserves both scripts when a base has a subscript and superscript", async () => {
  const files = await contents(
    await markdownToDocx("$$\nx_i^2\n$$", "Test"),
  );
  const xml = strFromU8(files["word/document.xml"]);
  expect(xml).toContain("<m:sSubSup>");
  expect(xml).toContain("<m:sub>");
  expect(xml).toContain("<m:sup>");
});

it("retains relations, arithmetic operators, and root degrees", async () => {
  const files = await contents(
    await markdownToDocx("$$\n\\frac{x+1}{y}=\\sqrt[3]{z}\n$$", "Test"),
  );
  const xml = strFromU8(files["word/document.xml"]);
  expect(xml).toContain("<m:t>+</m:t>");
  expect(xml).toContain("<m:t>=</m:t>");
  expect(xml).toContain("<m:deg>");
});

it("retains non-equality relation operators in native DOCX math", async () => {
  const files = await contents(
    await markdownToDocx("$$\nx \\leq y\n$$", "Test"),
  );
  const xml = strFromU8(files["word/document.xml"]);
  expect(xml).toMatch(/<m:t>(?:≤|&#x2264;|&#8804;)<\/m:t>/u);
});

it("keeps an integral differential in the native equation body", async () => {
  const files = await contents(
    await markdownToDocx("$$\n\\int_0^1 x^2 \\mathrm{d}x\n$$", "Test"),
  );
  const xml = strFromU8(files["word/document.xml"]);
  expect(xml).toContain("<m:t>d</m:t>");
  expect(xml).toContain("<m:t>x</m:t>");
});

it("supports explicit source-page breaks", async () => {
  const flowing = await markdownToDocx(
    "One\n\n<!-- page: 2 -->\n\nTwo",
    "Test",
  );
  const paged = await markdownToDocx("One\n\n<!-- page: 2 -->\n\nTwo", "Test", {
    pageBreaks: true,
  });
  expect(paged.size).toBeGreaterThan(flowing.size);
});

it("flushes large Markdown exports in bounded document sections", async () => {
  const progress = [];
  const markdown = Array.from({ length: 1100 }, (_, index) => `Paragraph ${index}`).join("\n\n");
  const blob = await markdownToDocx(markdown, "Large document", {
    maxBlocksPerSection: 32,
    onProgress: (event) => progress.push(event),
  });

  expect(blob.size).toBeGreaterThan(0);
  expect(progress.length).toBeGreaterThan(1);
  expect(progress.at(-1).blocks).toBeGreaterThan(0);
});

it("preserves an oversized equation as source text instead of crashing export", async () => {
  const warnings = [];
  const source = "x".repeat(256 * 1024 + 1);
  const blob = await markdownToDocx(`$$\n${source}\n$$`, "Large equation", {
    onWarning: (warning) => warnings.push(warning),
  });

  expect(blob.size).toBeGreaterThan(0);
  expect(warnings).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "equation" }),
  ]));
});

it("never leaks inline provenance comments and joins Markdown soft lines", async () => {
  const files = await contents(
    await markdownToDocx(
      "A wrapped\nline <!-- page: 2 --> continues here",
      "Test",
    ),
  );
  const xml = strFromU8(files["word/document.xml"]);
  expect(xml).not.toContain("&lt;!--");
  expect(xml).toContain("A wrapped line continues here");
});
it("embeds preserved source visuals", async () => {
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ),
    (c) => c.charCodeAt(0),
  );
  const files = await contents(
    await markdownToDocx(
      '[SOURCE_VISUAL page=7 id="p7-equation-1" kind="equation" bbox="0,0,1,1"]',
      "Test",
      {
        assets: new Map([
          ["p7-equation-1", { data: png, width: 1, height: 1 }],
        ]),
      },
    ),
  );
  expect(
    Object.keys(files).some((name) => name.startsWith("word/media/")),
  ).toBe(true);
});

it("keeps source visual captions visible in both DOCX writers", async () => {
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );
  for (const options of [{ streaming: false }, { streaming: true }]) {
    const files = await contents(
      await markdownToDocx(
        '[SOURCE_VISUAL page=7 id="captioned" kind="graphic" bbox="0,0,1,1" caption="Figure 7.1 Demand curve"]',
        "Caption",
        { ...options, assets: new Map([["captioned", { data: png, width: 1, height: 1, caption: "Figure 7.1 Demand curve" }]]) },
      ),
    );
    expect(strFromU8(files["word/document.xml"])).toContain("Figure 7.1 Demand curve");
  }
});

it("streams large DOCX packages without retaining one document object model", async () => {
  const progress = [];
  const files = await contents(
    await markdownToDocx(
      "# Large export\n\n" +
        Array.from({ length: 300 }, (_, index) => `Paragraph ${index}`).join("\n\n") +
        "\n\n$$\nx_i^2 + \\frac{1}{2}\n$$",
      "Streaming test",
      { streaming: true, onProgress: (event) => progress.push(event) },
    ),
  );

  expect(Object.keys(files)).toEqual(expect.arrayContaining([
    "[Content_Types].xml",
    "word/document.xml",
    "word/_rels/document.xml.rels",
  ]));
  const xml = strFromU8(files["word/document.xml"]);
  expect(xml).toContain("<m:oMath>");
  expect(xml).toContain("Paragraph 299");
  expect(progress.at(-1)).toEqual(expect.objectContaining({ streaming: true, complete: true }));
});

it("preserves binary equation operands in the streaming OMML writer", async () => {
  const files = await contents(
    await markdownToDocx("$$\nx + 1 = 2\n$$", "Streaming equation", {
      streaming: true,
    }),
  );
  const xml = strFromU8(files["word/document.xml"]);
  expect(xml).toContain("<m:t>x</m:t>");
  expect(xml).toContain("<m:t>1</m:t>");
  expect(xml).toContain("<m:t>2</m:t>");
  expect(xml).toContain("<m:t>=</m:t>");
});

it("keeps streaming media in relationship-addressed package entries", async () => {
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );
  const files = await contents(
    await markdownToDocx(
      '[SOURCE_VISUAL page=7 id="streaming-image" kind="image" bbox="0,0,1,1"]',
      "Streaming visual",
      { streaming: true, assets: new Map([["streaming-image", { id: "streaming-image", data: png, width: 1, height: 1 }]]) },
    ),
  );
  expect(Object.keys(files)).toContain("word/media/image-00001.png");
  expect(strFromU8(files["word/document.xml"])).toContain('r:embed="rId8"');
  expect(strFromU8(files["word/_rels/document.xml.rels"])).toContain('Id="rId8"');
  expect(strFromU8(files["word/_rels/document.xml.rels"])).toContain('Target="media/image-00001.png"');
});

it("isolates unreadable streaming assets without dangling relationships", async () => {
  const warnings = [];
  const files = await contents(
    await markdownToDocx(
      '[SOURCE_VISUAL page=7 id="unreadable" kind="image" bbox="0,0,1,1"]',
      "Streaming visual",
      {
        streaming: true,
        assets: new Map([["unreadable", { data: { arrayBuffer: async () => { throw new Error("read failed"); } } }]]),
        onWarning: (warning) => warnings.push(warning),
      },
    ),
  );
  expect(strFromU8(files["word/document.xml"])).toContain("Source image preserved on PDF page 7.");
  expect(strFromU8(files["word/_rels/document.xml.rels"])).not.toContain('Id="rId8"');
  expect(warnings).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "visual", error: "read failed" }),
  ]));
});

it("selects the streaming writer for large inputs and asset-heavy workspaces", () => {
  expect(shouldUseStreamingDocx("x".repeat(512 * 1024))).toBe(true);
  expect(shouldUseStreamingDocx("short", { assets: new Map(Array.from({ length: 512 }, (_, index) => [String(index), {}])) })).toBe(true);
  expect(shouldUseStreamingDocx("short", { streaming: false, assets: new Map(Array.from({ length: 512 }, (_, index) => [String(index), {}])) })).toBe(false);
});
