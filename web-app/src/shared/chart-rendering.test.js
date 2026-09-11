import { expect, it } from "vitest";
import { chartIRExportSidecars, chartIRToVegaLite } from "./chart-rendering.js";
import { CHART_IR_SCHEMA_VERSION } from "./semantic-ir.js";

const acceptedBarChart = {
  schemaVersion: CHART_IR_SCHEMA_VERSION,
  id: "chart-bar-1",
  kind: "chart",
  data: {
    fields: [
      { name: "category", type: "string", title: "Category" },
      { name: "value", type: "number", title: "Value" },
    ],
    rows: [
      { category: "A", value: 12 },
      { category: "B", value: 18 },
    ],
    source: { kind: "table", page: 2, bbox: [10, 20, 200, 140] },
  },
  marks: [{ type: "bar", role: "series" }],
  encoding: {
    x: { field: "category", type: "nominal", axis: { title: "Category" } },
    y: { field: "value", type: "quantitative", axis: { title: "Value" } },
  },
  geometry: { bbox: [10, 20, 200, 140] },
  provenance: { producer: "extract-worker", version: "10" },
  confidence: { overall: 0.92, structural: 0.9, semantic: 0.88 },
  disposition: "accepted",
};

it("exports accepted ChartIR to a strict Vega-Lite spec and sidecars", () => {
  const result = chartIRToVegaLite(acceptedBarChart);

  expect(result.spec.$schema).toContain("vega-lite");
  expect(result.spec.mark).toBe("bar");
  expect(result.spec.encoding.x.field).toBe("category");
  expect(result.spec.data.values).toHaveLength(2);
  expect(result.csv).toContain("category,value");

  const sidecars = chartIRExportSidecars(acceptedBarChart);
  expect(sidecars.spec).toContain("vega-lite");
  expect(sidecars.json).toContain("chart-bar-1");
  expect(sidecars.csv).toContain("A,12");
});

it("rejects weak or unsupported chart evidence", () => {
  expect(() =>
    chartIRToVegaLite({
      ...acceptedBarChart,
      disposition: "review",
    }),
  ).toThrow(/accepted disposition/);

  expect(() =>
    chartIRToVegaLite({
      ...acceptedBarChart,
      marks: [{ type: "area" }],
    }),
  ).toThrow(/bar, line, point, or scatter/);

  expect(() =>
    chartIRToVegaLite({
      ...acceptedBarChart,
      data: {
        ...acceptedBarChart.data,
        rows: [{ category: "A", value: "not-a-number" }],
      },
    }),
  ).toThrow(/non-numeric quantitative field/);
});