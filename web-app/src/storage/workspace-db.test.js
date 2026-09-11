import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_REVISION,
  deserializeWorkspace,
  serializeWorkspace,
} from "./workspace-db.js";

it("round-trips PDF and visual binary data in exported workspaces", () => {
  const value = {
    schema: 4,
    extractionVersion: 10,
    pdfBytes: new Uint8Array([1, 2, 3]).buffer,
    pages: {
      1: { page: 1, assets: [{ id: "a", data: new Uint8Array([4, 5, 6]) }] },
    },
  };
  const restored = deserializeWorkspace(serializeWorkspace(value));
  expect([...new Uint8Array(restored.pdfBytes)]).toEqual([1, 2, 3]);
  expect([...restored.pages[1].assets[0].data]).toEqual([4, 5, 6]);
});

it("rejects imported workspace filenames that could create unsafe ZIP paths", () => {
  for (const fileName of [
    "../escape.pdf",
    "..\\escape.pdf",
    "/tmp/escape.pdf",
    "C:\\escape.pdf",
  ]) {
    const serialized = serializeWorkspace({
      schema: 4,
      extractionVersion: 10,
      fileName,
      pdfBytes: new Uint8Array([1]),
      pages: {},
    });
    expect(() => deserializeWorkspace(serialized)).toThrow(/leaf name/i);
  }
});

describe("workspace checkpoint revisions", () => {
  it("marks newly exported workspaces with the current checkpoint revision", () => {
    const parsed = JSON.parse(
      serializeWorkspace({
        schema: 4,
        extractionVersion: 10,
        pdfBytes: new Uint8Array([1, 2, 3]),
        pages: {},
      }),
    );
    expect(parsed.checkpointRevision).toBe(CHECKPOINT_REVISION);
  });

  it("keeps current-revision workspaces compatible", () => {
    const serialized = serializeWorkspace({
      schema: 4,
      extractionVersion: 10,
      pdfBytes: new Uint8Array([1]),
      pages: { 1: { page: 1, text: "current" } },
    });
    const value = deserializeWorkspace(serialized);
    expect(value.extractionVersion).toBe(10);
    expect(value.checkpointRevision).toBe(CHECKPOINT_REVISION);
  });

  it("invalidates pre-fidelity v10 workspace exports instead of resuming stale pages", () => {
    const legacy = JSON.stringify({
      schema: 4,
      extractionVersion: 10,
      pdfBytes: { __binary: "uint8-array", base64: "AQ==" },
      pages: { 1: { page: 1, text: "flattened legacy extraction" } },
    });
    const value = deserializeWorkspace(legacy);
    expect(value.extractionVersion).toBe(-1);
    expect(value.checkpointRevision).toBe(0);
  });
});
