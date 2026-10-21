'use strict';

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OPEN_LOCAL_JSON' && sender.tab?.id != null) {
    const tabId = sender.tab.id;
    const key = `pending_${tabId}`;
    chrome.storage.session.set({
      [key]: {
        text: message.text,
        filename: message.filename || 'data.json',
        sourceUrl: message.sourceUrl || ''
      }
    }).then(() => {
      chrome.tabs.update(tabId, { url: chrome.runtime.getURL(`viewer.html?auto=1&tab=${tabId}`) });
      sendResponse({ ok: true });
    }).catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'GET_PENDING_JSON') {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false });
      return;
    }
    const key = `pending_${tabId}`;
    chrome.storage.session.get(key).then(data => {
      const payload = data[key];
      if (payload) chrome.storage.session.remove(key);
      sendResponse({ ok: !!payload, payload });
    }).catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
