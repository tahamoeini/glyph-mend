export const EQUATION_IR_FIXTURES = Object.freeze([
  {
    name: "inline-equation",
    mode: "inline",
    latex: "x_i^2 + y^2 = r^2",
  },
  {
    name: "display-fraction-and-scripts",
    mode: "display",
    latex: "\\frac{a_1}{\\sqrt{b}} = c^2",
  },
  {
    name: "greek-heavy-formula",
    mode: "display",
    latex: "\\alpha + \\beta \\leq \\gamma + \\Delta",
  },
  {
    name: "matrix",
    mode: "display",
    latex: "\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}",
  },
  {
    name: "scientific-prose-context",
    mode: "inline",
    latex: "E = mc^2",
    surroundingText: "The experiment reports E = mc^2 in the methods section.",
  },
  {
    name: "equation-image-source",
    mode: "display",
    latex: "",
    sourceOnly: true,
  },
]);
