export * from "./extract-worker-core.js";

import {
  validateWorkerRequest,
  validateWorkerResponse,
} from "../../security/validation.js";
import "./extract-worker-core.js";

const isDedicatedWorker =
  typeof WorkerGlobalScope !== "undefined" &&
  typeof self !== "undefined" &&
  self instanceof WorkerGlobalScope;

if (isDedicatedWorker) {
  const coreHandler = self.onmessage;
  const nativePostMessage = self.postMessage.bind(self);
  let allowedPages = new Set();

  self.postMessage = (message, transfer) => {
    try {
      validateWorkerResponse(message, { allowedPages });
      if (transfer === undefined) nativePostMessage(message);
      else nativePostMessage(message, transfer);
    } catch {
      nativePostMessage({
        type: "error",
        code: "SECURITY_VALIDATION",
        message: "Worker output was rejected by the security policy.",
      });
    }
  };

  self.onmessage = async (event) => {
    try {
      const data = validateWorkerRequest(event?.data, {
        baseUrl: self.location?.href,
      });
      allowedPages = new Set(data.pages);
      await coreHandler?.call(self, { data });
    } catch (error) {
      nativePostMessage({
        type: "error",
        code: "SECURITY_VALIDATION",
        message: `Security validation rejected worker request: ${error?.message || "invalid input"}`,
      });
    }
  };
}
