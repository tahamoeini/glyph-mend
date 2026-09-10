import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoDir = resolve(appDir, "..");
const publicDir = resolve(appDir, "public");
const sourceConfig = resolve(repoDir, "branding.json");

const brand = JSON.parse(await readFile(sourceConfig, "utf8"));
for (const key of ["name", "shortName", "slug", "cliName", "slogan", "logoPath"]) {
  if (typeof brand[key] !== "string" || !brand[key].trim()) {
    throw new Error(`branding.json requires a non-empty ${key}`);
  }
}

const relativeLogo = brand.logoPath.replace(/^\.\//, "");
const sourceLogo = resolve(repoDir, relativeLogo);
const logoFromRepo = relative(repoDir, sourceLogo);
if (
  !logoFromRepo ||
  logoFromRepo === ".." ||
  logoFromRepo.startsWith(`..${sep}`) ||
  isAbsolute(logoFromRepo)
) {
  throw new Error("branding.json logoPath must resolve to a file inside the repository for brand:sync");
}
const publicLogo = resolve(publicDir, logoFromRepo);
await mkdir(dirname(publicLogo), { recursive: true });
await copyFile(sourceLogo, publicLogo);
await copyFile(sourceLogo, resolve(publicDir, "icon.svg"));
await writeFile(resolve(publicDir, "branding.json"), `${JSON.stringify(brand, null, 2)}\n`, "utf8");

const manifest = {
  name: `${brand.name} Browser Edition`,
  short_name: brand.shortName,
  description: brand.slogan,
  start_url: "./",
  display: "standalone",
  background_color: "#f2f4ef",
  theme_color: "#17211d",
  icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
};
await writeFile(
  resolve(publicDir, "manifest.webmanifest"),
  `${JSON.stringify(manifest)}\n`,
  "utf8",
);

console.log(`Synced browser branding: ${brand.name}`);
