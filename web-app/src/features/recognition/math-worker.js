import { createWorkerCapability } from "../../shared/recognizer-capability.js";

export function createMathWorkerCapability({ workerFactory, fallback } = {}) {
  return createWorkerCapability({
    name: "math-worker",
    workerFactory,
    fallback,
    metadata: {
      version: "1",
      capability: "math",
    },
  });
}
