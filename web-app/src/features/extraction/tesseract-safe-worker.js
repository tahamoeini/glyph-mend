import OEM from "tesseract.js/src/constants/OEM.js";
import createJob from "tesseract.js/src/createJob.js";
import { defaultOptions, loadImage, onMessage, send, spawnWorker, terminateWorker } from "tesseract.js/src/worker/browser/index.js";
import getId from "tesseract.js/src/utils/getId.js";

let workerCounter = 0;

function resolveBrowserPath(value) {
  return value ? new URL(value, self.location.href).href : value;
}

function resolveOptions(options) {
  const resolved = { ...defaultOptions, ...options };
  ["corePath", "workerPath", "langPath"].forEach((key) => {
    if (resolved[key]) resolved[key] = resolveBrowserPath(resolved[key]);
  });
  return resolved;
}

export async function createSafeWorker(
  langs = "eng",
  oem = OEM.LSTM_ONLY,
  workerOptions = {},
  config = {},
) {
  const id = getId("Worker", workerCounter);
  workerCounter += 1;

  const {
    logger = () => {},
    errorHandler = () => {},
    ...options
  } = resolveOptions(workerOptions);

  const promises = new Map();
  const currentLangs = typeof langs === "string" ? langs.split("+") : langs;
  let currentOem = oem;
  let currentConfig = config;
  const lstmOnlyCore = [OEM.DEFAULT, OEM.LSTM_ONLY].includes(oem) && !options.legacyCore;

  let workerResResolve;
  let workerResReject;
  let workerSettled = false;
  const workerRes = new Promise((resolve, reject) => {
    workerResResolve = (value) => {
      if (workerSettled) return;
      workerSettled = true;
      resolve(value);
    };
    workerResReject = (reason) => {
      if (workerSettled) return;
      workerSettled = true;
      reject(reason);
    };
  });

  const worker = spawnWorker(options);
  worker.onerror = (event) => {
    const message = event?.message || "Worker startup failed";
    workerResReject(message);
    errorHandler(message);
  };

  const settleJob = (action, jobId, status, data) => {
    const promiseId = `${action}-${jobId}`;
    const handlers = promises.get(promiseId);
    if (!handlers) return false;
    promises.delete(promiseId);
    if (status === "resolve") handlers.resolve({ jobId, data });
    else handlers.reject(data);
    return true;
  };

  const startJob = ({ id: jobId, action, payload }) =>
    new Promise((resolve, reject) => {
      promises.set(`${action}-${jobId}`, { resolve, reject });
      send(worker, {
        workerId: id,
        jobId,
        action,
        payload,
      });
    });

  const loadInternal = (jobId) =>
    startJob(
      createJob({
        id: jobId,
        action: "load",
        payload: {
          options: {
            lstmOnly: lstmOnlyCore,
            corePath: options.corePath,
            logging: options.logging,
          },
        },
      }),
    );

  const loadLanguageInternal = (_langs, jobId) =>
    startJob(
      createJob({
        id: jobId,
        action: "loadLanguage",
        payload: {
          langs: _langs,
          options: {
            langPath: options.langPath,
            dataPath: options.dataPath,
            cachePath: options.cachePath,
            cacheMethod: options.cacheMethod,
            gzip: options.gzip,
            lstmOnly: [OEM.DEFAULT, OEM.LSTM_ONLY].includes(currentOem) && !options.legacyLang,
          },
        },
      }),
    );

  const initializeInternal = (_langs, _oem, _config, jobId) =>
    startJob(
      createJob({
        id: jobId,
        action: "initialize",
        payload: { langs: _langs, oem: _oem, config: _config },
      }),
    );

  const recognize = async (image, opts = {}, output = { text: true }, jobId) =>
    startJob(
      createJob({
        id: jobId,
        action: "recognize",
        payload: { image: await loadImage(image), options: opts, output },
      }),
    );

  const reinitialize = async (langsValue = "eng", nextOem, nextConfig, jobId) => {
    const desiredOem = nextOem || currentOem;
    if (lstmOnlyCore && [OEM.TESSERACT_ONLY, OEM.TESSERACT_LSTM_COMBINED].includes(desiredOem)) {
      throw new Error("Legacy model requested but code missing.");
    }
    currentOem = desiredOem;
    currentConfig = nextConfig || currentConfig;
    const langsArr = typeof langsValue === "string" ? langsValue.split("+") : langsValue;
    const freshLangs = langsArr.filter((value) => !currentLangs.includes(value));
    currentLangs.push(...freshLangs);
    if (freshLangs.length) {
      await loadLanguageInternal(freshLangs, jobId);
    }
    return initializeInternal(langsValue, desiredOem, currentConfig, jobId);
  };

  const setParameters = (params = {}, jobId) =>
    startJob(
      createJob({
        id: jobId,
        action: "setParameters",
        payload: { params },
      }),
    );

  const readText = (path, jobId) =>
    startJob(
      createJob({
        id: jobId,
        action: "FS",
        payload: { method: "readFile", args: [path, { encoding: "utf8", flags: "a+" }] },
      }),
    );

  const terminate = async () => {
    promises.clear();
    terminateWorker(worker);
  };

  onMessage(worker, ({ jobId, status, action, data }) => {
    if (status === "progress") {
      logger({ ...data, userJobId: jobId });
      return;
    }
    const handled = settleJob(action, jobId, status, data);
    if (status === "reject") {
      if (action === "load" || action === "loadLanguage" || action === "initialize") {
        workerResReject(data);
      }
      errorHandler(data);
      return;
    }
    if (!handled) {
      // Ignore late resolve/reject events after a failed startup. The upstream
      // wrapper throws here, which crashes the outer extraction worker.
    }
  });

  const resolveObj = {
    worker,
    readText,
    recognize,
    reinitialize,
    setParameters,
    terminate,
  };

  loadInternal()
    .then(() => loadLanguageInternal(langs))
    .then(() => initializeInternal(langs, oem, config))
    .then(() => workerResResolve(resolveObj))
    .catch((error) => workerResReject(error));

  return workerRes;
}