import { expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { markdownToDocx } from "./docx-export.js";
async function contents(blob) {
  const bytes = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return unzipSync(new Uint8Array(bytes));
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
