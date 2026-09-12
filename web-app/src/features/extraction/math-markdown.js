const LATEX_SYMBOLS = new Map([
  ["≤", "\\leq"], ["≥", "\\geq"], ["≠", "\\neq"], ["≈", "\\approx"],
  ["∞", "\\infty"], ["∑", "\\sum"], ["∏", "\\prod"], ["∫", "\\int"],
  ["√", "\\sqrt"], ["×", "\\times"], ["÷", "\\div"], ["μ", "\\mu"],
  ["σ", "\\sigma"], ["λ", "\\lambda"], ["α", "\\alpha"], ["β", "\\beta"],
  ["γ", "\\gamma"], ["δ", "\\delta"], ["θ", "\\theta"], ["π", "\\pi"],
  ["ρ", "\\rho"], ["τ", "\\tau"], ["φ", "\\phi"],
]);
const MATH_SYMBOLS = /[=<>≤≥≠≈+−×÷∑∏∫√∞]/g;
const ESCAPED_PUNCTUATION = /\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g;
const INLINE_TEX_PAREN = /\\\(([^\n]{1,240}?)\\\)/g;
const INLINE_DOLLAR = /(?<!\$)\$([^$\n]{1,240})\$(?!\$)/g;
const MATH_ATOM = String.raw`(?:\\[A-Za-z]+|[A-Za-zα-ωΑ-Ω][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()[\]{}])`;
const MATH_TERM = `${MATH_ATOM}(?:\s*[\\[(]\s*${MATH_ATOM}(?:\s*[,;]\s*${MATH_ATOM})*\s*[\\])])?`;
const INLINE_EQUATION = new RegExp(
  String.raw`(?<![\w$(])${MATH_TERM}\s*(?:=|≤|≥|≠|≈|≡|<|>)\s*${MATH_TERM}(?:\s*(?:[+\-−×÷*/^]|=|≤|≥|≠|≈|≡|<|>)\s*${MATH_TERM}){0,12}`,
  "gu",
);
const INLINE_PAREN_EXPRESSION =
  /(?<![\w$])(?:[A-Za-z][A-Za-z0-9_]*)?\([^()\n]{1,70}[=<>≤≥≠≈+*/^][^()\n]{0,70}\)/gu;

function normalize(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

export function latexMarkdown(value) {
  let text = normalize(value).replace(ESCAPED_PUNCTUATION, "$1");
  for (const [symbol, latex] of LATEX_SYMBOLS) text = text.split(symbol).join(latex);
  return text.replace(/½/g, "\\frac{1}{2}");
}

export function escapeMd(value) {
  let text = String(value ?? "").replace(ESCAPED_PUNCTUATION, "$1");
  text = text.replace(/`/g, "\\`");
  text = text.replace(/^(\s*)(#{1,6}|>|[-+*])(?=\s)/, "$1\\$2");
  return text.replace(/^(\s*\d+)\.(?=\s)/, "$1\\.");
}

function plausible(value) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.length > 120 || /https?:\/\//i.test(candidate)) return false;
  if (/^(?:amount|total|posted|adjustments|the|this|that)\b/i.test(candidate)) return false;
  const words = candidate.match(/[A-Za-zÀ-ÖØ-öø-ÿ]{3,}/g) || [];
  const proseWords = candidate.match(
    /\b(?:the|and|that|this|with|from|where|which|then|than|for|are|was|were|have|has|into|when|amount|total|posted|plus|adjustments)\b/gi,
  ) || [];
  const score =
    (candidate.match(MATH_SYMBOLS) || []).length * 2 +
    (candidate.match(/[A-Za-z]\s*[_^]\s*[A-Za-z0-9({\[]/g) || []).length * 2 +
    (candidate.match(/\b(?:sin|cos|tan|log|ln|exp|max|min|arg|maximize|minimize)\b/gi) || [])
      .length;
  const compactExpression = /^[\wα-ωΑ-Ω\s()[\]{}=<>≤≥≠≈+\-−×÷*/^]+$/u.test(candidate);
  return (score >= 4 || (compactExpression && score >= 2)) && !(words.length > 8 && proseWords.length >= 2);
}

export function inlineMathMarkdown(value) {
  let text = String(value ?? "");
  const protectedMath = [];
  const protect = (_match, body) => {
    const token = `\u0000GLYPHMEND_MATH_${protectedMath.length}\u0000`;
    protectedMath.push(`$${latexMarkdown(body)}$`);
    return token;
  };
  text = text.replace(INLINE_TEX_PAREN, protect).replace(INLINE_DOLLAR, protect);
  const replace = (match) => {
    const candidate = match.trim();
    return plausible(candidate) ? `$${latexMarkdown(candidate)}$` : match;
  };
  text = text.replace(INLINE_EQUATION, replace).replace(INLINE_PAREN_EXPRESSION, replace);
  protectedMath.forEach((math, index) => {
    text = text.replace(`\u0000GLYPHMEND_MATH_${index}\u0000`, math);
  });
  return text;
}
