import DOMPurify from "dompurify";
import { marked } from "marked";
import { beforeEach, describe, expect, it } from "vitest";
import { deserializeWorkspace, serializeWorkspace } from "../storage/workspace-db.js";
import { CONTENT_SECURITY_POLICY } from "./policy.js";
import {
  configureUntrustedRendering,
  sanitizeReconstructedSvg,
} from "./rendering.js";
import {
  assertTrustedLocalResourceUrl,
  bundleAssetPath,
  parseUntrustedJson,
  SECURITY_LIMITS,
  validateWorkerRequest,
  validateWorkerResponse,
} from "./validation.js";

beforeEach(() => {
  configureUntrustedRendering();
});

describe("untrusted JSON and bundle paths", () => {
  it("rejects prototype-pollution keys before workspace data reaches application state", () => {
    expect(() =>
      parseUntrustedJson('{"safe":{"__proto__":{"polluted":true}}}'),
    ).toThrow(/Unsafe key/);
    expect(() =>
      deserializeWorkspace(
        '{"schema":4,"constructor":{"prototype":{"polluted":true}}}',
      ),
    ).toThrow(/Unsafe key/);
    expect({}.polluted).toBeUndefined();
  });

  it("rejects traversal-capable asset identifiers and produces canonical safe bundle paths", () => {
    for (const id of ["../escape", "../../escape", "a/b", "a\\b", ".", ".."]) {
      expect(() => bundleAssetPath(id)).toThrow(/unsafe bundle path/i);
    }
    expect(bundleAssetPath("p12-image-4")).toBe("assets/p12-image-4.png");
  });

  it("rejects malicious asset ids in imported workspace checkpoints", () => {
    const serialized = serializeWorkspace({
      schema: 4,
      extractionVersion: 10,
      pdfBytes: new Uint8Array([1]),
      pages: {
        1: {
          page: 1,
          assets: [{ id: "../../outside", data: new Uint8Array([2]) }],
        },
      },
    });
    expect(() => deserializeWorkspace(serialized)).toThrow(/unsafe bundle path/i);
  });
});

describe("Markdown and reconstructed SVG boundaries", () => {
  it("renders imported Markdown as static content without active HTML or remote resources", () => {
    const markdown = [
      "[click me](javascript:alert(1))",
      '<img src="https://evil.example/pixel" onerror="alert(1)">',
      '<svg onload="alert(1)"><script>alert(1)</script></svg>',
    ].join("\n\n");
    const html = DOMPurify.sanitize(marked.parse(markdown, { gfm: true }));
    expect(html).toContain("click me");
    expect(html).not.toMatch(/javascript:|evil\.example|onerror|onload|<script|<svg|<img|href=/i);
  });

  it("keeps GlyphMend's local source-visual placeholder attribute while stripping URLs", () => {
    const html = DOMPurify.sanitize(
      '<figure class="source-visual-preview" data-asset="p1-image-1"><figcaption>Source</figcaption></figure><a href="https://evil.example">external</a>',
    );
    expect(html).toContain('data-asset="p1-image-1"');
    expect(html).toContain("external");
    expect(html).not.toContain("href=");
  });

  it("accepts only a static SVG subset for reconstructed diagrams", () => {
    const safe = sanitizeReconstructedSvg(
      '<svg viewBox="0 0 100 40" role="img" aria-label="flow"><rect x="1" y="1" width="98" height="38" fill="none" stroke="black"/><text x="50" y="22" text-anchor="middle">Review</text></svg>',
    );
    expect(safe).toContain("<svg");
    expect(safe).toContain("<rect");
    expect(safe).toContain("Review");
  });

  it.each([
    '<svg onload="alert(1)"><text>bad</text></svg>',
    '<svg><script>alert(1)</script></svg>',
    '<svg><foreignObject><div>HTML label</div></foreignObject></svg>',
    '<svg><text><tspan onclick="alert(1)">node</tspan></text></svg>',
    '<svg><a href="https://evil.example"><text>link</text></a></svg>',
    '<svg><rect fill="url(https://evil.example/a.svg#x)"/></svg>',
  ])("rejects active reconstructed SVG payload %s", (payload) => {
    expect(() => sanitizeReconstructedSvg(payload)).toThrow(/Unsafe reconstructed SVG/);
  });
});

describe("worker and local resource validation", () => {
  const baseUrl = "https://glyphmend.test/app/assets/extract-worker.js";
  const paths = {
    workerPath: "https://glyphmend.test/app/tesseract/worker.min.js",
    corePath: "https://glyphmend.test/app/tesseract-core/",
    langPath: "https://glyphmend.test/app/tessdata/",
  };

  it("allows only same-origin, allowlisted OCR code/model paths", () => {
    expect(
      assertTrustedLocalResourceUrl(paths.workerPath, {
        baseUrl,
        allowedPathSuffixes: ["/tesseract/worker.min.js"],
      }),
    ).toBe(paths.workerPath);
    expect(() =>
      assertTrustedLocalResourceUrl("https://evil.example/model.js", {
        baseUrl,
        allowedPathSuffixes: ["/tesseract/worker.min.js"],
      }),
    ).toThrow(/Cross-origin/);
    expect(() =>
      assertTrustedLocalResourceUrl("javascript:alert(1)", { baseUrl }),
    ).toThrow(/HTTP\(S\)/);
  });

  it("rejects arbitrary model/code URLs, unknown options, and oversized page batches", () => {
    const request = {
      type: "extract",
      buffer: new ArrayBuffer(4),
      pages: [1, 2],
      options: { useOcr: true, ocrLanguage: "eng", ocrDpi: 300 },
      password: "",
      ocrPaths: paths,
    };
    expect(validateWorkerRequest(request, { baseUrl }).pages).toEqual([1, 2]);
    expect(() =>
      validateWorkerRequest(
        { ...request, ocrPaths: { ...paths, langPath: "https://evil.example/model/" } },
        { baseUrl },
      ),
    ).toThrow(/Cross-origin/);
    expect(() =>
      validateWorkerRequest(
        { ...request, options: { ...request.options, modelUrl: "https://evil.example" } },
        { baseUrl },
      ),
    ).toThrow(/Unknown option/);
    expect(() =>
      validateWorkerRequest(
        {
          ...request,
          pages: Array.from(
            { length: SECURITY_LIMITS.workerPagesPerBatch + 1 },
            (_, index) => index + 1,
          ),
        },
        { baseUrl },
      ),
    ).toThrow(/page ceiling/);
  });

  it("rejects forged worker page messages and traversal-capable returned assets", () => {
    expect(() =>
      validateWorkerResponse(
        { type: "page-start", page: 7 },
        { allowedPages: new Set([1, 2]) },
      ),
    ).toThrow(/outside the requested batch/);
    expect(() =>
      validateWorkerResponse(
        {
          type: "page",
          page: 1,
          text: "safe text",
          assets: [
            {
              id: "../../escape",
              kind: "image",
              bbox: [0, 0, 1, 1],
              caption: "",
              width: 1,
              height: 1,
              data: new Uint8Array([1]),
            },
          ],
          edges: {},
          quality: {},
        },
        { allowedPages: new Set([1]) },
      ),
    ).toThrow(/unsafe bundle path/i);
  });
});

describe("Content Security Policy", () => {
  it("keeps executable content local and blocks objects, frames, forms, and arbitrary network access", () => {
    const directives = Object.fromEntries(
      CONTENT_SECURITY_POLICY.split("; ").map((directive) => {
        const [name, ...values] = directive.split(" ");
        return [name, values];
      }),
    );
    expect(directives["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(directives["script-src"]).not.toContain("'unsafe-eval'");
    expect(directives["script-src"]).not.toContain("'unsafe-inline'");
    expect(directives["connect-src"]).toEqual(["'self'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["frame-src"]).toEqual(["'none'"]);
    expect(directives["form-action"]).toEqual(["'none'"]);
    expect(directives["base-uri"]).toEqual(["'none'"]);
  });
});
