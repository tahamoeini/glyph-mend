import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { LoopbackCompanionBridge, sha256Hex } from "../../web-app/src/features/companion/bridge.js";

const executable = process.platform === "win32" ? "target/debug/companion-cli.exe" : "target/debug/companion-cli";
const webOrigin = "http://127.0.0.1:5173";
const child = spawn(executable, ["--no-open", "--web-origin", webOrigin], { stdio: ["ignore", "pipe", "inherit"] });
let output = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => { output += chunk; });

try {
  const deadline = Date.now() + 20_000;
  while (!output.includes("Connection URL:") && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Companion exited early (${child.exitCode}).`);
    await delay(25);
  }
  assert.match(output, /Connection URL:/, "runtime did not start");
  const connectionUrl = output.split("Connection URL:").at(-1).trim().split(/\r?\n/, 1)[0];
  const params = new URLSearchParams(new URL(connectionUrl).hash.slice(1));
  const endpoint = params.get("companionEndpoint");
  const pairingCode = params.get("companionCode");
  assert.ok(endpoint && pairingCode, "runtime did not provide pairing data");

  const calls = [];
  let notifyPollStarted;
  const pollStarted = new Promise((resolve) => { notifyPollStarted = resolve; });
  const fetchWithOrigin = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).includes("/events?")) notifyPollStarted();
    const headers = new Headers(init.headers);
    headers.set("Origin", webOrigin);
    const response = await fetch(url, { ...init, headers });
    assert.equal(response.headers.get("access-control-allow-origin"), webOrigin, "runtime must allow only the configured exact origin");
    return response;
  };
  const requestJson = async (path, body, origin = webOrigin) => {
    const headers = new Headers({ "content-type": "application/json", Origin: origin });
    const response = await fetch(endpoint + path, { method: "POST", headers, body: JSON.stringify(body) });
    return { response, body: await response.json().catch(() => ({})) };
  };
  const preflight = await fetch(endpoint + "/v1/jobs/00000000-0000-4000-8000-000000000001/chunks/0", {
    method: "OPTIONS",
    headers: {
      Origin: webOrigin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "authorization,content-type,x-glyphmend-chunk-length",
    },
  });
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get("access-control-allow-origin"), webOrigin);
  assert.match(preflight.headers.get("access-control-allow-headers"), /x-glyphmend-chunk-length/i);

  const sessionRequest = { protocolVersion: { major: 1, minor: 8 }, irSchemaVersion: 2, pairingCode };
  let invalid = await requestJson("/v1/session", sessionRequest, "https://wrong.example");
  assert.equal(invalid.body.code, "security-rejected");
  assert.equal(invalid.response.headers.get("access-control-allow-origin"), null);
  invalid = await requestJson("/v1/session", { ...sessionRequest, protocolVersion: { major: 2, minor: 0 } });
  assert.equal(invalid.body.code, "protocol-incompatible");
  invalid = await requestJson("/v1/session", { ...sessionRequest, irSchemaVersion: 99 });
  assert.equal(invalid.body.code, "ir-schema-unsupported");

  const bridge = new LoopbackCompanionBridge(fetchWithOrigin);
  const connection = await bridge.connect(endpoint, pairingCode);
  assert.equal(connection.status, "connected");
  assert.deepEqual(bridge.session.protocolVersion, { major: 1, minor: 1 });
  assert.ok(connection.capabilities.some(({ id }) => id === "glyphmend.diagnostic.mock.v1"));
  await assert.rejects(bridge.createJob({
    documentName: "unsupported.png", capabilityId: "glyphmend.unsupported.v1", inputKind: "region",
    declaredBytes: 0, pageCount: 1, idempotencyKey: crypto.randomUUID(),
    metadata: { schema: "glyphmend.region-input.v1", page: 1, bbox: [0, 0, 1, 1], sourceIds: [], deterministicSummary: {} },
  }), { status: 400, code: "capability-unsupported" });

  const crop = new Uint8Array(1024 * 1024 + 1).fill(23);
  const idempotencyKey = crypto.randomUUID();
  const jobRequest = {
    documentName: "region.png", capabilityId: "glyphmend.diagnostic.mock.v1", inputKind: "region",
    declaredBytes: crop.byteLength, pageCount: 50, idempotencyKey,
    metadata: { schema: "glyphmend.region-input.v1", page: 1, bbox: [0, 0, 120, 80], sourceIds: ["flow-1"], deterministicSummary: { nodeCount: 2, edgeCount: 1 } },
  };
  const job = await bridge.createJob(jobRequest);
  assert.equal((await bridge.createJob(jobRequest)).jobId, job.jobId, "idempotent create should return the same job");
  await assert.rejects(bridge.createJob({ ...jobRequest, documentName: "changed.png" }), { status: 409, code: "conflict" });
  const chunks = [crop.subarray(0, 1024 * 1024), crop.subarray(1024 * 1024)];
  for (let sequence = 0; sequence < chunks.length; sequence += 1) {
    await bridge.appendChunk(job.jobId, sequence, chunks[sequence]);
  }
  await bridge.appendChunk(job.jobId, 1, chunks[1]);
  const complete = { sha256Hex: await sha256Hex(crop), totalBytes: crop.byteLength };
  assert.equal((await bridge.completeInput(job.jobId, complete)).queued, true);
  assert.equal((await bridge.completeInput(job.jobId, complete)).queued, false);

  const seen = [];
  await bridge.subscribe(job.jobId, (event) => seen.push(event)).done;
  assert.ok(seen.some(({ eventType }) => eventType === "event-history-gap"));
  assert.ok(seen.some(({ eventType }) => eventType === "job-completed"));
  const result = await bridge.getResult(job.jobId);
  assert.equal(result.status, "completed");
  assert.equal(result.result.schema, "glyphmend.provider-result.v1");
  assert.equal(calls.filter((url) => url.includes("/chunks/")).length, 3);

  // The HTTP body limit applies before JSON parsing and authentication.
  const oversized = await fetch(endpoint + "/v1/jobs", { method: "POST", headers: { Origin: webOrigin, Authorization: bridge.headers().authorization, "content-type": "application/json" }, body: " ".repeat(65 * 1024) });
  assert.equal(oversized.status, 413);

  const waitingJob = await bridge.createJob({ ...jobRequest, documentName: "cancel.png", declaredBytes: 0, pageCount: 1, idempotencyKey: crypto.randomUUID() });
  const controller = new AbortController();
  const pendingPoll = bridge.subscribe(waitingJob.jobId, () => {}, { signal: controller.signal, waitMs: 15_000 });
  await Promise.race([pollStarted, delay(5_000).then(() => { throw new Error("long poll did not start"); })]);
  controller.abort();
  await pendingPoll.done;
  await bridge.cancel(waitingJob.jobId);
  assert.equal((await bridge.getResult(waitingJob.jobId)).status, "cancelled");
  await bridge.disconnect();
  console.log("Companion browser-to-runtime diagnostic E2E passed.");
} finally {
  child.kill();
}
