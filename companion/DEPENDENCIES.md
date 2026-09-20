# Companion dependency record

Resolved versions are pinned in `Cargo.lock`; this record identifies the direct
runtime surface reviewed for the first companion foundation.

| Component | Resolved line | License |
| --- | --- | --- |
| Rust toolchain | 1.97.0 | Rust/LLVM terms |
| Tauri Rust shell | 2.11.6 | Apache-2.0 OR MIT |
| Tauri web adapter | 2.11.1 | Apache-2.0 OR MIT |
| Axum | 0.8.9 | MIT |
| Tokio / tokio-util | 1.53.1 / 0.7.19 | MIT |
| Serde / serde_json | 1.0.229 / 1.0.151 | MIT OR Apache-2.0 |
| UUID / zeroize / getrandom | 1.26.1 / 1.9.0 / 0.3.4 | Apache-2.0 OR MIT |
| bytes / tracing / tower-http | 1.12.1 / 0.1.44 / 0.7.1 | MIT |

`cargo deny check` applies the deny-by-default advisory/license policy in
`deny.toml`. No PDF library, OCR engine, model runtime, model weight, network
client, telemetry SDK, shell plugin, filesystem plugin, or updater plugin is a
companion dependency.
