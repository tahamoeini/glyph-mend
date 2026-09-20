import { invoke } from "@tauri-apps/api/core";

// This file is packaged only with the Tauri shell. The ordinary browser app
// detects this narrow global without importing Tauri code.
globalThis.GlyphMendCompanion = Object.freeze({
  detect: async () => ({ status: "connected" }),
  connect: async () => ({ status: "connected", sessionId: "tauri-direct" }),
  getCapabilities: () => invoke("companion_capabilities"),
  createJob: async (request) => ({ jobId: await invoke("companion_create_job", { request }) }),
  subscribe: () => () => {},
  cancel: (jobId) => invoke("companion_cancel_job", { jobId }),
  disconnect: async () => {},
});
