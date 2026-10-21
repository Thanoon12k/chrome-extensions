import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const extensionPath = resolve('dist');
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(resolve('test-results/direct-google-'));
const config = JSON.parse(await readFile('extension-config.json', 'utf8'));
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
assert.equal(manifest.background, undefined, 'Google sign-in must not depend on a background receiver');
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});
context.setDefaultTimeout(15000);
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'google-demo@example.test', app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {}, aud: 'authenticated', role: 'authenticated' };
const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600, role:'authenticated' })).toString('base64url')}.fake-test-signature`;
const session = { access_token: token, refresh_token: 'fake-test-refresh-token', token_type: 'bearer', expires_in: 3600, user };
const requests = [];
await context.route('https://axncazensmjdqpczvzwf.supabase.co/**', route => {
  requests.push({ url: route.request().url(), body: route.request().postData() });
  const path = new URL(route.request().url()).pathname;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(path.endsWith('/user') ? user : path.endsWith('/token') ? session : []) });
});
await context.addInitScript(callback => {
  globalThis.oauthMode = 'cancel';
  // Failing every runtime message reproduces the user's missing-receiver condition.
  chrome.runtime.sendMessage = async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
  chrome.identity.launchWebAuthFlow = async options => {
    globalThis.testAuthURL = options.url;
    if (globalThis.oauthMode === 'cancel') throw new Error('The user did not approve access.');
    if (globalThis.oauthMode === 'wrong-origin') return 'https://wrong.example/supabase?code=stolen';
    return `${callback}?code=test-one-time-code`;
  };
}, config.redirectUrl);
try {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`chrome-extension://${config.id}/index.html`);
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await page.getByText('Google sign-in was cancelled. You can try again.', { exact: true }).waitFor();
  const cancelled = await page.evaluate(async () => await chrome.storage.local.get());
  assert.equal(cancelled['quiet-vault.auth.v1-code-verifier'], undefined);
  assert.equal(cancelled['quiet-vault.auth.v1'], undefined);
  await page.evaluate(() => { globalThis.oauthMode = 'wrong-origin'; });
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await page.getByText(/Google sign-in could not finish/).waitFor();
  assert.equal(requests.filter(r => r.url.includes('/token')).length, 0);
  await page.evaluate(() => { globalThis.oauthMode = 'success'; });
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await page.getByRole('button', { name: 'Create my vault', exact: true }).waitFor();
  const state = await page.evaluate(async () => ({ stored: await chrome.storage.local.get(), authURL: globalThis.testAuthURL }));
  const authURL = new URL(state.authURL);
  assert.equal(authURL.searchParams.get('redirect_to'), config.redirectUrl);
  assert.equal(authURL.searchParams.get('code_challenge_method'), 's256');
  assert.ok(authURL.searchParams.get('code_challenge')?.length > 30);
  const body = JSON.parse(requests.find(r => r.url.includes('/token')).body);
  assert.equal(body.auth_code, 'test-one-time-code'); assert.ok(body.code_verifier.length > 30);
  assert.equal(JSON.parse(state.stored['quiet-vault.auth.v1']).user.id, user.id);
  assert.equal(state.stored['quiet-vault.auth.v1-code-verifier'], undefined);
  assert.equal(await page.getByRole('searchbox').count(), 0);
  // Simulate an actual action popup, then verify it opens a durable sign-in tab.
  await page.evaluate(async () => await chrome.storage.local.clear());
  const popup = await context.newPage();
  await popup.addInitScript(() => { chrome.extension.getViews = () => [window]; });
  await popup.goto(`chrome-extension://${config.id}/index.html`);
  const nextPage = context.waitForEvent('page');
  await popup.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  const dedicated = await nextPage;
  await dedicated.getByText('Google sign-in was cancelled. You can try again.', { exact: true }).waitFor();
  assert.equal(dedicated.url(), `chrome-extension://${config.id}/index.html`);
  assert.deepEqual(errors, []);
  console.log('PASS: Google PKCE sign-in without any background worker and with runtime messaging forced to fail; cancellation, cleanup, callback validation, session storage, required master password, and popup-to-tab continuation. Google/API responses simulated.');
} finally { await context.close(); }
