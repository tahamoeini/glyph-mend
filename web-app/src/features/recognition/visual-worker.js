import { createWorkerCapability } from "../../shared/recognizer-capability.js";
import { visualWorkerRecognize } from "./raster-flowchart.js";
import {
  VISUAL_PROVIDER_KIND,
  candidateToVisualIR,
  compareVisualTopology,
  createMockVisualProvider,
  createVisualRecognizerProvider,
  visualProviderResult,
} from "./visual-provider.js";
import { legacyVisualIRToV2 } from "../../shared/visual-ir.js";

function supportsLocalML(options = {}) {
  if (options.enableMl === false) return false;
  return !!(options.provider || options.enableMl);
}

function buildVisualWorkerResult(result = {}, meta = {}) {
  try {
    return {
      ...result,
      visualIRv2: legacyVisualIRToV2(result, {
        page: result.page || result.candidate?.page || 1,
        bbox: result.geometry?.bbox || result.candidate?.bbox,
        sourceKind: result.candidate?.sourceType || "raster",
      }),
    };
  } catch {
    return result;
  }
}

export function createVisualWorkerCapability({
  workerFactory,
  fallback,
  provider,
  enableMl = false,
  cvProvider,
  mlProvider,
  companionProvider,
  featureFlag = true,
  version = "1",
} = {}) {
  const browserProvider = provider || (supportsLocalML({ enableMl, provider: mlProvider }) ? createVisualRecognizerProvider({ provider: mlProvider || createMockVisualProvider() }) : null);
  const nativeProvider = companionProvider ? createVisualRecognizerProvider({ provider: companionProvider }) : null;
  const visualProvider = browserProvider || nativeProvider;
  const localWorkerFactory = workerFactory || (async () => ({
    async run(input = {}, context = {}) {
      const deterministic = visualWorkerRecognize(input, context);
      if (!featureFlag) {
        return buildVisualWorkerResult(deterministic, {});
      }

      const deterministicIR = candidateToVisualIR(deterministic);
      const deterministicTopology = {
        nodes: deterministicIR.nodes,
        edges: deterministicIR.edges,
      };

      const localMlAllowed = !!visualProvider && (supportsLocalML({ enableMl, provider: browserProvider }) || !!nativeProvider);
      if (!localMlAllowed || deterministicTopology.nodes.length < 2 || deterministicTopology.edges.length < 1) {
        return buildVisualWorkerResult(deterministicIR, {});
      }

      let providerResult;
      try {
        providerResult = await visualProvider.recognize(
          {
            deterministic: deterministicTopology,
            candidate: deterministicIR,
            page: input.page,
            bbox: input.bbox,
            raster: input.raster,
            ocrTextRegions: input.ocrTextRegions,
          },
          context,
        );
      } catch (error) {
        return buildVisualWorkerResult({
          ...deterministicIR,
          disposition: "review",
          warnings: [
            ...(deterministicIR.warnings || []),
            "Optional provider failed; deterministic visual evidence was preserved.",
          ],
          provenance: {
            ...deterministicIR.provenance,
            providerFailure: {
              name: error?.name || "Error",
              message: error?.message || String(error),
            },
            featureFlag,
          },
        }, {});
      }
      if (!Array.isArray(providerResult?.candidates) || providerResult.candidates.length === 0) {
        return buildVisualWorkerResult({
          ...deterministicIR,
          disposition: "review",
          warnings: [
            ...(deterministicIR.warnings || []),
            ...(providerResult?.warnings || []),
            "Companion provider returned evidence without a canonical VisualIR candidate.",
          ],
          provenance: {
            ...deterministicIR.provenance,
            providerEvidence: providerResult,
            featureFlag,
          },
        }, {});
      }

      const candidate = providerResult?.candidates?.[0] || {};
      const mlIr = candidateToVisualIR(candidate);
      const comparison = compareVisualTopology(deterministicTopology, mlIr);
      const mlConfidence = Number(candidate?.confidence?.overall || providerResult?.confidence?.overall || 0);
      const deterministicConfidence = Number(deterministicIR?.confidence?.overall || 0);
      const combinedConfidence = comparison.contradiction
        ? Math.min(deterministicConfidence, mlConfidence, 0.5)
        : Math.max(deterministicConfidence, mlConfidence);
      const disposition = comparison.contradiction
        ? "review"
        : mlIr.nodes.length >= 2 && mlIr.edges.length >= 1 && combinedConfidence >= 0.82
          ? "accepted"
          : deterministicIR.disposition === "preserved"
            ? "preserved"
            : "review";

      const merged = {
        ...deterministicIR,
        ...mlIr,
        confidence: {
          ...deterministicIR.confidence,
          ...mlIr.confidence,
          overall: combinedConfidence,
          deterministic: deterministicConfidence,
          provider: mlConfidence,
        },
        disposition,
        warnings: [
          ...(deterministicIR.warnings || []),
          ...(providerResult?.warnings || []),
          ...(comparison.contradiction ? ["ML topology contradicted deterministic evidence; marked for review."] : []),
        ],
        provenance: {
          ...deterministicIR.provenance,
          provider: providerResult?.provider || null,
          mlTiming: providerResult?.timing || null,
          mlResources: providerResult?.resources || null,
          comparison,
          featureFlag,
        },
      };

      return buildVisualWorkerResult(merged, {});
    },
  }));
  return createWorkerCapability({
    name: "visual-worker",
    workerFactory: localWorkerFactory,
    fallback,
    metadata: {
      version,
      capability: "visual",
      mlEnabled: !!enableMl,
      featureFlag: !!featureFlag,
      provider: visualProvider?.name || null,
      providerKind: visualProvider?.kind || null,
      modelHash: visualProvider?.modelHash || null,
      browserProvider: browserProvider?.name || null,
      companionProvider: nativeProvider?.name || null,
    },
  });
}
