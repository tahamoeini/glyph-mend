import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const checkMode = process.argv.includes("--check");

const browserPolicy = Object.freeze({
  "@tesseract.js-data/eng": {
    expectedLicenses: ["MIT"],
    review: "APPROVED_WITH_NOTE",
    purpose: "Bundled English OCR traineddata",
  },
  docx: {
    expectedLicenses: ["MIT"],
    review: "APPROVED",
    purpose: "Browser DOCX generation",
  },
  dompurify: {
    expectedLicenses: ["(MPL-2.0 OR Apache-2.0)"],
    review: "APPROVED",
    purpose: "Untrusted preview/markup sanitization",
  },
  fflate: {
    expectedLicenses: ["MIT"],
    review: "APPROVED",
    purpose: "Local ZIP creation/inspection",
  },
  idb: {
    expectedLicenses: ["ISC"],
    review: "APPROVED",
    purpose: "Local IndexedDB persistence",
  },
  marked: {
    expectedLicenses: ["MIT"],
    review: "APPROVED",
    purpose: "Markdown parsing",
  },
  mupdf: {
    expectedLicenses: ["AGPL-3.0-or-later"],
    review: "BLOCKED_STRATEGY_REVIEW",
    purpose: "Browser PDF/vector rendering and extraction via WASM",
  },
  "pdfjs-dist": {
    expectedLicenses: ["Apache-2.0"],
    review: "APPROVED",
    purpose: "Browser PDF parsing/rendering",
  },
  "tesseract.js": {
    expectedLicenses: ["Apache-2.0"],
    review: "APPROVED",
    purpose: "Browser-local OCR runtime",
  },
  "@esbuild/win32-x64": {
    expectedLicenses: ["MIT"],
    review: "BUILD_ONLY",
    purpose: "Optional Windows build binary",
  },
  "@rollup/rollup-win32-x64-msvc": {
    expectedLicenses: ["MIT"],
    review: "BUILD_ONLY",
    purpose: "Optional Windows Rollup build binary",
  },
});

const copiedRuntimeAssetPolicy = Object.freeze({
  "tesseract.js-core": {
    expectedLicenses: ["Apache-2.0"],
    review: "APPROVED_WITH_NOTE",
    purpose: "Transitive Tesseract WASM core copied into the offline bundle",
  },
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function row(columns) {
  return `| ${columns.map((value) => String(value).replaceAll("|", "\\|")).join(" | ")} |`;
}

const packageJson = readJson(path.join(webRoot, "package.json"));
const lock = readJson(path.join(webRoot, "package-lock.json"));

const directBrowser = {
  ...(packageJson.dependencies || {}),
  ...(packageJson.optionalDependencies || {}),
};
const failures = [];
const browserRows = [];

for (const [name, requested] of Object.entries(directBrowser).sort(([a], [b]) => a.localeCompare(b))) {
  const policy = browserPolicy[name];
  const locked = lock.packages?.[`node_modules/${name}`];
  if (!policy) {
    failures.push(`Unreviewed direct browser dependency: ${name}`);
    browserRows.push([name, requested, locked?.version || "missing", locked?.license || "UNKNOWN", "UNREVIEWED"]);
    continue;
  }
  if (!locked) {
    failures.push(`Direct browser dependency missing from lockfile: ${name}`);
    browserRows.push([name, requested, "missing", "UNKNOWN", policy.review]);
    continue;
  }
  if (!locked.license) failures.push(`Lockfile license missing for ${name}@${locked.version}`);
  if (!policy.expectedLicenses.includes(locked.license)) {
    failures.push(
      `License drift for ${name}@${locked.version}: expected ${policy.expectedLicenses.join(" or ")}, got ${locked.license || "UNKNOWN"}`,
    );
  }
  browserRows.push([name, requested, locked.version, locked.license || "UNKNOWN", policy.review]);
}

for (const [name, policy] of Object.entries(copiedRuntimeAssetPolicy)) {
  const locked = lock.packages?.[`node_modules/${name}`];
  if (!locked) {
    failures.push(`Copied runtime asset package missing from lockfile: ${name}`);
    continue;
  }
  if (!locked.license) failures.push(`Lockfile license missing for copied runtime asset ${name}@${locked.version}`);
  if (!policy.expectedLicenses.includes(locked.license)) {
    failures.push(
      `License drift for copied runtime asset ${name}@${locked.version}: expected ${policy.expectedLicenses.join(" or ")}, got ${locked.license || "UNKNOWN"}`,
    );
  }
}

console.log("# GlyphMend direct dependency license report\n");
console.log("This report is an engineering gate, not legal advice. It verifies manifest coverage and lockfile license drift.\n");
console.log("## Browser direct/runtime dependencies\n");
console.log(row(["Package", "Requested", "Locked", "Lockfile license", "Review"]));
console.log(row(["---", "---", "---", "---", "---"]));
for (const item of browserRows) console.log(row(item));

console.log("\n## Explicitly copied transitive runtime assets\n");
console.log(row(["Package", "Locked", "Lockfile license", "Review"]));
console.log(row(["---", "---", "---", "---"]));
for (const [name, policy] of Object.entries(copiedRuntimeAssetPolicy)) {
  const locked = lock.packages?.[`node_modules/${name}`];
  console.log(row([name, locked?.version || "missing", locked?.license || "UNKNOWN", policy.review]));
}

console.log("
if (failures.length) {
  console.error("\nLicense gate failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  if (checkMode) process.exitCode = 1;
} else {
  console.log("\nLicense gate: PASS — every current direct production dependency has an explicit reviewed policy entry and browser lockfile licenses match the reviewed expressions.");
  console.log("Known copyleft strategy blockers remain BLOCKED_STRATEGY_REVIEW; this command does not convert them into approvals.");
}
