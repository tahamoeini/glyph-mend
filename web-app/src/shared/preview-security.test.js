import { expect, it } from "vitest";
import { sanitizePreviewHtml } from "./preview-security.js";

it("removes active HTML, SVG, event handlers, and executable URLs from previews", () => {
  const dirty = `
    <h2>Safe heading</h2>
    <a href="javascript:alert(1)" target="_blank">link text</a>
    <img src="https://evil.invalid/pixel" onerror="alert(1)">
    <svg onload="alert(1)"><script>alert(1)</script><a href="https://evil.invalid/">x</a></svg>
    <iframe src="https://evil.invalid/"></iframe>
    <p style="background:url(https://evil.invalid/x)">safe paragraph</p>
  `;

  const clean = sanitizePreviewHtml(dirty);
  expect(clean).toContain("Safe heading");
  expect(clean).toContain("link text");
  expect(clean).toContain("safe paragraph");
  expect(clean).not.toMatch(/<script|<svg|<iframe|<img|<a\b/i);
  expect(clean).not.toMatch(/javascript:|onerror|onload|https:\/\/evil\.invalid|style=/i);
});

it("preserves only the inert generated preview structures GlyphMend needs", () => {
  const clean = sanitizePreviewHtml(
    '<figure class="source-visual-preview" data-asset="asset-1"><figcaption>Preserved source</figcaption></figure>' +
      '<div class="math-accessible" role="math" aria-label="Equation: x"><math display="block"><mtext>x</mtext></math></div>',
  );

  expect(clean).toContain("source-visual-preview");
  expect(clean).toContain('data-asset="asset-1"');
  expect(clean).toContain("<figcaption>Preserved source</figcaption>");
  expect(clean).toContain('role="math"');
  expect(clean).toContain("<math");
  expect(clean).toContain("<mtext>x</mtext>");
});
