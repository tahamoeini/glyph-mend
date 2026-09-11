import { expect, test } from "@playwright/test";

test("shows the semantic surface fixture in light and dark appearances", async ({ page }) => {
  await page.goto("/design-system.html");
  await expect(page.getByRole("heading", { name: "Quiet content, deliberate chrome." })).toBeVisible();
  await expect(page.locator(".content-panel.liquid-glass")).toHaveCount(0);
  await expect(page.locator(".liquid-glass")).toHaveCount(3);
  await expect(page.locator(".liquid-glass-regular")).toHaveCount(2);
  await expect(page.locator(".liquid-glass-clear")).toHaveCount(1);
  await expect(page.locator(".liquid-glass-selected-overlay")).toHaveCount(1);
  await page.screenshot({ path: "test-results/design-system-light.png", fullPage: true });

  await page.getByRole("button", { name: "Toggle appearance" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "test-results/design-system-dark.png", fullPage: true });
});
