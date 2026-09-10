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
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
        .join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
      "binary",
    ),
  );
  return Buffer.concat(chunks);
}

function runningMatterPdf() {
  const pageStream = (body) =>
    [
      "BT /F1 9 Tf 72 760 Td (RUNNING HEADER) Tj ET",
      `BT /F1 11 Tf 72 620 Td (${body}) Tj ET`,
      "BT /F1 9 Tf 72 30 Td (RUNNING FOOTER) Tj ET",
    ].join("\n");
  const first = pageStream("First body text.");
  const second = pageStream("Second body text.");
  const third = pageStream("Third body text.");
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(first, "binary")} >>\nstream\n${first}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${Buffer.byteLength(second, "binary")} >>\nstream\n${second}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents 8 0 R >>",
    `<< /Length ${Buffer.byteLength(third, "binary")} >>\nstream\n${third}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ]);
}

test("remove header and footer options remove repeated running matter from Markdown", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#pdfInput").setInputFiles({
    name: "running-matter.pdf",
    mimeType: "application/pdf",
    buffer: runningMatterPdf(),
  });
  await expect(page.locator("#workspace")).toBeVisible();

  await page.locator("details.advanced").evaluate((details) => {
    details.open = true;
  });
  await page.locator("#useOcr").uncheck();
  await page.locator("#removeHeaders").check();
  await page.locator("#removeFooters").check();
  await page.locator("#extractButton").click();

  await expect(page.locator("#statusText")).toContainText("complete", {
    timeout: 30000,
  });
  const markdown = await page.locator("#markdownEditor").inputValue();
  expect(markdown).toContain("First body text");
  expect(markdown).toContain("Second body text");
  expect(markdown).toContain("Third body text");
  expect(markdown).not.toContain("RUNNING HEADER");
  expect(markdown).not.toContain("RUNNING FOOTER");
});
