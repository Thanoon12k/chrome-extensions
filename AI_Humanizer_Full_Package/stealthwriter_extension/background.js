// Service worker: proxies calls to the local workbench bridge.
// (StealthWriter is served over HTTPS, so the page itself cannot call
// http://127.0.0.1 — the extension background can.)
importScripts("shared.js");

async function bridgeFetch(method, path, body) {
  const { bridgeUrl } = await swbGetSettings();
  const url = bridgeUrl.replace(/\/+$/, "") + path;
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    let data;
    try {
      data = await res.json();
    } catch (e) {
      data = { ok: false, error: `Bad response (${res.status})` };
    }
    if (!res.ok && data.ok !== false) data.ok = false;
    data.httpStatus = res.status;
    return data;
  } catch (e) {
    return {
      ok: false,
      offline: true,
      error: `Workbench not reachable at ${bridgeUrl}. Start the DOCX workbench first.`
    };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "bridge") {
    bridgeFetch(msg.method || "GET", msg.path, msg.body).then(sendResponse);
    return true; // async response
  }
  return false;
});

// Let the content script use chrome.storage.session (cleared when Chrome
// closes, so a run never auto-resumes days later).
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {});
