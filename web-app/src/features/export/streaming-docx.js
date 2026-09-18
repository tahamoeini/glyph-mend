import { Deflate, strToU8 } from "fflate";
import { parseLatexToMathIR } from "../../shared/mathir-parser.js";
import { MATH_IR_LIMITS } from "../../shared/semantic-ir.js";

export const STREAMING_DOCX_LIMITS = Object.freeze({
  automaticThresholdCharacters: 512 * 1024,
  automaticThresholdAssets: 512,
  maxMathDepth: MATH_IR_LIMITS.maxDepth,
  maxMathNodes: MATH_IR_LIMITS.maxNodes,
  maxMathStringLength: MATH_IR_LIMITS.maxStringLength,
  maxImageWidth: 600,
  maxImageHeight: 760,
});

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

function byteView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT === 1)
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function updateCrc(crc, bytes) {
  let value = crc >>> 0;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function binaryHeader(signature, length) {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  return bytes;
}

function zipLocalHeader(name, method, flags, crc, compressedSize, size) {
  const nameBytes = strToU8(name);
  const header = binaryHeader(0x04034b50, 30 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint16(4, 20, true);
  view.setUint16(6, flags, true);
  view.setUint16(8, method, true);
  view.setUint32(14, crc >>> 0, true);
  view.setUint32(18, compressedSize >>> 0, true);
  view.setUint32(22, size >>> 0, true);
  view.setUint16(26, nameBytes.length, true);
  header.set(nameBytes, 30);
  return header;
}

class StreamingZip {
  constructor() {
    this.parts = [];
    this.offset = 0;
    this.entries = [];
  }

  push(bytes) {
    const value = byteView(bytes) || new Uint8Array(bytes);
    if (value.byteLength) {
      this.parts.push(value);
      this.offset += value.byteLength;
    }
  }

  addStored(name, data, directory = false) {
    const bytes = byteView(data) || strToU8(String(data || ""));
    const crc = (~updateCrc(0xffffffff, bytes)) >>> 0;
    const offset = this.offset;
    this.push(zipLocalHeader(name, 0, 0x800, crc, bytes.byteLength, bytes.byteLength));
    this.push(bytes);
    this.entries.push({
      name,
      method: 0,
      flags: 0x800,
      crc,
      compressedSize: bytes.byteLength,
      size: bytes.byteLength,
      offset,
      directory,
    });
  }

  startDeflated(name) {
    const offset = this.offset;
    const flags = 0x808;
    const nameBytes = strToU8(name);
    const header = zipLocalHeader(name, 8, flags, 0, 0, 0);
    this.push(header);
    let crc = 0xffffffff;
    let size = 0;
    let compressedSize = 0;
    const deflate = new Deflate({ level: 6 }, (chunk) => {
      if (chunk?.byteLength) {
        compressedSize += chunk.byteLength;
        this.push(chunk);
      }
    });
    let finalized = false;
    return {
      push: (bytes) => {
        if (finalized) throw new Error(`ZIP entry ${name} was already finalized.`);
        const value = byteView(bytes) || strToU8(String(bytes || ""));
        crc = updateCrc(crc, value);
        size += value.byteLength;
        deflate.push(value);
      },
      finalize: () => {
        if (finalized) return;
        finalized = true;
        deflate.push(new Uint8Array(), true);
        const finalCrc = (~crc) >>> 0;
        const descriptor = binaryHeader(0x08074b50, 16);
        const view = new DataView(descriptor.buffer);
        view.setUint32(4, finalCrc, true);
        view.setUint32(8, compressedSize >>> 0, true);
        view.setUint32(12, size >>> 0, true);
        this.push(descriptor);
        this.entries.push({
          name,
          method: 8,
          flags,
          crc: finalCrc,
          compressedSize,
          size,
          offset,
          nameBytes,
          directory: false,
        });
      },
    };
  }

  finish() {
    const centralOffset = this.offset;
    for (const entry of this.entries) {
      const nameBytes = entry.nameBytes || strToU8(entry.name);
      const central = binaryHeader(0x02014b50, 46 + nameBytes.length);
      const view = new DataView(central.buffer);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, entry.flags, true);
      view.setUint16(10, entry.method, true);
      view.setUint32(16, entry.crc >>> 0, true);
      view.setUint32(20, entry.compressedSize >>> 0, true);
      view.setUint32(24, entry.size >>> 0, true);
      view.setUint16(28, nameBytes.length, true);
      view.setUint32(38, entry.directory ? 0x10 : 0, true);
      view.setUint32(42, entry.offset >>> 0, true);
      central.set(nameBytes, 46);
      this.push(central);
    }
    const centralSize = this.offset - centralOffset;
    const end = binaryHeader(0x06054b50, 22);
    const view = new DataView(end.buffer);
    view.setUint16(8, this.entries.length, true);
    view.setUint16(10, this.entries.length, true);
    view.setUint32(12, centralSize >>> 0, true);
    view.setUint32(16, centralOffset >>> 0, true);
    this.push(end);
    return new Blob(this.parts, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function notifyStreamingWarning(options, warning) {
  try {
    options.onWarning?.(warning);
  } catch {
    // Diagnostics must not turn a recoverable block fallback into an export failure.
  }
}

function asBytes(value) {
  return byteView(value);
}

async function assetBytes(value) {
  const bytes = asBytes(value);
  if (bytes) return bytes;
  if (value?.arrayBuffer) return new Uint8Array(await value.arrayBuffer());
  return null;
}

function imageType(asset) {
  const value = String(asset?.type || asset?.mimeType || "png").toLowerCase();
  if (value.includes("jpeg") || value === "jpg") return "jpeg";
  if (value.includes("gif")) return "gif";
  if (value.includes("bmp")) return "bmp";
  if (value.includes("svg")) return "svg";
  return "png";
}

function imageContentType(extension) {
  return extension === "jpeg"
    ? "image/jpeg"
    : extension === "gif"
      ? "image/gif"
      : extension === "bmp"
        ? "image/bmp"
        : extension === "svg"
          ? "image/svg+xml"
          : "image/png";
}

function safeDimension(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(maximum, Math.max(1, Math.round(number)));
}

function visualDimensions(asset) {
  const width = safeDimension(asset?.width, 500, STREAMING_DOCX_LIMITS.maxImageWidth);
  const height = safeDimension(asset?.height, 300, STREAMING_DOCX_LIMITS.maxImageHeight);
  const scale = Math.min(
    STREAMING_DOCX_LIMITS.maxImageWidth / width,
    STREAMING_DOCX_LIMITS.maxImageHeight / height,
    1,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function emu(value) {
  return Math.max(1, Math.round(Number(value || 1) * 9525));
}

function textXml(value, properties = "") {
  const text = String(value ?? "");
  if (!text) return "";
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function inlineXml(source) {
  const text = String(source || "")
    .replace(/<!--.*?-->/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const runs = [];
  const re = /(\*\*([^*]+)\*\*|_([^_<>]+)_|`([^`]+)`|<sup>(.*?)<\/sup>|<sub>(.*?)<\/sub>|<u>(.*?)<\/u>)/gi;
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    if (match.index > last) runs.push(textXml(text.slice(last, match.index)));
    const value = match[2] || match[3] || match[4] || match[5] || match[6] || match[7] || "";
    const properties = [
      match[2] ? "<w:b/>" : "",
      match[3] ? "<w:i/>" : "",
      match[4] ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : "",
      match[5] ? '<w:vertAlign w:val="superscript"/>' : "",
      match[6] ? '<w:vertAlign w:val="subscript"/>' : "",
      match[7] ? '<w:u w:val="single"/>' : "",
    ].join("");
    runs.push(textXml(value, properties));
    last = re.lastIndex;
  }
  if (last < text.length) runs.push(textXml(text.slice(last)));
  return runs.join("");
}

function resolveNode(node, map, key) {
  if (!node) return null;
  const direct = node[key];
  if (typeof direct === "object" && direct) return direct;
  if (typeof direct === "string") return map.get(direct) || null;
  const id = node[`${key}Id`];
  return typeof id === "string" ? map.get(id) || null : null;
}

function childrenOf(node, map) {
  if (Array.isArray(node?.childrenIds))
    return node.childrenIds.map((id) => map.get(id)).filter(Boolean);
  return Array.isArray(node?.children) ? node.children : [];
}

function mathValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value.type === "number" || value.type === "identifier" || value.type === "text")
    return String(value.value ?? "");
  if (value.type === "symbol") return String(value.symbol ?? "");
  if (value.type === "operator") return mathOperator(value.value);
  if (value.type === "unsupported") return value.raw || `\\${value.command || "?"}`;
  return "";
}

function mathOperator(value) {
  return {
    plus: "+",
    minus: "−",
    times: "×",
    divide: "÷",
    "plus-minus": "±",
    "less-equal": "≤",
    "greater-equal": "≥",
    "not-equal": "≠",
    approximately: "≈",
    equivalent: "≡",
    similar: "∼",
    proportional: "∝",
    in: "∈",
    to: "→",
    equals: "=",
    "less-than": "<",
    "greater-than": ">",
    separator: "&",
  }[value] ?? String(value ?? "");
}

function mathRun(value) {
  return `<m:r><m:t>${escapeXml(value)}</m:t></m:r>`;
}

function binaryXml(node, map, operator, depth) {
  return `${mathNodeXml(resolveNode(node, map, "left"), map, depth + 1)}${mathRun(operator)}${mathNodeXml(resolveNode(node, map, "right"), map, depth + 1)}`;
}

function mathNodeXml(node, map, depth = 0) {
  if (depth > STREAMING_DOCX_LIMITS.maxMathDepth)
    throw new RangeError("MathIR depth limit exceeded during DOCX streaming.");
  if (node == null) return mathRun(" ");
  if (typeof node === "string" || typeof node === "number") return mathRun(node);
  switch (node.type) {
    case "fraction":
      return `<m:f><m:num>${mathNodeXml(resolveNode(node, map, "numerator"), map, depth + 1)}</m:num><m:den>${mathNodeXml(resolveNode(node, map, "denominator"), map, depth + 1)}</m:den></m:f>`;
    case "root": {
      const degree = resolveNode(node, map, "index");
      return `<m:rad><m:radPr/>${degree ? `<m:deg>${mathNodeXml(degree, map, depth + 1)}</m:deg>` : ""}<m:e>${mathNodeXml(resolveNode(node, map, "value"), map, depth + 1)}</m:e></m:rad>`;
    }
    case "sum":
    case "prod":
    case "integral": {
      const lower = resolveNode(node, map, "lower");
      const upper = resolveNode(node, map, "upper");
      const symbol = node.type === "sum" ? "∑" : node.type === "prod" ? "∏" : "∫";
      const limitLocation = node.type === "integral" ? "subSup" : "undOvr";
      const body = node.type === "integral"
        ? `${mathNodeXml(resolveNode(node, map, "body"), map, depth + 1)}${mathNodeXml(resolveNode(node, map, "differential"), map, depth + 1)}`
        : mathNodeXml(resolveNode(node, map, "body"), map, depth + 1);
      return `<m:nary><m:naryPr><m:chr m:val="${symbol}"/><m:limLoc m:val="${limitLocation}"/></m:naryPr>${lower ? `<m:sub>${mathNodeXml(lower, map, depth + 1)}</m:sub>` : ""}${upper ? `<m:sup>${mathNodeXml(upper, map, depth + 1)}</m:sup>` : ""}<m:e>${body}</m:e></m:nary>`;
    }
    case "subscript": {
      const base = resolveNode(node, map, "base");
      const value = resolveNode(node, map, "value");
      if (base?.type === "superscript") {
        return `<m:sSubSup><m:sSubSupPr/><m:e>${mathNodeXml(resolveNode(base, map, "base"), map, depth + 1)}</m:e><m:sub>${mathNodeXml(value, map, depth + 1)}</m:sub><m:sup>${mathNodeXml(resolveNode(base, map, "value"), map, depth + 1)}</m:sup></m:sSubSup>`;
      }
      return `<m:sSub><m:sSubPr/><m:e>${mathNodeXml(base, map, depth + 1)}</m:e><m:sub>${mathNodeXml(value, map, depth + 1)}</m:sub></m:sSub>`;
    }
    case "superscript": {
      const base = resolveNode(node, map, "base");
      const value = resolveNode(node, map, "value");
      if (base?.type === "subscript") {
        return `<m:sSubSup><m:sSubSupPr/><m:e>${mathNodeXml(resolveNode(base, map, "base"), map, depth + 1)}</m:e><m:sub>${mathNodeXml(resolveNode(base, map, "value"), map, depth + 1)}</m:sub><m:sup>${mathNodeXml(value, map, depth + 1)}</m:sup></m:sSubSup>`;
      }
      return `<m:sSup><m:sSupPr/><m:e>${mathNodeXml(base, map, depth + 1)}</m:e><m:sup>${mathNodeXml(value, map, depth + 1)}</m:sup></m:sSup>`;
    }
    case "equation": return binaryXml(node, map, "=", depth);
    case "difference": return binaryXml(node, map, "−", depth);
    case "product": return binaryXml(node, map, "×", depth);
    case "quotient": return binaryXml(node, map, "÷", depth);
    case "binary": return binaryXml(node, map, mathOperator(node.value), depth);
    case "function":
      return `${mathNodeXml(resolveNode(node, map, "name"), map, depth + 1)}${mathNodeXml(resolveNode(node, map, "argument"), map, depth + 1)}`;
    case "sequence":
    case "group":
    case "environment":
      return childrenOf(node, map).map((child) => mathNodeXml(child, map, depth + 1)).join("") || mathNodeXml(resolveNode(node, map, "body"), map, depth + 1);
    case "identifier":
    case "number":
    case "text":
    case "symbol":
    case "operator":
      return mathRun(mathValue(node));
    case "linebreak": return mathRun(" ");
    default: return mathRun(mathValue(node) || node.raw || " ");
  }
}

function equationXml(source) {
  const raw = String(source || "").trim();
  if (raw.length > STREAMING_DOCX_LIMITS.maxMathStringLength)
    throw new RangeError("Equation source length limit exceeded during DOCX streaming.");
  const ir = parseLatexToMathIR(raw);
  if (!ir || ir.disposition !== "accepted" || ir.errors?.length)
    throw new Error("Equation reconstruction was not validated for editable DOCX output.");
  if (ir.nodes.length > STREAMING_DOCX_LIMITS.maxMathNodes)
    throw new RangeError("MathIR node limit exceeded during DOCX streaming.");
  const map = new Map(ir.nodes.map((node) => [node.id, node]));
  const root = map.get(ir.rootId) || ir.nodes[0];
  return `<m:oMathPara><m:oMath>${mathNodeXml(root, map)}</m:oMath></m:oMathPara>`;
}

function paragraphXml(content, options = {}) {
  const properties = [];
  if (options.style) properties.push(`<w:pStyle w:val="${escapeXml(options.style)}"/>`);
  if (options.align) properties.push(`<w:jc w:val="${options.align}"/>`);
  if (options.spacing) properties.push(`<w:spacing w:after="${options.spacing}"/>`);
  if (options.bullet) properties.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
  if (options.numbered) properties.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>');
  return `<w:p>${properties.length ? `<w:pPr>${properties.join("")}</w:pPr>` : ""}${content || "<w:r><w:t xml:space=\"preserve\"></w:t></w:r>"}</w:p>`;
}

function tableXml(lines) {
  const rows = lines
    .filter((_, index) => index !== 1)
    .map((line, rowIndex) => {
      const cells = line.replace(/^\||\|$/g, "").split("|");
      return `<w:tr>${cells.map((cell) => `<w:tc><w:tcPr>${rowIndex === 0 ? "<w:shd w:fill=\"E8F0EE\"/>" : ""}</w:tcPr>${paragraphXml(inlineXml(cell.trim()))}</w:tc>`).join("")}</w:tr>`;
    })
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows}</w:tbl>`;
}

function imageXml(asset, relationshipId, drawingId) {
  const size = visualDimensions(asset);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(size.width)}" cy="${emu(size.height)}"/><wp:effectExtent t="0" r="0" b="0" l="0"/><wp:docPr id="${drawingId}" name="GlyphMend preserved visual" descr="${escapeXml(asset?.caption || "Source visual preserved from PDF")}" title="Source visual"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="" descr="${escapeXml(asset?.caption || "Source visual")}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}" cstate="none"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(size.width)}" cy="${emu(size.height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function sourceFields(line) {
  const match = /^\[SOURCE_VISUAL\s+([^\]]+)\]$/.exec(line);
  if (!match) return null;
  const fields = {};
  for (const item of match[1].matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g))
    fields[item[1]] = item[2] ?? item[3];
  return fields;
}

function contentTypes(mediaExtensions) {
  const defaults = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    ...[...mediaExtensions].map((extension) => `<Default Extension="${extension}" ContentType="${imageContentType(extension)}"/>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join("")}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

const documentHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document mc:Ignorable="w14 w15 wp14" xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas.microsoft.com/office/word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:body>`;
const documentFooter = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault/><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="21"/></w:rPr></w:style>${[1,2,3,4,5,6].map((level) => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="Heading ${level}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="${32 - Math.min(5, level - 1) * 2}"/></w:rPr></w:style>`).join("")}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style></w:styles>`;
const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>`;
const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:compat><w:compatSetting w:val="15" w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word"/></w:compat></w:settings>`;
const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotes>`;
const endnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotes>`;
const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`;
const fontTableXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="Aptos"/></w:fonts>`;
const emptyRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"/>`;
const customPropertiesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"/>`;

function rootRelationships() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>`;
}

function documentRelationships(media) {
  const entries = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>',
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>',
    '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    '<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>',
    '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>',
  ];
  for (const entry of media) entries.push(`<Relationship Id="${entry.relationshipId}" Type="${IMAGE_REL}" Target="${entry.target}"/>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}">${entries.join("")}</Relationships>`;
}

function coreProperties(title) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(title || "Document")}</dc:title><dc:creator>GlyphMend</dc:creator></cp:coreProperties>`;
}

function appProperties() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>GlyphMend Browser Edition</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>GlyphMend</Company></Properties>`;
}

async function addTextEntry(entry, state, options) {
  const fields = sourceFields(entry.trim);
  if (fields) {
    const asset = state.assets.get(fields.id);
    let data = null;
    let readError = null;
    if (asset?.data) {
      try {
        data = await assetBytes(asset.data);
      } catch (error) {
        readError = error;
      }
    }
    if (data?.byteLength) {
      const extension = imageType(asset);
      const relationshipId = `rId${state.nextRelationshipId++}`;
      const target = `media/image-${String(state.media.length + 1).padStart(5, "0")}.${extension}`;
      state.media.push({ asset, extension, relationshipId, target, data });
      const drawingId = state.nextDrawingId++;
      return paragraphXml(imageXml(asset, relationshipId, drawingId), { align: "center", spacing: 140 });
    }
    if (asset?.data)
      notifyStreamingWarning(options, { kind: "visual", message: `Asset ${asset.id || fields.id} was not readable; source marker preserved.`, error: readError instanceof Error ? readError.message : undefined });
    return paragraphXml(inlineXml(`Source ${fields.kind || "visual"} preserved on PDF page ${fields.page}.`), { align: "center", spacing: 140 });
  }
  return paragraphXml(inlineXml(entry));
}

function sourceMarkerFromLine(line) {
  const fields = sourceFields(line);
  return fields ? fields.id : null;
}

export function shouldUseStreamingDocx(markdown = "", options = {}) {
  if (options.streaming === true || options.forceStreaming === true) return true;
  if (options.streaming === false || options.forceStreaming === false) return false;
  const assetCount = options.assets?.size ?? Object.keys(options.assets || {}).length;
  return String(markdown).length >= STREAMING_DOCX_LIMITS.automaticThresholdCharacters || assetCount >= STREAMING_DOCX_LIMITS.automaticThresholdAssets;
}

export async function markdownToStreamingDocx(markdown, title = "Document", options = {}) {
  const assets = options.assets instanceof Map ? options.assets : new Map(Object.entries(options.assets || {}));
  const zip = new StreamingZip();
  const documentEntry = zip.startDeflated("word/document.xml");
  const state = {
    assets,
    media: [],
    nextRelationshipId: 8,
    nextDrawingId: 1,
    section: 0,
  };
  const push = (value) => documentEntry.push(strToU8(value));
  const pushBlock = async (xml) => {
    push(xml);
    state.section += 1;
    if (state.section % 128 === 0) {
      await options.onProgress?.({ section: Math.ceil(state.section / 128), blocks: 128, streaming: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  try {
    push(documentHeader);
    const lines = String(markdown || "").split("\n");
    let inMath = false;
    let math = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trim = line.trim();
      if (/^<!--\s*page:/.test(trim)) {
        if (options.pageBreaks) await pushBlock(paragraphXml('<w:r><w:br w:type="page"/></w:r>'));
        continue;
      }
      if (/^<!--/.test(trim)) continue;
      if (trim === "$$") {
        if (inMath) {
          const raw = math.join(" ").trim();
          try {
            await pushBlock(paragraphXml(equationXml(raw), { align: "center" }));
          } catch (error) {
            notifyStreamingWarning(options, { kind: "equation", message: error instanceof Error ? error.message : String(error), fallback: "source-text" });
            await pushBlock(paragraphXml(inlineXml(raw), { align: "center" }));
          }
          math = [];
        }
        inMath = !inMath;
        continue;
      }
      if (inMath) {
        math.push(trim);
        continue;
      }
      const fence = /^```([A-Za-z0-9_-]+)\s*$/.exec(trim);
      if (fence) {
        const source = [];
        while (index + 1 < lines.length && lines[index + 1].trim() !== "```") source.push(lines[++index]);
        if (lines[index + 1]?.trim() === "```") index += 1;
        await pushBlock(paragraphXml(inlineXml(`[${fence[1]} source preserved]\n${source.join("\n")}`), { spacing: 140 }));
        continue;
      }
      if (/^\|.*\|$/.test(trim) && /^\|?\s*:?-{3,}/.test((lines[index + 1] || "").trim())) {
        const table = [line, lines[++index]];
        while (/^\|.*\|$/.test(lines[index + 1] || "")) table.push(lines[++index]);
        await pushBlock(tableXml(table));
        continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(trim);
      if (heading) {
        await pushBlock(paragraphXml(inlineXml(heading[2]), { style: `Heading${heading[1].length}` }));
        continue;
      }
      const list = /^[-*+]\s+(.+)$/.exec(trim);
      if (list) {
        await pushBlock(paragraphXml(inlineXml(list[1]), { bullet: true }));
        continue;
      }
      const numbered = /^\d+[.)]\s+(.+)$/.exec(trim);
      if (numbered) {
        await pushBlock(paragraphXml(inlineXml(numbered[1]), { numbered: true }));
        continue;
      }
      if (sourceMarkerFromLine(trim)) {
        await pushBlock(await addTextEntry({ trim }, state, options));
        continue;
      }
      if (/^\[VISUAL_PLACEHOLDER/.test(trim)) {
        await pushBlock(paragraphXml(inlineXml(trim.replace(/^\[VISUAL_PLACEHOLDER\s*|\]$/g, "")), { align: "center" }));
        continue;
      }
      if (trim) {
        const paragraph = [line];
        while (index + 1 < lines.length && lines[index + 1].trim() && !/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||\$\$|<!--|\[(?:VISUAL_|SOURCE_))/.test(lines[index + 1].trim())) paragraph.push(lines[++index]);
        const text = paragraph.map((value) => value.trim()).join(" ").replace(/\s+/g, " ").trim();
        if (text) await pushBlock(paragraphXml(inlineXml(text), { spacing: 120 }));
      }
    }
    if (inMath && math.length) await pushBlock(paragraphXml(inlineXml(math.join(" ")), { align: "center" }));
    documentEntry.push(strToU8(documentFooter));
    documentEntry.finalize();
    for (const directory of ["word/", "word/_rels/", "word/media/", "docProps/"]) {
      zip.addStored(directory, new Uint8Array(), true);
    }
    for (const media of state.media) {
      zip.addStored(`word/${media.target}`, media.data);
    }
    const fixed = [
      ["[Content_Types].xml", contentTypes(new Set(state.media.map((item) => item.extension)))],
      ["_rels/.rels", rootRelationships()],
      ["word/_rels/document.xml.rels", documentRelationships(state.media)],
      ["word/styles.xml", stylesXml],
      ["word/numbering.xml", numberingXml],
      ["word/settings.xml", settingsXml],
      ["word/footnotes.xml", footnotesXml],
      ["word/_rels/footnotes.xml.rels", emptyRelationships],
      ["word/endnotes.xml", endnotesXml],
      ["word/_rels/endnotes.xml.rels", emptyRelationships],
      ["word/comments.xml", commentsXml],
      ["word/_rels/comments.xml.rels", emptyRelationships],
      ["word/fontTable.xml", fontTableXml],
      ["word/_rels/fontTable.xml.rels", emptyRelationships],
      ["docProps/core.xml", coreProperties(title)],
      ["docProps/custom.xml", customPropertiesXml],
      ["docProps/app.xml", appProperties()],
    ];
    for (const [name, xml] of fixed) {
      zip.addStored(name, strToU8(xml));
    }
    await options.onProgress?.({ section: Math.ceil(state.section / 128), blocks: state.section % 128 || 128, streaming: true, complete: true });
    return zip.finish();
  } catch (error) {
    throw error;
  }
}
