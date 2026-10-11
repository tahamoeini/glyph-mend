import { registerSW } from "virtual:pwa-register";
import "./posthog-analytics.js";

if (location.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) {
  navigator.serviceWorker?.getRegistrations?.().then((registrations) =>
    Promise.all(registrations.map((registration) => registration.unregister())),
  );
  globalThis.caches?.keys?.().then((names) =>
    Promise.all(
      names
        .filter(
          (name) =>
            name.startsWith("workbox-") ||
            name.startsWith("glyphmend") ||
            name.startsWith("pdf-sanitizer"),
        )
        .map((name) => caches.delete(name)),
    ),
  );
} else {
  registerSW({ immediate: true });
}

await import("./app.js");
