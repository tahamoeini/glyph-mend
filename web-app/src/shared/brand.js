export const DEFAULT_BRAND = Object.freeze({
  name: "GlyphMend",
  shortName: "GlyphMend",
  slug: "glyph-mend",
  cliName: "glyphmend",
  slogan: "Faithful document reconstruction from PDF to structured Markdown.",
  description:
    "Local-first, structure-aware PDF reconstruction with OCR, resumable extraction, quality checks, and Markdown-first export.",
  logoPath: "./brand/glyphmend-mark.svg",
  logoAlt: "GlyphMend logo",
});

const BRAND_CACHE_KEY = "glyphmend-runtime-brand-v1";

function clean(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeBrand(candidate = {}) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(DEFAULT_BRAND).map(([key, fallback]) => [
        key,
        clean(candidate?.[key], fallback),
      ]),
    ),
  );
}

function cachedBrand() {
  try {
    const raw = localStorage.getItem(BRAND_CACHE_KEY);
    return raw ? normalizeBrand(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function cacheBrand(brand) {
  try {
    localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(brand));
  } catch {}
}

export async function loadBrand({ url = "./branding.json", fetchImpl = globalThis.fetch } = {}) {
  const cached = cachedBrand();
  if (typeof fetchImpl !== "function") return cached || DEFAULT_BRAND;

  try {
    const response = await fetchImpl(new URL(url, document.baseURI), { cache: "no-store" });
    if (!response.ok) throw new Error(`Brand config request failed with ${response.status}`);
    const brand = normalizeBrand(await response.json());
    cacheBrand(brand);
    return brand;
  } catch {
    return cached || DEFAULT_BRAND;
  }
}

export function applyBrand(brand, root = document) {
  const resolved = normalizeBrand(brand);
  const doc = root.nodeType === 9 ? root : root.ownerDocument;

  root.querySelectorAll("[data-brand-name]").forEach((node) => {
    node.textContent = resolved.name;
  });
  root.querySelectorAll("[data-brand-slogan]").forEach((node) => {
    node.textContent = resolved.slogan;
  });
  root.querySelectorAll("[data-brand-logo]").forEach((node) => {
    node.setAttribute("src", new URL(resolved.logoPath, doc.baseURI).toString());
    node.setAttribute("alt", resolved.logoAlt);
  });
  root.querySelectorAll("[data-brand-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", resolved.name);
  });

  doc.title = `${resolved.name} — Browser Edition`;
  doc.querySelector('meta[name="description"]')?.setAttribute("content", resolved.slogan);
  doc.documentElement.dataset.brand = resolved.slug;
  globalThis.__GLYPHMEND_BRAND__ = resolved;
  return resolved;
}

export async function initBrand(options) {
  return applyBrand(await loadBrand(options));
}
