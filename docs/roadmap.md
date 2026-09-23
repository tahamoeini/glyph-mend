# Active roadmap

## Release readiness

### Benchmark the two engines by document class

Create an independently labeled PDF benchmark set covering text-heavy, scanned English, multi-column, table, equation, and image-heavy documents. Measure OCR error, reading order, structure recovery, latency, and peak memory against browser mode. Publish the class-level results and repeat the runs before making performance or accuracy claims.

### Preserve browser-only behavior

Run the browser extraction, storage, OCR, export, and production-build checks without connecting the Companion. Keep fallback behavior covered for connection denial, unsupported loopback access, Companion failure, and offline operation.

### Verify cross-runtime IR

Maintain versioned Semantic Document IR v2 fixtures consumed by Rust and the browser. Reject invalid or oversized output before it reaches checkpoints or exports.

### Complete signed distribution prerequisites

Keep Windows code signing and macOS Developer ID signing/notarization as hard gates for public Companion publication. Every release package needs its executable, PDFium and Tesseract runtime files, English Fast and Best models, notices, checksums, SBOM, and provenance.

### Promote only measured releases

Publish the first Companion version as a prerelease. Promote it to stable only after repeatable benchmark improvements are documented for specific document classes and browser-only behavior has no regression.
