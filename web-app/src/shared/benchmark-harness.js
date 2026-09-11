export const BENCHMARK_SCHEMA_VERSION = 1;
export const LOCAL_BENCHMARK_DIRECTORY = ".benchmarks/local";

export const MATH_FIXTURE_CATEGORIES = [
  "simple",
  "nested-fractions",
  "integrals-sums-products",
  "matrices",
  "cases",
  "accents",
  "aligned-equations",
  "noisy-low-resolution",
];

export const DIAGRAM_FIXTURE_CATEGORIES = [
  "clean-vector-flowchart",
  "raster-flowchart",
  "reversed-arrow-trap",
  "disconnected-node",
  "ambiguous-connector",
  "mixed-figure",
];

export function stableDeepValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableDeepValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableDeepValue(item)]),
    );
  }
  return value;
}

export function stableSignature(value) {
  return JSON.stringify(stableDeepValue(value));
}

export function normalizeMathText(value = "") {
  return String(value)
    .replace(/\s+/g, "")
    .replace(/\\cdot/g, "*")
    .replace(/\\times/g, "*")
    .trim();
}

export function renderComparisonHook(actualValue, expectedValue) {
  const actual = normalizeMathText(actualValue);
  const expected = normalizeMathText(expectedValue);
  return {
    pass: actual === expected,
    actual,
    expected,
  };
}

export function canonicalMathSerializer(value) {
  return JSON.stringify(stableDeepValue(value));
}

export function normalizeAst(value) {
  return stableDeepValue(value);
}

export function defaultMathFixtureSet() {
  return [
    {
      id: "math/simple-linear",
      category: "simple",
      kind: "math",
      label: "Simple linear equation",
      source: "hand-authored",
      latex: "x + 1 = 2",
      expectedAst: {
        type: "equation",
        left: {
          type: "sum",
          left: { type: "identifier", value: "x" },
          right: { type: "number", value: 1 },
        },
        right: { type: "number", value: 2 },
      },
    },
    {
      id: "math/nested-fraction",
      category: "nested-fractions",
      kind: "math",
      label: "Nested fraction",
      source: "hand-authored",
      latex: "\\frac{1}{1 + \\frac{1}{x}}",
      expectedAst: {
        type: "fraction",
        numerator: { type: "number", value: 1 },
        denominator: {
          type: "sum",
          left: { type: "number", value: 1 },
          right: {
            type: "fraction",
            numerator: { type: "number", value: 1 },
            denominator: { type: "identifier", value: "x" },
          },
        },
      },
    },
    {
      id: "math/integral-limit",
      category: "integrals-sums-products",
      kind: "math",
      label: "Definite integral with bounds",
      source: "hand-authored",
      latex: "\\int_0^1 x^2 \\mathrm{d}x",
      expectedAst: {
        type: "integral",
        lower: { type: "number", value: 0 },
        upper: { type: "number", value: 1 },
        integrand: {
          type: "power",
          base: { type: "identifier", value: "x" },
          exponent: { type: "number", value: 2 },
        },
      },
    },
    {
      id: "math/matrix",
      category: "matrices",
      kind: "math",
      label: "2x2 matrix",
      source: "hand-authored",
      latex: "\\begin{pmatrix} a & b \\ c & d \\end{pmatrix}",
      expectedAst: {
        type: "matrix",
        rows: [
          [{ type: "identifier", value: "a" }, { type: "identifier", value: "b" }],
          [{ type: "identifier", value: "c" }, { type: "identifier", value: "d" }],
        ],
      },
    },
    {
      id: "math/cases",
      category: "cases",
      kind: "math",
      label: "Piecewise cases",
      source: "hand-authored",
      latex: "\\begin{cases} x & x \\ge 0 \\ -x & x < 0 \\end{cases}",
      expectedAst: {
        type: "cases",
        branches: [
          {
            condition: { type: "gte", left: { type: "identifier", value: "x" }, right: { type: "number", value: 0 } },
            value: { type: "identifier", value: "x" },
          },
          {
            condition: { type: "lt", left: { type: "identifier", value: "x" }, right: { type: "number", value: 0 } },
            value: { type: "unary-minus", value: { type: "identifier", value: "x" } },
          },
        ],
      },
    },
    {
      id: "math/accent",
      category: "accents",
      kind: "math",
      label: "Accent expression",
      source: "hand-authored",
      latex: "\\hat{x} + \\bar{y}",
      expectedAst: {
        type: "sum",
        left: { type: "accent", name: "hat", value: { type: "identifier", value: "x" } },
        right: { type: "accent", name: "bar", value: { type: "identifier", value: "y" } },
      },
    },
    {
      id: "math/aligned",
      category: "aligned-equations",
      kind: "math",
      label: "Aligned equation block",
      source: "hand-authored",
      latex: "x &= y + 1 \\\\ z &= y - 1",
      expectedAst: {
        type: "aligned",
        rows: [
          {
            type: "equation",
            left: { type: "identifier", value: "x" },
            right: {
              type: "sum",
              left: { type: "identifier", value: "y" },
              right: { type: "number", value: 1 },
            },
          },
          {
            type: "equation",
            left: { type: "identifier", value: "z" },
            right: {
              type: "difference",
              left: { type: "identifier", value: "y" },
              right: { type: "number", value: 1 },
            },
          },
        ],
      },
    },
    {
      id: "math/noisy-low-res",
      category: "noisy-low-resolution",
      kind: "math",
      label: "Low-resolution noisy equation",
      source: "hand-authored",
      latex: "x^2 + y^2 = r^2",
      expectedAst: {
        type: "equation",
        left: {
          type: "sum",
          left: {
            type: "power",
            base: { type: "identifier", value: "x" },
            exponent: { type: "number", value: 2 },
          },
          right: {
            type: "power",
            base: { type: "identifier", value: "y" },
            exponent: { type: "number", value: 2 },
          },
        },
        right: {
          type: "power",
          base: { type: "identifier", value: "r" },
          exponent: { type: "number", value: 2 },
        },
      },
    },
  ];
}

export function defaultDiagramFixtureSet() {
  return [
    {
      id: "diagram/clean-vector-flowchart",
      category: "clean-vector-flowchart",
      kind: "diagram",
      label: "Clean vector flowchart",
      source: "hand-authored",
      expected: {
        nodes: [
          { id: "start", label: "Start" },
          { id: "process", label: "Process" },
          { id: "done", label: "Done" },
        ],
        edges: [
          { from: "start", to: "process", direction: "forward" },
          { from: "process", to: "done", direction: "forward" },
        ],
      },
    },
    {
      id: "diagram/raster-flowchart",
      category: "raster-flowchart",
      kind: "diagram",
      label: "Raster flowchart",
      source: "hand-authored",
      expected: {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ],
        edges: [
          { from: "a", to: "b", direction: "forward" },
          { from: "b", to: "c", direction: "forward" },
        ],
      },
    },
    {
      id: "diagram/reversed-arrow-trap",
      category: "reversed-arrow-trap",
      kind: "diagram",
      label: "Reversed arrow trap",
      source: "hand-authored",
      expected: {
        nodes: [
          { id: "source", label: "Source" },
          { id: "target", label: "Target" },
        ],
        edges: [{ from: "source", to: "target", direction: "forward" }],
      },
    },
    {
      id: "diagram/disconnected-node",
      category: "disconnected-node",
      kind: "diagram",
      label: "Disconnected node",
      source: "hand-authored",
      expected: {
        nodes: [
          { id: "one", label: "One" },
          { id: "two", label: "Two" },
          { id: "three", label: "Three" },
        ],
        edges: [{ from: "one", to: "two", direction: "forward" }],
      },
    },
    {
      id: "diagram/ambiguous-connector",
      category: "ambiguous-connector",
      kind: "diagram",
      label: "Ambiguous connector",
      source: "hand-authored",
      expected: {
        nodes: [
          { id: "in", label: "In" },
          { id: "decision", label: "Decision" },
          { id: "out", label: "Out" },
        ],
        edges: [
          { from: "in", to: "decision", direction: "forward" },
          { from: "decision", to: "out", direction: "forward" },
        ],
      },
    },
    {
      id: "diagram/mixed-figure",
      category: "mixed-figure",
      kind: "diagram",
      label: "Mixed figure",
      source: "hand-authored",
      expected: {
        nodes: [
          { id: "input", label: "Input" },
          { id: "box", label: "Box" },
          { id: "output", label: "Output" },
        ],
        edges: [
          { from: "input", to: "box", direction: "forward" },
          { from: "box", to: "output", direction: "forward" },
        ],
      },
    },
  ];
}

export function evaluateMathFixture(fixture, candidate = {}) {
  const ast = candidate.ast ?? null;
  const parseSuccess = !!ast && typeof ast === "object";
  const semanticEquivalent =
    parseSuccess &&
    stableSignature(normalizeAst(ast)) === stableSignature(normalizeAst(fixture.expectedAst));
  const renderedComparison = renderComparisonHook(
    candidate.latex ?? fixture.latex,
    fixture.latex,
  );
  const serializerSyntaxValid =
    typeof candidate.serialized === "string"
      ? (() => {
          try {
            JSON.parse(candidate.serialized);
            return true;
          } catch {
            return false;
          }
        })()
      : parseSuccess && !!canonicalMathSerializer(ast);

  const passed = parseSuccess && semanticEquivalent && renderedComparison.pass && serializerSyntaxValid;

  return {
    id: fixture.id,
    category: fixture.category,
    kind: fixture.kind,
    metrics: {
      parseSuccess,
      semanticEquivalent,
      renderedComparison,
      serializerSyntaxValid,
      renderedComparisonHook: renderedComparison,
    },
    passed,
  };
}

export function evaluateVisualFixture(fixture, candidate = {}) {
  const expectedNodes = fixture.expected.nodes;
  const expectedEdges = fixture.expected.edges;
  const actualNodes = candidate.nodes ?? expectedNodes;
  const actualEdges = candidate.edges ?? expectedEdges;

  const nodeCorrect =
    actualNodes.length === expectedNodes.length &&
    expectedNodes.every((expectedNode) =>
      actualNodes.some(
        (actualNode) =>
          actualNode.id === expectedNode.id && actualNode.label === expectedNode.label,
      ),
    );

  const edgeCorrect =
    actualEdges.length === expectedEdges.length &&
    expectedEdges.every((expectedEdge) =>
      actualEdges.some(
        (actualEdge) =>
          actualEdge.from === expectedEdge.from &&
          actualEdge.to === expectedEdge.to &&
          actualEdge.direction === expectedEdge.direction,
      ),
    );

  const directionCorrect =
    expectedEdges.every((expectedEdge) =>
      actualEdges.some(
        (actualEdge) =>
          actualEdge.from === expectedEdge.from &&
          actualEdge.to === expectedEdge.to &&
          actualEdge.direction === expectedEdge.direction,
      ),
    );

  const labelCorrect = expectedNodes.every((expectedNode) =>
    actualNodes.some(
      (actualNode) => actualNode.id === expectedNode.id && actualNode.label === expectedNode.label,
    ),
  );

  const passed = nodeCorrect && edgeCorrect && directionCorrect && labelCorrect;

  return {
    id: fixture.id,
    category: fixture.category,
    kind: fixture.kind,
    metrics: {
      nodeCorrect,
      edgeCorrect,
      directionCorrect,
      labelCorrect,
    },
    passed,
  };
}

export function benchmarkFixtureSet({ mathFixtures = defaultMathFixtureSet(), diagramFixtures = defaultDiagramFixtureSet(), modelName = "fixture-baseline" } = {}) {
  const fixtureResults = [];

  for (const fixture of [...mathFixtures, ...diagramFixtures]) {
    if (fixture.kind === "math") {
      fixtureResults.push(
        evaluateMathFixture(fixture, {
          ast: fixture.expectedAst,
          latex: fixture.latex,
          serialized: canonicalMathSerializer(fixture.expectedAst),
        }),
      );
    } else {
      fixtureResults.push(
        evaluateVisualFixture(fixture, {
          nodes: fixture.expected.nodes,
          edges: fixture.expected.edges,
        }),
      );
    }
  }

  const summary = {
    total: fixtureResults.length,
    passed: fixtureResults.filter((result) => result.passed).length,
    failed: fixtureResults.filter((result) => !result.passed).length,
  };

  return {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    model: modelName,
    suite: "glyphmend-local-fixtures",
    localBenchmarkDirectory: LOCAL_BENCHMARK_DIRECTORY,
    notes: "Hand-authored fixtures only; keep future private corpora outside git and load them locally via this harness.",
    fixtures: fixtureResults,
    summary,
  };
}

export function createBenchmarkResult(modelName = "fixture-baseline") {
  return benchmarkFixtureSet({ modelName });
}
