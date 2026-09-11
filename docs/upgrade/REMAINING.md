# Remaining work ledger

Append-only unresolved-work ledger for GlyphMend upgrade prompts.

## Entry schema

Each unresolved item must use this schema:

```md
## GM-UPG-<unique-id> — <short title>
- Detected in step: <step number/name>
- Date:
- Status: OPEN | BLOCKED | DEFERRED | FAILED | RESOLVED
- Severity: critical | high | medium | low
- Area:
- Dependency:
- Description:
- Evidence:
- Files / symbols involved:
- What was attempted:
- Why it remains:
- Recommended next action:
- Safe to continue unrelated work: yes | no
- Resolution note:
```

Never delete old entries. Mark resolved work as `RESOLVED` and add a resolution note instead of removing history.

## GM-UPG-001 — OCR e2e baseline fails in local Tesseract path
- Detected in step: Step 01 baseline audit
- Date: 2026-09-11
- Status: OPEN
- Severity: medium
- Area: browser / OCR / e2e
- Dependency: local Tesseract pipeline and OCR assets in web-app
- Description: The baseline Playwright OCR test times out because the extraction worker transitions to `Extraction worker failed` instead of completing OCR successfully.
- Evidence: `npm run test:e2e` failed in [web-app/tests/ocr-baseline.spec.js](web-app/tests/ocr-baseline.spec.js) with `#statusText` showing `Extraction worker failed`.
- Files / symbols involved: [web-app/tests/ocr-baseline.spec.js](web-app/tests/ocr-baseline.spec.js), [web-app/src/features/extraction/extract-worker.js](web-app/src/features/extraction/extract-worker.js), [web-app/src/app.js](web-app/src/app.js)
- What was attempted: Installed browser dependencies, reran browser unit tests and the browser build, then executed the OCR e2e baseline.
- Why it remains: The local OCR path still fails under the e2e baseline, but the exact worker-side cause was not isolated in this step.
- Recommended next action: Inspect the OCR worker logs and asset loading path for the Tesseract baseline sample before changing OCR behavior.
- Safe to continue unrelated work: yes
- Resolution note: Unresolved.

