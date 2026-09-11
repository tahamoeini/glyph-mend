from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Callable

from .branding import get_brand
from .config import ExtractionConfig
from .docx_export import markdown_to_docx
from .progress import ProgressEvent
from .workflow import combine_workspace, extract_pdf_resumable
from .workspace import default_workspace_path


class UserCancelled(RuntimeError):
    """Raised cooperatively when the desktop user stops an active job."""


def _open_path(path: Path) -> None:
    target = path.expanduser().resolve()
    if sys.platform.startswith("win"):
        os.startfile(str(target))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(target)])
    else:
        subprocess.Popen(["xdg-open", str(target)])


def _format_event(event: ProgressEvent) -> str:
    progress = ""
    if event.current is not None and event.total is not None:
        progress = f" ({event.current}/{event.total}"
        if event.percent is not None:
            progress += f", {event.percent:.0f}%"
        progress += ")"
    elapsed = f" [{event.elapsed_seconds:.1f}s]" if event.elapsed_seconds is not None else ""
    details = ""
    if event.details:
        details = " | " + ", ".join(f"{key}={value}" for key, value in event.details.items())
    return f"[{event.stage}] {event.message}{progress}{elapsed}{details}"


def _parse_positive_int(value: str, name: str) -> int:
    try:
        result = int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be a whole number") from exc
    if result <= 0:
        raise ValueError(f"{name} must be positive")
    return result


def main(argv: list[str] | None = None) -> int:
    brand = get_brand()
    arguments = list(sys.argv[1:] if argv is None else argv)
    if any(argument in {"-h", "--help"} for argument in arguments):
        print(f"usage: {brand.cli_name}-gui [--help]")
        print("\nLaunch the native desktop interface.")
        return 0
    if arguments:
        print(f"{brand.cli_name}-gui: unrecognized arguments: {' '.join(arguments)}", file=sys.stderr)
        return 2
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox, ttk
        from tkinter.scrolledtext import ScrolledText
    except ImportError:
        print(
            f"{brand.name} GUI requires Tkinter. On Windows/macOS it is normally included; "
            "on minimal Linux installations install the system Tk package (for example python3-tk).",
            file=sys.stderr,
        )
        return 1

    class App:
        def __init__(self, root: tk.Tk):
            self.root = root
            self.root.title(brand.name)
            self.root.geometry("1040x800")
            self.root.minsize(900, 700)
            self.events: queue.Queue[tuple[str, object]] = queue.Queue()
            self.stop_event = threading.Event()
            self.worker: threading.Thread | None = None
            self.running = False
            self._vars()
            self._ui()
            self.root.after(100, self._poll)

        def _vars(self) -> None:
            self.pdf = tk.StringVar()
            self.output = tk.StringVar()
            self.workspace = tk.StringVar()
            self.ocr_language = tk.StringVar(value="eng")
            self.ocr_dpi = tk.StringVar(value="300")
            self.layout_mode = tk.StringVar(value="auto")
            self.layout_batch = tk.StringVar(value="20")
            self.checkpoint_pages = tk.StringVar(value="20")

            self.use_ocr = tk.BooleanVar(value=True)
            self.force_ocr = tk.BooleanVar(value=False)
            self.keep_headers = tk.BooleanVar(value=False)
            self.keep_footers = tk.BooleanVar(value=False)
            self.page_markers = tk.BooleanVar(value=True)
            self.tables = tk.BooleanVar(value=True)
            self.equations = tk.BooleanVar(value=True)
            self.task_lists = tk.BooleanVar(value=True)
            self.flows = tk.BooleanVar(value=True)
            self.placeholders = tk.BooleanVar(value=True)
            self.strict = tk.BooleanVar(value=False)

            self.combine_workspace = tk.StringVar()
            self.combine_output = tk.StringVar()
            self.docx_input = tk.StringVar()
            self.docx_source_pdf = tk.StringVar()
            self.docx_output = tk.StringVar()
            self.docx_title = tk.StringVar()
            # Word is reflowing; reproducing every source PDF page boundary is opt-in.
            self.docx_page_breaks = tk.BooleanVar(value=False)

            self.status = tk.StringVar(value="Ready")
            self.progress_value = tk.DoubleVar(value=0.0)

        def _ui(self) -> None:
            outer = ttk.Frame(self.root, padding=10)
            outer.pack(fill="both", expand=True)

            header = ttk.Frame(outer)
            header.pack(fill="x", pady=(0, 8))
            ttk.Label(header, text=brand.name, font=("TkDefaultFont", 16, "bold")).pack(side="left")
            ttk.Label(header, text=brand.slogan).pack(side="left", padx=14)

            tabs = ttk.Notebook(outer)
            tabs.pack(fill="both", expand=True)
            extract_tab = ttk.Frame(tabs, padding=12)
            combine_tab = ttk.Frame(tabs, padding=12)
            docx_tab = ttk.Frame(tabs, padding=12)
            tabs.add(extract_tab, text="Extract / Resume")
            tabs.add(combine_tab, text="Combine Workspace")
            tabs.add(docx_tab, text="Markdown → DOCX")
            self._extract_ui(extract_tab)
            self._combine_ui(combine_tab)
            self._docx_ui(docx_tab)

            bar = ttk.Frame(outer)
            bar.pack(fill="x", pady=(10, 4))
            ttk.Progressbar(bar, variable=self.progress_value, maximum=100).pack(
                side="left", fill="x", expand=True
            )
            ttk.Label(bar, textvariable=self.status, width=42, anchor="e").pack(side="left", padx=8)

            log_tools = ttk.Frame(outer)
            log_tools.pack(fill="x")
            ttk.Label(log_tools, text="Live log").pack(side="left")
            ttk.Button(log_tools, text="Save Log…", command=self._save_log).pack(side="right")
            ttk.Button(log_tools, text="Clear", command=self._clear_log).pack(side="right", padx=6)
            self.log = ScrolledText(outer, height=12, wrap="word", state="disabled")
            self.log.pack(fill="x", pady=(4, 0))

        def _path_row(self, parent, row: int, label: str, variable, browse, *, can_open: bool = False) -> None:
            ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=(0, 8), pady=4)
            ttk.Entry(parent, textvariable=variable).grid(row=row, column=1, sticky="ew", pady=4)
            ttk.Button(parent, text="Browse…", command=browse).grid(row=row, column=2, padx=(8, 0), pady=4)
            if can_open:
                ttk.Button(parent, text="Open", command=lambda: self._open(variable.get())).grid(
                    row=row, column=3, padx=(6, 0), pady=4
                )

        def _extract_ui(self, parent) -> None:
            paths = ttk.LabelFrame(parent, text="Files and checkpoints", padding=10)
            paths.pack(fill="x")
            paths.columnconfigure(1, weight=1)
            self._path_row(paths, 0, "Input PDF", self.pdf, self._choose_pdf)
            self._path_row(paths, 1, "Output Markdown", self.output, self._choose_output, can_open=True)
            self._path_row(paths, 2, "Workspace", self.workspace, self._choose_workspace, can_open=True)

            engine = ttk.LabelFrame(parent, text="Extraction engine", padding=10)
            engine.pack(fill="x", pady=(10, 0))
            ttk.Checkbutton(engine, text="OCR fallback", variable=self.use_ocr).grid(row=0, column=0, sticky="w")
            ttk.Checkbutton(engine, text="Force OCR", variable=self.force_ocr).grid(row=0, column=1, sticky="w", padx=8)
            ttk.Label(engine, text="Language").grid(row=0, column=2, sticky="e")
            ttk.Entry(engine, textvariable=self.ocr_language, width=10).grid(row=0, column=3, sticky="w", padx=4)
            ttk.Label(engine, text="DPI").grid(row=0, column=4, sticky="e")
            ttk.Entry(engine, textvariable=self.ocr_dpi, width=7).grid(row=0, column=5, sticky="w", padx=4)

            ttk.Label(engine, text="Layout mode").grid(row=1, column=0, sticky="w", pady=(8, 0))
            ttk.Combobox(
                engine,
                textvariable=self.layout_mode,
                values=("auto", "layout", "legacy"),
                state="readonly",
                width=10,
            ).grid(row=1, column=1, sticky="w", pady=(8, 0))
            ttk.Label(engine, text="Engine batch pages").grid(row=1, column=2, sticky="e", pady=(8, 0))
            ttk.Entry(engine, textvariable=self.layout_batch, width=7).grid(row=1, column=3, sticky="w", padx=4, pady=(8, 0))
            ttk.Label(engine, text="Checkpoint pages").grid(row=1, column=4, sticky="e", pady=(8, 0))
            ttk.Entry(engine, textvariable=self.checkpoint_pages, width=7).grid(row=1, column=5, sticky="w", padx=4, pady=(8, 0))

            semantics = ttk.LabelFrame(parent, text="Semantic output", padding=10)
            semantics.pack(fill="x", pady=(10, 0))
            options = [
                ("Tables", self.tables),
                ("Equations", self.equations),
                ("Task lists", self.task_lists),
                ("Vector flows", self.flows),
                ("Visual placeholders", self.placeholders),
                ("Page markers", self.page_markers),
                ("Keep headers", self.keep_headers),
                ("Keep footers", self.keep_footers),
                ("Strict / fail fast", self.strict),
            ]
            for index, (text, variable) in enumerate(options):
                ttk.Checkbutton(semantics, text=text, variable=variable).grid(
                    row=index // 3, column=index % 3, sticky="w", padx=(0, 24), pady=3
                )

            buttons = ttk.Frame(parent)
            buttons.pack(fill="x", pady=12)
            self.start_button = ttk.Button(buttons, text="Extract / Resume", command=lambda: self._extract(False))
            self.start_button.pack(side="left")
            self.restart_button = ttk.Button(
                buttons, text="Restart from Scratch…", command=lambda: self._extract(True)
            )
            self.restart_button.pack(side="left", padx=8)
            self.stop_button = ttk.Button(buttons, text="Stop Safely", command=self._stop, state="disabled")
            self.stop_button.pack(side="left")
            ttk.Label(
                buttons,
                text="Completed checkpoints survive a stop; only the active unfinished part is retried.",
            ).pack(side="left", padx=12)

        def _combine_ui(self, parent) -> None:
            frame = ttk.LabelFrame(parent, text="Checkpoint workspace", padding=10)
            frame.pack(fill="x")
            frame.columnconfigure(1, weight=1)
            self._path_row(
                frame, 0, "Workspace", self.combine_workspace, self._choose_combine_workspace, can_open=True
            )
            self._path_row(
                frame, 1, "Output Markdown", self.combine_output, self._choose_combine_output, can_open=True
            )
            buttons = ttk.Frame(parent)
            buttons.pack(fill="x", pady=12)
            ttk.Button(buttons, text="Inspect Manifest", command=self._inspect_manifest).pack(side="left")
            ttk.Button(buttons, text="Combine Validated Parts", command=self._combine).pack(side="left", padx=8)
            ttk.Label(
                parent,
                text="Combining validates every expected part and checksum without reopening the PDF.",
            ).pack(anchor="w")

        def _docx_ui(self, parent) -> None:
            frame = ttk.LabelFrame(parent, text="Word export", padding=10)
            frame.pack(fill="x")
            frame.columnconfigure(1, weight=1)
            self._path_row(frame, 0, "Input Markdown", self.docx_input, self._choose_docx_input)
            self._path_row(
                frame,
                1,
                "Source PDF (optional)",
                self.docx_source_pdf,
                self._choose_docx_source_pdf,
            )
            self._path_row(frame, 2, "Output DOCX", self.docx_output, self._choose_docx_output, can_open=True)
            ttk.Label(frame, text="Document title").grid(row=3, column=0, sticky="w", pady=4)
            ttk.Entry(frame, textvariable=self.docx_title).grid(row=3, column=1, sticky="ew", pady=4)
            ttk.Checkbutton(
                frame,
                text="Preserve source PDF page boundaries as hard Word page breaks",
                variable=self.docx_page_breaks,
            ).grid(row=4, column=1, sticky="w", pady=4)
            ttk.Button(parent, text="Create DOCX", command=self._docx).pack(anchor="w", pady=12)
            ttk.Label(
                parent,
                text=(
                    "Display-math blocks become native editable Word equations. If the original PDF is "
                    "provided, image-only equations, tables and figures represented by placeholders are "
                    "embedded as source crops. Word reflows naturally unless page preservation is enabled."
                ),
                wraplength=820,
            ).pack(anchor="w")

        def _choose_pdf(self) -> None:
            value = filedialog.askopenfilename(filetypes=[("PDF files", "*.pdf"), ("All files", "*.*")])
            if value:
                source = Path(value)
                output = source.with_suffix(".md")
                self.pdf.set(str(source))
                self.output.set(str(output))
                self.workspace.set(str(default_workspace_path(output)))

        def _choose_output(self) -> None:
            value = filedialog.asksaveasfilename(defaultextension=".md", filetypes=[("Markdown", "*.md")])
            if value:
                self.output.set(value)
                self.workspace.set(str(default_workspace_path(Path(value))))

        def _choose_workspace(self) -> None:
            value = filedialog.askdirectory()
            if value:
                self.workspace.set(value)

        def _choose_combine_workspace(self) -> None:
            value = filedialog.askdirectory()
            if not value:
                return
            self.combine_workspace.set(value)
            manifest = Path(value) / "manifest.json"
            try:
                data = json.loads(manifest.read_text(encoding="utf-8"))
                if data.get("output_path"):
                    self.combine_output.set(str(data["output_path"]))
            except Exception:
                pass

        def _choose_combine_output(self) -> None:
            value = filedialog.asksaveasfilename(defaultextension=".md", filetypes=[("Markdown", "*.md")])
            if value:
                self.combine_output.set(value)

        def _choose_docx_input(self) -> None:
            value = filedialog.askopenfilename(filetypes=[("Markdown", "*.md *.markdown"), ("All files", "*.*")])
            if value:
                source = Path(value)
                self.docx_input.set(str(source))
                self.docx_output.set(str(source.with_suffix(".docx")))
                sibling_pdf = source.with_suffix(".pdf")
                if sibling_pdf.is_file():
                    self.docx_source_pdf.set(str(sibling_pdf))

        def _choose_docx_source_pdf(self) -> None:
            value = filedialog.askopenfilename(filetypes=[("PDF files", "*.pdf"), ("All files", "*.*")])
            if value:
                self.docx_source_pdf.set(value)

        def _choose_docx_output(self) -> None:
            value = filedialog.asksaveasfilename(
                defaultextension=".docx", filetypes=[("Word document", "*.docx")]
            )
            if value:
                self.docx_output.set(value)

        def _config(self) -> ExtractionConfig:
            return ExtractionConfig(
                use_ocr=self.use_ocr.get(),
                force_ocr=self.force_ocr.get(),
                ocr_language=self.ocr_language.get().strip() or "eng",
                ocr_dpi=_parse_positive_int(self.ocr_dpi.get(), "OCR DPI"),
                keep_headers=self.keep_headers.get(),
                keep_footers=self.keep_footers.get(),
                include_page_markers=self.page_markers.get(),
                extract_tables=self.tables.get(),
                extract_equations=self.equations.get(),
                normalize_task_lists=self.task_lists.get(),
                detect_vector_flows=self.flows.get(),
                include_visual_placeholders=self.placeholders.get(),
                layout_mode=self.layout_mode.get(),
                layout_batch_pages=_parse_positive_int(self.layout_batch.get(), "Engine batch pages"),
                strict=self.strict.get(),
            )

        def _extract(self, restart: bool) -> None:
            if self.running:
                return
            try:
                source_text = self.pdf.get().strip()
                if not source_text:
                    raise ValueError("Choose an input PDF")
                source = Path(source_text).expanduser().resolve()
                if not source.is_file():
                    raise FileNotFoundError(source)
                output_text = self.output.get().strip()
                output = (
                    Path(output_text).expanduser().resolve()
                    if output_text
                    else source.with_suffix(".md")
                )
                workspace_text = self.workspace.get().strip()
                workspace = (
                    Path(workspace_text).expanduser().resolve()
                    if workspace_text
                    else default_workspace_path(output).resolve()
                )
                checkpoint = _parse_positive_int(self.checkpoint_pages.get(), "Checkpoint pages")
                config = self._config()
                config.validate()
            except Exception as exc:
                messagebox.showerror("Cannot start extraction", str(exc))
                return

            if restart and not messagebox.askyesno(
                "Restart extraction",
                "Discard the existing compatible checkpoint workspace and extract from page 1?",
            ):
                return

            self.output.set(str(output))
            self.workspace.set(str(workspace))
            self.progress_value.set(0)
            self._append(f"Starting {'restart' if restart else 'extract/resume'}: {source}")

            def task(callback: Callable[[ProgressEvent], None]) -> Path:
                extract_pdf_resumable(
                    source,
                    output,
                    workspace_path=workspace,
                    checkpoint_pages=checkpoint,
                    config=config,
                    restart=restart,
                    progress=callback,
                )
                return output

            self._start(task, "Starting extraction…")

        def _combine(self) -> None:
            if self.running:
                return
            workspace_text = self.combine_workspace.get().strip()
            if not workspace_text:
                messagebox.showerror("Combine", "Choose a workspace")
                return
            workspace = Path(workspace_text)
            output_text = self.combine_output.get().strip()
            output = Path(output_text) if output_text else None

            def task(_callback: Callable[[ProgressEvent], None]) -> Path:
                return combine_workspace(workspace, output)

            self._start(task, "Combining checkpoints…")

        def _docx(self) -> None:
            if self.running:
                return
            source_text = self.docx_input.get().strip()
            if not source_text:
                messagebox.showerror("DOCX", "Choose a Markdown input")
                return
            source = Path(source_text)
            output_text = self.docx_output.get().strip()
            output = Path(output_text) if output_text else source.with_suffix(".docx")
            title = self.docx_title.get().strip() or None
            page_breaks = self.docx_page_breaks.get()
            source_pdf_text = self.docx_source_pdf.get().strip()
            source_pdf = Path(source_pdf_text) if source_pdf_text else None
            if source_pdf is not None and not source_pdf.is_file():
                messagebox.showerror("DOCX", f"Source PDF does not exist:\n{source_pdf}")
                return

            if page_breaks:
                try:
                    marker_count = len(
                        re.findall(
                            r"<!--\s*page:\s*\d+\s*-->",
                            source.read_text(encoding="utf-8"),
                            flags=re.IGNORECASE,
                        )
                    )
                except Exception:
                    marker_count = 0
                if marker_count > 100 and not messagebox.askyesno(
                    "Preserve source page boundaries?",
                    f"This Markdown contains {marker_count} source page markers. Hard Word page breaks "
                    "can create a much longer, sparse document. Continue anyway?",
                ):
                    return

            def task(_callback: Callable[[ProgressEvent], None]) -> Path:
                return markdown_to_docx(
                    source,
                    output,
                    title=title,
                    page_breaks=page_breaks,
                    source_pdf=source_pdf,
                )

            self._start(task, "Creating DOCX…")

        def _inspect_manifest(self) -> None:
            workspace_text = self.combine_workspace.get().strip()
            if not workspace_text:
                messagebox.showerror("Manifest", "Choose a workspace")
                return
            manifest = Path(workspace_text) / "manifest.json"
            try:
                data = json.loads(manifest.read_text(encoding="utf-8"))
                pages = int(data.get("page_count") or 0)
                checkpoint = int(data.get("checkpoint_pages") or 0)
                expected = (pages + checkpoint - 1) // checkpoint if checkpoint else 0
                completed = len(data.get("parts") or [])
                source_name = (data.get("source") or {}).get("name", "unknown")
            except Exception as exc:
                messagebox.showerror("Manifest", str(exc))
                return
            messagebox.showinfo(
                "Workspace manifest",
                f"Source: {source_name}\nStatus: {data.get('status', 'unknown')}\nPages: {pages}\n"
                f"Completed parts: {completed}/{expected}\nAlgorithm version: {data.get('algorithm_version', '?')}\n"
                f"Output: {data.get('output_path', '')}",
            )

        def _start(self, task: Callable[[Callable[[ProgressEvent], None]], Path], status: str) -> None:
            if self.running:
                return
            self.running = True
            self.stop_event.clear()
            self.status.set(status)
            self._set_buttons(True)

            def callback(event: ProgressEvent) -> None:
                self.events.put(("progress", event))
                if self.stop_event.is_set() and event.stage not in {"error", "complete"}:
                    raise UserCancelled("Stopped by user; completed checkpoints were preserved")

            def worker() -> None:
                try:
                    result = task(callback)
                except UserCancelled as exc:
                    self.events.put(("cancelled", exc))
                except Exception as exc:
                    self.events.put(("error", exc))
                else:
                    self.events.put(("done", result))

            self.worker = threading.Thread(target=worker, daemon=True)
            self.worker.start()

        def _stop(self) -> None:
            if not self.running:
                return
            self.stop_event.set()
            self.status.set("Stopping after current engine operation…")
            self._append("Stop requested. Completed checkpoints remain reusable.")

        def _poll(self) -> None:
            try:
                while True:
                    kind, payload = self.events.get_nowait()
                    if kind == "progress":
                        event = payload
                        assert isinstance(event, ProgressEvent)
                        if event.percent is not None:
                            self.progress_value.set(event.percent)
                        self.status.set(event.message)
                        self._append(_format_event(event))
                    elif kind == "done":
                        self.progress_value.set(100)
                        self.status.set("Completed")
                        self._append(f"Completed: {payload}")
                        self._finish()
                    elif kind == "cancelled":
                        self.status.set("Stopped; checkpoints preserved")
                        self._append(str(payload))
                        self._finish()
                    elif kind == "error":
                        self.status.set("Failed")
                        self._append(f"ERROR: {payload}")
                        self._finish()
                        messagebox.showerror(brand.name, str(payload))
            except queue.Empty:
                pass
            self.root.after(100, self._poll)

        def _finish(self) -> None:
            self.running = False
            self.worker = None
            self._set_buttons(False)

        def _set_buttons(self, busy: bool) -> None:
            state = "disabled" if busy else "normal"
            self.start_button.configure(state=state)
            self.restart_button.configure(state=state)
            self.stop_button.configure(state="normal" if busy else "disabled")

        def _open(self, value: str) -> None:
            if not value.strip():
                return
            path = Path(value)
            target = path if path.exists() else path.parent
            if not target.exists():
                messagebox.showerror("Open", f"Path does not exist:\n{target}")
                return
            try:
                _open_path(target)
            except Exception as exc:
                messagebox.showerror("Open", str(exc))

        def _append(self, text: str) -> None:
            self.log.configure(state="normal")
            self.log.insert("end", text.rstrip() + "\n")
            self.log.see("end")
            self.log.configure(state="disabled")

        def _clear_log(self) -> None:
            self.log.configure(state="normal")
            self.log.delete("1.0", "end")
            self.log.configure(state="disabled")

        def _save_log(self) -> None:
            value = filedialog.asksaveasfilename(
                defaultextension=".log", filetypes=[("Log file", "*.log"), ("Text", "*.txt")]
            )
            if value:
                Path(value).write_text(self.log.get("1.0", "end-1c"), encoding="utf-8")

    root = tk.Tk()
    try:
        style = ttk.Style(root)
        if sys.platform.startswith("win") and "vista" in style.theme_names():
            style.theme_use("vista")
    except Exception:
        pass
    App(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
