function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function accessibleMathBlock(expression) {
  const text = String(expression || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const safe = escapeHtml(text);
  return `<div class="math-accessible" role="math" aria-label="Equation: ${safe}"><math display="block" aria-label="Equation: ${safe}"><mtext>${safe}</mtext></math><span class="visually-hidden">Equation: ${safe}</span></div>`;
}

export function renderAccessibleMathMarkdown(markdown) {
  return String(markdown || "").replace(
    /^\s*\$\$\s*\n?([\s\S]*?)\n?\s*\$\$\s*$/gm,
    (_match, expression) => accessibleMathBlock(expression),
  );
}
