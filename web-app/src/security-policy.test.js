import fs from "node:fs";
import { expect, it } from "vitest";

const indexHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");

function cspDirectives() {
  const match = indexHtml.match(/http-equiv=["']Content-Security-Policy["'][^>]*content=["']([^"']*(?:'[^']*'[^"']*)*)["']/i);
  if (!match) throw new Error("Content-Security-Policy meta tag is missing.");
  return Object.fromEntries(
    match[1]
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values];
      }),
  );
}

it("keeps a restrictive browser CSP around reconstructed content", () => {
  const directives = cspDirectives();
  expect(directives["default-src"]).toEqual(["'self'"]);
  expect(directives["object-src"]).toEqual(["'none'"]);
  expect(directives["frame-src"]).toEqual(["'none'"]);
  expect(directives["form-action"]).toEqual(["'none'"]);
  expect(directives["connect-src"]).toEqual(["'self'"]);
  expect(directives["script-src"]).toContain("'self'");
  expect(directives["script-src"]).not.toContain("'unsafe-eval'");
  expect(directives["script-src"]).not.toContain("*");
  expect(directives["connect-src"]).not.toContain("*");
  expect(directives["img-src"]).toContain("https://api.producthunt.com");
  expect(directives["script-src"]).not.toContain("https://api.producthunt.com");
  expect(directives["connect-src"]).not.toContain("https://api.producthunt.com");
});

it("keeps PDF.js JavaScript evaluation disabled", () => {
  expect(appSource).toMatch(/isEvalSupported\s*:\s*false/);
});
