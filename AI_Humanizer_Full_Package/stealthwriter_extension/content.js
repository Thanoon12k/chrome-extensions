// StealthWriter Auto Bridge — content script.
// Pulls chunks from the local DOCX workbench, types them into StealthWriter,
// clicks "Humanize", waits for the output and sends it back.
(() => {
  if (window.__swbLoaded) return;
  window.__swbLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let running = false;
  let picking = null;
  let ui = null;
  const logLines = [];

  // ------------------------------------------------------------------
  // Bridge (through the background service worker)
  // ------------------------------------------------------------------
  function bridge(method, path, body) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "bridge", method, path, body }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { ok: false, error: "No response from extension" });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: "Extension was reloaded — refresh this page." });
      }
    });
  }

  // ------------------------------------------------------------------
  // DOM helpers
  // ------------------------------------------------------------------
  function isOurs(el) {
    return !!(el && el.closest && el.closest("#swb-host"));
  }

  function isVisible(el) {
    if (!el || isOurs(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  }

  function isTextField(el) {
    return el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT");
  }

  function readText(el) {
    if (!el) return "";
    return isTextField(el) ? el.value || "" : el.innerText || "";
  }

  function querySafe(sel) {
    if (!sel) return null;
    try {
      return document.querySelector(sel);
    } catch (e) {
      return null;
    }
  }

  function editables() {
    const nodes = document.querySelectorAll(
      'textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'
    );
    return [...nodes].filter((el) => {
      if (!isVisible(el)) return false;
      if (el.disabled || el.readOnly) return false;
      // skip nested editables (keep the outermost editor root)
      if (el.parentElement && el.parentElement.closest('[contenteditable="true"], [contenteditable=""]')) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 150 && r.height >= 60;
    });
  }

  function findInput(settings) {
    const configured = querySafe(settings.inputSelector);
    if (configured) return configured;
    const list = editables();
    list.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      // top-most first, then left-most (input is normally left / above output)
      if (Math.abs(ra.top - rb.top) > 40) return ra.top - rb.top;
      return ra.left - rb.left;
    });
    return list[0] || null;
  }

  function findButton(settings) {
    const configured = querySafe(settings.buttonSelector);
    if (configured) return configured;
    let re;
    try {
      re = new RegExp(settings.buttonText || SWB_DEFAULTS.buttonText, "i");
    } catch (e) {
      re = new RegExp(SWB_DEFAULTS.buttonText, "i");
    }
    const buttons = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')]
      .filter((b) => isVisible(b))
      .map((b) => ({ b, t: (b.innerText || b.value || b.getAttribute("aria-label") || "").trim() }))
      .filter((x) => x.t && x.t.length < 40 && re.test(x.t));
    buttons.sort((x, y) => x.t.length - y.t.length);
    return buttons.length ? buttons[0].b : null;
  }

  function isDisabled(btn) {
    return !!(btn.disabled || btn.getAttribute("aria-disabled") === "true");
  }

  async function setInputText(el, text) {
    el.focus();
    if (isTextField(el)) {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    // contenteditable (ProseMirror / Tiptap / Quill / Lexical …)
    const selectAll = () => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };
    const probe = text.slice(0, 40).replace(/\s+/g, " ");
    const landed = () => readText(el).replace(/\s+/g, " ").includes(probe);

    selectAll();
    document.execCommand("delete");
    await sleep(100);

    // 1) simulated paste — best at keeping paragraph breaks
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (e) {
      /* ignore */
    }
    await sleep(300);
    if (landed()) return;

    // 2) insertText
    selectAll();
    document.execCommand("insertText", false, text);
    await sleep(300);
    if (landed()) return;

    // 3) brute force
    el.innerText = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  // Candidate elements that might hold the humanized output.
  function outputCandidates(settings, inputEl) {
    const configured = querySafe(settings.outputSelector);
    if (configured) return [configured];
    const out = [];
    const all = document.body.querySelectorAll("textarea, [contenteditable], div, section, article, p, pre");
    for (const el of all) {
      if (el === inputEl || isOurs(el)) continue;
      if (inputEl && (el.contains(inputEl) || inputEl.contains(el))) continue;
      if (!isVisible(el)) continue;
      out.push(el);
    }
    return out;
  }

  function snapshot(settings, inputEl) {
    const map = new Map();
    for (const el of outputCandidates(settings, inputEl)) map.set(el, readText(el).trim());
    return map;
  }

  function depth(el) {
    let d = 0;
    while (el && el.parentElement) {
      d++;
      el = el.parentElement;
    }
    return d;
  }

  // Pick the changed element whose text length best matches the input length.
  function pickOutput(settings, inputEl, baseline, sentText) {
    const configured = querySafe(settings.outputSelector);
    if (configured) return configured;
    const inLen = sentText.length;
    const probe = sentText.slice(0, 60);
    let best = null;
    let bestScore = Infinity;
    for (const el of outputCandidates(settings, inputEl)) {
      const t = readText(el).trim();
      if (!t || t === (baseline.get(el) || "")) continue;
      if (t.includes(probe)) continue; // an echo of the input, not a rewrite
      const ratio = t.length / inLen;
      if (ratio < 0.35 || ratio > 3) continue;
      const score = Math.abs(Math.log(ratio)) - depth(el) * 0.001; // tie-break: deepest
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------
  // One StealthWriter round-trip
  // ------------------------------------------------------------------
  async function humanizeText(text, settings) {
    const input = findInput(settings);
    if (!input) throw new Error("Input box not found. Use “Pick input” on the panel.");

    const outputBefore = querySafe(settings.outputSelector);
    const beforeConfigured = outputBefore ? readText(outputBefore).trim() : null;
    const baseline = snapshot(settings, input);

    await setInputText(input, text);
    await sleep(900);
    const typed = readText(input).trim();
    if (typed.length < text.trim().length * 0.8) {
      throw new Error("Could not put the text into StealthWriter's input box. Try “Pick input”.");
    }

    // wait for the Humanize button to be enabled
    let btn = null;
    for (let i = 0; i < 40 && running; i++) {
      btn = findButton(settings);
      if (btn && !isDisabled(btn)) break;
      await sleep(250);
    }
    if (!btn) throw new Error("Humanize button not found. Use “Pick button” on the panel.");
    if (isDisabled(btn)) throw new Error("Humanize button stays disabled (word limit or credits?).");
    btn.click();
    setStatus("Waiting for StealthWriter…");

    const start = Date.now();
    const stableMs = Math.max(1, settings.stableSeconds) * 1000;
    let last = null;
    let lastChange = Date.now();
    while (Date.now() - start < settings.timeoutSeconds * 1000) {
      if (!running) throw new Error("Stopped");
      await sleep(700);
      const el = pickOutput(settings, input, baseline, text);
      let t = el ? readText(el).trim() : "";
      if (beforeConfigured !== null && t === beforeConfigured) t = "";
      if (t !== last) {
        last = t;
        lastChange = Date.now();
        continue;
      }
      const b = findButton(settings);
      const busy = b && (b.getAttribute("aria-busy") === "true" || /\b\w+ing\b/i.test((b.innerText || "").trim()));
      if (t && !busy && Date.now() - lastChange >= stableMs) return t;
    }
    throw new Error(`No output after ${settings.timeoutSeconds}s (limit reached, logged out, or output box not detected — try “Pick output”).`);
  }

  function splitParts(text, expected) {
    const clean = (arr) => arr.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (expected === 1) return [text.replace(/\s+/g, " ").trim()];
    const byBlank = clean(text.split(/\n\s*\n/));
    if (byBlank.length === expected) return byBlank;
    const byLine = clean(text.split(/\n/));
    if (byLine.length === expected) return byLine;
    return null;
  }

  async function humanizeChunk(paragraphs, settings) {
    const joined = paragraphs.join("\n\n");
    const out = await humanizeText(joined, settings);
    const parts = splitParts(out, paragraphs.length);
    if (parts) return { parts };

    if (settings.mismatch !== "per-paragraph") {
      return { mismatch: true, got: out };
    }
    log(`Paragraph count changed — redoing ${paragraphs.length} paragraphs one by one.`);
    const res = [];
    for (let i = 0; i < paragraphs.length; i++) {
      if (!running) throw new Error("Stopped");
      setStatus(`Paragraph ${i + 1}/${paragraphs.length}…`);
      const t = await humanizeText(paragraphs[i], settings);
      res.push(t.replace(/\s+/g, " ").trim());
      await sleep(Math.max(1, settings.delaySeconds) * 1000);
    }
    return { parts: res };
  }

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------
  async function runLoop() {
    let errors = 0;
    while (running) {
      const settings = await swbGetSettings();
      setStatus("Asking workbench for the next chunk…");
      const next = await bridge("GET", "/api/next");
      if (!next.ok) {
        log(next.error || "Workbench error");
        return stop(next.error || "Workbench error");
      }
      if (next.done) {
        showProgress(next.status);
        log("All chunks are done.");
        return stop("✓ All chunks done — check the output DOCX.");
      }
      const chunk = next.chunk;
      showProgress(next.status);
      setStatus(`Item ${chunk.item_no}: ${chunk.total_words} words, ${chunk.paragraphs.length} paragraph(s)…`);

      try {
        const r = await humanizeChunk(chunk.paragraphs, settings);
        if (!running) break;
        let res;
        if (r.mismatch) {
          if (settings.mismatch === "skip") {
            log(`Item ${chunk.item_no}: paragraph count changed — skipped.`);
            res = await bridge("POST", "/api/skip", {
              index: chunk.index,
              session: chunk.session,
              reason: "paragraph count mismatch"
            });
          } else {
            log(`Item ${chunk.item_no}: paragraph count changed — stopped for manual fix.`);
            return stop("Paragraph count changed. Fix this item manually in the workbench.");
          }
        } else {
          res = await bridge("POST", "/api/result", { index: chunk.index, session: chunk.session, parts: r.parts });
          if (res.ok) log(`Item ${chunk.item_no}: replaced ✓`);
        }
        if (!res.ok) throw new Error(res.error || "Workbench rejected the result");
        showProgress(res.status);
        errors = 0;
      } catch (e) {
        if (!running) break;
        errors++;
        log(`Item ${chunk.item_no}: ${e.message}`);
        if (errors >= settings.maxErrors) return stop(`Stopped after ${errors} errors: ${e.message}`);
      }

      for (let s = Math.max(1, settings.delaySeconds); s > 0 && running; s--) {
        setStatus(`Next chunk in ${s}s…`);
        await sleep(1000);
      }
    }
  }

  async function start() {
    if (running) return;
    running = true;
    await chrome.storage.session.set({ swbRunning: true }).catch(() => {});
    renderButtons();
    log("Started.");
    runLoop().catch((e) => stop(e.message));
  }

  async function stop(message) {
    running = false;
    await chrome.storage.session.set({ swbRunning: false }).catch(() => {});
    setStatus(message || "Stopped.");
    renderButtons();
  }

  // ------------------------------------------------------------------
  // Element picker
  // ------------------------------------------------------------------
  function cssPath(el) {
    const unique = (sel) => {
      try {
        const m = document.querySelectorAll(sel);
        return m.length === 1 && m[0] === el;
      } catch (e) {
        return false;
      }
    };
    if (el.id && !/\d{3,}|:/.test(el.id) && unique(`#${CSS.escape(el.id)}`)) return `#${CSS.escape(el.id)}`;
    for (const attr of ["data-testid", "data-test", "name", "placeholder", "aria-label"]) {
      const v = el.getAttribute(attr);
      if (v) {
        const sel = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(v)}"]`;
        if (unique(sel)) return sel;
      }
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let part = node.tagName.toLowerCase();
      if (node.id && !/\d{3,}|:/.test(node.id)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }

  let hoverBox = null;
  function startPick(role) {
    picking = role;
    setStatus(`Click the StealthWriter ${role} element (Esc to cancel)…`);
    if (!hoverBox) {
      hoverBox = document.createElement("div");
      hoverBox.id = "swb-host-hover";
      Object.assign(hoverBox.style, {
        position: "fixed",
        pointerEvents: "none",
        border: "2px solid #7c3aed",
        background: "rgba(124,58,237,.12)",
        zIndex: 2147483646,
        borderRadius: "4px"
      });
    }
    document.documentElement.appendChild(hoverBox);
    document.addEventListener("mousemove", onPickMove, true);
    document.addEventListener("click", onPickClick, true);
    document.addEventListener("keydown", onPickKey, true);
  }

  function endPick() {
    picking = null;
    hoverBox && hoverBox.remove();
    document.removeEventListener("mousemove", onPickMove, true);
    document.removeEventListener("click", onPickClick, true);
    document.removeEventListener("keydown", onPickKey, true);
  }

  function onPickMove(e) {
    const el = e.target;
    if (isOurs(el)) return;
    const r = el.getBoundingClientRect();
    Object.assign(hoverBox.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  }

  async function onPickClick(e) {
    if (isOurs(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    let el = e.target;
    if (picking === "button") el = el.closest('button, [role="button"], input[type="submit"]') || el;
    if (picking === "input") el = el.closest('textarea, [contenteditable="true"], [contenteditable=""]') || el;
    const role = picking;
    const sel = cssPath(el);
    endPick();
    await chrome.storage.sync.set({ [`${role}Selector`]: sel });
    setStatus(`Saved ${role}: ${sel}`);
    log(`${role} selector = ${sel}`);
  }

  function onPickKey(e) {
    if (e.key === "Escape") {
      endPick();
      setStatus("Pick cancelled.");
    }
  }

  // ------------------------------------------------------------------
  // Detection report (popup "Test detection")
  // ------------------------------------------------------------------
  async function detect() {
    const settings = await swbGetSettings();
    const input = findInput(settings);
    const btn = findButton(settings);
    const out = querySafe(settings.outputSelector);
    const flash = (el, color) => {
      if (!el) return;
      const old = el.style.outline;
      el.style.outline = `3px solid ${color}`;
      setTimeout(() => (el.style.outline = old), 2500);
    };
    flash(input, "#16a34a");
    flash(btn, "#2563eb");
    flash(out, "#d97706");
    return {
      input: input ? `${input.tagName.toLowerCase()} (${cssPath(input)})` : null,
      button: btn ? `"${(btn.innerText || "").trim()}"` : null,
      output: out ? cssPath(out) : settings.outputSelector ? "selector not found" : "auto-detect after click"
    };
  }

  // ------------------------------------------------------------------
  // Floating panel
  // ------------------------------------------------------------------
  function buildPanel() {
    const host = document.createElement("div");
    host.id = "swb-host";
    Object.assign(host.style, { position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483647 });
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .p { font: 13px/1.4 system-ui, sans-serif; width: 300px; background: #111827; color: #f9fafb;
             border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.35); overflow: hidden; }
        .h { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px;
             background: #7c3aed; font-weight: 600; cursor: pointer; user-select: none; }
        .b { padding: 10px 12px; }
        .st { min-height: 18px; margin-bottom: 6px; }
        .pr { font-size: 12px; color: #c4b5fd; margin-bottom: 8px; }
        .bar { height: 5px; background: #374151; border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
        .bar i { display: block; height: 100%; width: 0; background: #22c55e; transition: width .3s; }
        .row { display: flex; gap: 6px; margin-bottom: 6px; }
        button { flex: 1; font: 600 12px system-ui, sans-serif; border: 0; border-radius: 7px; padding: 7px 6px;
                 cursor: pointer; background: #374151; color: #f9fafb; }
        button:hover { filter: brightness(1.15); }
        .go { background: #16a34a; } .stop { background: #dc2626; }
        .log { max-height: 110px; overflow: auto; font: 11px/1.35 ui-monospace, monospace; color: #9ca3af;
               background: #0b1220; border-radius: 6px; padding: 6px; white-space: pre-wrap; }
        .min .b { display: none; }
      </style>
      <div class="p">
        <div class="h"><span>StealthWriter Auto Bridge</span><span class="tg">–</span></div>
        <div class="b">
          <div class="st">Idle. Load a DOCX in the workbench, then press Start.</div>
          <div class="pr"></div>
          <div class="bar"><i></i></div>
          <div class="row"><button class="go">▶ Start</button><button class="stop">■ Stop</button></div>
          <div class="row"><button data-pick="input">Pick input</button><button data-pick="button">Pick button</button><button data-pick="output">Pick output</button></div>
          <div class="log"></div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);
    const $ = (s) => root.querySelector(s);
    const panel = $(".p");
    $(".h").addEventListener("click", () => {
      panel.classList.toggle("min");
      $(".tg").textContent = panel.classList.contains("min") ? "+" : "–";
    });
    $(".go").addEventListener("click", start);
    $(".stop").addEventListener("click", () => stop("Stopped by you."));
    root.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => startPick(b.dataset.pick)));
    return { root, $ };
  }

  function setStatus(t) {
    if (ui) ui.$(".st").textContent = t;
  }

  function showProgress(st) {
    if (!ui || !st || !st.loaded) return;
    const done = st.replaced + st.skipped;
    ui.$(".pr").textContent = `${st.file} — ${st.replaced} replaced · ${st.skipped} skipped · ${st.pending} pending`;
    ui.$(".bar i").style.width = st.total ? `${Math.round((done / st.total) * 100)}%` : "0";
  }

  function log(t) {
    const line = `${new Date().toLocaleTimeString()}  ${t}`;
    logLines.push(line);
    if (logLines.length > 200) logLines.shift();
    if (ui) {
      const box = ui.$(".log");
      box.textContent = logLines.slice(-50).join("\n");
      box.scrollTop = box.scrollHeight;
    }
  }

  function renderButtons() {
    if (!ui) return;
    ui.$(".go").disabled = running;
    ui.$(".go").style.opacity = running ? ".5" : "1";
  }

  // ------------------------------------------------------------------
  // Messages from the popup
  // ------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("swb-")) return false;
    (async () => {
      switch (msg.type) {
        case "swb-start":
          await start();
          return { ok: true };
        case "swb-stop":
          await stop("Stopped from popup.");
          return { ok: true };
        case "swb-pick":
          startPick(msg.role);
          return { ok: true };
        case "swb-detect":
          return { ok: true, report: await detect() };
        case "swb-state":
          return { ok: true, running, log: logLines.slice(-20) };
        default:
          return { ok: false };
      }
    })().then(sendResponse);
    return true;
  });

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  ui = buildPanel();
  renderButtons();
  bridge("GET", "/api/status").then((st) => {
    if (!st.ok) setStatus(st.error || "Workbench not reachable.");
    else if (!st.loaded) setStatus("Workbench connected — load a DOCX there.");
    else {
      showProgress(st);
      setStatus("Workbench connected. Press Start.");
    }
  });
  // resume after a page reload/navigation inside StealthWriter
  chrome.storage.session
    .get({ swbRunning: false })
    .then(({ swbRunning }) => {
      if (swbRunning) {
        log("Resuming after page reload…");
        setTimeout(start, 3000);
      }
    })
    .catch(() => {});
})();
