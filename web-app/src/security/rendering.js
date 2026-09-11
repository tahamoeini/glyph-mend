import DOMPurify from "dompurify";
import { SECURITY_LIMITS, SecurityValidationError } from "./validation.js";

const MARKDOWN_TAGS = [
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "code",
  "em",
  "strong",
  "del",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "figure",
  "figcaption",
  "span",
  "div",
  "a",
];
const MARKDOWN_ATTRIBUTES = ["class", "data-asset", "colspan", "rowspan"];
const FORBIDDEN_MARKDOWN_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "img",
  "svg",
  "math",
  "video",
  "audio",
  "source",
  "track",
  "canvas",
  "link",
  "meta",
  "base",
];
const FORBIDDEN_MARKDOWN_ATTRIBUTES = [
  "href",
  "src",
  "srcset",
  "xlink:href",
  "style",
  "target",
  "action",
  "formaction",
];

export const MARKDOWN_PURIFY_CONFIG = Object.freeze({
  ALLOWED_TAGS: MARKDOWN_TAGS,
  ALLOWED_ATTR: MARKDOWN_ATTRIBUTES,
  FORBID_TAGS: FORBIDDEN_MARKDOWN_TAGS,
  FORBID_ATTR: FORBIDDEN_MARKDOWN_ATTRIBUTES,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  KEEP_CONTENT: true,
  RETURN_TRUSTED_TYPE: false,
});

const SAFE_SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "title",
  "desc",
]);
const SAFE_SVG_ATTRIBUTES = [
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-opacity",
  "opacity",
  "transform",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "role",
  "aria-label",
];
const SVG_LIMIT = Math.min(2 * 1024 * 1024, SECURITY_LIMITS.markdownChars);
const ACTIVE_SVG_TAG = /<(?:script|foreignObject|iframe|object|embed|image|use|a|style|link|meta)\b/i;
const ACTIVE_SVG_ATTRIBUTE = /\s(?:on[a-z0-9_-]+|href|xlink:href|src)\s*=/i;
const ACTIVE_SVG_PROTOCOL = /(?:javascript|vbscript|data)\s*:/i;
const EXTERNAL_SVG_REFERENCE = /url\s*\(/i;

function rejectSvg(message) {
  throw new SecurityValidationError(`Unsafe reconstructed SVG: ${message}`);
}

function validateSvgSource(source) {
  if (typeof source !== "string" || !source.trim()) rejectSvg("empty or non-text input.");
  if (source.length > SVG_LIMIT) rejectSvg("input exceeds the SVG size ceiling.");
  if (ACTIVE_SVG_TAG.test(source)) rejectSvg("active or reference-capable elements are not allowed.");
  if (ACTIVE_SVG_ATTRIBUTE.test(source)) rejectSvg("event handlers and URL attributes are not allowed.");
  if (ACTIVE_SVG_PROTOCOL.test(source)) rejectSvg("active URI schemes are not allowed.");
  if (EXTERNAL_SVG_REFERENCE.test(source)) rejectSvg("CSS/SVG URL references are not allowed.");
  for (const match of source.matchAll(/<\/?\s*([A-Za-z][\w:-]*)\b/g)) {
    if (!SAFE_SVG_TAGS.has(match[1])) rejectSvg(`element <${match[1]}> is outside the safe subset.`);
  }
}

export function configureUntrustedRendering() {
  DOMPurify.setConfig(MARKDOWN_PURIFY_CONFIG);
}

export function sanitizeReconstructedSvg(source) {
  validateSvgSource(source);
  DOMPurify.clearConfig?.();
  try {
    const sanitized = DOMPurify.sanitize(source, {
      USE_PROFILES: { svg: true, svgFilters: false, html: false, mathMl: false },
      ALLOWED_TAGS: [...SAFE_SVG_TAGS],
      ALLOWED_ATTR: SAFE_SVG_ATTRIBUTES,
      FORBID_TAGS: [
        "script",
        "foreignObject",
        "iframe",
        "object",
        "embed",
        "image",
        "use",
        "a",
        "style",
        "link",
        "meta",
      ],
      FORBID_ATTR: ["href", "xlink:href", "src", "style"],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: true,
      RETURN_TRUSTED_TYPE: false,
    });
    if (!/<svg\b/i.test(sanitized)) rejectSvg("sanitization removed the SVG root.");
    validateSvgSource(sanitized);
    return sanitized;
  } finally {
    DOMPurify.setConfig(MARKDOWN_PURIFY_CONFIG);
  }
}
