from __future__ import annotations

import re
from collections.abc import Iterable

from docx.oxml import OxmlElement
from docx.oxml.ns import qn


_XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

_COMMANDS = {
    "alpha": "α",
    "beta": "β",
    "gamma": "γ",
    "delta": "δ",
    "epsilon": "ε",
    "varepsilon": "ϵ",
    "theta": "θ",
    "vartheta": "ϑ",
    "lambda": "λ",
    "mu": "μ",
    "nu": "ν",
    "xi": "ξ",
    "pi": "π",
    "rho": "ρ",
    "sigma": "σ",
    "tau": "τ",
    "phi": "φ",
    "varphi": "ϕ",
    "chi": "χ",
    "psi": "ψ",
    "omega": "ω",
    "Gamma": "Γ",
    "Delta": "Δ",
    "Theta": "Θ",
    "Lambda": "Λ",
    "Xi": "Ξ",
    "Pi": "Π",
    "Sigma": "Σ",
    "Phi": "Φ",
    "Psi": "Ψ",
    "Omega": "Ω",
    "times": "×",
    "cdot": "·",
    "pm": "±",
    "mp": "∓",
    "div": "÷",
    "le": "≤",
    "leq": "≤",
    "ge": "≥",
    "geq": "≥",
    "ne": "≠",
    "neq": "≠",
    "approx": "≈",
    "equiv": "≡",
    "propto": "∝",
    "infty": "∞",
    "sum": "∑",
    "prod": "∏",
    "int": "∫",
    "partial": "∂",
    "nabla": "∇",
    "in": "∈",
    "notin": "∉",
    "subset": "⊂",
    "subseteq": "⊆",
    "supset": "⊃",
    "supseteq": "⊇",
    "cup": "∪",
    "cap": "∩",
    "to": "→",
    "rightarrow": "→",
    "leftarrow": "←",
    "leftrightarrow": "↔",
    "Rightarrow": "⇒",
    "Leftarrow": "⇐",
    "Leftrightarrow": "⇔",
    "ldots": "…",
    "cdots": "⋯",
    "max": "max",
    "min": "min",
    "log": "log",
    "ln": "ln",
    "exp": "exp",
    "sin": "sin",
    "cos": "cos",
    "tan": "tan",
}

_TEXT_COMMANDS = {"text", "mathrm", "mathbf", "mathit", "operatorname"}


def _run(text: str):
    element = OxmlElement("m:r")
    node = OxmlElement("m:t")
    node.text = text
    if text[:1].isspace() or text[-1:].isspace():
        node.set(_XML_SPACE, "preserve")
    element.append(node)
    return element


def _append_children(parent, children: Iterable) -> None:
    for child in children:
        parent.append(child)


def _group(tag: str, children: list):
    element = OxmlElement(tag)
    _append_children(element, children or [_run(" ")])
    return element


def _fraction(numerator: list, denominator: list):
    node = OxmlElement("m:f")
    node.append(_group("m:num", numerator))
    node.append(_group("m:den", denominator))
    return node


def _radical(body: list):
    node = OxmlElement("m:rad")
    props = OxmlElement("m:radPr")
    hide = OxmlElement("m:degHide")
    hide.set(qn("m:val"), "1")
    props.append(hide)
    node.append(props)
    node.append(OxmlElement("m:deg"))
    node.append(_group("m:e", body))
    return node


def _script(base: list, subscript: list | None, superscript: list | None):
    if subscript is not None and superscript is not None:
        node = OxmlElement("m:sSubSup")
        node.append(_group("m:e", base))
        node.append(_group("m:sub", subscript))
        node.append(_group("m:sup", superscript))
        return node
    if subscript is not None:
        node = OxmlElement("m:sSub")
        node.append(_group("m:e", base))
        node.append(_group("m:sub", subscript))
        return node
    node = OxmlElement("m:sSup")
    node.append(_group("m:e", base))
    node.append(_group("m:sup", superscript or []))
    return node


def _strip_markdown_math_markup(value: str) -> str:
    text = re.sub(r"<!--\s*page:\s*\d+\s*-->", "", value, flags=re.IGNORECASE)
    text = re.sub(r"<sup>(.*?)</sup>", r"^{\1}", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<sub>(.*?)</sub>", r"_{\1}", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"</?u>", "", text, flags=re.IGNORECASE)
    text = text.replace("**", "").replace("__", "")
    return re.sub(r"\s+", " ", text).strip()


class _Parser:
    def __init__(self, value: str):
        self.value = value
        self.pos = 0

    def parse(self, stop: str | None = None) -> list:
        output: list = []
        while self.pos < len(self.value):
            if stop is not None and self.value[self.pos] == stop:
                self.pos += 1
                break
            atom = self._atom()
            if not atom:
                continue
            subscript = None
            superscript = None
            while self.pos < len(self.value) and self.value[self.pos] in "^_":
                marker = self.value[self.pos]
                self.pos += 1
                script = self._script_arg()
                if marker == "^":
                    superscript = script
                else:
                    subscript = script
            if subscript is not None or superscript is not None:
                output.append(_script(atom, subscript, superscript))
            else:
                output.extend(atom)
        return output

    def _script_arg(self) -> list:
        if self.pos >= len(self.value):
            return [_run(" ")]
        if self.value[self.pos] == "{":
            self.pos += 1
            return self.parse("}")
        if self.value[self.pos] == "\\":
            return self._command()
        char = self.value[self.pos]
        self.pos += 1
        return [_run(char)]

    def _group_arg(self) -> list:
        while self.pos < len(self.value) and self.value[self.pos].isspace():
            self.pos += 1
        if self.pos < len(self.value) and self.value[self.pos] == "{":
            self.pos += 1
            return self.parse("}")
        return self._script_arg()

    def _command(self) -> list:
        self.pos += 1
        if self.pos >= len(self.value):
            return [_run("\\")]
        start = self.pos
        if self.value[self.pos].isalpha():
            while self.pos < len(self.value) and self.value[self.pos].isalpha():
                self.pos += 1
            command = self.value[start : self.pos]
        else:
            command = self.value[self.pos]
            self.pos += 1

        if command == "frac":
            return [_fraction(self._group_arg(), self._group_arg())]
        if command == "sqrt":
            return [_radical(self._group_arg())]
        if command in _TEXT_COMMANDS:
            return self._group_arg()
        if command in {"left", "right"}:
            return []
        mapped = _COMMANDS.get(command)
        if mapped is not None:
            return [_run(mapped)]
        if command in {"{", "}", "_", "^", "%", "#", "&"}:
            return [_run(command)]
        return [_run("\\" + command)]

    def _atom(self) -> list:
        if self.pos >= len(self.value):
            return []
        char = self.value[self.pos]
        if char == "\\":
            return self._command()
        if char == "{":
            self.pos += 1
            return self.parse("}")
        if char == "}":
            self.pos += 1
            return []
        if char in "^_":
            self.pos += 1
            return [_run(char)]
        self.pos += 1
        return [_run(char)]


def equation_elements(value: str) -> list:
    """Convert a conservative LaTeX/linear-math subset into native Word OMML elements."""

    cleaned = _strip_markdown_math_markup(value)
    if not cleaned:
        return []
    return _Parser(cleaned).parse()


def append_equation(paragraph, value: str) -> bool:
    """Append a native Word equation (OMML) to an existing paragraph."""

    elements = equation_elements(value)
    if not elements:
        return False

    math_para = OxmlElement("m:oMathPara")
    props = OxmlElement("m:oMathParaPr")
    justification = OxmlElement("m:jc")
    justification.set(qn("m:val"), "center")
    props.append(justification)
    math_para.append(props)

    math = OxmlElement("m:oMath")
    _append_children(math, elements)
    math_para.append(math)
    paragraph._p.append(math_para)
    return True
