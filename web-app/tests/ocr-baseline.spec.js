import { expect, test } from "@playwright/test";

function samplePdf() {
  const stream =
    "BT /F1 24 Tf 72 700 Td (Browser OCR Baseline Test) Tj 0 -40 Td /F1 16 Tf (Readable local OCR content.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

test("forces OCR through the restored local Tesseract pipeline", async ({ page }) => {
  const pageErrors = [];
  const failedResponses = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      /(?:tesseract|tessdata|traineddata|wasm)/i.test(response.url())
    ) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/");
  await page.locator("#pdfInput").setInputFiles({
    name: "ocr-baseline.pdf",
    mimeType: "application/pdf",
    buffer: samplePdf(),
  });
  await expect(page.locator("#workspace")).toBeVisible();

  await page.locator("details.advanced").evaluate((details) => {
    details.open = true;
  });
  await page.locator("#forceOcr").check();
  await page.locator("#extractButton").click();

  await expect(page.locator("#statusText")).toContainText("complete", {
    timeout: 60000,
  });
  await expect(page.locator("#progressText")).toHaveText("100%");
  await expect(page.locator("#markdownEditor")).toHaveValue(
    /Browser OCR Baseline Test/i,
  );
  expect(failedResponses).toEqual([]);
  expect(pageErrors).toEqual([]);
});
