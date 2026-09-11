import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "..");
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

const pythonPolicy = Object.freeze({
  pymupdf: {
    review: "BLOCKED_STRATEGY_REVIEW",
    license: "AGPL-3.0 / Artifex commercial dual-license",
    purpose: "Python PDF rendering/extraction",
  },
  pymupdf4llm: {
    review: "BLOCKED_STRATEGY_REVIEW",
    license: "AGPL-3.0 / Artifex commercial dual-license",
    purpose: "Python structured PDF-to-Markdown extraction",
  },
  "python-docx": {
    review: "APPROVED",
    license: "MIT",
    purpose: "Python DOCX generation",
  },
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizePythonName(spec) {
  const match = spec.trim().match(/^([A-Za-z0-9_.-]+)/);
  return match ? match[1].toLowerCase().replaceAll("_", "-") : null;
}

function readPythonRuntimeDependencies(pyprojectText) {
  const projectStart = pyprojectText.indexOf("[project]");
  if (projectStart < 0) throw new Error("pyproject.toml has no [project] section");
  const afterProject = pyprojectText.slice(projectStart);
  const match = afterProject.match(/\ndependencies\s*=\s*\[([\s\S]*?)\n\]/);
  if (!match) throw new Error("pyproject.toml has no project dependencies array");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function row(columns) {
  return `| ${columns.map((value) => String(value).replaceAll("|", "\\|")).join(" | ")} |`;
}

const packageJson = readJson(path.join(webRoot, "package.json"));
const lock = readJson(path.join(webRoot, "package-lock.json"));
const pyprojectText = fs.readFileSync(path.join(repoRoot, "pyproject.toml"), "utf8");

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

const pythonSpecs = readPythonRuntimeDependencies(pyprojectText);
const pythonRows = [];
for (const spec of pythonSpecs) {
  const name = normalizePythonName(spec);
  const policy = pythonPolicy[name];
  if (!policy) {
    failures.push(`Unreviewed Python runtime dependency: ${spec}`);
    pythonRows.push([name || spec, spec, "UNKNOWN", "UNREVIEWED"]);
    continue;
  }
  pythonRows.push([name, spec, policy.license, policy.review]);
}

for (const name of Object.keys(pythonPolicy)) {
  if (!pythonSpecs.some((spec) => normalizePythonName(spec) === name)) {
    failures.push(`Stale Python license policy entry not present in pyproject.toml: ${name}`);
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

console.log("\n## Python runtime dependencies\n");
console.log(row(["Package", "Declared spec", "Reviewed license", "Review"]));
console.log(row(["---", "---", "---", "---"]));
for (const item of pythonRows) console.log(row(item));

if (failures.length) {
  console.error("\nLicense gate failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  if (checkMode) process.exitCode = 1;
} else {
  console.log("\nLicense gate: PASS — every current direct production dependency has an explicit reviewed policy entry and browser lockfile licenses match the reviewed expressions.");
  console.log("Known copyleft strategy blockers remain BLOCKED_STRATEGY_REVIEW; this command does not convert them into approvals.");
}
