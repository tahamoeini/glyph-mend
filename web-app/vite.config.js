import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { viteStaticCopy } from "vite-plugin-static-copy";

const OCR_LANGUAGES = ["eng", "rus", "fas", "chi_sim"];
const sharedNodeModules = fileURLToPath(new URL("../node_modules/", import.meta.url)).replaceAll("\\", "/");
const dependencyAsset = (...segments) => `${sharedNodeModules}/${segments.join("/")}`;

export default defineConfig(({ mode }) => {
  const desktopBuild = mode === "desktop";
  const aliases = [
    {
      find: /^mupdf$/,
      replacement: fileURLToPath(
        new URL("./src/mupdf-vite.js", import.meta.url),
      ),
    },
  ];

  if (desktopBuild) {
    aliases.push({
      find: "@glyphmend/tauri-adapter",
      replacement: fileURLToPath(
        new URL("../companion/apps/companion-tauri/web/src/tauri-adapter.js", import.meta.url),
      ),
    });
    aliases.push({
      find: /^\.\/features\/companion\/bridge\.js$/,
      replacement: fileURLToPath(
        new URL("./src/features/companion/desktop-bridge.js", import.meta.url),
      ),
    });
  }

  const plugins = [
    viteStaticCopy({
      targets: [
        { src: dependencyAsset("pdfjs-dist", "wasm", "*"), dest: "wasm" },
        { src: dependencyAsset("mupdf", "dist", "mupdf.js"), dest: "mupdf" },
        { src: dependencyAsset("mupdf", "dist", "mupdf-wasm.js"), dest: "mupdf" },
        { src: dependencyAsset("mupdf", "dist", "mupdf-wasm.wasm"), dest: "mupdf" },
        {
          src: dependencyAsset("tesseract.js-core", "*.{wasm,wasm.js}"),
          dest: "tesseract-core",
        },
        {
          src: dependencyAsset("tesseract.js", "dist", "worker.min.js"),
          dest: "tesseract",
        },
        ...OCR_LANGUAGES.map((language) => ({
          // Serve local models uncompressed so the same file works in dev and offline builds.
          src: dependencyAsset("@tesseract.js-data", language, "4.0.0_best_int", `${language}.traineddata.gz`),
          dest: "tessdata",
          rename: `${language}.traineddata`,
          transform: {
            encoding: "buffer",
            handler: (content) => gunzipSync(content),
          },
        })),
      ],
    }),
    {
      name: "glyphmend-build-entry",
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          const entry = desktopBuild ? "desktop-entry.js" : "browser-entry.js";
          const placeholder = '<script type="module" src="/src/entry.js"></script>';
          if (!html.includes(placeholder)) {
            throw new Error("GlyphMend entry point placeholder is missing from index.html.");
          }
          let transformed = html.replace(
            placeholder,
            '<script type="module" src="/src/' + entry + '"></script>',
          );
          if (!desktopBuild) {
            const cspAttribute = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]+)(")/i;
            if (!cspAttribute.test(transformed)) {
              throw new Error("GlyphMend Content-Security-Policy meta tag is missing.");
            }
            const scriptPolicy = "script-src 'self' 'wasm-unsafe-eval'";
            const connectPolicy = "connect-src 'self' http://127.0.0.1:*";
            const scriptHosts =
              "https://us-assets.i.posthog.com https://eu-assets.i.posthog.com";
            const connectHosts =
              "https://us.i.posthog.com https://eu.i.posthog.com";
            transformed = transformed.replace(
              cspAttribute,
              (_match, prefix, policy, suffix) => {
                if (!policy.includes(scriptPolicy) || !policy.includes(connectPolicy)) {
                  throw new Error("GlyphMend Content-Security-Policy directives changed unexpectedly.");
                }
                const updatedPolicy = policy
                  .replace(scriptPolicy, scriptPolicy + " " + scriptHosts)
                  .replace(connectPolicy, connectPolicy + " " + connectHosts);
                return prefix + updatedPolicy + suffix;
              },
            );
          }
          return transformed;
        },
      },
    },
  ];

  if (!desktopBuild) {
    plugins.push(
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: [
          "icon.svg",
          "wasm/*",
          "mupdf/*",
          "tesseract/*",
          "tesseract-core/*",
          "tessdata/*",
        ],
        manifest: false,
        workbox: {
          // Keep brand identity runtime-configurable after build. The loader stores
          // the last successful configuration locally for offline use.
          globIgnores: ["branding.json", "brand/**"],
          maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        },
      }),
    );
  }

  return {
    base: "./",
    worker: { format: "es" },
    // The extraction worker is created only after the user starts extraction.
    // Pre-bundle its npm-only dependency up front so Vite does not discover it
    // lazily and force a full-page reload in the middle of the first extraction.
    optimizeDeps: { include: ["tesseract.js"] },
    resolve: { alias: aliases },
    plugins,
    build: desktopBuild
      ? {
          outDir: fileURLToPath(
            new URL("../companion/apps/companion-tauri/web/dist", import.meta.url),
          ),
          emptyOutDir: true,
        }
      : undefined,
    test: { environment: "jsdom", include: ["src/**/*.test.js"] },
  };
});
