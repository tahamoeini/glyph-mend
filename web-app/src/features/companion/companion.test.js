import { expect, it, vi } from "vitest";
import { LoopbackCompanionBridge, createCompanionProvider, readCompanionFragment } from "./bridge.js";
import { companionStatus, validateEndpoint, validateEnvelope, validateProviderResult } from "./protocol.js";

function response(body = {}, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body };
}

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

it("negotiates a session and retrieves provider capabilities", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(response({ protocolVersion: { major: 1, minor: 1 }, irSchemaVersion: 2, sessionId: "session", sessionToken: "token" }))
    .mockResolvedValueOnce(response([{
      id: "glyphmend.diagnostic.mock.v1",
      version: "1.0.0",
      providerKind: "deterministic",
      inputSchema: "glyphmend.job-input.v1",
      outputSchema: "glyphmend.provider-result.v1",
      executionLocations: ["companion"],
    }]));
  const bridge = new LoopbackCompanionBridge(fetch);
  const result = await bridge.connect("http://127.0.0.1:49183", "code");
  expect(result.status).toBe("connected");
  expect(result.capabilities[0].providerKind).toBe("deterministic");
  expect(fetch.mock.calls[0][0]).toContain("/v1/session");
});

it("uses PUT chunks and ordered HTTP event polling instead of WebSocket", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(response({ jobId: "job" }))
    .mockResolvedValueOnce(response({}, true, 204))
    .mockResolvedValueOnce(response({}, true, 202))
    .mockResolvedValueOnce(response({ events: [{ sequence: 1, eventType: "job-completed" }], nextSequence: 1, terminal: true }));
  const bridge = new LoopbackCompanionBridge(fetch);
  bridge.endpoint = "http://127.0.0.1:49183";
  bridge.session = { token: "token" };
  const job = await bridge.createJob({
    documentName: "region.json",
    capabilityId: "glyphmend.diagnostic.mock.v1",
    inputKind: "region",
    declaredBytes: 3,
    pageCount: 1,
    metadata: {},
  });
  await bridge.appendChunk(job.jobId, 0, new Uint8Array([1, 2, 3]));
  await bridge.completeInput(job.jobId, { sha256Hex: "a".repeat(64), totalBytes: 3 });
  const events = [];
  const subscription = bridge.subscribe(job.jobId, (event) => events.push(event));
  await subscription.done;
  expect(fetch.mock.calls[1][0]).toContain("/chunks/0");
  expect(fetch.mock.calls[1][1].method).toBe("PUT");
  expect(fetch.mock.calls[3][0]).toContain("/events?after=0");
  expect(events[0].sequence).toBe(1);
});

it("adapts a connected Companion to the existing local provider shape", async () => {
  const bridge = {
    createJob: vi.fn(async () => ({ jobId: "job" })),
    appendChunk: vi.fn(async () => undefined),
    completeInput: vi.fn(async () => undefined),
    subscribe: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })),
    getResult: vi.fn(async () => ({ result: {
      schema: "glyphmend.provider-result.v1",
      capability: "glyphmend.visual.classify.v1",
      source: { page: 1, bbox: [0, 0, 1, 1], contentHash: "sha256:test" },
      observations: [],
      provider: { id: "hybrid", kind: "hybrid-local", version: "1" },
      warnings: [],
      diagnostics: {},
    } })),
  };
  const provider = createCompanionProvider({ bridge });
  const result = await provider.recognize({ page: 1 }, { source: "test" });
  expect(result.provider.kind).toBe("hybrid-local");
  expect(bridge.createJob).toHaveBeenCalledWith(expect.objectContaining({ inputKind: "region" }));
});

it("reads one-time connection data from a URL fragment", () => {
  expect(readCompanionFragment("#companionEndpoint=http%3A%2F%2F127.0.0.1%3A49183&companionCode=abc")).toEqual({
    endpoint: "http://127.0.0.1:49183",
    pairingCode: "abc",
  });
});

it("maps bridge failure states and rejects unknown wire fields", () => {
  expect(companionStatus({ code: "PROTOCOL_INCOMPATIBLE" })).toBe("protocol-incompatible");
  expect(companionStatus({ name: "AbortError" })).toBe("timed-out");
  expect(() => validateEnvelope({ protocolVersion: { major: 1, minor: 0 }, messageType: "hello", sequence: 0, extra: true })).toThrow(/Unknown/);
  expect(() => validateProviderResult({ schema: "wrong" })).toThrow(/provider result/);
});

it("cancels an in-flight Companion provider job when its signal is aborted", async () => {
  const bridge = {
    createJob: vi.fn(async () => ({ jobId: "job" })),
    appendChunk: vi.fn(async () => undefined),
    completeInput: vi.fn(async () => undefined),
    subscribe: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })),
    cancel: vi.fn(async () => undefined),
    getResult: vi.fn(),
  };
  const provider = createCompanionProvider({ bridge });
  await expect(provider.recognize({ page: 1 }, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
  expect(bridge.cancel).toHaveBeenCalledWith("job");
  expect(bridge.getResult).not.toHaveBeenCalled();
});