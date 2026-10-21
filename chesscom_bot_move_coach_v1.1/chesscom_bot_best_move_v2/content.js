(() => {
  "use strict";

  // Hard safety boundary: this build deliberately runs only on Chess.com bot/computer routes.
  const isAllowedBotRoute = () => {
    const p = location.pathname;
    return p === "/play/computer"
     || p.startsWith("/play/computer/")
      || p.startsWith("/game/computer/")
      || p.startsWith("/game/")
      || p.startsWith("/play/online/");
 
 
 
 
  };
  if (!isAllowedBotRoute()) return;
  if (window.__CHESS_BOT_TRAINER_LOADED__) return;
  window.__CHESS_BOT_TRAINER_LOADED__ = true;

  const PIECES = {
    wp: "P", wn: "N", wb: "B", wr: "R", wq: "Q", wk: "K",
    bp: "p", bn: "n", bb: "b", br: "r", bq: "q", bk: "k"
  };

  const START_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  const state = {
    board: null,
    lastMap: null,
    turn: "w",
    castling: "KQkq",
    ep: "-",
    fullmove: 1,
    initializedAtStart: false,
    lastFen: "",
    analyzingFen: "",
    bestMove: "",
    depth: 12,
    auto: true,
    requestSeq: 0,
    timer: null,
    observer: null,
    panel: null,
    overlay: null,
    panelVisible: true
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function findBoard() {
    const candidates = $$('wc-chess-board, [data-board="main"], .board');
    return candidates.find(el => el && el.querySelector && el.querySelector('.piece')) || null;
  }

  function getPieceMap(board) {
    const map = new Map();
    for (const el of $$('.piece', board)) {
      const classes = Array.from(el.classList || []);
      const pc = classes.find(c => PIECES[c]);
      const sq = classes.find(c => /^square-[1-8][1-8]$/.test(c));
      if (!pc || !sq) continue;
      const m = sq.match(/^square-([1-8])([1-8])$/);
      if (!m) continue;
      const square = String.fromCharCode(96 + Number(m[1])) + m[2];
      map.set(square, PIECES[pc]);
    }
    return map;
  }

  function placementFromMap(map) {
    const rows = [];
    for (let rank = 8; rank >= 1; rank--) {
      let row = "";
      let empty = 0;
      for (let file = 1; file <= 8; file++) {
        const sq = String.fromCharCode(96 + file) + rank;
        const piece = map.get(sq);
        if (!piece) {
          empty++;
        } else {
          if (empty) { row += empty; empty = 0; }
          row += piece;
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join("/");
  }

  function playerColor() {
    if (!state.board) return "w";
    return state.board.classList.contains("flipped") ? "b" : "w";
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function detectTurnFromClock() {
    let clocks = $$('.clock-component').filter(visible);
    if (clocks.length < 2) {
      clocks = $$('.clock-time-monospace[role="timer"], .clock-time-monospace').filter(visible)
        .map(el => el.closest('.clock-component') || el);
      clocks = Array.from(new Set(clocks));
    }
    if (clocks.length < 2) return null;
    clocks.sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const top = clocks[0], bottom = clocks[clocks.length - 1];
    const active = clocks.find(el => el.classList.contains('clock-player-turn') || el.classList.contains('is-active') || el.closest('.clock-player-turn'));
    if (!active) return null;
    const bottomColor = playerColor();
    return active === bottom || bottom.contains(active) ? bottomColor : (bottomColor === "w" ? "b" : "w");
  }

  function diffMove(oldMap, newMap) {
    if (!oldMap) return null;
    const changed = [];
    const all = new Set([...oldMap.keys(), ...newMap.keys()]);
    for (const sq of all) {
      const a = oldMap.get(sq) || null;
      const b = newMap.get(sq) || null;
      if (a !== b) changed.push({ sq, before: a, after: b });
    }
    if (changed.length < 2 || changed.length > 5) return null;

    // Normal move/capture/promotion: find a piece that disappeared and a same-color piece that appeared.
    for (const from of changed.filter(x => x.before && x.before !== x.after)) {
      const color = from.before === from.before.toUpperCase() ? "w" : "b";
      const candidates = changed.filter(x => x.after && x.after !== x.before && ((x.after === x.after.toUpperCase()) ? "w" : "b") === color);
      for (const to of candidates) {
        // Castling has king + rook changes; prefer king as the mover.
        if (from.before.toLowerCase() === "k" && to.after.toLowerCase() === "k") {
          return { from: from.sq, to: to.sq, piece: from.before, color };
        }
      }
      const to = candidates[0];
      if (to) return { from: from.sq, to: to.sq, piece: from.before, color };
    }
    return null;
  }

  function stripCastle(chars) {
    let rights = state.castling === "-" ? "" : state.castling;
    for (const c of chars) rights = rights.replaceAll(c, "");
    state.castling = rights || "-";
  }

  function updateHistory(oldMap, newMap) {
    const mv = diffMove(oldMap, newMap);
    if (!mv) {
      const clockTurn = detectTurnFromClock();
      if (clockTurn) state.turn = clockTurn;
      return;
    }

    const { from, to, piece, color } = mv;
    const lower = piece.toLowerCase();
    if (piece === "K") stripCastle("KQ");
    if (piece === "k") stripCastle("kq");
    if (piece === "R" && from === "h1") stripCastle("K");
    if (piece === "R" && from === "a1") stripCastle("Q");
    if (piece === "r" && from === "h8") stripCastle("k");
    if (piece === "r" && from === "a8") stripCastle("q");

    // If a rook disappeared from its original corner, that right is gone even if captured.
    if (oldMap.get("h1") === "R" && newMap.get("h1") !== "R") stripCastle("K");
    if (oldMap.get("a1") === "R" && newMap.get("a1") !== "R") stripCastle("Q");
    if (oldMap.get("h8") === "r" && newMap.get("h8") !== "r") stripCastle("k");
    if (oldMap.get("a8") === "r" && newMap.get("a8") !== "r") stripCastle("q");

    state.ep = "-";
    if (lower === "p") {
      const r1 = Number(from[1]), r2 = Number(to[1]);
      if (Math.abs(r2 - r1) === 2) state.ep = from[0] + ((r1 + r2) / 2);
    }

    state.turn = color === "w" ? "b" : "w";
    if (color === "b") state.fullmove++;
  }

  function buildFen() {
    if (!state.board) return null;
    const map = getPieceMap(state.board);
    if (map.size < 2) return null;
    const placement = placementFromMap(map);

    if (!state.lastMap) {
      state.initializedAtStart = placement === START_PLACEMENT;
      state.castling = state.initializedAtStart ? "KQkq" : "-";
      state.ep = "-";
      state.fullmove = 1;
      const clockTurn = detectTurnFromClock();
      state.turn = clockTurn || (state.initializedAtStart ? "w" : "w");
    } else {
      updateHistory(state.lastMap, map);
      const clockTurn = detectTurnFromClock();
      if (clockTurn) state.turn = clockTurn;
    }

    state.lastMap = map;
    return `${placement} ${state.turn} ${state.castling} ${state.ep} 0 ${Math.max(1, state.fullmove)}`;
  }

  function createPanel() {
    if ($('#cbt-panel')) return $('#cbt-panel');
    const panel = document.createElement('div');
    panel.id = 'cbt-panel';
    panel.innerHTML = `
      <div class="cbt-title-row"><div class="cbt-title">Bot Move Coach</div><button class="cbt-x" title="Hide panel">×</button></div>
      <div class="cbt-subtitle">Chess.com computer games only</div>
      <div class="cbt-status"><span class="cbt-dot"></span><span class="cbt-status-text">Finding board…</span></div>
      <div class="cbt-move">—</div>
      <div class="cbt-eval"></div>
      <div class="cbt-pv"></div>
      <div class="cbt-row">
        <label>Depth
          <select class="cbt-depth">
            <option value="8">8</option>
            <option value="10">10</option>
            <option value="12" selected>12</option>
            <option value="14">14</option>
            <option value="15">15</option>
          </select>
        </label>
        <label class="cbt-auto"><input type="checkbox" class="cbt-auto-box" checked> Auto</label>
      </div>
      <div class="cbt-row">
        <button class="cbt-primary cbt-analyze">Analyze now</button>
        <button class="cbt-small cbt-clear" title="Clear arrow">Clear</button>
      </div>
      <div class="cbt-foot">Position only is sent to StockfishOnline for analysis.</div>`;
    document.documentElement.appendChild(panel);

    const depthEl = $('.cbt-depth', panel);
    const autoEl = $('.cbt-auto-box', panel);
    chrome.storage.local.get({ depth: 12, auto: true, panelVisible: true }, cfg => {
      state.depth = Math.max(6, Math.min(15, Number(cfg.depth) || 12));
      state.auto = cfg.auto !== false;
      state.panelVisible = cfg.panelVisible !== false;
      depthEl.value = String(state.depth);
      autoEl.checked = state.auto;
      panel.style.display = state.panelVisible ? '' : 'none';
    });
    depthEl.addEventListener('change', () => {
      state.depth = Number(depthEl.value) || 12;
      chrome.storage.local.set({ depth: state.depth });
      if (state.auto) scheduleAnalysis(50, true);
    });
    autoEl.addEventListener('change', () => {
      state.auto = autoEl.checked;
      chrome.storage.local.set({ auto: state.auto });
      if (state.auto) scheduleAnalysis(50, true);
    });
    $('.cbt-analyze', panel).addEventListener('click', () => scheduleAnalysis(0, true));
    $('.cbt-clear', panel).addEventListener('click', clearArrow);
    $('.cbt-x', panel).addEventListener('click', () => {
      state.panelVisible = false;
      panel.style.display = 'none';
      chrome.storage.local.set({ panelVisible: false });
    });
    return panel;
  }

  function setStatus(text, mode = "") {
    if (!state.panel) return;
    $('.cbt-status-text', state.panel).textContent = text;
    const dot = $('.cbt-dot', state.panel);
    dot.className = 'cbt-dot' + (mode ? ` ${mode}` : '');
  }

  function setResult(res) {
    if (!state.panel) return;
    const move = res.bestMove || "";
    const pretty = move ? `${move.slice(0,2)} → ${move.slice(2,4)}${move[4] ? ` = ${move[4].toUpperCase()}` : ""}` : "—";
    $('.cbt-move', state.panel).textContent = pretty;
    let evalText = `Depth ${res.depth}`;
    if (res.mate !== null && res.mate !== undefined) evalText += ` • Mate ${res.mate > 0 ? '+' : ''}${res.mate}`;
    else if (typeof res.evaluation === 'number') evalText += ` • Eval ${res.evaluation > 0 ? '+' : ''}${res.evaluation.toFixed(2)}`;
    $('.cbt-eval', state.panel).textContent = evalText;
    const pvMoves = String(res.continuation || '').split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
    $('.cbt-pv', state.panel).textContent = pvMoves ? `Line: ${pvMoves}` : '';
  }

  function ensureOverlay() {
    if (!state.board) return null;
    if (state.overlay && state.overlay.isConnected && state.overlay.parentElement === state.board) return state.overlay;
    const cs = getComputedStyle(state.board);
    if (cs.position === 'static') state.board.style.position = 'relative';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 800 800');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('cbt-board-overlay');
    state.board.appendChild(svg);
    state.overlay = svg;
    return svg;
  }

  function squareCenter(square) {
    const file = square.charCodeAt(0) - 97; // a=0
    const rank = Number(square[1]) - 1;     // 1=0
    const flipped = state.board && state.board.classList.contains('flipped');
    const col = flipped ? 7 - file : file;
    const row = flipped ? rank : 7 - rank;
    return { x: col * 100 + 50, y: row * 100 + 50 };
  }

  function clearArrow() {
    if (state.overlay) state.overlay.replaceChildren();
  }

  function drawArrow(uci) {
    if (!uci || uci.length < 4) return;
    const svg = ensureOverlay();
    if (!svg) return;
    svg.replaceChildren();
    const a = squareCenter(uci.slice(0,2));
    const b = squareCenter(uci.slice(2,4));
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.max(1, Math.hypot(dx,dy));
    const ux = dx / len, uy = dy / len;
    const endX = b.x - ux * 26, endY = b.y - uy * 26;

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'cbt-arrow-head');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '10');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    marker.setAttribute('markerUnits', 'strokeWidth');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M0,0 L0,6 L7,3 z');
    path.setAttribute('fill', 'rgba(255, 190, 55, .92)');
    marker.appendChild(path); defs.appendChild(marker); svg.appendChild(defs);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(a.x)); line.setAttribute('y1', String(a.y));
    line.setAttribute('x2', String(endX)); line.setAttribute('y2', String(endY));
    line.setAttribute('stroke', 'rgba(255, 190, 55, .86)');
    line.setAttribute('stroke-width', '18');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', 'url(#cbt-arrow-head)');
    svg.appendChild(line);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(a.x)); circle.setAttribute('cy', String(a.y));
    circle.setAttribute('r', '20'); circle.setAttribute('fill', 'rgba(255, 190, 55, .62)');
    svg.appendChild(circle);
  }

  async function analyze(force = false) {
    if (!isAllowedBotRoute()) return;
    state.board = findBoard();
    if (!state.board) { setStatus('Waiting for Chess.com board…'); return; }

    const fen = buildFen();
    if (!fen) { setStatus('Could not read position', 'err'); return; }

    const turn = fen.split(' ')[1];
    const me = playerColor();
    if (!force && turn !== me) {
      setStatus('Bot is thinking / opponent turn', '');
      return;
    }
    if (!force && fen === state.lastFen) return;
    if (state.analyzingFen === fen) return;

    const seq = ++state.requestSeq;
    state.analyzingFen = fen;
    state.lastFen = fen;
    setStatus('Stockfish is calculating…', 'busy');

    chrome.runtime.sendMessage({ type: 'analyzeFen', fen, depth: state.depth }, res => {
      if (seq !== state.requestSeq) return;
      state.analyzingFen = '';
      if (chrome.runtime.lastError) {
        setStatus(`Engine error: ${chrome.runtime.lastError.message}`, 'err');
        return;
      }
      if (!res || !res.ok) {
        setStatus(`Engine error: ${(res && res.error) || 'unknown error'}`, 'err');
        return;
      }
      state.bestMove = res.bestMove;
      setResult(res);
      drawArrow(res.bestMove);
      setStatus(turn === me ? 'Best move ready' : 'Position analyzed', 'ok');
    });
  }

  function scheduleAnalysis(delay = 320, force = false) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      if (state.auto || force) analyze(force);
    }, delay);
  }

  function watchBoard(board) {
    if (state.observer) state.observer.disconnect();
    state.board = board;
    state.lastMap = null;
    state.lastFen = '';
    state.castling = 'KQkq'; state.ep = '-'; state.fullmove = 1;
    state.observer = new MutationObserver(mutations => {
      const relevant = mutations.some(m => m.type === 'childList' || m.type === 'attributes');
      if (relevant) scheduleAnalysis(260, false);
    });
    state.observer.observe(board, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    scheduleAnalysis(150, false);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;
    if (message.type === 'getTrainerStatus') {
      sendResponse({ ok: true, allowed: true, boardFound: !!findBoard(), panelVisible: state.panel ? state.panel.style.display !== 'none' : true });
      return;
    }
    if (message.type === 'analyzeNow') {
      scheduleAnalysis(0, true);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'togglePanel') {
      if (!state.panel) state.panel = createPanel();
      state.panelVisible = state.panel.style.display === 'none';
      state.panel.style.display = state.panelVisible ? '' : 'none';
      chrome.storage.local.set({ panelVisible: state.panelVisible });
      sendResponse({ ok: true, panelVisible: state.panelVisible });
      return;
    }
    if (message.type === 'setDepth') {
      state.depth = Math.max(6, Math.min(15, Number(message.depth) || 12));
      const el = state.panel && $('.cbt-depth', state.panel);
      if (el) el.value = String(state.depth);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'setAuto') {
      state.auto = message.auto !== false;
      const el = state.panel && $('.cbt-auto-box', state.panel);
      if (el) el.checked = state.auto;
      if (state.auto) scheduleAnalysis(50, true);
      sendResponse({ ok: true });
      return;
    }
  });

  function bootstrap() {
    state.panel = createPanel();
    const board = findBoard();
    if (board) watchBoard(board);
    else setStatus('Waiting for Chess.com bot board…');

    // Chess.com is a SPA; re-check if the board element is replaced.
    setInterval(() => {
      if (!isAllowedBotRoute()) return;
      const current = findBoard();
      if (current && current !== state.board) watchBoard(current);
    }, 1200);
  }

  bootstrap();
})();
