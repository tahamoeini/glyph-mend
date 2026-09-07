from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path
from typing import Callable

from .config import ExtractionConfig
from .docx_export import markdown_to_docx
from .progress import ProgressEvent
from .workflow import combine_workspace, extract_pdf_resumable
from .workspace import default_workspace_path


class UserCancelled(RuntimeError):
    """Raised cooperatively when the desktop user stops an active job."""


def _open_path(path: Path) -> None:
    path = path.expanduser().resolve()
    if sys.platform.startswith("win"):
        os.startfile(str(path))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


def _format_event(event: ProgressEvent) -> str:
    percent = f" {event.percent:.0f}%" if event.percent is not None else ""
    current = ""
    if event.current is not None and event.total is not None:
        current = f" ({event.current}/{event.total})"
    elapsed = f" [{event.elapsed_seconds:.1f}s]" if event.elapsed_seconds is not None else ""
    details = ""
    if event.details:
        compact = ", ".join(f"{key}={value}" for key, value in event.details.items())
        details = f" | {compact}"
    return f"[{event.stage}] {event.message}{current}{percent}{elapsed}{details}"


def _parse_positive_int(value: str, name: str) -> int:
    try:
        result = int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be a whole number") from exc
    if result <= 0:
        raise ValueError(f"{name} must be positive")
    return result


def main() -> int:
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox, ttk
        from tkinter.scrolledtext import ScrolledText
    except ImportError as exc:
        print(
            "pdf-sanitizer GUI requires Tkinter. On Windows/macOS it is normally included; "
            "on minimal Linux installations install the system Tk package (for example python3-tk).",
            file=sys.stderr,
        )
        return 1

    class PdfSanitizerApp:
        def __init__(self, root: tk.Tk):
            self.root = root
            self.root.title("PDF Sanitizer")
            self.root.geometry("1040x780")
            self.root.minsize(900, 680)

            self.events: queue.Queue[tuple[str, object]] = queue.Queue()
            self.stop_event = threading.Event()
            self.worker: threading.Thread | None = None

            self._build_variables()
            self._build_ui()
            self.root.after(100, self._poll_events)

        def _build_variables(self) -> None:
            self.pdf_var = tk.StringVar()
            self.output_var = tk.StringVar()
            self.workspace_var = tk.StringVar()
            self.ocr_language_var = tk.StringVar(value="eng")
            self.ocr_dpi_var = tk.StringVar(value="300")
            self.layout_mode_var = tk.StringVar(value="auto")
            self.layout_batch_var = tk.StringVar(value="20")
            self.checkpoint_pages_var = tk.StringVar(value="20")

            self.use_ocr_var = tk.BooleanVar(value=True)
            self.force_ocr_var = tk.BooleanVar(value=False)
            self.keep_headers_var = tk.BooleanVar(value=False)
            self.keep_footers_var = tk.BooleanVar(value=False)
            self.page_markers_var = tk.BooleanVar(value=True)
            self.tables_var = tk.BooleanVar(value=True)
            self.equations_var = tk.BooleanVar(value=True)
            self.task_lists_var = tk.BooleanVar(value=True)
            self.flows_var = tk.BooleanVar(value=True)
            self.placeholders_var = tk.BooleanVar(value=True)
            self.strict_var = tk.BooleanVar(value=False)

            self.combine_workspace_var = tk.StringVar()
            self.combine_output_var = tk.StringVar()
            self.docx_input_var = tk.StringVar()
            self.docx_output_var = tk.StringVar()
            self.docx_title_var = tk.StringVar()
            self.docx_page_breaks_var = tk.BooleanVar(value=True)

            self.status_var = tk.StringVar(value="Ready")
            self.progress_var = tk.DoubleVar(value=0.0)

        def _build_ui(self) -> None:
            outer = ttk.Frame(self.root, padding=10)
            outer.pack(fill="both", expand=True)

            header = ttk.Frame(outer)
            header.pack(fill="x", pady=(0, 8))
            ttk.Label(header, text="PDF Sanitizer", font=("TkDefaultFont", 16, "bold")).pack(side="left")
            ttk.Label(
                header,
                text="Local-first PDF → Markdown, resumable checkpoints, and DOCX export",
            ).pack(side="left", padx=(14, 0))

            self.notebook = ttk.Notebook(outer)
            self.notebook.pack(fill="both", expand=True)

            self.extract_tab = ttk.Frame(self.notebook, padding=12)
            self.combine_tab = ttk.Frame(self.notebook, padding=12)
            self.docx_tab = ttk.Frame(self.notebook, padding=12)
            self.notebook.add(self.extract_tab, text="Extract / Resume")
            self.notebook.add(self.combine_tab, text="Combine Workspace")
            self.notebook.add(self.docx_tab, text="Markdown → DOCX")

            self._build_extract_tab()
            self._build_combine_tab()
            self._build_docx_tab()

            progress_frame = ttk.Frame(outer)
            progress_frame.pack(fill="x", pady=(10, 4))
            self.progress = ttk.Progressbar(
                progress_frame,
                variable=self.progress_var,
                maximum=100,
                mode="determinate",
            )
            self.progress.pack(side="left", fill="x", expand=True)
            ttk.Label(progress_frame, textvariable=self.status_var, width=38, anchor="e").pack(
                side="left", padx=(10, 0)
            )

            log_header = ttk.Frame(outer)
            log_header.pack(fill="x")
            ttk.Label(log_header, text="Live log").pack(side="left")
            ttk.Button(log_header, text="Save Log…", command=self._save_log).pack(side="right")
            ttk.Button(log_header, text="Clear", command=self._clear_log).pack(side="right", padx=6)

            self.log = ScrolledText(outer, height=12, wrap="word", state="disabled")
            self.log.pack(fill="both", expand=False, pady=(4, 0))

        def _path_row(
            self,
            parent,
            row: int,
            label: str,
            variable: tk.StringVar,
            browse: Callable[[], None],
            *,
            open_button: bool = False,
        ) -> None:
            ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=(0, 8), pady=4)
            ttk.Entry(parent, textvariable=variable).grid(row=row, column=1, sticky="ew", pady=4)
            ttk.Button(parent, text="Browse…", command=browse).grid(row=row, column=2, padx=(8, 0), pady=4)
            if open_button:
                ttk.Button(parent, text="Open", command=lambda: self._open_variable_path(variable)).grid(
                    row=row, column=3, padx=(6, 0), pady=4
                )

        def _build_extract_tab(self) -> None:
            paths = ttk.LabelFrame(self.extract_tab, text="Files and checkpoints", padding=10)
            paths.pack(fill="x")
            paths.columnconfigure(1, weight=1)
            self._path_row(paths, 0, "Input PDF", self.pdf_var, self._browse_pdf)
            self._path_row(paths, 1, "Output Markdown", self.output_var, self._browse_output_md, open_button=True)
            self._path_row(paths, 2, "Workspace", self.workspace_var, self._browse_workspace, open_button=True)

            engine = ttk.LabelFrame(self.extract_tab, text="Extraction engine", padding=10)
            engine.pack(fill="x", pady=(10, 0))
            for column in range(6):
                engine.columnconfigure(column, weight=1 if column in {1, 3, 5} else 0)

            ttk.Checkbutton(engine, text="OCR fallback", variable=self.use_ocr_var).grid(row=0, column=0, sticky="w")
            ttk.Checkbutton(engine, text="Force OCR", variable=self.force_ocr_var).grid(row=0, column=1, sticky="w")
            ttk.Label(engine, text="OCR language").grid(row=0, column=2, sticky="e", padx=(8, 4))
            ttk.Entry(engine, textvariable=self.ocr_language_var, width=12).grid(row=0, column=3, sticky="w")
            ttk.Label(engine, text="OCR DPI").grid(row=0, column=4, sticky="e", padx=(8, 4))
            ttk.Entry(engine, textvariable=self.ocr_dpi_var, width=8).grid(row=0, column=5, sticky="w")

            ttk.Label(engine, text="Layout mode").grid(row=1, column=0, sticky="w", pady=(8, 0))
            ttk.Combobox(
                engine,
                textvariable=self.layout_mode_var,
                values=("auto", "layout", "legacy"),
                state="readonly",
                width=12,
            ).grid(row=1, column=1, sticky="w", pady=(8, 0))
            ttk.Label(engine, text="Engine batch pages").grid(row=1, column=2, sticky="e", padx=(8, 4), pady=(8, 0))
            ttk.Entry(engine, textvariable=self.layout_batch_var, width=8).grid(row=1, column=3, sticky="w", pady=(8, 0))
            ttk.Label(engine, text="Checkpoint pages").grid(row=1, column=4, sticky="e", padx=(8, 4), pady=(8, 0))
            ttk.Entry(engine, textvariable=self.checkpoint_pages_var, width=8).grid(row=1, column=5, sticky="w", pady=(8, 0))

            semantics = ttk.LabelFrame(self.extract_tab, text="Semantic output", padding=10)
            semantics.pack(fill="x", pady=(10, 0))
            checks = [
                ("Tables", self.tables_var),
                ("Equations", self.equations_var),
                ("Task lists", self.task_lists_var),
                ("Vector flows", self.flows_var),
                ("Visual placeholders", self.placeholders_var),
                ("Page markers", self.page_markers_var),
                ("Keep headers", self.keep_headers_var),
                ("Keep footers", self.keep_footers_var),
                ("Strict / fail fast", self.strict_var),
            ]
            for index, (text, variable) in enumerate(checks):
                ttk.Checkbutton(semantics, text=text, variable=variable).grid(
                    row=index // 3,
                    column=index % 3,
                    sticky="w",
                    padx=(0, 24),
                    pady=3,
                )

            actions = ttk.Frame(self.extract_tab)
            actions.pack(fill="x", pady=(12, 0))
            self.start_button = ttk.Button(actions, text="Extract / Resume", command=lambda: self._start_extract(False))
            self.start_button.pack(side="left")
            self.restart_button = ttk.Button(actions, text="Restart from Scratch…", command=lambda: self._start_extract(True))
            self.restart_button.pack(side="left", padx=8)
            self.stop_button = ttk.Button(actions, text="Stop Safely", command=self._request_stop, state="disabled")
            self.stop_button.pack(side="left")
            ttk.Label(
                actions,
                text="Stopping preserves completed checkpoint files; the active unfinished checkpoint may be retried.",
            ).pack(side="left", padx=12)

        def _build_combine_tab(self) -> None:
            frame = ttk.LabelFrame(self.combine_tab, text="Completed extraction workspace", padding=10)
            frame.pack(fill="x")
            frame.columnconfigure(1, weight=1)
            self._path_row(
                frame,
                0,
                "Workspace",
                self.combine_workspace_var,
                self._browse_combine_workspace,
                open_button=True,
            )
            self._path_row(frame, 1, "Output Markdown", self.combine_output_var, self._browse_combine_output, open_button=True)

            actions = ttk.Frame(self.combine_tab)
            actions.pack(fill="x", pady=12)
            ttk.Button(actions, text="Inspect Manifest", command=self._inspect_manifest).pack(side="left")
            ttk.Button(actions, text="Combine Validated Parts", command=self._start_combine).pack(side="left", padx=8)

            ttk.Label(
                self.combine_tab,
                text=(
                    "Combining does not reopen or re-extract the PDF. Every expected part is checksum-validated "
                    "against manifest.json before final Markdown is written."
                ),
                wraplength=800,
            ).pack(anchor="w")

        def _build_docx_tab(self) -> None:
            frame = ttk.LabelFrame(self.docx_tab, text="Markdown export", padding=10)
            frame.pack(fill="x")
            frame.columnconfigure(1, weight=1)
            self._path_row(frame, 0, "Input Markdown", self.docx_input_var, self._browse_docx_input)
            self._path_row(frame, 1, "Output DOCX", self.docx_output_var, self._browse_docx_output, open_button=True)
            ttk.Label(frame, text="Document title").grid(row=2, column=0, sticky="w", pady=4)
            ttk.Entry(frame, textvariable=self.docx_title_var).grid(row=2, column=1, sticky="ew", pady=4)
            ttk.Checkbutton(
                frame,
                text="Turn <!-- page: N --> markers into Word page breaks",
                variable=self.docx_page_breaks_var,
            ).grid(row=3, column=1, sticky="w", pady=4)

            ttk.Button(self.docx_tab, text="Create DOCX", command=self._start_docx).pack(anchor="w", pady=12)
            ttk.Label(
                self.docx_tab,
                text=(
                    "Headings, paragraphs, lists, task lists, links, tables, code blocks, and page breaks are mapped "
                    "to Word structures. LaTeX and Mermaid are preserved legibly rather than guessed into unreliable native objects."
                ),
                wraplength=800,
            ).pack(anchor="w")

        def _browse_pdf(self) -> None:
            value = filedialog.askopenfilename(filetypes=[("PDF files", "*.pdf"), ("All files", "*.*")])
            if not value:
                return
            pdf = Path(value)
            self.pdf_var.set(str(pdf))
            output = pdf.with_suffix(".md")
            self.output_var.set(str(output))
            self.workspace_var.set(str(default_workspace_path(output)))

        def _browse_output_md(self) -> None:
            value = filedialog.asksaveasfilename(defaultextension=".md", filetypes=[("Markdown", "*.md")])
            if value:
                self.output_var.set(value)
                self.workspace_var.set(str(default_workspace_path(Path(value))))

        def _browse_workspace(self) -> None:
            value = filedialog.askdirectory()
            if value:
                self.workspace_var.set(value)

        def _browse_combine_workspace(self) -> None:
            value = filedialog.askdirectory()
            if value:
                self.combine_workspace_var.set(value)
                manifest = Path(value) / "manifest.json"
                if manifest.is_file():
                    try:
                        data = json.loads(manifest.read_text(encoding="utf-8"))
                        output = data.get("output_path")
                        if output:
                            self.combine_output_var.set(str(output))
                    except Exception:
                        pass

        def _browse_combine_output(self) -> None:
            value = filedialog.asksaveasfilename(defaultextension=".md", filetypes=[("Markdown", "*.md")])
            if value:
                self.combine_output_var.set(value)

        def _browse_docx_input(self) -> None:
            value = filedialog.askopenfilename(filetypes=[("Markdown", "*.md *.markdown"), ("All files", "*.*")])
            if value:
                path = Path(value)
                self.docx_input_var.set(str(path))
                self.docx_output_var.set(str(path.with_suffix(".docx")))

        def _browse_docx_output(self) -> None:
            value = filedialog.asksaveasfilename(defaultextension=".docx", filetypes=[("Word document", "*.docx")])
            if value:
                self.docx_output_var.set(value)

        def _open_variable_path(self, variable: tk.StringVar) -> None:
            value = variable.get().strip()
            if not value:
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

        def _build_config(self) -> ExtractionConfig:
            return ExtractionConfig(
                use_ocr=self.use_ocr_var.get(),
                force_ocr=self.force_ocr_var.get(),
                ocr_language=self.ocr_language_var.get().strip() or "eng",
                ocr_dpi=_parse_positive_int(self.ocr_dpi_var.get(), "OCR DPI"),
                keep_headers=self.keep_headers_var.get(),
                keep_footers=self.keep_footers_var.get(),
                include_page_markers=self.page_markers_var.get(),
                extract_tables=self.tables_var.get(),
                extract_equations=self.equations_var.get(),
                normalize_task_lists=self.task_lists_var.get(),
                detect_vector_flows=self.flows_var.get(),
                include_visual_placeholders=self.placeholders_var.get(),
                layout_mode=self.layout_mode_var.get(),
                layout_batch_pages=_parse_positive_int(self.layout_batch_var.get(), "Engine batch pages"),
                strict=self.strict_var.get(),
            )

        def _start_extract(self, restart: bool) -> None:
            if self._busy():
                return
            try:
                source = Path(self.pdf_var.get().strip()).expanduser().resolve()
                output = Path(self.output_var.get().strip()).expanduser().resolve()
                workspace_text = self.workspace_var.get().strip()
                workspace = (
                    Path(workspace_text).expanduser().resolve()
                    if workspace_text
                    else default_workspace_path(output).resolve()
                )
                checkpoint_pages = _parse_positive_int(self.checkpoint_pages_var.get(), "Checkpoint pages")
                config = self._build_config()
                config.validate()
                if not source.is_file():
                    raise FileNotFoundError(source)
            except Exception as exc:
                messagebox.showerror("Cannot start extraction", str(exc))
                return

            if restart and not messagebox.askyesno(
                "Restart extraction",
                "Discard the existing compatible checkpoint workspace and extract from page 1 again?",
            ):
                return

            self.progress_var.set(0)
            self.status_var.set("Starting extraction…")
            self._append_log(f"Starting {'restart' if restart else 'extract/resume'}: {source}")

            def work(progress_callback: Callable[[ProgressEvent], None]) -> object:
                result = extract_pdf_resumable(
                    source,
                    output,
                    workspace_path=workspace,
                    checkpoint_pages=checkpoint_pages,
                    config=config,
                    restart=restart,
                    progress=progress_callback,
                )
                return output

            self._start_worker(work)

        def _start_combine(self) -> None:
            if self._busy():
                return
            workspace_text = self.combine_workspace_var.get().strip()
            if not workspace_text:
                messagebox.showerror("Combine", "Choose a checkpoint workspace first.")
                return
            workspace = Path(workspace_text)
            output_text = self.combine_output_var.get().strip()
            output = Path(output_text) if output_text else None
            self.status_var.set("Combining checkpoints…")
            self._append_log(f"Combining workspace: {workspace}")

            def work(_progress_callback: Callable[[ProgressEvent], None]) -> object:
                return combine_workspace(workspace, output)

            self._start_worker(work)

        def _start_docx(self) -> None:
            if self._busy():
                return
            source_text = self.docx_input_var.get().strip()
            if not source_text:
                messagebox.showerror("DOCX", "Choose a Markdown input first.")
                return
            source = Path(source_text)
            output_text = self.docx_output_var.get().strip()
            output = Path(output_text) if output_text else source.with_suffix(".docx")
            title = self.docx_title_var.get().strip() or None
            page_breaks = self.docx_page_breaks_var.get()
            self.status_var.set("Creating DOCX…")
            self._append_log(f"Creating DOCX from: {source}")

            def work(_progress_callback: Callable[[ProgressEvent], None]) -> object:
                return markdown_to_docx(source, output, title=title, page_breaks=page_breaks)

            self._start_worker(work)

        def _inspect_manifest(self) -> None:
            workspace_text = self.combine_workspace_var.get().strip()
            if not workspace_text:
                messagebox.showerror("Manifest", "Choose a workspace first.")
                return
            manifest = Path(workspace_text) / "manifest.json"
            try:
                data = json.loads(manifest.read_text(encoding="utf-8"))
            except Exception as exc:
                messagebox.showerror("Manifest", str(exc))
                return
            parts = data.get("parts") or []
            completed = len(parts)
            checkpoint_pages = int(data.get("checkpoint_pages") or 0)
            page_count = int(data.get("page_count") or 0)
            expected = (page_count + checkpoint_pages - 1) // checkpoint_pages if checkpoint_pages else 0
            source = (data.get("source") or {}).get("name", "unknown")
            messagebox.showinfo(
                "Workspace manifest",
                f"Source: {source}\nStatus: {data.get('status', 'unknown')}\nPages: {page_count}\n"
                f"Completed parts: {completed}/{expected}\nAlgorithm version: {data.get('algorithm_version', '?')}\n"
                f"Output: {data.get('output_path', '')}",
            )

        def _start_worker(self, function: Callable[[Callable[[ProgressEvent], None]], object]) -> None:
            if self._busy():
                return
            self.stop_event.clear()
            self._set_busy(True)

            def progress_callback(event: ProgressEvent) -> None:
                self.events.put(("progress", event))
                if self.stop_event.is_set() and event.stage not in {"error", "complete"}:
                    raise UserCancelled("Stopped by user; completed checkpoints were preserved")

            def target() -> None:
                try:
                    result = function(progress_callback)
                except UserCancelled as exc:
                    self.events.put(("cancelled", exc))
                except Exception as exc:
                    self.events.put(("error", exc))
                else:
                    self.events.put(("done", result))

            self.worker = threading.Thread(target=target, daemon=True)
            self.worker.start()

        def _request_stop(self) -> None:
            if not self._busy():
                return
            self.stop_event.set()
            self.status_var.set("Stopping after current engine operation…")
            self._append_log("Stop requested. Completed checkpoints will remain reusable.")

        def _busy(self) -> bool:
            return self.worker is not None and self.worker.is_alive()

        def _set_busy(self, busy: bool) -> None:
            state = "disabled" if busy else "normal"
            self.start_button.configure(state=state)
            self.restart_button.configure(state=state)
            self.stop_button.configure(state="normal" if busy else "disabled")

        def _poll_events(self) -> None:
            try:
                while True:
                    kind, payload = self.events.get_nowait()
                    if kind == "progress":
                        event = payload
                        assert isinstance(event, ProgressEvent)
                        if event.percent is not None:
                            self.progress_var.set(event.percent)
                        self.status_var.set(event.message)
                        self._append_log(_format_event(event))
                    elif kind == "done":
                        self.progress_var.set(100)
                        self.status_var.set("Completed")
                        self._append_log(f"Completed: {payload}")
                        self._set_busy(False)
                        self.worker = None
                    elif kind == "cancelled":
                        self.status_var.set("Stopped; checkpoints preserved")
                        self._append_log(str(payload))
                        self._set_busy(False)
                        self.worker = None
                    elif kind == "error":
                        self.status_var.set("Failed")
                        self._append_log(f"ERROR: {payload}")
                        self._set_busy(False)
                        self.worker = None
                        messagebox.showerror("PDF Sanitizer", str(payload))
            except queue.Empty:
                pass
            self.root.after(100, self._poll_events)

        def _append_log(self, text: str) -> None:
            self.log.configure(state="normal")
            self.log.insert("end", text.rstrip() + "\n")
            self.log.see("end")
            self.log.configure(state="disabled")

        def _clear_log(self) -> None:
            self.log.configure(state="normal")
            self.log.delete("1.0", "end")
            self.log.configure(state="disabled")

        def _save_log(self) -> None:
            value = filedialog.asksaveasfilename(defaultextension=".log", filetypes=[("Log file", "*.log"), ("Text", "*.txt")])
            if not value:
                return
            Path(value).write_text(self.log.get("1.0", "end-1c"), encoding="utf-8")

    root = tk.Tk()
    try:
        style = ttk.Style(root)
        if "vista" in style.theme_names() and sys.platform.startswith("win"):
            style.theme_use("vista")
    except Exception:
        pass
    PdfSanitizerApp(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
