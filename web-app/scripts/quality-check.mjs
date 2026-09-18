import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const selfPath = fileURLToPath(import.meta.url);
const sourceRoots = [join(root, "src"), join(root, "scripts")];

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function javascriptFiles() {
  return sourceRoots.flatMap(filesUnder).sort();
}

function syntaxCheck() {
  for (const file of javascriptFiles()) {
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } catch (error) {
      const output = Buffer.concat([error.stdout || Buffer.alloc(0), error.stderr || Buffer.alloc(0)]).toString();
      throw new Error(`JavaScript syntax check failed for ${relative(root, file)}\n${output}`);
    }
  }
}

function lintContract() {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) throw new Error(`Duplicate HTML ids: ${[...new Set(duplicates)].join(", ")}`);

  const forbidden = javascriptFiles().filter((file) => file !== selfPath && /playwright|puppeteer/i.test(readFileSync(file, "utf8")));
  if (forbidden.length) {
    throw new Error(`Heavy browser E2E dependency detected in: ${forbidden.map((file) => relative(root, file)).join(", ")}`);
  }
}

const mode = process.argv[2] || "typecheck";
if (mode === "lint") {
  syntaxCheck();
  lintContract();
  console.log("GlyphMend lint contract passed (syntax, duplicate IDs, and heavy-E2E policy).");
} else if (mode === "typecheck") {
  syntaxCheck();
  console.log("GlyphMend JavaScript typecheck gate passed (syntax and module parse contract; no TypeScript sources).");
} else {
  throw new Error(`Unknown quality-check mode: ${mode}`);
}
