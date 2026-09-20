//! Development and headless local host. It never opens documents itself.
#![forbid(unsafe_code)]

use anyhow::Result;
use companion_bridge::{start, BridgeConfig};
use companion_service::JobManager;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .without_time()
        .init();
    let handle = start(BridgeConfig::default(), Arc::new(JobManager::default())).await?;
    println!("GlyphMend companion endpoint: {}", handle.endpoint);
    println!(
        "Pairing code (single use, expires in five minutes): {}",
        handle.pairing_code
    );
    if std::env::args().any(|argument| argument == "--self-test") {
        handle.shutdown().await;
        return Ok(());
    }
    tokio::signal::ctrl_c().await?;
    handle.shutdown().await;
    Ok(())
}
