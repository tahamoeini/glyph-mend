import { createWorkerCapability } from "../../shared/recognizer-capability.js";

export function createVisualWorkerCapability({ workerFactory, fallback } = {}) {
  return createWorkerCapability({
    name: "visual-worker",
    workerFactory,
    fallback,
    metadata: {
      version: "1",
      capability: "visual",
    },
  });
}
