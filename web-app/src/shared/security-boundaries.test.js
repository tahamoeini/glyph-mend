import { expect, it } from "vitest";
import {
  ACTIVE_FORMAT_LIMITS,
  assertSafeStructuredValue,
  validateExtractionRequest,
  validateExtractionWorkerMessage,
} from "./security-boundaries.js";

function request(overrides = {}) {
  return {
    type: "extract",
    buffer: new ArrayBuffer(16),
    pages: [1, 2],
    options: { useOcr: true, ocrLanguage: "eng", ocrDpi: 300 },
    password: "",
    ocrPaths: {
      workerPath: "https://glyphmend.test/tesseract/worker.min.js",
      corePath: "https://glyphmend.test/tesseract-core/",
      langPath: "https://glyphmend.test/tessdata/",
    },
    ...overrides,
  };
}

it("accepts only bounded same-origin extraction requests", () => {
  const validated = validateExtractionRequest(request(), {
    baseUrl: "https://glyphmend.test/app/",
  });
  expect(validated.pages).toEqual([1, 2]);
  expect(validated.options.ocrLanguage).toBe("eng");
});

it("rejects external worker/model URL injection and unsupported request fields", () => {
  expect(() =>
    validateExtractionRequest(
      request({
        ocrPaths: {
          workerPath: "https://evil.invalid/worker.js",
          corePath: "https://glyphmend.test/tesseract-core/",
          langPath: "https://glyphmend.test/tessdata/",
        },
      }),
      { baseUrl: "https://glyphmend.test/app/" },
    ),
  ).toThrow(/same-origin bundled asset/i);

  expect(() =>
    validateExtractionRequest(
      request({ options: { useOcr: true, ocrLanguage: "eng", modelUrl: "https://evil.invalid/model.bin" } }),
      { baseUrl: "https://glyphmend.test/app/" },
    ),
  ).toThrow(/unsupported key modelUrl/i);
});

it("rejects prototype-pollution keys in structured worker inputs", () => {
  const poisoned = JSON.parse('{"safe":{"__proto__":{"polluted":true}}}');
  expect(() => assertSafeStructuredValue(poisoned, "payload")).toThrow(/unsafe key __proto__/i);
  expect({}.polluted).toBeUndefined();
});

it("rejects oversized requests and page responses with graceful limit errors", () => {
  const tinyLimits = {
    ...ACTIVE_FORMAT_LIMITS,
    maxPdfBytes: 8,
    maxPageTextChars: 8,
  };
  expect(() =>
    validateExtractionRequest(request(), {
      baseUrl: "https://glyphmend.test/app/",
      limits: tinyLimits,
    }),
  ).toThrow(/PDF exceeds/i);

  expect(() =>
    validateExtractionWorkerMessage(
      {
        type: "page",
        page: 1,
        index: 0,
        total: 1,
        text: "0123456789",
        bodySize: 12,
        assets: [],
        edges: {},
        quality: {},
        reviewItems: [],
        engine: "mupdf-wasm",
      },
      { limits: tinyLimits },
    ),
  ).toThrow(/page text.*limit/i);
});

it("rejects unknown or malformed worker messages", () => {
  expect(() => validateExtractionWorkerMessage({ type: "run-code", code: "alert(1)" })).toThrow(/unsupported.*message type/i);
  expect(() => validateExtractionWorkerMessage({ type: "ocr-progress", page: 1, status: "x", progress: 2 })).toThrow(/OCR progress/i);
});
