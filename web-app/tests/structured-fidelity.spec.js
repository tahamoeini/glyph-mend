import { expect, test } from "@playwright/test";

function buildPdf(objects) {
  const chunks = [Buffer.from("%PDF-1.4\n", "binary")];
  const offsets = [0];
  let length = chunks[0].length;

  objects.forEach((object, index) => {
    offsets.push(length);
    const prefix = Buffer.from(`${index + 1} 0 obj\n`, "binary");
    const body = Buffer.isBuffer(object) ? object : Buffer.from(object, "binary");
    const suffix = Buffer.from("\nendobj\n", "binary");
    chunks.push(prefix, body, suffix);
    length += prefix.length + body.length + suffix.length;
  });

  const xref = length;
  const trailer = Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
      .join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    "binary",
  );
  chunks.push(trailer);
  return Buffer.concat(chunks);
}

function textAndImagePdf() {
  const stream = [
    "BT /F1 20 Tf 72 730 Td (TECHNICAL NOTE) Tj ET",
    "BT /F1 11 Tf 72 680 Td (This page has enough native text that OCR should not be required for ordinary prose extraction.) Tj ET",
    "BT /F1 11 Tf 72 662 Td (The embedded image below must still be retained as source evidence.) Tj ET",
    "q 300 0 0 150 72 400 cm /Im1 Do Q",
    "BT /F1 11 Tf 72 375 Td (Figure 1. Embedded source visual) Tj ET",
  ].join("\n");
  const imageBytes = Buffer.from([
    0, 0, 0,
    255, 255, 255,
    255, 255, 255,
    0, 0, 0,
  ]);
  const imageObject = Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${imageBytes.length} >>\nstream\n`,
      "binary",
    ),
    imageBytes,
    Buffer.from("\nendstream", "binary"),
  ]);

  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    imageObject,
  ]);
}

test("preserves structured text and embedded source visuals without forcing OCR", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.locator("#pdfInput").setInputFiles({
    name: "structured-fidelity.pdf",
    mimeType: "application/pdf",
    buffer: textAndImagePdf(),
  });
  await expect(page.locator("#workspace")).toBeVisible();

  await page.locator("details.advanced").evaluate((details) => {
    details.open = true;
  });
  await page.locator("#useOcr").uncheck();
  await page.locator("#extractButton").click();

  await expect(page.locator("#statusText")).toContainText("complete", {
    timeout: 30000,
  });
  await expect(page.locator("#progressText")).toHaveText("100%");

  const markdown = await page.locator("#markdownEditor").inputValue();
  expect(markdown).toContain("TECHNICAL NOTE");
  expect(markdown).toContain("This page has enough native text");
  expect(markdown).toMatch(/\[SOURCE_VISUAL page=1[^\]]+\]/);
  expect(markdown).toContain('caption="Figure 1. Embedded source visual"');
  expect(errors).toEqual([]);
});
