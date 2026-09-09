import { expect, test } from "@playwright/test";

function samplePdf() {
  const stream =
    "BT /F1 20 Tf 72 720 Td (Browser Extraction Test) Tj 0 -28 Td /F1 11 Tf (This paragraph remains readable.) Tj ET";
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
    .join(
      "\n",
    )}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

test("loads the complete local application shell", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Turn a PDF into useful, editable content.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Local processing only")).toBeVisible();
  await expect(page.locator("#pdfInput")).toHaveAttribute("accept", /pdf/);
});

test("extracts a PDF through the structured WASM worker", async ({ page }) => {
  const errors = [];
  let wasmResponse;

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (/\/mupdf\/mupdf-wasm\.wasm(?:\?|$)/.test(response.url())) {
      wasmResponse = {
        status: response.status(),
        contentType: response.headers()["content-type"] || "",
      };
    }
  });

  await page.goto("/");
  await page.locator("#pdfInput").setInputFiles({
    name: "sample.pdf",
    mimeType: "application/pdf",
    buffer: samplePdf(),
  });
  await expect(page.locator("#workspace")).toBeVisible();

  // This regression isolates MuPDF's native structured extraction and WASM
  // loading. OCR has its own worker/runtime path and should not mask this test.
  await page.locator("details.advanced").evaluate((details) => {
    details.open = true;
  });
  await page.locator("#useOcr").uncheck();
  await page.locator("#extractButton").click();

  await expect(page.locator("#statusText")).toContainText("complete", {
    timeout: 30000,
  });
  await expect(page.locator("#markdownEditor")).toHaveValue(
    /Browser Extraction Test/,
  );
  expect(wasmResponse).toMatchObject({ status: 200 });
  expect(wasmResponse.contentType).toContain("application/wasm");
  expect(errors).toEqual([]);
});
