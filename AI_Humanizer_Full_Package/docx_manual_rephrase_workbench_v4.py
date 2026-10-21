
import os
import re
import json
import time
import shutil
import traceback
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from dataclasses import dataclass, field
from pathlib import Path
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

try:
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
except Exception:
    Document = None
    OxmlElement = None
    qn = None

APP_NAME = "DOCX Manual Rephrase Workbench"
APP_VERSION = "4.1"

APP_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "DOCXManualRephraseWorkbenchV4"
APP_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_FILE = APP_DIR / "settings.json"
SESSION_DIR = APP_DIR / "sessions"
SESSION_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_SETTINGS = {
    "max_words": 1000,
    "min_words": 6,
    "skip_front_matter": True,
    "skip_headings": True,
    "skip_captions": True,
    "skip_references": True,
    "skip_lists": True,
    "skip_equations_objects": True,
    "separator": "<<<PARAGRAPH_BREAK>>>",
}

SECTION_WORDS = {
    "abstract", "introduction", "background", "related work", "literature review",
    "materials and methods", "methodology", "methods", "proposed method",
    "experimental setup", "experiments", "results", "results and discussion",
    "discussion", "conclusion", "conclusions", "future work",
    "acknowledgment", "acknowledgement", "acknowledgments", "acknowledgements",
    "references", "bibliography", "appendix", "supplementary material",
}
REFERENCE_HEADINGS = {"references", "reference", "bibliography"}
CAPTION_RE = re.compile(
    r"^\s*(figure|fig\.?|table|algorithm|scheme|chart|graph)\s*[A-Za-z0-9IVXivx\-\.]*\s*[:.\-]?",
    re.I
)
HEADING_NUMBER_RE = re.compile(
    r"^\s*(?:\d+(?:\.\d+){0,4}|[IVXLC]+|[A-Z])[\.\)]?\s+\S+",
    re.I
)
KEYWORDS_RE = re.compile(r"^\s*(keywords?|index terms?)\s*[:—\-]", re.I)
BRIDGE_HOST = "127.0.0.1"
BRIDGE_PORT = int(os.environ.get("WORKBENCH_BRIDGE_PORT", "8765"))

MATH_CHARS_RE = re.compile(r"[=±×÷∑∏√∫≈≠≤≥∞∂∇∆α-ωΑ-Ω^_{}]")


def load_settings():
    s = DEFAULT_SETTINGS.copy()
    if SETTINGS_FILE.exists():
        try:
            s.update(json.loads(SETTINGS_FILE.read_text(encoding="utf-8")))
        except Exception:
            pass
    return s


def save_settings(s):
    SETTINGS_FILE.write_text(json.dumps(s, indent=2), encoding="utf-8")


def count_words(text):
    return len(re.findall(r"\b[\w'’-]+\b", text or "", flags=re.UNICODE))


def normalize_space(text):
    return re.sub(r"[ \t]+", " ", (text or "").replace("\r", " ").replace("\n", " ")).strip()


def visible_text(paragraph):
    try:
        parts = []
        for node in paragraph._p.iter():
            if node.tag == qn("w:t"):
                parts.append(node.text or "")
            elif node.tag == qn("w:tab"):
                parts.append("\t")
            elif node.tag in (qn("w:br"), qn("w:cr")):
                parts.append("\n")
        return normalize_space("".join(parts))
    except Exception:
        return normalize_space(paragraph.text)


def style_name(paragraph):
    try:
        return paragraph.style.name or ""
    except Exception:
        return ""


def outline_level(paragraph):
    try:
        pPr = paragraph._p.pPr
        if pPr is None:
            return None
        node = pPr.find(qn("w:outlineLvl"))
        if node is not None:
            return int(node.get(qn("w:val")))
    except Exception:
        pass
    return None


def has_numpr(paragraph):
    try:
        pPr = paragraph._p.pPr
        return pPr is not None and pPr.find(qn("w:numPr")) is not None
    except Exception:
        return False


def has_equation_or_object(paragraph):
    forbidden = {
        "oMath", "oMathPara", "drawing", "pict", "object",
        "shape", "imagedata", "AlternateContent",
    }
    try:
        for node in paragraph._p.iter():
            if node.tag.rsplit("}", 1)[-1] in forbidden:
                return True
    except Exception:
        pass
    return False


def looks_math_only(text):
    t = (text or "").strip()
    if not t:
        return False
    words = count_words(t)
    math_chars = len(MATH_CHARS_RE.findall(t))
    return (words <= 18 and math_chars >= 2) or (words <= 8 and "=" in t)


def is_heading(paragraph, text):
    t = normalize_space(text)
    tl = t.lower().rstrip(":").strip()
    st = style_name(paragraph).lower()

    if not t:
        return False
    if "heading" in st or st in {"title", "subtitle"} or "section" in st:
        return True
    if outline_level(paragraph) is not None:
        return True
    if tl in SECTION_WORDS:
        return True
    if KEYWORDS_RE.match(t):
        return True
    if HEADING_NUMBER_RE.match(t) and count_words(t) <= 18 and len(t) <= 180:
        if not (len(t) > 120 and t.endswith(".")):
            return True

    letters = [c for c in t if c.isalpha()]
    if letters and len(t) <= 120 and count_words(t) <= 14:
        if sum(c.isupper() for c in letters) / len(letters) > 0.86:
            return True
    return False


def is_caption(paragraph, text):
    return "caption" in style_name(paragraph).lower() or bool(CAPTION_RE.match(text or ""))


def is_reference_heading(text):
    return normalize_space(text).lower().rstrip(":") in REFERENCE_HEADINGS


def front_marker(text):
    tl = normalize_space(text).lower().rstrip(":")
    if tl == "abstract":
        return "abstract"
    if tl == "introduction":
        return "introduction"
    if re.match(r"^\s*1[\.\)]?\s+introduction\b", tl, re.I):
        return "introduction"
    return None


def replace_paragraph_text(paragraph, new_text):
    p = paragraph._p
    for child in list(p):
        if child.tag != qn("w:pPr"):
            p.remove(child)

    r = OxmlElement("w:r")
    t = OxmlElement("w:t")
    if new_text.startswith(" ") or new_text.endswith(" ") or "  " in new_text:
        t.set(qn("xml:space"), "preserve")
    t.text = new_text
    r.append(t)
    p.append(r)


@dataclass
class ParagraphItem:
    paragraph_index: int
    text: str


@dataclass
class Chunk:
    item_no: int
    paragraphs: list = field(default_factory=list)
    total_words: int = 0
    status: str = "pending"
    replacement_parts: list = field(default_factory=list)


class DocxSession:
    def __init__(self, source_path, settings):
        if Document is None:
            raise RuntimeError("python-docx is not installed. Run INSTALL_AND_RUN.bat.")

        self.source_path = Path(source_path)
        self.settings = dict(settings)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self.output_path = self.source_path.with_name(
            f"{self.source_path.stem}_manual_rephrased_{ts}{self.source_path.suffix}"
        )
        self.backup_path = self.source_path.with_name(
            f"{self.source_path.stem}_backup_before_manual_rephrase{self.source_path.suffix}"
        )

        if not self.backup_path.exists():
            shutil.copy2(self.source_path, self.backup_path)
        shutil.copy2(self.source_path, self.output_path)

        self.doc = Document(str(self.output_path))
        self.chunks = []
        self.stats = {}
        self._scan_and_group()

    def _scan_and_group(self):
        s = self.settings
        max_words = int(s["max_words"])
        min_words = int(s["min_words"])

        front = bool(s["skip_front_matter"])
        in_refs = False

        stats = {
            "eligible_paragraphs": 0,
            "chunks": 0,
            "front_matter": 0,
            "headings": 0,
            "captions": 0,
            "references": 0,
            "lists": 0,
            "equations_objects": 0,
            "short_or_empty": 0,
            "math_lines": 0,
        }

        current = []
        current_words = 0
        item_no = 1

        def flush():
            nonlocal current, current_words, item_no
            if not current:
                return
            self.chunks.append(
                Chunk(
                    item_no=item_no,
                    paragraphs=list(current),
                    total_words=current_words,
                )
            )
            item_no += 1
            current = []
            current_words = 0

        for pidx, paragraph in enumerate(self.doc.paragraphs):
            text = visible_text(paragraph)
            marker = front_marker(text)

            # References boundary.
            if s["skip_references"] and is_reference_heading(text):
                in_refs = True
                stats["headings"] += 1
                continue

            if in_refs and s["skip_references"]:
                stats["references"] += 1
                continue

            # Front matter ends at Abstract or Introduction heading.
            if front:
                if marker in {"abstract", "introduction"}:
                    front = False
                    stats["headings"] += 1
                    continue
                stats["front_matter"] += 1
                continue

            skip_reason = None

            if not text or count_words(text) < min_words:
                skip_reason = "short_or_empty"
            elif s["skip_equations_objects"] and has_equation_or_object(paragraph):
                skip_reason = "equations_objects"
            elif looks_math_only(text):
                skip_reason = "math_lines"
            elif s["skip_headings"] and is_heading(paragraph, text):
                skip_reason = "headings"
            elif s["skip_captions"] and is_caption(paragraph, text):
                skip_reason = "captions"
            elif s["skip_lists"] and has_numpr(paragraph):
                skip_reason = "lists"

            if skip_reason:
                # v4: excluded material stays untouched in the DOCX, but it does NOT
                # break the packing sequence. We simply ignore it for word counting
                # and continue adding the next eligible prose paragraph.
                stats[skip_reason] += 1
                continue

            pw = count_words(text)
            stats["eligible_paragraphs"] += 1

            # If a single prose paragraph is longer than max, keep it alone.
            # This is rare; the GUI warns the user that it exceeds the target.
            if pw > max_words:
                flush()
                self.chunks.append(
                    Chunk(
                        item_no=item_no,
                        paragraphs=[ParagraphItem(pidx, text)],
                        total_words=pw,
                    )
                )
                item_no += 1
                continue

            if current and current_words + pw > max_words:
                flush()

            current.append(ParagraphItem(pidx, text))
            current_words += pw

        flush()
        stats["chunks"] = len(self.chunks)
        self.stats = stats

    def chunk_display_text(self, chunk):
        sep = self.settings["separator"]
        return f"\n\n{sep}\n\n".join(p.text for p in chunk.paragraphs)

    def save_replacement(self, chunk_index, replacement_text):
        chunk = self.chunks[chunk_index]
        sep = self.settings["separator"]

        # Split with optional surrounding whitespace/newlines.
        pattern = r"\s*" + re.escape(sep) + r"\s*"
        parts = [normalize_space(x) for x in re.split(pattern, replacement_text.strip())]

        expected = len(chunk.paragraphs)
        if len(parts) != expected:
            raise ValueError(
                f"This chunk contains {expected} original paragraphs, but the rephrased text "
                f"contains {len(parts)} parts.\n\n"
                f"Keep this separator between rephrased paragraphs exactly:\n{sep}"
            )

        self.save_replacement_parts(chunk_index, parts)

    def save_replacement_parts(self, chunk_index, parts):
        chunk = self.chunks[chunk_index]
        parts = [normalize_space(x) for x in parts]
        expected = len(chunk.paragraphs)
        if len(parts) != expected:
            raise ValueError(
                f"This chunk contains {expected} original paragraphs, but {len(parts)} "
                f"rephrased parts were supplied."
            )

        if any(not p for p in parts):
            raise ValueError("One or more rephrased paragraph parts are empty.")

        for pitem, new_text in zip(chunk.paragraphs, parts):
            paragraph = self.doc.paragraphs[pitem.paragraph_index]
            replace_paragraph_text(paragraph, new_text)

        chunk.replacement_parts = parts
        chunk.status = "replaced"
        self.doc.save(str(self.output_path))
        self._save_session_json()

    def mark_skipped(self, chunk_index):
        chunk = self.chunks[chunk_index]
        chunk.status = "skipped"
        chunk.replacement_parts = []
        self._save_session_json()

    def completion(self):
        replaced = sum(c.status == "replaced" for c in self.chunks)
        skipped = sum(c.status == "skipped" for c in self.chunks)
        pending = len(self.chunks) - replaced - skipped
        return replaced, skipped, pending

    def _save_session_json(self):
        path = SESSION_DIR / f"{self.output_path.stem}.json"
        data = {
            "source": str(self.source_path),
            "output": str(self.output_path),
            "backup": str(self.backup_path),
            "settings": self.settings,
            "stats": self.stats,
            "chunks": [
                {
                    "item_no": c.item_no,
                    "total_words": c.total_words,
                    "status": c.status,
                    "paragraphs": [
                        {"paragraph_index": p.paragraph_index, "text": p.text}
                        for p in c.paragraphs
                    ],
                    "replacement_parts": c.replacement_parts,
                }
                for c in self.chunks
            ],
        }
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


class ExtensionBridge:
    """Tiny local HTTP API used by the StealthWriter Chrome extension.

    The HTTP server runs in a background thread, but every request is executed
    on the Tk main thread (Tk is not thread-safe) through a queue polled by
    App._pump_bridge().
    """

    def __init__(self, app, host=BRIDGE_HOST, port=BRIDGE_PORT):
        self.app = app
        self.host = host
        self.port = port
        self.calls = queue.Queue()
        self.server = None
        self.error = None

    def start(self):
        bridge = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):
                pass

            def _origin_ok(self):
                # Only the browser extension (or local tools without an Origin)
                # may use the API; ordinary websites are refused.
                origin = self.headers.get("Origin")
                return origin is None or origin.startswith("chrome-extension://")

            def _send(self, code, payload):
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _dispatch(self, method):
                if not self._origin_ok():
                    self._send(403, {"ok": False, "error": "Forbidden origin"})
                    return
                data = {}
                if method == "POST":
                    try:
                        length = int(self.headers.get("Content-Length") or 0)
                        raw = self.rfile.read(length) if length else b"{}"
                        data = json.loads(raw.decode("utf-8") or "{}")
                    except Exception:
                        self._send(400, {"ok": False, "error": "Invalid JSON body"})
                        return
                code, payload = bridge.call(method, self.path.split("?")[0], data)
                self._send(code, payload)

            def do_GET(self):
                self._dispatch("GET")

            def do_POST(self):
                self._dispatch("POST")

        try:
            self.server = ThreadingHTTPServer((self.host, self.port), Handler)
        except OSError as e:
            self.error = str(e)
            return False
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return True

    def call(self, method, path, data, timeout=30):
        done = threading.Event()
        box = {}
        self.calls.put((method, path, data, done, box))
        if not done.wait(timeout):
            return 504, {"ok": False, "error": "Workbench did not respond"}
        return box.get("code", 500), box.get("payload", {"ok": False, "error": "No response"})

    def pump(self):
        while True:
            try:
                method, path, data, done, box = self.calls.get_nowait()
            except queue.Empty:
                return
            try:
                box["code"], box["payload"] = self.app.handle_bridge(method, path, data)
            except Exception as e:
                box["code"], box["payload"] = 500, {"ok": False, "error": str(e)}
            finally:
                done.set()


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"{APP_NAME} v{APP_VERSION}")
        self.geometry("1240x820")
        self.minsize(1080, 700)

        self.settings = load_settings()
        self.session = None
        self.current_index = 0
        self.loading_item = False

        self.file_var = tk.StringVar()
        self.max_words_var = tk.IntVar(value=self.settings["max_words"])
        self.min_words_var = tk.IntVar(value=self.settings["min_words"])
        self.separator_var = tk.StringVar(value=self.settings["separator"])

        self.skip_front_var = tk.BooleanVar(value=self.settings["skip_front_matter"])
        self.skip_head_var = tk.BooleanVar(value=self.settings["skip_headings"])
        self.skip_caption_var = tk.BooleanVar(value=self.settings["skip_captions"])
        self.skip_refs_var = tk.BooleanVar(value=self.settings["skip_references"])
        self.skip_lists_var = tk.BooleanVar(value=self.settings["skip_lists"])
        self.skip_eq_var = tk.BooleanVar(value=self.settings["skip_equations_objects"])

        self.status_var = tk.StringVar(value="Open a DOCX to begin.")
        self.item_var = tk.StringVar(value="No document loaded")
        self.output_var = tk.StringVar(value="")
        self.filter_var = tk.StringVar(value="All")

        self.bridge_var = tk.StringVar(value="")
        self.bridge_enabled_var = tk.BooleanVar(value=True)

        self._build_ui()
        self.bridge = ExtensionBridge(self)
        if self.bridge.start():
            self.bridge_var.set(f"Extension bridge: listening on http://{BRIDGE_HOST}:{BRIDGE_PORT}")
        else:
            self.bridge_var.set(f"Extension bridge OFF (port {BRIDGE_PORT} busy: {self.bridge.error})")
        self.after(100, self._pump_bridge)
        self.bind("<Control-o>", lambda e: self.choose_file())
        self.bind("<Control-Return>", lambda e: self.replace_and_next())
        self.bind("<Alt-Right>", lambda e: self.next_item())
        self.bind("<Alt-Left>", lambda e: self.prev_item())

    def _build_ui(self):
        root = ttk.Frame(self, padding=10)
        root.pack(fill="both", expand=True)

        top = ttk.Frame(root)
        top.pack(fill="x")
        ttk.Label(top, text=APP_NAME, font=("Segoe UI", 17, "bold")).pack(side="left")
        ttk.Label(
            top,
            text="v4: packs ALL eligible prose up to 1000 words; skipped items no longer break a box",
            font=("Segoe UI", 10)
        ).pack(side="left", padx=12, pady=(5,0))

        filebox = ttk.LabelFrame(root, text="1. Open Word document")
        filebox.pack(fill="x", pady=(8,5))
        fr = ttk.Frame(filebox, padding=8)
        fr.pack(fill="x")
        ttk.Entry(fr, textvariable=self.file_var).pack(side="left", fill="x", expand=True)
        ttk.Button(fr, text="Browse DOCX", command=self.choose_file).pack(side="left", padx=(8,0))
        ttk.Button(fr, text="Load / Scan", command=self.load_document).pack(side="left", padx=(8,0))

        opts = ttk.LabelFrame(root, text="Queue rules")
        opts.pack(fill="x", pady=5)
        og = ttk.Frame(opts, padding=8)
        og.pack(fill="x")

        ttk.Label(og, text="Maximum words per merged box:").grid(row=0,column=0,sticky="w")
        ttk.Spinbox(og, from_=100, to=1000, increment=25, width=8, textvariable=self.max_words_var).grid(row=0,column=1,sticky="w",padx=(5,20))
        ttk.Label(og, text="Minimum prose words:").grid(row=0,column=2,sticky="w")
        ttk.Spinbox(og, from_=1, to=50, width=8, textvariable=self.min_words_var).grid(row=0,column=3,sticky="w",padx=(5,20))
        ttk.Label(og, text="Paragraph separator:").grid(row=0,column=4,sticky="w")
        ttk.Entry(og, textvariable=self.separator_var, width=28).grid(row=0,column=5,sticky="w",padx=(5,0))

        ttk.Checkbutton(og, text="Skip title/authors/front matter", variable=self.skip_front_var).grid(row=1,column=0,columnspan=2,sticky="w",pady=3)
        ttk.Checkbutton(og, text="Skip section headings/subheadings", variable=self.skip_head_var).grid(row=1,column=2,columnspan=2,sticky="w",pady=3)
        ttk.Checkbutton(og, text="Skip figure/table captions", variable=self.skip_caption_var).grid(row=1,column=4,columnspan=2,sticky="w",pady=3)
        ttk.Checkbutton(og, text="Skip References/Bibliography", variable=self.skip_refs_var).grid(row=2,column=0,columnspan=2,sticky="w",pady=3)
        ttk.Checkbutton(og, text="Skip numbered/bulleted lists", variable=self.skip_lists_var).grid(row=2,column=2,columnspan=2,sticky="w",pady=3)
        ttk.Checkbutton(og, text="Skip equations/images/objects", variable=self.skip_eq_var).grid(row=2,column=4,columnspan=2,sticky="w",pady=3)

        note = (
            "Consecutive normal paragraphs are added greedily: keep adding the next eligible paragraph while the total stays at or below the limit. "
            "Headings, captions, equations, tables/objects, lists, and References create HARD boundaries, so they are never merged across."
        )
        ttk.Label(opts, text=note, wraplength=1180).pack(anchor="w", padx=10, pady=(0,8))

        main = ttk.Frame(root)
        main.pack(fill="both", expand=True, pady=5)

        nav = ttk.LabelFrame(main, text="Queue")
        nav.pack(side="left", fill="y", padx=(0,8))
        nav_top = ttk.Frame(nav, padding=(6,6,6,2))
        nav_top.pack(fill="x")
        ttk.Label(nav_top, text="Show:").pack(side="left")
        cb = ttk.Combobox(
            nav_top, textvariable=self.filter_var,
            values=["All", "Pending", "Replaced", "Skipped"],
            state="readonly", width=10
        )
        cb.pack(side="left", padx=5)
        cb.bind("<<ComboboxSelected>>", lambda e: self.refresh_list())

        self.listbox = tk.Listbox(nav, width=31, exportselection=False)
        self.listbox.pack(fill="both", expand=True, padx=6, pady=6)
        self.listbox.bind("<<ListboxSelect>>", self.on_list_select)
        self.visible_indices = []

        workspace = ttk.Frame(main)
        workspace.pack(side="left", fill="both", expand=True)

        hdr = ttk.Frame(workspace)
        hdr.pack(fill="x", pady=(0,5))
        ttk.Label(hdr, textvariable=self.item_var, font=("Segoe UI", 11, "bold")).pack(side="left")
        ttk.Label(hdr, textvariable=self.status_var).pack(side="right")

        cols = ttk.Frame(workspace)
        cols.pack(fill="both", expand=True)
        cols.columnconfigure(0, weight=1)
        cols.columnconfigure(1, weight=1)
        cols.rowconfigure(1, weight=1)

        ttk.Label(cols, text="ORIGINAL MERGED TEXT", font=("Segoe UI", 10, "bold")).grid(row=0,column=0,sticky="w",padx=(0,4))
        ttk.Label(cols, text="PASTE REPHRASED MERGED TEXT HERE", font=("Segoe UI", 10, "bold")).grid(row=0,column=1,sticky="w",padx=(4,0))

        self.original_box = tk.Text(cols, wrap="word", font=("Segoe UI", 11), undo=False)
        self.original_box.grid(row=1,column=0,sticky="nsew",padx=(0,4))
        self.original_box.configure(state="disabled")

        self.rephrase_box = tk.Text(cols, wrap="word", font=("Segoe UI", 11), undo=True)
        self.rephrase_box.grid(row=1,column=1,sticky="nsew",padx=(4,0))

        btns = ttk.Frame(workspace)
        btns.pack(fill="x", pady=(7,0))

        ttk.Button(btns, text="◀ Previous", command=self.prev_item).pack(side="left")
        ttk.Button(btns, text="Next ▶", command=self.next_item).pack(side="left", padx=5)
        ttk.Separator(btns, orient="vertical").pack(side="left", fill="y", padx=8)
        ttk.Button(btns, text="Copy Original", command=self.copy_original).pack(side="left", padx=3)
        ttk.Button(btns, text="Paste Clipboard →", command=self.paste_clipboard).pack(side="left", padx=3)
        ttk.Button(btns, text="Clear Right", command=self.clear_right).pack(side="left", padx=3)
        ttk.Button(btns, text="Replace", command=self.replace_current).pack(side="right", padx=3)
        ttk.Button(btns, text="Replace && Next", command=self.replace_and_next).pack(side="right", padx=3)
        ttk.Button(btns, text="Skip", command=self.skip_current).pack(side="right", padx=3)

        bottom = ttk.Frame(root)
        bottom.pack(fill="x", pady=(4,0))
        ttk.Label(bottom, textvariable=self.output_var, foreground="#444").pack(side="left", fill="x", expand=True)
        ttk.Checkbutton(bottom, text="Allow StealthWriter extension", variable=self.bridge_enabled_var).pack(side="right", padx=(8,0))
        ttk.Label(bottom, textvariable=self.bridge_var, foreground="#2a6").pack(side="right", padx=(8,0))
        ttk.Button(bottom, text="Open Output Folder", command=self.open_output_folder).pack(side="right", padx=(8,0))
        ttk.Button(bottom, text="Open Output DOCX", command=self.open_output_docx).pack(side="right", padx=(8,0))

    def collect_settings(self):
        sep = self.separator_var.get().strip()
        if not sep:
            sep = "<<<PARAGRAPH_BREAK>>>"
            self.separator_var.set(sep)
        s = {
            "max_words": min(1000, max(100, int(self.max_words_var.get()))),
            "min_words": max(1, int(self.min_words_var.get())),
            "skip_front_matter": bool(self.skip_front_var.get()),
            "skip_headings": bool(self.skip_head_var.get()),
            "skip_captions": bool(self.skip_caption_var.get()),
            "skip_references": bool(self.skip_refs_var.get()),
            "skip_lists": bool(self.skip_lists_var.get()),
            "skip_equations_objects": bool(self.skip_eq_var.get()),
            "separator": sep,
        }
        self.settings = s
        save_settings(s)
        return s

    def choose_file(self):
        p = filedialog.askopenfilename(
            title="Choose Word document",
            filetypes=[("Word documents", "*.docx")]
        )
        if p:
            self.file_var.set(p)

    def load_document(self):
        path = self.file_var.get().strip()
        if not path or not Path(path).exists():
            messagebox.showerror(APP_NAME, "Choose a valid .docx file first.")
            return

        try:
            self.session = DocxSession(path, self.collect_settings())
        except Exception as e:
            self.show_error(e)
            return

        if not self.session.chunks:
            messagebox.showwarning(APP_NAME, "No ordinary prose paragraphs were found with the current filters.")
            return

        self.current_index = 0
        st = self.session.stats
        self.output_var.set(f"Auto-saving output: {self.session.output_path}")
        self.refresh_list()
        self.show_chunk(0)

        messagebox.showinfo(
            APP_NAME,
            "Document grouped successfully.\n\n"
            f"Eligible prose paragraphs: {st['eligible_paragraphs']}\n"
            f"Merged queue boxes: {st['chunks']}\n"
            f"Maximum allowed: {self.settings['max_words']} words\n\n"
            "A separator is inserted between paragraphs. Keep the same separator in the rephrased text "
            "so each paragraph can be put back into its original Word position."
        )

    def chunk_label(self, idx):
        c = self.session.chunks[idx]
        icon = {"pending": "○", "replaced": "✓", "skipped": "—"}[c.status]
        preview = c.paragraphs[0].text[:33].replace("\n", " ")
        if len(c.paragraphs[0].text) > 33:
            preview += "…"
        return f"{icon} {c.item_no:03d} · {c.total_words}w · {len(c.paragraphs)}p  {preview}"

    def refresh_list(self):
        if not self.session:
            return
        filt = self.filter_var.get().lower()
        self.listbox.delete(0, tk.END)
        self.visible_indices = []

        for idx, c in enumerate(self.session.chunks):
            if filt != "all" and c.status != filt:
                continue
            self.visible_indices.append(idx)
            self.listbox.insert(tk.END, self.chunk_label(idx))

        if self.current_index in self.visible_indices:
            pos = self.visible_indices.index(self.current_index)
            self.listbox.selection_clear(0, tk.END)
            self.listbox.selection_set(pos)
            self.listbox.see(pos)

    def on_list_select(self, event=None):
        if self.loading_item:
            return
        sel = self.listbox.curselection()
        if not sel:
            return
        self.show_chunk(self.visible_indices[sel[0]])

    def show_chunk(self, idx):
        if not self.session or not (0 <= idx < len(self.session.chunks)):
            return

        self.current_index = idx
        c = self.session.chunks[idx]

        self.loading_item = True
        try:
            original = self.session.chunk_display_text(c)

            self.original_box.configure(state="normal")
            self.original_box.delete("1.0", tk.END)
            self.original_box.insert("1.0", original)
            self.original_box.configure(state="disabled")

            self.rephrase_box.delete("1.0", tk.END)
            if c.status == "replaced":
                sep = self.session.settings["separator"]
                self.rephrase_box.insert(
                    "1.0",
                    f"\n\n{sep}\n\n".join(c.replacement_parts)
                )

            warn = " ⚠ over target" if c.total_words > self.settings["max_words"] else ""
            self.item_var.set(
                f"Item {c.item_no}/{len(self.session.chunks)} · {c.total_words} words · "
                f"{len(c.paragraphs)} paragraphs · status: {c.status.upper()}{warn}"
            )

            r, s, p = self.session.completion()
            self.status_var.set(f"Replaced {r} · Skipped {s} · Pending {p}")
            self.refresh_list()
        finally:
            self.loading_item = False

    def copy_original(self):
        if not self.session:
            return
        text = self.session.chunk_display_text(self.session.chunks[self.current_index])
        self.clipboard_clear()
        self.clipboard_append(text)
        self.update()
        self.status_var.set("Merged original text copied to clipboard.")

    def paste_clipboard(self):
        try:
            text = self.clipboard_get()
        except Exception:
            messagebox.showwarning(APP_NAME, "Clipboard does not contain text.")
            return
        self.rephrase_box.delete("1.0", tk.END)
        self.rephrase_box.insert("1.0", text)

    def clear_right(self):
        self.rephrase_box.delete("1.0", tk.END)

    def replace_current(self):
        if not self.session:
            return False

        replacement = self.rephrase_box.get("1.0", "end-1c").strip()
        if not replacement:
            messagebox.showwarning(APP_NAME, "Paste/type the rephrased text in the right box first.")
            return False

        try:
            self.session.save_replacement(self.current_index, replacement)
        except Exception as e:
            self.show_error(e)
            return False

        self.show_chunk(self.current_index)
        self.status_var.set("Replaced all paragraphs in this merged box and saved the DOCX.")
        return True

    def replace_and_next(self):
        if self.replace_current():
            self.next_item(prefer_pending=True)

    def skip_current(self):
        if not self.session:
            return
        self.session.mark_skipped(self.current_index)
        self.show_chunk(self.current_index)
        self.next_item(prefer_pending=True)

    def next_item(self, prefer_pending=False):
        if not self.session:
            return
        start = self.current_index + 1
        if prefer_pending:
            for i in range(start, len(self.session.chunks)):
                if self.session.chunks[i].status == "pending":
                    self.show_chunk(i)
                    return
        if start < len(self.session.chunks):
            self.show_chunk(start)

    def prev_item(self):
        if self.session and self.current_index > 0:
            self.show_chunk(self.current_index - 1)

    def open_output_folder(self):
        if self.session:
            os.startfile(str(self.session.output_path.parent))

    def open_output_docx(self):
        if self.session:
            os.startfile(str(self.session.output_path))

    # ------------------------------------------------------------------
    # Chrome extension bridge (runs on the Tk thread via _pump_bridge)
    # ------------------------------------------------------------------
    def _pump_bridge(self):
        try:
            self.bridge.pump()
        finally:
            self.after(100, self._pump_bridge)

    def _bridge_status(self):
        if not self.session:
            return {"ok": True, "loaded": False, "enabled": bool(self.bridge_enabled_var.get())}
        r, s, p = self.session.completion()
        return {
            "ok": True,
            "loaded": True,
            "enabled": bool(self.bridge_enabled_var.get()),
            "file": self.session.source_path.name,
            "output": str(self.session.output_path),
            "total": len(self.session.chunks),
            "replaced": r,
            "skipped": s,
            "pending": p,
            "current": self.current_index,
        }

    def _bridge_chunk(self, idx):
        c = self.session.chunks[idx]
        return {
            "index": idx,
            "session": self.session.output_path.name,
            "item_no": c.item_no,
            "total_words": c.total_words,
            "paragraphs": [p.text for p in c.paragraphs],
        }

    def _bridge_index(self, data):
        try:
            idx = int(data.get("index"))
        except Exception:
            raise ValueError("Missing chunk index")
        if not self.session or not (0 <= idx < len(self.session.chunks)):
            raise ValueError("Chunk index out of range")
        if data.get("session") and data["session"] != self.session.output_path.name:
            raise ValueError("A different document is now loaded in the workbench.")
        return idx

    def handle_bridge(self, method, path, data):
        if path == "/api/status" and method == "GET":
            return 200, self._bridge_status()

        if not self.bridge_enabled_var.get():
            return 423, {"ok": False, "error": "Extension access is disabled in the workbench."}
        if not self.session:
            return 409, {"ok": False, "error": "No document loaded in the workbench."}

        if path == "/api/next" and method == "GET":
            order = list(range(self.current_index, len(self.session.chunks))) + list(range(0, self.current_index))
            for i in order:
                if self.session.chunks[i].status == "pending":
                    self.show_chunk(i)
                    return 200, {"ok": True, "done": False, "chunk": self._bridge_chunk(i), "status": self._bridge_status()}
            return 200, {"ok": True, "done": True, "status": self._bridge_status()}

        if path == "/api/result" and method == "POST":
            try:
                idx = self._bridge_index(data)
            except ValueError as e:
                return 409, {"ok": False, "error": str(e)}
            parts = data.get("parts")
            if not isinstance(parts, list) or not all(isinstance(x, str) for x in parts):
                return 400, {"ok": False, "error": "parts must be a list of strings"}
            try:
                self.session.save_replacement_parts(idx, parts)
            except ValueError as e:
                return 422, {"ok": False, "error": str(e)}
            self.show_chunk(idx)
            self.status_var.set(f"Item {self.session.chunks[idx].item_no} replaced by StealthWriter extension.")
            return 200, {"ok": True, "status": self._bridge_status()}

        if path == "/api/skip" and method == "POST":
            try:
                idx = self._bridge_index(data)
            except ValueError as e:
                return 409, {"ok": False, "error": str(e)}
            self.session.mark_skipped(idx)
            self.show_chunk(idx)
            reason = str(data.get("reason") or "")[:200]
            self.status_var.set(f"Item {self.session.chunks[idx].item_no} skipped by extension. {reason}")
            return 200, {"ok": True, "status": self._bridge_status()}

        return 404, {"ok": False, "error": "Unknown endpoint"}

    def show_error(self, exc):
        msg = "".join(traceback.format_exception_only(type(exc), exc)).strip()
        messagebox.showerror(APP_NAME, msg)


if __name__ == "__main__":
    App().mainloop()
