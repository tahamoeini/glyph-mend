import { expect, test } from "@playwright/test";
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
