//! Native PDF extraction for the optional local Companion.
#![forbid(unsafe_code)]

use anyhow::{anyhow, Context, Result};
use companion_contract::{
    Capability, DocumentExtractionOptions, ErrorCode, InputKind, JobResult, Progress, ProviderKind,
    DOCUMENT_EXTRACTION_CAPABILITY, IR_SCHEMA_ID, IR_SCHEMA_VERSION,
};
use companion_core::{
    CapabilityProvider, CoreError, ProgressSender, ProviderInput, ProviderOutput,
};
use image::{GenericImageView, ImageFormat};
use pdfium_render::prelude::*;
use rayon::prelude::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc,
    },
};
use tokio_util::sync::CancellationToken;

const ENGINE_ID: &str = "glyphmend.pdfium-tesseract";
const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
const OCR_WORKERS: usize = 2;
const MAX_RENDER_DIMENSION: f64 = 4096.0;
const OCR_DPI: f64 = 300.0;
const MIN_NATIVE_TEXT_CHARS: usize = 24;

#[derive(Debug, Default)]
pub struct PdfiumTesseractProvider;

#[derive(Debug, Clone)]
struct TextSegment {
    text: String,
    bbox: [f64; 4],
    source_kind: &'static str,
    confidence: Option<f64>,
    id: String,
}

struct RawPage {
    page_number: u32,
    width: f64,
    height: f64,
    object_count: usize,
    object_types: BTreeMap<String, u32>,
    native_segments: Vec<TextSegment>,
    tiff: Option<Vec<u8>>,
    render_width: u32,
    render_height: u32,
    fallback_reason: String,
    force_ocr: bool,
    ocr_segments: Vec<TextSegment>,
    ocr_error: Option<String>,
    ocr_confidence: Option<f64>,
}

impl CapabilityProvider for PdfiumTesseractProvider {
    fn capability(&self) -> Capability {
        Capability {
            id: DOCUMENT_EXTRACTION_CAPABILITY.into(),
            version: ENGINE_VERSION.into(),
            provider_kind: ProviderKind::Deterministic,
            input_schema: companion_contract::DOCUMENT_INPUT_SCHEMA.into(),
            output_schema: IR_SCHEMA_ID.into(),
            execution_locations: vec!["companion".into()],
            deterministic: true,
            requires_model: true,
            confidence_calibrated: false,
            privacy_class: "local-only".into(),
            diagnostic_only: false,
            ir_schema_version: IR_SCHEMA_VERSION,
        }
    }

    fn run(
        &self,
        input: ProviderInput,
        cancellation: CancellationToken,
        progress: ProgressSender,
    ) -> std::result::Result<ProviderOutput, CoreError> {
        extract_document(input, cancellation, progress)
            .map_err(|error| CoreError::Provider(error.to_string()))
    }
}

fn extract_document(
    input: ProviderInput,
    cancellation: CancellationToken,
    progress: ProgressSender,
) -> Result<ProviderOutput> {
    if input.input_kind != InputKind::Document || input.capability_id != DOCUMENT_EXTRACTION_CAPABILITY {
        return Err(anyhow!("document extraction requires a PDF document job"));
    }
    let options: DocumentExtractionOptions = serde_json::from_value(input.metadata.clone())
        .context("invalid document extraction options")?;
    options.validate(input.page_count).context("invalid document extraction options")?;
    if cancellation.is_cancelled() {
        return Err(cancelled());
    }
    let mut header = [0u8; 1024];
    let mut file = fs::File::open(&input.input_path).context("could not open uploaded PDF")?;
    use std::io::Read;
    let read = file.read(&mut header)?;
    if !header[..read].windows(5).any(|window| window == b"%PDF-") {
        return Err(anyhow!("uploaded bytes are not a PDF"));
    }

    let pdfium = bind_pdfium()?;
    let document = pdfium
        .load_pdf_from_file(&input.input_path, options.password.as_deref())
        .context("PDFium could not open the uploaded PDF")?;
    let actual_pages = document.pages().len() as u32;
    if actual_pages != input.page_count {
        return Err(anyhow!("PDF page count did not match the declared page count"));
    }

    let mut raw_pages = Vec::with_capacity(options.selected_pages.len());
    for &page_number in &options.selected_pages {
        if cancellation.is_cancelled() {
            return Err(cancelled());
        }
        let page_index = u16::try_from(page_number - 1).context("PDF page index overflow")?;
        let page = document.pages().get(page_index).context("PDFium could not load a page")?;
        let width = f64::from(page.width().value);
        let height = f64::from(page.height().value);
        let mut native_segments = Vec::new();
        let text_page = page.text().context("PDFium could not read page text")?;
        for (index, segment) in text_page.segments().iter().enumerate() {
            let text = segment.text().trim().to_owned();
            if text.is_empty() {
                continue;
            }
            let bounds = segment.bounds();
            let left = f64::from(bounds.left().value);
            let right = f64::from(bounds.right().value);
            let top = (height - f64::from(bounds.top().value)).max(0.0);
            let bottom = (height - f64::from(bounds.bottom().value)).min(height);
            native_segments.push(TextSegment {
                text,
                bbox: [left.max(0.0), top, right.min(width), bottom.max(top)],
                source_kind: "native-text",
                confidence: None,
                id: format!("pdfium-span-{page_number}-{index}"),
            });
        }
        native_segments.sort_by(|left, right| {
            left.bbox[1].total_cmp(&right.bbox[1]).then(left.bbox[0].total_cmp(&right.bbox[0]))
        });
        let mut object_types = BTreeMap::new();
        for object in page.objects().iter() {
            *object_types.entry(format!("{:?}", object.object_type())).or_insert(0) += 1;
        }
        let object_count = object_types.values().map(|count| *count as usize).sum();
        let native_chars = native_segments.iter().map(|segment| segment.text.chars().count()).sum::<usize>();
        let should_ocr = options.use_ocr && (options.force_ocr || native_chars < MIN_NATIVE_TEXT_CHARS);
        let fallback_reason = if !options.use_ocr {
            "ocr-disabled"
        } else if options.force_ocr {
            "forced-by-user"
        } else if native_chars < MIN_NATIVE_TEXT_CHARS {
            "no-usable-native-text"
        } else {
            "native-text-present"
        }.to_owned();

        let mut tiff = None;
        let mut render_width = 0;
        let mut render_height = 0;
        if should_ocr {
            let scale = (OCR_DPI / 72.0)
                .min(MAX_RENDER_DIMENSION / width.max(1.0))
                .min(MAX_RENDER_DIMENSION / height.max(1.0));
            render_width = (width * scale).round().max(1.0) as u32;
            let render_config = PdfRenderConfig::new().set_target_width(render_width as _);
            let rendered = page.render_with_config(&render_config).context("PDFium page rendering failed")?;
            let image = rendered.as_image().context("PDFium image conversion failed")?;
            render_width = image.width();
            render_height = image.height();
            let mut encoded = Cursor::new(Vec::new());
            image.write_to(&mut encoded, ImageFormat::Tiff).context("could not encode OCR image")?;
            tiff = Some(encoded.into_inner());
        }
        raw_pages.push(RawPage {
            page_number, width, height, object_count, object_types, native_segments, tiff,
            render_width, render_height, fallback_reason, force_ocr: options.force_ocr,
            ocr_segments: Vec::new(), ocr_error: None, ocr_confidence: None,
        });
    }
    drop(document);

    let tessdata = resolve_tessdata(&options.ocr_accuracy)?;
    let model_hash = sha256_file(&tessdata.join("eng.traineddata"))?;
    let completed = Arc::new(AtomicU32::new(0));
    let total_pages = raw_pages.len() as u32;
    let progress_sender = progress.clone();
    let cancellation_for_work = cancellation.clone();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(OCR_WORKERS)
        .thread_name(|index| format!("glyphmend-ocr-{index}"))
        .build()
        .context("could not start bounded OCR workers")?;

    let pages = pool.install(|| {
        raw_pages.into_par_iter().map(|mut raw| {
            if cancellation_for_work.is_cancelled() {
                return Err(cancelled());
            }
            if let Some(tiff) = raw.tiff.as_deref() {
                match recognize_tiff(
                    &tessdata,
                    tiff,
                    raw.page_number,
                    raw.render_width,
                    raw.render_height,
                    raw.width,
                    raw.height,
                ) {
                    Ok((segments, confidence)) => {
                        raw.ocr_segments = segments;
                        raw.ocr_confidence = confidence;
                    }
                    Err(error) => raw.ocr_error = Some(error.to_string()),
                }
            }
            let page = page_ir(&raw, &options, &model_hash);
            let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = progress_sender.send(Progress {
                phase: if raw.tiff.is_some() { "ocr-and-reconstruction".into() } else { "native-text-and-reconstruction".into() },
                completed_pages: done,
                total_pages,
                bytes_received: input.bytes_received,
            });
            Ok(page)
        }).collect::<Result<Vec<_>>>()
    })?;
    if cancellation.is_cancelled() {
        return Err(cancelled());
    }
    let document_ir = json!({
        "schema": IR_SCHEMA_ID,
        "schemaVersion": IR_SCHEMA_VERSION,
        "documentId": format!("pdf-sha256-{}", input.content_hash),
        "metadata": {
            "engine": { "id": ENGINE_ID, "version": ENGINE_VERSION },
            "sourceSha256": input.content_hash,
            "ocr": {
                "language": "eng",
                "accuracy": match options.ocr_accuracy {
                    companion_contract::OcrAccuracy::Fast => "fast",
                    companion_contract::OcrAccuracy::HighAccuracy => "high-accuracy",
                },
                "modelSha256": model_hash,
                "fastModel": "tessdata_fast",
                "highAccuracyModel": "tessdata_best"
            }
        },
        "pages": pages,
        "diagnostics": []
    });
    let result = JobResult::SemanticDocument(document_ir);
    result.validate().context("extractor produced invalid Semantic Document IR")?;
    Ok(ProviderOutput { progress: Vec::new(), result: Some(result) })
}

fn bind_pdfium() -> Result<Pdfium> {
    let executable_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."));
    let library = Pdfium::bind_to_library(
        Pdfium::pdfium_platform_library_name_at_path(&executable_dir),
    ).or_else(|_| Pdfium::bind_to_system_library())
        .context("PDFium runtime is missing beside the Companion executable")?;
    Ok(Pdfium::new(library))
}

fn resolve_tessdata(accuracy: &companion_contract::OcrAccuracy) -> Result<PathBuf> {
    let model_set = match accuracy {
        companion_contract::OcrAccuracy::Fast => "fast",
        companion_contract::OcrAccuracy::HighAccuracy => "best",
    };
    let root = std::env::var_os("GLYPHMEND_TESSDATA_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok().and_then(|path| path.parent().map(Path::to_path_buf)).map(|path| path.join("tessdata")))
        .ok_or_else(|| anyhow!("could not locate Companion model directory"))?;
    let path = root.join(model_set);
    if !path.join("eng.traineddata").is_file() {
        return Err(anyhow!("bundled English {model_set} OCR model is missing"));
    }
    Ok(path)
}

fn sha256_file(path: &Path) -> Result<String> {
    let bytes = fs::read(path).with_context(|| format!("could not read OCR model {}", path.display()))?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn recognize_tiff(
    tessdata: &Path,
    tiff: &[u8],
    page_number: u32,
    render_width: u32,
    render_height: u32,
    page_width: f64,
    page_height: f64,
) -> Result<(Vec<TextSegment>, Option<f64>)> {
    let data_path = tessdata.to_str().ok_or_else(|| anyhow!("OCR model path is not valid UTF-8"))?;
    let mut tesseract = leptess::LepTess::new(Some(data_path), "eng")
        .map_err(|error| anyhow!("could not initialize English OCR: {error}"))?;
    tesseract.set_image_from_mem(tiff).context("Tesseract could not read the rendered page")?;
    let tsv = tesseract.get_tsv_text(0).context("Tesseract could not return OCR text")?;
    let x_scale = page_width / f64::from(render_width.max(1));
    let y_scale = page_height / f64::from(render_height.max(1));
    let mut lines: BTreeMap<(u32, u32, u32), (String, f64, f64, f64, f64, Vec<f64>)> = BTreeMap::new();
    for row in tsv.lines().skip(1) {
        let fields = row.splitn(12, '\t').collect::<Vec<_>>();
        if fields.len() != 12 || fields[0] != "5" {
            continue;
        }
        let text = fields[11].trim();
        let confidence = fields[10].parse::<f64>().unwrap_or(-1.0);
        if text.is_empty() || confidence < 0.0 {
            continue;
        }
        let block = fields[2].parse::<u32>().unwrap_or(0);
        let paragraph = fields[3].parse::<u32>().unwrap_or(0);
        let line = fields[4].parse::<u32>().unwrap_or(0);
        let left = fields[6].parse::<f64>().unwrap_or(0.0);
        let top = fields[7].parse::<f64>().unwrap_or(0.0);
        let right = left + fields[8].parse::<f64>().unwrap_or(0.0);
        let bottom = top + fields[9].parse::<f64>().unwrap_or(0.0);
        let entry = lines.entry((block, paragraph, line)).or_insert_with(|| {
            (String::new(), left, top, right, bottom, Vec::new())
        });
        if !entry.0.is_empty() { entry.0.push(' '); }
        entry.0.push_str(text);
        entry.1 = entry.1.min(left);
        entry.2 = entry.2.min(top);
        entry.3 = entry.3.max(right);
        entry.4 = entry.4.max(bottom);
        entry.5.push(confidence / 100.0);
    }
    let mut segments = Vec::with_capacity(lines.len());
    let mut all_confidence = Vec::new();
    for (index, (_, (text, left, top, right, bottom, confidence))) in lines.into_iter().enumerate() {
        let mean = confidence.iter().sum::<f64>() / confidence.len().max(1) as f64;
        all_confidence.push(mean);
        segments.push(TextSegment {
            text: text.trim().to_owned(),
            bbox: [left * x_scale, top * y_scale, right * x_scale, bottom * y_scale],
            source_kind: "ocr-text",
            confidence: Some(mean.clamp(0.0, 1.0)),
            id: format!("tesseract-line-{page_number}-{index}"),
        });
    }
    let mean = (!all_confidence.is_empty()).then(|| {
        all_confidence.iter().sum::<f64>() / all_confidence.len() as f64
    });
    Ok((segments, mean))
}

fn page_ir(raw: &RawPage, options: &DocumentExtractionOptions, model_hash: &str) -> Value {
    let used_ocr = raw.tiff.is_some() && raw.ocr_error.is_none();
    let segments = if raw.force_ocr && used_ocr {
        &raw.ocr_segments
    } else if raw.native_segments.is_empty() {
        &raw.ocr_segments
    } else {
        &raw.native_segments
    };
    let nodes = segments.iter().enumerate().map(|(index, segment)| {
        let text = segment.text.trim();
        json!({
            "id": format!("companion-page-{}-segment-{index}", raw.page_number),
            "type": "paragraph",
            "content": { "markdown": text, "text": text },
            "sourcePage": raw.page_number,
            "bbox": segment.bbox,
            "coordinateSpace": "page-points",
            "sourceKind": segment.source_kind,
            "source": {
                "spanIds": [segment.id],
                "extra": {
                    "engine": ENGINE_ID,
                    "engineVersion": ENGINE_VERSION,
                    "fallbackReason": raw.fallback_reason
                }
            },
            "confidence": {
                "extraction": segment.confidence,
                "structure": null,
                "reconstruction": null,
                "export": null
            },
            "disposition": "reconstructed",
            "reconstructionVersion": 2,
            "diagnostics": []
        })
    }).collect::<Vec<_>>();
    let mut diagnostics = Vec::new();
    if nodes.is_empty() {
        diagnostics.push(json!({
            "code": "NO_RECOGNIZED_TEXT",
            "severity": "warning",
            "message": "No text was recovered by PDFium or English OCR on this page."
        }));
    }
    if let Some(error) = &raw.ocr_error {
        diagnostics.push(json!({
            "code": "OCR_FAILED",
            "severity": "warning",
            "message": "English OCR failed for this page.",
            "details": { "reason": error }
        }));
    }
    json!({
        "id": format!("companion-page-{}", raw.page_number),
        "pageNumber": raw.page_number,
        "sourcePage": raw.page_number,
        "bbox": [0.0, 0.0, raw.width, raw.height],
        "coordinateSpace": "page-points",
        "nodes": nodes,
        "relationships": [],
        "diagnostics": diagnostics,
        "layout": {
            "engine": ENGINE_ID,
            "engineVersion": ENGINE_VERSION,
            "readingOrderMethod": "top-to-bottom-then-left-to-right",
            "pageObjectCount": raw.object_count,
            "pageObjectTypes": raw.object_types
        },
        "source": {
            "engine": ENGINE_ID,
            "engineVersion": ENGINE_VERSION,
            "fallback": {
                "reason": raw.fallback_reason,
                "ocrRequested": options.use_ocr,
                "ocrAttempted": raw.tiff.is_some(),
                "ocrApplied": used_ocr && !raw.ocr_segments.is_empty(),
                "ocrAccuracy": match options.ocr_accuracy {
                    companion_contract::OcrAccuracy::Fast => "fast",
                    companion_contract::OcrAccuracy::HighAccuracy => "high-accuracy"
                },
                "ocrModel": if raw.tiff.is_some() { model_hash } else { Value::Null.as_str().unwrap_or("") },
                "ocrConfidence": raw.ocr_confidence,
                "ocrError": raw.ocr_error
            }
        }
    })
}

fn cancelled() -> anyhow::Error {
    anyhow!("{}: extraction cancelled", ErrorCode::Cancelled)
}
