import { defaultDiagramFixtureSet, renderComparisonHook } from "../../shared/benchmark-harness.js";

export const VISUAL_PROVIDER_KIND = Object.freeze({
  mock: "mock",
  local: "local",
  external: "external",
});

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function labelKey(value = "") {
  return normalizeText(value).toLowerCase();
}

function edgeKey(edge = {}) {
  return `${labelKey(edge.from || edge.source)}->${labelKey(edge.to || edge.target)}:${edge.directed === false ? "undirected" : "directed"}`;
}

function nodeKey(node = {}) {
  return `${labelKey(node.id)}:${labelKey(node.label || node.text)}`;
}

export function createMockVisualProvider({
  name = "mock-visual-provider",
  runtime = "browser-js",
  version = "0.0.0-mock",
  modelHash = "mock-visual-model-hash",
} = {}) {
  return Object.freeze({
    kind: VISUAL_PROVIDER_KIND.mock,
    name,
    runtime,
    version,
    modelHash,
    async recognize(input, context = {}) {
      const deterministic = isPlainObject(input?.deterministic) ? input.deterministic : {};
      const candidate = isPlainObject(input?.candidate) ? input.candidate : {};
      const nodes = Array.isArray(candidate.nodes) && candidate.nodes.length ? candidate.nodes : Array.isArray(deterministic.nodes) ? deterministic.nodes : [];
      const edges = Array.isArray(candidate.edges) && candidate.edges.length ? candidate.edges : Array.isArray(deterministic.edges) ? deterministic.edges : [];
      const confidence = isPlainObject(candidate.confidence)
        ? candidate.confidence
        : {
            overall: nodes.length >= 2 && edges.length >= 1 ? 0.88 : 0.52,
            structural: nodes.length >= 2 ? 0.84 : 0.45,
            topology: edges.length >= 1 ? 0.82 : 0.42,
          };
      const now = Date.now();
      return {
        ok: true,
        provider: {
          name,
          kind: VISUAL_PROVIDER_KIND.mock,
          runtime,
          version,
          modelHash,
          hash: modelHash,
        },
        candidates: [
          {
            id: candidate.id || deterministic.id || "visual-candidate",
            kind: candidate.kind || deterministic.kind || "flowchart",
            nodes,
            edges,
            labels: Array.isArray(candidate.labels) ? candidate.labels : deterministic.labels || [],
            geometry: candidate.geometry || deterministic.geometry || {},
            shapes: Array.isArray(candidate.shapes) ? candidate.shapes : deterministic.shapes || [],
            styles: candidate.styles || deterministic.styles || {},
            confidence: {
              token: numeric(confidence.token, numeric(confidence.overall, 0)),
              sequence: numeric(confidence.sequence, numeric(confidence.overall, 0)),
              overall: numeric(confidence.overall, 0),
            },
            warnings: Array.isArray(candidate.warnings) ? candidate.warnings : [],
            errors: Array.isArray(candidate.errors) ? candidate.errors : [],
          },
        ],
        warnings: deterministic.nodes?.length || deterministic.edges?.length ? [] : ["Mock visual provider used without deterministic evidence."],
        timing: {
          durationMs: 1,
          startedAt: now,
          finishedAt: now,
        },
        resources: {
          wasm: false,
          modelBytes: 0,
          peakMemoryMb: 0,
        },
        metadata: {
          context: context || {},
          fixtureCount: defaultDiagramFixtureSet().length,
        },
      };
    },
  });
}

export function createVisualRecognizerProvider({ provider, name, kind, runtime, version, modelHash } = {}) {
  const recognizer = provider || createMockVisualProvider({ name, runtime, version, modelHash });
  return Object.freeze({
    ...recognizer,
    name: recognizer.name || name || "visual-recognizer-provider",
    kind: recognizer.kind || kind || VISUAL_PROVIDER_KIND.local,
    runtime: recognizer.runtime || runtime || "browser-js",
    version: recognizer.version || version || "unknown",
    modelHash: recognizer.modelHash || modelHash || null,
    async recognize(input, context = {}) {
      const result = await recognizer.recognize(input, context);
      return visualProviderResult({
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

export function visualProviderResult(payload = {}) {
  const candidateConfidence = payload?.candidates?.[0]?.confidence || payload?.confidence || {};
  return {
    ok: true,
    provider: {
      name: payload.name || "provider",
      kind: payload.kind || VISUAL_PROVIDER_KIND.local,
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

export function candidateToVisualIR(candidate = {}) {
  const nodes = Array.isArray(candidate.nodes) ? candidate.nodes : [];
  const edges = Array.isArray(candidate.edges) ? candidate.edges : [];
  return {
    schemaVersion: 1,
    id: candidate.id || "visual-candidate",
    kind: candidate.kind || "flowchart",
    nodes: nodes.map((node, index) => ({
      id: node.id || `n${index + 1}`,
      label: normalizeText(node.label || node.text || node.id || `Node ${index + 1}`),
      shape: node.shape || "box",
      geometry: node.geometry || {},
      style: node.style || undefined,
    })),
    edges: edges.map((edge, index) => ({
      id: edge.id || `e${index + 1}`,
      source: edge.source || edge.from || "",
      target: edge.target || edge.to || "",
      label: normalizeText(edge.label) || `edge ${index + 1}`,
      directed: edge.directed !== false,
      geometry: edge.geometry || {},
      style: edge.style || undefined,
    })),
    labels: Array.isArray(candidate.labels) ? candidate.labels : [],
    geometry: candidate.geometry || {},
    shapes: Array.isArray(candidate.shapes) ? candidate.shapes : [],
    styles: candidate.styles || {},
    provenance: candidate.provenance || { producer: "visual-worker", source: "ml-fallback" },
    confidence: isPlainObject(candidate.confidence) ? candidate.confidence : { overall: 0 },
    disposition: candidate.disposition || "review",
    warnings: Array.isArray(candidate.warnings) ? candidate.warnings : [],
    errors: Array.isArray(candidate.errors) ? candidate.errors : [],
  };
}

export function compareVisualTopology(deterministic = {}, proposed = {}) {
  const deterministicNodes = Array.isArray(deterministic.nodes) ? deterministic.nodes : [];
  const proposedNodes = Array.isArray(proposed.nodes) ? proposed.nodes : [];
  const deterministicEdges = Array.isArray(deterministic.edges) ? deterministic.edges : [];
  const proposedEdges = Array.isArray(proposed.edges) ? proposed.edges : [];

  const deterministicNodeKeys = new Set(deterministicNodes.map(nodeKey));
  const proposedNodeKeys = new Set(proposedNodes.map(nodeKey));
  const deterministicEdgeKeys = new Set(deterministicEdges.map(edgeKey));
  const proposedEdgeKeys = new Set(proposedEdges.map(edgeKey));

  const nodeMatches = [...proposedNodeKeys].filter((key) => deterministicNodeKeys.has(key)).length;
  const edgeMatches = [...proposedEdgeKeys].filter((key) => deterministicEdgeKeys.has(key)).length;

  const nodeMismatch = deterministicNodeKeys.size && proposedNodeKeys.size
    ? 1 - nodeMatches / Math.max(deterministicNodeKeys.size, proposedNodeKeys.size)
    : 0;
  const edgeMismatch = deterministicEdgeKeys.size && proposedEdgeKeys.size
    ? 1 - edgeMatches / Math.max(deterministicEdgeKeys.size, proposedEdgeKeys.size)
    : 0;

  const contradiction = nodeMismatch > 0.5 || edgeMismatch > 0.5;
  return {
    nodeMatches,
    edgeMatches,
    nodeMismatch,
    edgeMismatch,
    contradiction,
    evidencePresent: deterministicNodeKeys.size > 0 || deterministicEdgeKeys.size > 0,
  };
}

export function evaluateVisualProvider(provider, fixtures = defaultDiagramFixtureSet()) {
  return Promise.all(
    fixtures.map(async (fixture) => {
      const result = await provider.recognize({ candidate: fixture.expected }, { fixtureId: fixture.id });
      const candidate = result?.candidates?.[0] || {};
      const nodeMatch = renderComparisonHook(
        JSON.stringify(candidate.nodes || []),
        JSON.stringify(fixture.expected.nodes || []),
      ).pass;
      const edgeMatch = renderComparisonHook(
        JSON.stringify(candidate.edges || []),
        JSON.stringify(fixture.expected.edges || []),
      ).pass;
      return {
        id: fixture.id,
        passed: nodeMatch && edgeMatch,
        expected: fixture.expected,
        actual: candidate,
        warningCount: (result?.warnings || []).length,
      };
    }),
  ).then((results) => ({
    provider: provider.name || provider.runtime || "unknown",
    total: fixtures.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    results,
  }));
}
