const appName = "GlyphMend";
const projectToken = String(import.meta.env.VITE_POSTHOG_PROJECT_TOKEN || "").trim();
let apiHost = String(import.meta.env.VITE_POSTHOG_API_HOST || "https://us.i.posthog.com").trim();
const productionBuild = import.meta.env.PROD;

function posthogOptions() {
  return {
    api_host: apiHost,
    defaults: "2026-05-30",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    disable_session_recording: true,
    disable_surveys: true,
    advanced_disable_flags: true,
    person_profiles: "never",
    persistence: "sessionStorage",
    logs: { captureConsoleLogs: false },
    before_send: function (event) {
      if (!event || event.event !== "product_opened") return null;
      event.properties = { app_name: appName };
      delete event.$set;
      delete event.$set_once;
      return event;
    },
    loaded: function (instance) {
      instance.capture("product_opened", { app_name: appName });
    }
  };
}

function getPosthogStub() {
  const posthog = (window.posthog || []);
  if (posthog.__SV) return posthog;
  window.posthog = posthog;
  posthog._i = [];
  posthog.init = function (token, options, alias) {
    const assetHost = apiHost.replace(/\.i\.posthog\.com(?=\/|$)/, "-assets.i.posthog.com");
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";
    script.async = true;
    script.src = assetHost.replace(/\/+$/, "") + "/static/array.js";
    const firstScript = document.getElementsByTagName("script")[0];
    if (firstScript && firstScript.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }
    const instanceName = alias || "posthog";
    const instance = instanceName === "posthog" ? posthog : (posthog[instanceName] = []);
    const people = instance.people || [];
    instance.people = people;
    const instanceToString = function (verbose) {
      const name = instanceName === "posthog" ? "posthog" : "posthog." + instanceName;
      return verbose ? name : name + " (stub)";
    };
    Object.defineProperty(instance, "toString", {
      configurable: true, enumerable: true, writable: true, value: instanceToString
    });
    Object.defineProperty(people, "toString", {
      configurable: true, enumerable: true, writable: true,
      value: function () { return instanceToString(1) + ".people (stub)"; }
    });
    const methods = "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" ");
    for (const method of methods) {
      instance[method] = function (...args) { instance.push([method, ...args]); };
    }
    posthog._i.push([token, options, instanceName]);
  };
  posthog.__SV = 1;
  return posthog;
}

function normalizeHost(candidate) {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return "";
    return parsed.origin + parsed.pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

const normalizedHost = normalizeHost(apiHost);
if (productionBuild && projectToken && normalizedHost) {
  apiHost = normalizedHost;
  getPosthogStub().init(projectToken, posthogOptions());
}