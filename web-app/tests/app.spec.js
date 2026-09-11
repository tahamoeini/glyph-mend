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

function rgbaToComponents(color) {
  const values = color.match(/[\d.]+/g)?.map(Number) ?? [];
  const [red = 0, green = 0, blue = 0, alpha = 1] = values;
  return { red, green, blue, alpha };
}

function luminanceFromRgb(red, green, blue) {
  const normalize = (value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };

  const r = normalize(red);
  const g = normalize(green);
  const b = normalize(blue);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const front = luminanceFromRgb(foreground.red, foreground.green, foreground.blue);
  const back = luminanceFromRgb(background.red, background.green, background.blue);
  const lighter = Math.max(front, back);
  const darker = Math.min(front, back);
  return (lighter + 0.05) / (darker + 0.05);
}

async function evaluateThemeTokens(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const parse = (value) => {
      const helper = document.createElement("div");
      helper.style.color = value;
      document.body.append(helper);
      const computed = getComputedStyle(helper).color;
      helper.remove();
      return computed;
    };

    return {
      textPrimary: parse(style.getPropertyValue("--text-primary")),
      textSecondary: parse(style.getPropertyValue("--text-secondary")),
      textTertiary: parse(style.getPropertyValue("--text-tertiary")),
      accentText: parse(style.getPropertyValue("--accent-text")),
      textOnAccent: parse(style.getPropertyValue("--text-on-accent")),
      materialContent: parse(style.getPropertyValue("--surface-content-background")),
      materialInset: parse(style.getPropertyValue("--surface-content-inset")),
      accentFill: parse(style.getPropertyValue("--accent-fill")),
      theme: root.dataset.theme,
      appearance: root.dataset.appearance,
      motion: root.dataset.motion,
      transparency: root.dataset.transparency,
      contrast: root.dataset.contrast,
      pointer: root.dataset.pointer,
    };
  });
}

function expectMinimumContrast(foreground, background, minimum) {
  const ratio = contrastRatio(rgbaToComponents(foreground), rgbaToComponents(background));
  expect(ratio).toBeGreaterThanOrEqual(minimum);
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
  await expect(page.locator("#themeButton")).toHaveAttribute(
    "aria-label",
    /mode/,
  );
  await expect(page.locator(".liquid-glass-selected-overlay")).toHaveCount(1);
});

test("keeps settings, document views, and exports accessible", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#markdownInput").setInputFiles({
    name: "review.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Review\n\nEditable document content."),
  });

  await expect(page.locator("#workspace")).toBeVisible();
  await page.locator("details.advanced summary").click();
  await expect(page.locator("#ocrDpi")).toBeVisible();
  await page.locator("#forceOcr").check();
  await expect(page.locator("#forceOcr")).toBeChecked();

  await page.locator("#previewTab").click();
  await expect(page.locator("#previewTab")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#renderedPreview")).toContainText(
    "Editable document content.",
  );
  await page.locator("#logTab").press("ArrowLeft");
  await expect(page.locator("#sourceTab")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await expect(page.locator("#downloadMarkdown")).toBeEnabled();
  await expect(page.locator("#downloadDocx")).toBeEnabled();
  await expect(page.locator("#downloadText")).toBeEnabled();
  await expect(page.locator("#downloadReport")).toBeEnabled();
  await expect(page.locator("#downloadBundle")).toBeEnabled();
});

test("keeps content opaque and liquid glass limited to functional layers", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#markdownInput").setInputFiles({
    name: "review.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Review\n\nFunctional chrome should float above content."),
  });

  await expect(page.locator(".topbar.liquid-glass-regular")).toBeVisible();
  await expect(page.locator("#settingsSidebar.liquid-glass-regular")).toBeVisible();
  await page.locator("#sourceTab").click();
  await expect(page.locator(".page-controls.liquid-glass-clear")).toBeVisible();
  await expect(page.locator("#welcome.liquid-glass")).toHaveCount(0);
  await expect(page.locator(".editor.liquid-glass")).toHaveCount(0);
  await expect(page.locator(".exports.liquid-glass")).toHaveCount(0);
  await expect(page.locator("#markdownEditor.liquid-glass")).toHaveCount(0);
  await expect(page.locator("#renderedPreview.liquid-glass")).toHaveCount(0);
  await expect(page.locator("#activityLog.liquid-glass")).toHaveCount(0);
  await expect(page.locator(".liquid-glass .liquid-glass")).toHaveCount(0);
});

test("follows system appearance changes until manually overridden", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "system");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "system");

  await page.locator("#themeButton").click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "manual");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("adapts to reduced motion, reduced transparency, high contrast, and coarse pointers", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = originalMatchMedia(query);
      const override = (matches) => ({
        matches,
        media: result.media,
        onchange: result.onchange,
        addEventListener: result.addEventListener?.bind(result),
        removeEventListener: result.removeEventListener?.bind(result),
        addListener: result.addListener?.bind(result),
        removeListener: result.removeListener?.bind(result),
        dispatchEvent: result.dispatchEvent?.bind(result),
      });

      if (query === "(prefers-reduced-transparency: reduce)") return override(true);
      if (query === "(prefers-contrast: more)") return override(true);
      if (query === "(pointer: coarse)") return override(true);
      return result;
    };
  });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark", forcedColors: "none" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "more");
  await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduce");
  await expect(page.locator("html")).toHaveAttribute("data-pointer", "coarse");

  const styles = await page.evaluate(() => {
    const topbar = getComputedStyle(document.querySelector(".topbar"));
    const dropZone = getComputedStyle(document.getElementById("dropZone"));
    const control = getComputedStyle(document.getElementById("themeButton"));
    return {
      topbarBackdrop: topbar.backdropFilter || topbar.webkitBackdropFilter,
      dropZoneTransition: dropZone.transitionProperty,
      controlMinHeight: control.minHeight,
      controlMinWidth: control.minWidth,
    };
  });

  expect(styles.topbarBackdrop === "none" || styles.topbarBackdrop === "").toBe(true);
  expect(styles.dropZoneTransition).toContain("opacity");
  expect(Number.parseFloat(styles.controlMinHeight)).toBeGreaterThanOrEqual(44);
  expect(Number.parseFloat(styles.controlMinWidth)).toBeGreaterThanOrEqual(44);
});

test("adapts workspace panes by available width without losing editor state", async ({ page }) => {
  const modes = [
    { width: 375, mode: "compact", panes: 1 },
    { width: 900, mode: "medium", panes: 2 },
    { width: 1200, mode: "wide", panes: 2 },
    { width: 1600, mode: "extra-wide", panes: 3 },
  ];

  for (const { width, mode, panes } of modes) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/");
    await page.locator("#markdownInput").setInputFiles({
      name: `layout-${mode}.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(`# ${mode}\n\nResponsive workspace validation.`),
    });
    await expect(page.locator("html")).toHaveAttribute("data-layout-mode", mode);
    await expect(page.locator(".editor")).toBeVisible();
    if (mode === "compact") {
      await expect(page.locator("#compactActionDock")).toBeVisible();
      await expect(page.locator("body")).not.toHaveClass(/inspector-open/);
      await expect(page.locator("#resultsInspector")).toHaveCSS("pointer-events", "none");
    } else {
      await expect(page.locator("#resultsInspector")).toBeVisible();
    }
    const columns = await page.locator("#workspace").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    expect(columns).toBeGreaterThanOrEqual(panes);
  }

  await page.setViewportSize({ width: 1200, height: 960 });
  await page.goto("/");
  await page.locator("#markdownInput").setInputFiles({
    name: "resize-state.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Resize state\n\nOriginal content."),
  });
  await page.locator("#markdownEditor").fill("# Resize state\n\nEdited before resize.");
  await page.locator("#previewTab").click();
  await page.setViewportSize({ width: 600, height: 960 });
  await expect(page.locator("html")).toHaveAttribute("data-layout-mode", "compact");
  await expect(page.locator("#previewTab")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#markdownEditor")).toHaveValue("# Resize state\n\nEdited before resize.");
  await page.locator("#compactInspectorButton").click();
  await expect(page.locator("body")).toHaveClass(/inspector-open/);
  await expect(page.locator("#downloadMarkdown")).toBeEnabled();
});
test("keeps theme token contrast above WCAG thresholds in light and dark modes", async ({
  page,
}) => {
  await page.goto("/");
  let tokens = await evaluateThemeTokens(page);
  expectMinimumContrast(tokens.textPrimary, tokens.materialContent, 4.5);
  expectMinimumContrast(tokens.textSecondary, tokens.materialContent, 4.5);
  expectMinimumContrast(tokens.textTertiary, tokens.materialInset, 4.5);
  expectMinimumContrast(tokens.accentText, tokens.accentFill, 4.5);

  await page.locator("#themeButton").click();
  tokens = await evaluateThemeTokens(page);
  expect(tokens.theme).toBe("dark");
  expectMinimumContrast(tokens.textPrimary, tokens.materialContent, 4.5);
  expectMinimumContrast(tokens.textSecondary, tokens.materialContent, 4.5);
  expectMinimumContrast(tokens.textTertiary, tokens.materialInset, 4.5);
  expectMinimumContrast(tokens.textOnAccent, tokens.accentFill, 4.5);
});

test("opens and closes the settings drawer on a small screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 800 });
  await page.goto("/");
  await page.locator("#markdownInput").setInputFiles({
    name: "mobile.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Mobile review"),
  });

  await expect(page.locator("#sidebarToggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.locator("#sidebarToggle").click();
  await expect(page.locator("body")).toHaveClass(/sidebar-open/);
  await expect(page.locator("#sidebarToggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.locator("#sidebarBackdrop").click();
  await expect(page.locator("body")).not.toHaveClass(/sidebar-open/);
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
  await expect(page.locator("#progressText")).toHaveText("100%");
  await expect(page.locator("#progressStage")).toHaveText("Complete");
  await expect(page.locator("#markdownEditor")).toHaveValue(
    /Browser Extraction Test/,
  );
  expect(wasmResponse).toMatchObject({ status: 200 });
  expect(wasmResponse.contentType).toContain("application/wasm");
  expect(errors).toEqual([]);
});
