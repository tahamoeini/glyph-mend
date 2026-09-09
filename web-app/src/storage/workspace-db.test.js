import { expect, it } from "vitest";
import { deserializeWorkspace, serializeWorkspace } from "./workspace-db.js";

it("round-trips PDF and visual binary data in exported workspaces", () => {
  const value = {
    schema: 4,
    pdfBytes: new Uint8Array([1, 2, 3]).buffer,
    pages: {
      1: { page: 1, assets: [{ id: "a", data: new Uint8Array([4, 5, 6]) }] },
    },
  };
  const restored = deserializeWorkspace(serializeWorkspace(value));
  expect([...new Uint8Array(restored.pdfBytes)]).toEqual([1, 2, 3]);
  expect([...restored.pages[1].assets[0].data]).toEqual([4, 5, 6]);
});
