# GlyphMend PostHog analytics

## Cloudflare Pages secret

Add the **encrypted Secret** `POSTHOG_PROJECT_TOKEN` to this Pages project in **Settings → Variables and Secrets → Add**, select **Encrypt**, save it, then redeploy. Use the PostHog project ingestion token for the US Cloud project. Apply it to Production; add the same secret to Preview only if preview traffic should be counted.

The function at `/api/posthog/*` reads this binding at runtime. The browser bundle contains only a placeholder and a same-origin endpoint. Do not add a project token to `VITE_POSTHOG_PROJECT_TOKEN`, HTML, source files, build output, or a `vars` entry. Do not use a personal API/CLI key here. The PostHog project ID is not required by the browser SDK.

If this project is deployed somewhere other than Cloudflare Pages, the Pages Function will not run and tracking stays inactive. Use an equivalent server-side proxy before enabling analytics on another host.

## Pages project layout

The current Cloudflare Pages project uses `web-app` as its root directory and `dist` as its build output. Keep the Function at `web-app/functions/api/posthog/[[path]].js` so Pages discovers the `/api/posthog/*` route. Deploying only the static `web-app/dist/` directory does not include the Function. With the Production Secret configured, `/api/posthog/static/array.js` should return JavaScript; an HTML app shell at that path means the Function is not being routed.

## Events and privacy

The client captures `product_opened`, allowlisted `page_viewed` route IDs, and `ui_interaction` control types. Controls can use an allowlisted `data-posthog-action` value; a small fixed mapping also recognizes exact English, Persian, Russian, and Chinese accessible labels. Only the mapped action ID is sent, never the label or user content. The global `window.__APP_ANALYTICS__.trackFeature(id, outcome)` helper accepts only allowlisted IDs and the `started`, `completed`, or `failed` outcomes. Feature flag evaluation is enabled.

The event sanitizer drops unknown events and replaces event properties with a small allowlist. It never sends page query strings, hashes, form values, uploaded content, filenames, document text, prompts, or user-created labels. GlyphMend processes source documents locally; neither document text nor rendered page content is sent to analytics.

Session replay, surveys, autocapture, and exception capture are off by default. Survey automatic display remains disabled. The code contains masked replay settings as a safeguard if recording is deliberately enabled later, but content-heavy areas still need review first. There is no in-app project, setup, or consent prompt.

## Controls

Tracking behavior is configured in the project's `posthog-analytics` module under `TRACKING_OPTIONS`; these are non-secret code options. Feature flags are on. Keep recording, surveys, autocapture, and exception capture disabled unless their privacy effects are reviewed. The proxy forwards only accepted content types and does not forward cookies, referrer, browser user-agent, or visitor IP headers to PostHog. PostHog may still process network-level metadata from the proxy request.

## Documentation

- [PostHog product analytics installation](https://posthog.com/docs/product-analytics/installation)
- [PostHog feature flags](https://posthog.com/docs/feature-flags)
- [PostHog session replay privacy](https://posthog.com/docs/session-replay)
- [PostHog surveys](https://posthog.com/docs/surveys/installation)
- [Cloudflare Pages Function bindings and secrets](https://developers.cloudflare.com/pages/functions/bindings/)
- [Cloudflare Pages Function routing](https://developers.cloudflare.com/pages/functions/routing/)
