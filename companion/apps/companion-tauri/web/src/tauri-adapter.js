import { invoke } from "@tauri-apps/api/core";

function subscribe(jobId, onEvent, { waitMs = 15_000, signal } = {}) {
  let stopped = false;
  let sequence = 0;
  const done = (async () => {
    while (!stopped && !signal?.aborted) {
      const page = await invoke("companion_job_events", { jobId, after: sequence, waitMs });
      for (const event of page.events || []) {
        sequence = Math.max(sequence, Number(event.sequence) || sequence);
        onEvent(event);
      }
      sequence = Math.max(sequence, Number(page.nextSequence) || sequence);
      if (page.terminal) break;
    }
    return sequence;
  })();
  return { done, stop: () => { stopped = true; } };
}

globalThis.GlyphMendCompanion = Object.freeze({
  detect: async () => ({ status: "connected" }),
  connect: async () => ({ status: "connected", sessionId: "tauri-direct", capabilities: await invoke("companion_capabilities") }),
  getCapabilities: () => invoke("companion_capabilities"),
  createJob: async (request) => ({ jobId: await invoke("companion_create_job", { request }) }),
  appendChunk: (jobId, sequence, body) => invoke("companion_append_chunk", { jobId, sequence, body: Array.from(body) }),
  completeInput: (jobId, request) => invoke("companion_complete_job", { jobId, request }),
  getResult: (jobId) => invoke("companion_job_result", { jobId }),
  subscribe,
  cancel: (jobId) => invoke("companion_cancel_job", { jobId }),
  disconnect: async () => {},
});