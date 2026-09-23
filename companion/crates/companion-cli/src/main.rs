//! Portable local host for PDFium and Tesseract document extraction.
#![forbid(unsafe_code)]

use anyhow::Result;
use companion_bridge::{start, BridgeConfig, DEFAULT_WEB_ORIGIN};
use companion_core::DiagnosticMockProvider;
use companion_extractor::PdfiumTesseractProvider;
use companion_service::JobManager;
use std::{process::Command, sync::Arc};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .without_time()
        .init();
    let arguments = std::env::args().collect::<Vec<_>>();
    let no_open = arguments.iter().any(|argument| argument == "--no-open");
    let self_test = arguments.iter().any(|argument| argument == "--self-test");
    let web_origin = parse_web_origin(&arguments)?;
    let config = BridgeConfig::for_web_origin(&web_origin)?;
    let manager = JobManager::with_default_storage_providers(vec![
        Arc::new(DiagnosticMockProvider),
        Arc::new(PdfiumTesseractProvider),
    ])?;
    let handle = start(config, Arc::new(manager)).await?;
    let connection_url = format!(
        "{}/#companionEndpoint={}&companionCode={}",
        web_origin.trim_end_matches('/'),
        handle.endpoint,
        handle.pairing_code
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

fn parse_web_origin(arguments: &[String]) -> Result<String> {
    let occurrences = arguments
        .iter()
        .enumerate()
        .filter(|(_, argument)| argument.as_str() == "--web-origin")
        .collect::<Vec<_>>();
    if occurrences.len() > 1 {
        anyhow::bail!("--web-origin may be specified only once");
    }
    let Some((index, _)) = occurrences.first() else {
        return Ok(DEFAULT_WEB_ORIGIN.to_string());
    };
    arguments
        .get(*index + 1)
        .filter(|value| !value.starts_with("--"))
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("--web-origin requires an exact http or https origin"))
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
