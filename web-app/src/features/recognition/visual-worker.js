import { createWorkerCapability } from "../../shared/recognizer-capability.js";
import { visualWorkerRecognize } from "./raster-flowchart.js";

export function createVisualWorkerCapability({ workerFactory, fallback } = {}) {
  const localWorkerFactory = workerFactory || (async () => ({ run: (input, context = {}) => visualWorkerRecognize(input, context) }));
  return createWorkerCapability({
    name: "visual-worker",
    workerFactory: localWorkerFactory,
    fallback,
    metadata: {
      version: "1",
      capability: "visual",
    },
  });
}
