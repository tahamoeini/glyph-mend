import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyBrand, DEFAULT_BRAND, loadBrand, normalizeBrand } from "./brand.js";

beforeEach(() => {
  document.head.innerHTML = '<meta name="description" content="old">';
  document.body.innerHTML = `
    <div data-brand-aria-label>
      <span data-brand-name></span>
      <span data-brand-slogan></span>
      <img data-brand-logo>
    </div>`;
  localStorage.clear();
});

describe("runtime branding", () => {
  it("keeps canonical GlyphMend defaults", () => {
    expect(DEFAULT_BRAND.name).toBe("GlyphMend");
    expect(DEFAULT_BRAND.slogan).toBe(
      "Faithful document reconstruction from PDF to structured Markdown.",
    );
  });

  it("normalizes blank values back to safe defaults", () => {
    const brand = normalizeBrand({ name: "  ", slogan: "Custom slogan" });
    expect(brand.name).toBe("GlyphMend");
    expect(brand.slogan).toBe("Custom slogan");
  });

  it("applies configured name, slogan, title, and logo without HTML injection", () => {
    const brand = applyBrand({
      name: "Acme <b>Docs</b>",
      slogan: "A configured reconstruction service",
      slug: "acme-docs",
      logoPath: "./custom.svg",
      logoAlt: "Acme logo",
    });

    expect(document.querySelector("[data-brand-name]").textContent).toBe("Acme <b>Docs</b>");
    expect(document.querySelector("[data-brand-slogan]").textContent).toBe(
      "A configured reconstruction service",
    );
    expect(document.querySelector("[data-brand-name] b")).toBeNull();
    expect(document.title).toBe("Acme <b>Docs</b> — Browser Edition");
    expect(document.documentElement.dataset.brand).toBe("acme-docs");
    expect(document.querySelector("[data-brand-logo]").src).toContain("custom.svg");
    expect(brand.name).toBe("Acme <b>Docs</b>");
  });

  it("loads runtime JSON and falls back cleanly when it is unavailable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: "Configured Name", slogan: "Configured slogan" }),
    });
    expect((await loadBrand({ fetchImpl })).name).toBe("Configured Name");

    fetchImpl.mockRejectedValueOnce(new Error("offline"));
    expect((await loadBrand({ fetchImpl })).name).toBe("Configured Name");
  });
});
