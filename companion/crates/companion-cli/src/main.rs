//! Portable headless local host. It never parses documents itself.
#![forbid(unsafe_code)]

use anyhow::Result;
use companion_bridge::{start, BridgeConfig};
use companion_service::JobManager;
use std::{process::Command, sync::Arc};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .without_time()
        .init();
    let no_open = std::env::args().any(|argument| argument == "--no-open");
    let self_test = std::env::args().any(|argument| argument == "--self-test");
    let handle = start(BridgeConfig::default(), Arc::new(JobManager::default())).await?;
    let connection_url = format!(
        "https://glyphmend.negar.team/#companionEndpoint={}&companionCode={}",
        handle.endpoint, handle.pairing_code
    );

    println!("GlyphMend Companion ready.");
    println!("Endpoint: {}", handle.endpoint);
    println!("Connection URL: {}", connection_url);

    if !no_open && !self_test {
        if let Err(error) = open_browser(&connection_url) {
            eprintln!("Could not open the browser automatically: {error}");
        }
    }
    if self_test {
        handle.shutdown().await;
        return Ok(());
    }
    tokio::signal::ctrl_c().await?;
    handle.shutdown().await;
    Ok(())
}

fn open_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map(|_| ())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(url).spawn().map(|_| ())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(url).spawn().map(|_| ())
    }
}
