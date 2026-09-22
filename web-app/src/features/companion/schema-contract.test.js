import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { COMPANION_IR_SCHEMA, COMPANION_PROTOCOL } from "./protocol.js";

it("keeps browser protocol constants aligned with the checked-in v1 schema", () => {
  const schema = JSON.parse(readFileSync(
    resolve(process.cwd(), "..", "companion", "schemas", "companion", "v1", "protocol.json"), "utf8"));

  expect(schema.$id).toBe("glyphmend.companion/v1/protocol");
  expect(schema.properties.protocolVersion.properties.major.const).toBe(COMPANION_PROTOCOL.major);
  expect(schema.properties.irSchemaVersion.const).toBe(COMPANION_IR_SCHEMA.version);
  expect(schema.properties.messageType.enum).toContain("job-input-complete");
  const providerResult = JSON.parse(readFileSync(resolve(process.cwd(), "..", "companion", "schemas", "companion", "v1", "provider-result.json"), "utf8"));
  expect(providerResult.properties.schema.const).toBe("glyphmend.provider-result.v1");
  expect(providerResult.properties.provider.properties.kind.enum).toContain("hybrid-local");
});
