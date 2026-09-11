import { defaultMathFixtureSet, renderComparisonHook } from "../../shared/benchmark-harness.js";

/**
 * @typedef {Object} MathRecognizerProvider
 * @property {string} kind
 * @property {string} name
 * @property {string} runtime
 * @property {string} version
 * @property {string|null} modelHash
 * @property {(input: any, context?: any) => Promise<any>} recognize
 */

export const MATH_PROVIDER_KIND = Object.freeze({
  mock: "mock",
  local: "local",
  external: "external",
});

export function createMockMathProvider({ name = "mock", runtime = "browser-js", version = "0.0.0-mock" } = {}) {
  const modelHash = "mock-model-hash";
  return Object.freeze({
    kind: MATH_PROVIDER_KIND.mock,
    name,
    runtime,
    version,
    modelHash,
    async recognize(input, context = {}) {
      const value = String(input?.text || input || "").trim();
      const latex = value || "x + 1 = 2";
      const normalized = latex.replace(/\s+/g, " ");
      const confidence = {
        token: 0.95,
        sequence: 0.91,
        overall: 0.93,
      };
      return {
        ok: true,
        provider: {
          name,
          kind: MATH_PROVIDER_KIND.mock,
          runtime,
          version,
          modelHash,
          hash: modelHash,
        },
        candidates: [
          {
            latex,
            confidence,
            normalized,
          },
        ],
        warnings: value ? [] : ["No math text was supplied; using a deterministic fallback equation."],
        timing: {
          durationMs: 1,
          startedAt: Date.now(),
          finishedAt: Date.now(),
        },
        resources: {
          wasm: false,
          modelBytes: 0,
          peakMemoryMb: 0,
        },
        metadata: {
          context: context || {},
        },
      };
    },
  });
}

export function mathProviderResult(payload = {}) {
  const candidateConfidence = payload?.candidates?.[0]?.confidence || payload?.confidence || {};
  return {
    ok: true,
    provider: {
      name: payload.name || "provider",
      kind: payload.kind || MATH_PROVIDER_KIND.local,
      runtime: payload.runtime || "browser-js",
      version: payload.version || "unknown",
      modelHash: payload.modelHash || null,
      hash: payload.modelHash || null,
    },
    candidates: Array.isArray(payload.candidates) ? payload.candidates : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    timing: {
      durationMs: Number(payload?.timing?.durationMs) || 0,
      startedAt: payload?.timing?.startedAt || null,
      finishedAt: payload?.timing?.finishedAt || null,
    },
    resources: {
      wasm: !!payload?.resources?.wasm,
      modelBytes: Number(payload?.resources?.modelBytes) || 0,
      peakMemoryMb: Number(payload?.resources?.peakMemoryMb) || 0,
    },
    metadata: payload.metadata || {},
    confidence: {
      token: Number(candidateConfidence?.token) || 0,
      sequence: Number(candidateConfidence?.sequence) || 0,
      overall: Number(candidateConfidence?.overall) || 0,
    },
  };
}

export async function evaluateMathProvider(provider, fixtures = defaultMathFixtureSet()) {
  let passed = 0;
  const results = [];
  for (const fixture of fixtures) {
    const result = await provider.recognize({ text: fixture.latex }, { fixtureId: fixture.id });
    const candidate = result?.candidates?.[0]?.latex || "";
    const comparison = renderComparisonHook(candidate, fixture.latex);
    results.push({
      id: fixture.id,
      passed: comparison.pass,
      expected: fixture.latex,
      actual: candidate,
      warningCount: (result?.warnings || []).length,
    });
    if (comparison.pass) passed += 1;
  }

  return {
    provider: provider.name || provider.runtime || "unknown",
    total: fixtures.length,
    passed,
    failed: fixtures.length - passed,
    results,
  };
}
