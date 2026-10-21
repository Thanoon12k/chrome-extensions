import { client, authStorage, AUTH_KEY } from './client.js';
import { googleSignIn, oauthError } from './oauth.js';

let pending = null;
async function startGoogleSignIn() {
  try {
    await chrome.storage.local.set({ 'quiet-vault.oauth-status': { state: 'pending', at: Date.now() } });
    await googleSignIn(client, chrome.identity);
    await chrome.storage.local.remove('quiet-vault.oauth-status');
    // The action popup may have closed when the Google window took focus.
    // A fresh vault tab reads the saved account session and requests its master password.
    await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    return { ok: true };
  } catch (error) {
    await authStorage.removeItem(`${AUTH_KEY}-code-verifier`);
    const message = oauthError(error);
    await chrome.storage.local.set({ 'quiet-vault.oauth-status': { state: 'error', message, at: Date.now() } });
    return { ok: false, message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'quiet-vault:google-login' || sender.id !== chrome.runtime.id
    || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  if (!pending) pending = startGoogleSignIn().finally(() => { pending = null; });
  pending.then(sendResponse, () => sendResponse({ ok: false, message: 'Could not start Google sign-in. Please try again.' }));
  return true;
});
