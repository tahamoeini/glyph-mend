import { expect, test } from "@playwright/test";

test("serves a restrictive CSP and keeps imported Markdown inert", async ({ page }) => {
  const unexpectedRemoteRequests = [];
  page.on("request", (request) => {
    try {
      if (new URL(request.url()).hostname === "evil.example")
        unexpectedRemoteRequests.push(request.url());
    } catch {}
  });

  await page.goto("/");

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-src 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).not.toContain("script-src 'self' 'unsafe-eval'");

  const maliciousMarkdown = [
    "# Untrusted document",
    "[remote](javascript:window.__glyphmendPwned=true)",
    '<img src="https://evil.example/pixel" onerror="window.__glyphmendPwned=true">',
    '<svg onload="window.__glyphmendPwned=true"><script>window.__glyphmendPwned=true</script></svg>',
  ].join("\n\n");

  await page.locator("#markdownInput").setInputFiles({
    name: "untrusted.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(maliciousMarkdown),
  });

  await expect(page.locator("#markdownEditor")).toContainText("Untrusted document");
  await expect(page.locator("#renderedPreview")).toContainText("Untrusted document");
  await expect(
    page.locator("#renderedPreview img, #renderedPreview svg, #renderedPreview script"),
  ).toHaveCount(0);
  await expect(page.locator("#renderedPreview a")).not.toHaveAttribute("href", /.+/);
  expect(await page.evaluate(() => globalThis.__glyphmendPwned)).toBeUndefined();
  expect(unexpectedRemoteRequests).toEqual([]);
});
