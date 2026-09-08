# PDF Sanitizer Browser Edition

A fully local browser variation of pdf-sanitizer.

## Current capabilities

- No backend
- Local PDF loading
- PDF.js based page/text extraction
- Page progress tracking
- Browser Markdown generation
- Local workspace persistence using IndexedDB
- Markdown preview and export

## Architecture

```
PDF
 |
PDF.js
 |
Browser extraction engine
 |
Markdown sanitizer
 |
IndexedDB checkpoints
 |
Local exports
```

## Brython decision

Brython is useful for running Python syntax in the browser, but it does not make the existing CPython PDF/OCR/document-processing stack portable. The browser edition therefore uses JavaScript APIs and browser-compatible libraries.

Future options:

- Web Workers
- WASM processing modules
- TypeScript migration
- optional desktop wrapper

## Scope

This variation intentionally does not modify the Python backend. It is a separate browser implementation sharing concepts and output formats.
