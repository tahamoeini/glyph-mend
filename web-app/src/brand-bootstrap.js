import { initBrand } from "./shared/brand.js";
import { configureUntrustedRendering } from "./security/rendering.js";

configureUntrustedRendering();
initBrand();
