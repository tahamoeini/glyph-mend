import { SecurityValidationError } from "./validation.js";

export function assertSafeLeafFileName(
  value,
  { fallback = "document.pdf", maxChars = 1024 } = {},
) {
  const name = String(value || fallback);
  if (!name || name.length > maxChars)
    throw new SecurityValidationError("File name exceeds the allowed size.");
  if (
    name === "." ||
    name === ".." ||
    /[\\/:\u0000-\u001f\u007f]/.test(name)
  )
    throw new SecurityValidationError(
      "File name must be a leaf name and may not contain path separators, drive prefixes, or control characters.",
    );
  return name;
}
