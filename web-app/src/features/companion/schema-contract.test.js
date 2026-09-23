import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { COMPANION_IR_SCHEMA, COMPANION_PROTOCOL, REGION_INPUT_SCHEMA } from "./protocol.js";

const schemas = resolve(process.cwd(), "..", "companion", "schemas", "companion", "v1");
const readSchema = (name) => JSON.parse(readFileSync(resolve(schemas, name), "utf8"));

it("documents the active REST v1 contract and its independent schemas", () => {
  const api = readSchema("protocol.json");
  expect(api.openapi).toBe("3.1.0");
  expect(api.info.version).toBe("1.1");
  expect(api.paths["/v1/session"].post).toBeDefined();
  expect(api.paths["/v1/jobs/{jobId}/events"].get.responses["409"]).toBeDefined();
  expect(api.paths["/v1/jobs/{jobId}/chunks/{sequence}"].put.requestBody.content["application/octet-stream"]).toBeDefined();
  expect(api.components.schemas.ProtocolVersion.properties.major.const).toBe(COMPANION_PROTOCOL.major);
  expect(api.components.schemas.NegotiatedProtocolVersion.properties.minor.maximum).toBe(COMPANION_PROTOCOL.minor);
  expect(readSchema("session-request.json").properties.irSchemaVersion.const).toBe(COMPANION_IR_SCHEMA.version);
  expect(readSchema("region-input.json").properties.schema.const).toBe(REGION_INPUT_SCHEMA);
  expect(readSchema("provider-result.json").properties.source.properties.bbox.minItems).toBe(4);
  expect(readSchema("provider-result.json").properties.source.properties.bbox.maxItems).toBe(4);
  expect(readSchema("provider-result.json").properties.source.properties.contentHash.pattern).toContain("64");
  expect(readSchema("provider-result.json").properties.observations.maxItems).toBe(256);
  expect(readSchema("events-page.json").required).toContain("historyTruncated");
  expect(readSchema("error.json").properties.earliestSequence).toBeDefined();
});
