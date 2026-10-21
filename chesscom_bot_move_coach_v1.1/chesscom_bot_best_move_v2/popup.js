const $ = s => document.querySelector(s);

function isBotUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'www.chess.com' && u.hostname !== 'chess.com') return false;
    const p = u.pathname;
    return p === '/play/computer' 
    || p.startsWith('/play/computer/') 
    || p.startsWith('/game/computer/')
     || p.startsWith("/game/")
      || p.startsWith("/play/online/");
  } catch (_) { return false; }
}

function isChessUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'www.chess.com' || h === 'chess.com';
  } catch (_) { return false; }
}

function setCard(mode, title, text) {
  const card = $('#statusCard');
  card.className = `status-card ${mode}`;
  $('#statusTitle').textContent = title;
  $('#statusText').textContent = text;
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function send(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); }
  catch (_) { return null; }
}

(async () => {
  const tab = await activeTab();
  const url = tab && tab.url ? tab.url : '';
  const cfg = await chrome.storage.local.get({ depth: 12, auto: true });
  $('#depth').value = String(cfg.depth || 12);
  $('#auto').checked = cfg.auto !== false;

  if (tab && isBotUrl(url)) {
    setCard('ok', 'BOT GAME — ACTIVE', 'The extension is allowed here. Start a computer game and the best-move arrow will update in real time.');
    $('#botControls').classList.remove('hidden');
    const s = await send(tab.id, { type: 'getTrainerStatus' });
    if (!s) setCard('ok', 'BOT PAGE — RELOAD ONCE', 'This tab was already open before the extension was updated. Reload the page once, then it will be active.');
  } else if (tab && isChessUrl(url)) {
    setCard('locked', 'HUMAN GAME — DISABLED', 'This page is not a Chess.com bot/computer route, so real-time engine hints are intentionally off.');
    $('#openBot').classList.remove('hidden');
  } else {
    setCard('neutral', 'OPEN A CHESS.COM BOT GAME', 'Use Play → Computer. The toolbar icon now opens this control panel.');
    $('#openBot').classList.remove('hidden');
  }

  $('#depth').addEventListener('change', async e => {
    const depth = Number(e.target.value) || 12;
    await chrome.storage.local.set({ depth });
    if (tab && isBotUrl(url)) await send(tab.id, { type: 'setDepth', depth });
  });

  $('#auto').addEventListener('change', async e => {
    const auto = !!e.target.checked;
    await chrome.storage.local.set({ auto });
    if (tab && isBotUrl(url)) await send(tab.id, { type: 'setAuto', auto });
  });

  $('#analyze').addEventListener('click', async () => {
    if (!tab) return;
    await send(tab.id, { type: 'analyzeNow' });
    window.close();
  });

  $('#togglePanel').addEventListener('click', async () => {
    if (!tab) return;
    await send(tab.id, { type: 'togglePanel' });
    window.close();
  });

  $('#openBot').addEventListener('click', async () => {
    await chrome.tabs.create({ url: 'https://www.chess.com/play/computer' });
    window.close();
  });
})();
