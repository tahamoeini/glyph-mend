#!/usr/bin/env bash
set -Eeuo pipefail

ci_dir="$(mktemp -d /tmp/glyphmend-ci.XXXXXX)"
(
  cd /workspace
  find branding.json brand web-app/src/shared/brand.js web-app/src/styles/style.css -type f -print0 | sort -z | xargs -0 sha256sum
) > "$ci_dir/branding-before.sha256"
tar -C /workspace --exclude=.git --exclude=.venv --exclude=node_modules --exclude=target --exclude=dist --exclude=.pytest_cache --exclude=.ruff_cache --exclude=__pycache__ --exclude=.mypy_cache -cf - . | tar -C "$ci_dir" -xf -
cd "$ci_dir"

echo "== Web platform verification =="
cd web-app
npm ci
if node -e 'const p=require("./package.json"); const d={...p.dependencies,...p.devDependencies,...p.optionalDependencies}; process.exit(Object.keys(d).some((n)=>n === "playwright" || n.startsWith("@playwright/")) ? 0 : 1)'; then
  echo "Playwright is intentionally forbidden in GlyphMend CI."
  exit 1
fi
npm run license:check
npm audit --omit=dev --audit-level=high
npm run lint
npm run typecheck
npm test
npm run build
cd ..
sha256sum -c "$ci_dir/branding-before.sha256"

echo "== Companion runtime verification =="
cd companion
cargo fmt --all -- --check
cargo clippy --workspace --exclude companion-tauri -- -D warnings
cargo test --workspace --exclude companion-tauri
cargo build -p companion-cli
cargo fetch --locked
ln -s "$CARGO_TARGET_DIR" target
node tests/browser-runtime-e2e.mjs
# cargo-deny 0.20.2 stores its default RustSec database under this stable name.
advisory_db="$CARGO_HOME/advisory-dbs/advisory-db-3157b0e258782691"
if [[ -d "$advisory_db/.git" ]]; then
  git -C "$advisory_db" -c http.version=HTTP/1.1 fetch --depth 1 origin HEAD
  git -C "$advisory_db" reset --hard FETCH_HEAD
else
  git -c http.version=HTTP/1.1 clone --depth 1 https://github.com/rustsec/advisory-db "$advisory_db"
fi
cargo deny --offline check

echo "Web and Companion Linux checks passed."
