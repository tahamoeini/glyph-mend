import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeModulesDir = path.join(rootDir, "node_modules");
const require = createRequire(import.meta.url);

const rollupVersion = readPackageVersion("rollup/package.json");
const esbuildVersion = readPackageVersion("esbuild/package.json");
const rollupPackage = resolveRollupPackage();
const esbuildPackage = resolveEsbuildPackage();

if (!existsSync(nodeModulesDir) || !rollupPackage || !esbuildPackage || !rollupVersion || !esbuildVersion) {
  process.exit(0);
}

const platformPackages = [
  `${rollupPackage}@${rollupVersion}`,
  `${esbuildPackage}@${esbuildVersion}`,
];

const missingPackages = platformPackages.filter((packageSpec) => {
  const { packageName, version } = splitPackageSpec(packageSpec);
  return !hasExpectedPackageVersion(packageName, version);
});

if (missingPackages.length === 0) {
  process.exit(0);
}

// Do not invoke `npm install` from a lifecycle script. npm can reify (and
// prune) the active node_modules tree while this script is running, leaving
// tools such as Vite only partially installed. A normal top-level install is
// the safe, deterministic place to resolve optional platform packages.
console.error(
  `[native-deps] Missing native packages for ${process.platform}/${process.arch}: ` +
    `${missingPackages.join(", ")}. Run \`npm install\` from web-app after removing its node_modules directory.`,
);
process.exit(1);

function resolveRollupPackage() {
  if (process.platform === "win32") {
    return {
      x64: "@rollup/rollup-win32-x64-msvc",
      arm64: "@rollup/rollup-win32-arm64-msvc",
      ia32: "@rollup/rollup-win32-ia32-msvc",
    }[process.arch] ?? null;
  }

  if (process.platform === "darwin") {
    return {
      x64: "@rollup/rollup-darwin-x64",
      arm64: "@rollup/rollup-darwin-arm64",
    }[process.arch] ?? null;
  }

  if (process.platform === "linux") {
    const variant = isMusl() ? "musl" : "gnu";
    const packages = {
      x64: {
        gnu: "@rollup/rollup-linux-x64-gnu",
        musl: "@rollup/rollup-linux-x64-musl",
      },
      arm64: {
        gnu: "@rollup/rollup-linux-arm64-gnu",
        musl: "@rollup/rollup-linux-arm64-musl",
      },
      arm: {
        gnu: "@rollup/rollup-linux-arm-gnueabihf",
        musl: "@rollup/rollup-linux-arm-musleabihf",
      },
      loong64: {
        gnu: "@rollup/rollup-linux-loong64-gnu",
        musl: "@rollup/rollup-linux-loong64-musl",
      },
      ppc64: {
        gnu: "@rollup/rollup-linux-ppc64-gnu",
        musl: "@rollup/rollup-linux-ppc64-musl",
      },
      riscv64: {
        gnu: "@rollup/rollup-linux-riscv64-gnu",
        musl: "@rollup/rollup-linux-riscv64-musl",
      },
      s390x: {
        gnu: "@rollup/rollup-linux-s390x-gnu",
      },
    };

    const packageNames = packages[process.arch];
    if (!packageNames) {
      return null;
    }

    return packageNames[variant] ?? packageNames.gnu ?? null;
  }

  return null;
}

function resolveEsbuildPackage() {
  const packages = {
    win32: {
      x64: "@esbuild/win32-x64",
      arm64: "@esbuild/win32-arm64",
      ia32: "@esbuild/win32-ia32",
    },
    darwin: {
      x64: "@esbuild/darwin-x64",
      arm64: "@esbuild/darwin-arm64",
    },
    linux: {
      x64: "@esbuild/linux-x64",
      arm64: "@esbuild/linux-arm64",
      arm: "@esbuild/linux-arm",
      ia32: "@esbuild/linux-ia32",
      loong64: "@esbuild/linux-loong64",
      mips64el: "@esbuild/linux-mips64el",
      ppc64: "@esbuild/linux-ppc64",
      riscv64: "@esbuild/linux-riscv64",
      s390x: "@esbuild/linux-s390x",
    },
    freebsd: {
      x64: "@esbuild/freebsd-x64",
      arm64: "@esbuild/freebsd-arm64",
    },
    netbsd: {
      x64: "@esbuild/netbsd-x64",
      arm64: "@esbuild/netbsd-arm64",
    },
    openbsd: {
      x64: "@esbuild/openbsd-x64",
      arm64: "@esbuild/openbsd-arm64",
    },
    sunos: {
      x64: "@esbuild/sunos-x64",
    },
  };

  return packages[process.platform]?.[process.arch] ?? null;
}

function isMusl() {
  if (process.platform !== "linux") {
    return false;
  }

  try {
    const header = process.report?.getReport?.().header;
    return !header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

function readPackageVersion(packageJsonPath) {
  try {
    return require(packageJsonPath).version ?? null;
  } catch {
    return null;
  }
}

function hasExpectedPackageVersion(packageName, version) {
  const packageDir = path.join(nodeModulesDir, ...packageName.split("/"));
  if (!existsSync(packageDir)) {
    return false;
  }

  try {
    return require(path.join(packageDir, "package.json")).version === version;
  } catch {
    return false;
  }
}

function splitPackageSpec(packageSpec) {
  const atIndex = packageSpec.lastIndexOf("@");
  if (atIndex <= 0) {
    return { packageName: packageSpec, version: null };
  }

  return {
    packageName: packageSpec.slice(0, atIndex),
    version: packageSpec.slice(atIndex + 1),
  };
}
