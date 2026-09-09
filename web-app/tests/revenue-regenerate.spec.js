import { expect, test } from "@playwright/test";

const source =
  "/mnt/c/Users/Taha/Downloads/The Theory and Practice of Revenue Management/The Theory and Practice of Revenue Management.pdf";

test("regenerates the Revenue Management pages 1 to 75", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto("/");
  await page.locator("#pdfInput").setInputFiles(source);
  await page.locator('input[name="rangeMode"][value="custom"]').check();
  await page.locator("#pageRange").fill("1-75");
  await page.locator("#extractButton").click();
  await expect(page.locator("#statusText")).toContainText("complete", {
    timeout: 230000,
  });

  for (const [selector, suffix] of [
    ["#downloadMarkdown", ".md"],
    ["#downloadText", ".txt"],
    ["#downloadReport", ".report.json"],
    ["#downloadDocx", ".docx"],
  ]) {
    const download = page.waitForEvent("download");
    await page.locator(selector).click();
    await (await download).saveAs(test.info().outputPath(`revenue${suffix}`));
  }
});
