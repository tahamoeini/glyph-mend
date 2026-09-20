import { expect, it, vi } from "vitest";
import { LoopbackCompanionBridge } from "./bridge.js";
import { companionStatus, validateEndpoint, validateEnvelope } from "./protocol.js";

it("does not probe until a user supplies an endpoint", async () => {
  const fetch = vi.fn();
  const bridge = new LoopbackCompanionBridge(fetch);
  expect(await bridge.detect()).toEqual({ status: "unavailable" });
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects non-loopback endpoints before network access", async () => {
  const fetch = vi.fn();
  const bridge = new LoopbackCompanionBridge(fetch);
  expect(await bridge.connect("https://example.com", "code")).toEqual({ status: "failed" });
  expect(fetch).not.toHaveBeenCalled();
  expect(() => validateEndpoint("http://localhost:8765")).toThrow(/127/);
});

it("maps bridge failure states and rejects unknown wire fields", () => {
  expect(companionStatus({ code: "PROTOCOL_INCOMPATIBLE" })).toBe("protocol-incompatible");
  expect(companionStatus({ name: "AbortError" })).toBe("timed-out");
  expect(() => validateEnvelope({ protocolVersion: { major: 1, minor: 0 }, messageType: "hello", sequence: 0, extra: true })).toThrow(/Unknown/);
});
