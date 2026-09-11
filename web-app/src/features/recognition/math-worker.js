import { createWorkerCapability } from "../../shared/recognizer-capability.js";
import { createMockMathProvider, mathProviderResult } from "./math-provider.js";

export const MATH_PROVIDER_DEFAULTS = Object.freeze({
  kind: "mock",
  runtime: "browser-js",
  version: "0.0.0-mock",
  modelHash: "mock-model-hash",
});

export function createMathRecognizerProvider(options = {}) {
  const provider = options.provider || createMockMathProvider(options);
  return Object.freeze({
    ...provider,
    name: provider.name || options.name || "math-recognizer-provider",
    kind: provider.kind || options.kind || MATH_PROVIDER_DEFAULTS.kind,
    runtime: provider.runtime || options.runtime || MATH_PROVIDER_DEFAULTS.runtime,
    version: provider.version || options.version || MATH_PROVIDER_DEFAULTS.version,
    modelHash: provider.modelHash || options.modelHash || MATH_PROVIDER_DEFAULTS.modelHash,
    async recognize(input, context = {}) {
      const result = await provider.recognize(input, context);
      return mathProviderResult({
        ...result,
        name: this.name,
        kind: this.kind,
        runtime: this.runtime,
        version: this.version,
        modelHash: this.modelHash,
      });
    },
  });
}

export function createMathWorkerCapability({ workerFactory, fallback, provider, ...options } = {}) {
  const recognizer = provider || createMathRecognizerProvider(options);
  return createWorkerCapability({
    name: "math-worker",
    workerFactory: workerFactory || (async () => ({
      async run(input, _context = {}) {
        return recognizer.recognize(input, _context);
      },
    })),
    fallback: fallback || (() => ({ ok: true, result: { fallback: true, provider: recognizer }, meta: { capability: "math" } })),
    metadata: {
      version: recognizer.version || "1",
      capability: "math",
      provider: recognizer.name,
      providerKind: recognizer.kind,
      modelHash: recognizer.modelHash || null,
    },
  });
}
