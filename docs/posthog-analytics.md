# GlyphMend PostHog analytics

## Cloudflare Pages secret

Add the **encrypted Secret** `POSTHOG_PROJECT_TOKEN` to this Pages project in **Settings → Variables and Secrets → Add**, select **Encrypt**, save it, then redeploy. Use the PostHog project ingestion token for the US Cloud project. Apply it to Production; add the same secret to Preview only if preview traffic should be counted.

The function at `/api/posthog/*` reads this binding at runtime. The browser bundle contains only a placeholder and a same-origin endpoint. Do not add a project token to `VITE_POSTHOG_PROJECT_TOKEN`, HTML, source files, build output, or a `vars` entry. Do not use a personal API/CLI key here. The PostHog project ID is not required by the browser SDK.

If this project is deployed somewhere other than Cloudflare Pages, the Pages Function will not run and tracking stays inactive. Use an equivalent server-side proxy before enabling analytics on another host.

## Pages project layout

The current Cloudflare Pages project uses `web-app` as its root directory and `dist` as its build output. Keep the Function at `web-app/functions/api/posthog/[[path]].js` so Pages discovers the `/api/posthog/*` route. Deploying only the static `web-app/dist/` directory does not include the Function. With the Production Secret configured, `/api/posthog/static/array.js` should return JavaScript; an HTML app shell at that path means the Function is not being routed.

## Events and privacy

The client captures `product_opened`, allowlisted `page_viewed` route IDs, and `ui_interaction` control types. Controls can use an allowlisted `data-posthog-action` value; a small fixed mapping also recognizes exact English, Persian, Russian, and Chinese accessible labels. Only the mapped action ID is sent, never the label or user content. The global `window.__APP_ANALYTICS__.trackFeature(id, outcome)` helper accepts only allowlisted IDs and the `started`, `completed`, or `failed` outcomes. Feature flag evaluation is enabled.

The event sanitizer drops unknown events and replaces event properties with a small allowlist. It preserves PostHog's `$process_person_profile: false` marker so session-scoped anonymous events do not create person profiles. It never sends page query strings, hashes, form values, uploaded content, filenames, document text, prompts, or user-created labels. GlyphMend processes source documents locally; neither document text nor rendered page content is sent to analytics.

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


## Structured workflow and friction telemetry (October 2026)

The client now exposes a deliberately bounded interface:

```js
window.__APP_ANALYTICS__?.trackWorkflow(" upload ".trim(), "started");
window.__APP_ANALYTICS__?.trackWorkflow(" upload ".trim(), "completed");
window.__APP_ANALYTICS__?.trackIssue("validation");
window.__APP_ANALYTICS__?.trackTiming(" upload ".trim(), 640);
```

Approved workflow identifiers for this app: `upload`, `extract`, `ocr`, `review`, `export`, `download`, `desktop-connect`.

- `workflow_step` has only `app_name`, `route_id`, `step_id`, `outcome` (started/completed/failed/cancelled).
- `client_issue` has only `app_name`, `route_id`, `issue_kind` (runtime/promise/network/validation/timeout/render/storage/unknown).
- `workflow_timing` has only `app_name`, `route_id`, `step_id`, `duration_band` (under_100ms/100_499ms/500_1999ms/2_9s/10s_plus).
- Generic uncaught browser errors and rejected promises emit a **category only**. No exception messages, stack traces or values are transmitted. This is *not* full PostHog exception tracking.
- Calls with unrecognized workflow names, outcomes, timing values or error kinds are ignored. The `before_send` sanitizer also rejects unsafe properties.
- The workflow helper must be called at the actual beginning and end of each operation, including exception/cancellation paths. Simply adding the helper does **not** instrument the operation.
- Never pass usernames, user-generated content, monetary amounts, portfolio holdings, uploaded document names/content, source code, form values, free-text labels, query parameters or raw URLs.

**Reporting contract:** create an app-filtered dashboard with app opens, page views, action IDs, started/completed/failed/cancelled workflow counts, completion funnel and drop-off by `step_id`, error categories, duration bands, and release-over-release comparisons once production events exist. Retention and navigation paths require stable, actually observed event sequences. A dashboard created before deployment is not evidence of working instrumentation.

**Session replay:** stays disabled. Recording cannot be enabled safely merely by setting masking options; it requires review of app-specific sensitive screens and consent/legal basis. The current sanitizer rejects recorder payload events. For actual recordings, a dedicated audited capture pipeline and proxy path will be necessary.

**Free-tier operations:** monitor current PostHog billing/usage before enabling high-volume features. Use scoped events, sampling and retention appropriate to measured demand; free allowances can change. Avoid duplicating autocapture with manually emitted clicks.

**Validation:** confirm the encrypted Cloudflare Pages binding, deploy the Function with the frontend, verify its static SDK route (not an HTML fallback), exercise an actual workflow, then confirm each event's allowlisted properties in PostHog Live Events. Compare started and terminal outcomes; test failed requests and rejected promises without exposing sensitive content. Verify ad blockers and offline operation degrade gracefully. Source module: `web-app/src/posthog-analytics.js`.

