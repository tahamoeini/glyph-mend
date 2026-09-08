# PDF Sanitizer Browser Edition

A fully client-side HTML/CSS/JavaScript variation of pdf-sanitizer.

## Goals

- Run locally in a browser.
- No backend.
- No server processing.
- Keep the existing Python project untouched.
- Share compatible concepts with the main project where practical.

## Architecture

```
Browser
 ├── HTML UI
 ├── CSS styling
 ├── JavaScript application layer
 ├── Web Workers for heavy tasks
 ├── IndexedDB local workspace
 └── WASM/browser libraries
```

## Brython decision

Brython is interesting for Python-in-browser experiments, but it is not the default choice for this project. The current extraction pipeline depends on Python libraries and native tooling that do not naturally move into a browser sandbox.

The browser edition should use JavaScript/TypeScript as the runtime and reuse concepts, formats, and algorithms rather than trying to execute the existing Python application directly.

Brython can be evaluated later for small scripting/plugin scenarios.

## Current scope

Initial MVP:

- load PDF locally
- render pages
- inspect Markdown
- convert Markdown preview
- export local artifacts
- run lightweight client-side sanitization

Advanced extraction features will require browser-compatible implementations or WASM ports.
