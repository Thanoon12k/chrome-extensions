'use strict';

(() => {
  const path = decodeURIComponent(location.pathname || '');
  if (!/\.(json|jsonl|ndjson)$/i.test(path)) return;

  // Chrome renders local JSON as page text. Read it without changing the file.
  const text = document.body?.innerText || document.documentElement?.innerText || '';
  if (!text.trim()) return;

  let valid = false;
  try {
    JSON.parse(text.replace(/^\uFEFF/, ''));
    valid = true;
  } catch {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length > 1) {
      try {
        lines.forEach(line => JSON.parse(line));
        valid = true;
      } catch {}
    }
  }
  if (!valid) return;

  const filename = path.split('/').pop() || 'data.json';
  chrome.runtime.sendMessage({
    type: 'OPEN_LOCAL_JSON',
    text,
    filename,
    sourceUrl: location.href
  });
})();
