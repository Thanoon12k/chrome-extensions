import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const extensionPath = resolve('dist');
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(resolve('test-results/google-profile-'));
const config = JSON.parse(await readFile('extension-config.json', 'utf8'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});
context.setDefaultTimeout(15000);
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'google-demo@example.test', app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {}, aud: 'authenticated', role: 'authenticated' };
const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600, role:'authenticated' })).toString('base64url')}.fake-test-signature`;
const session = { access_token: token, refresh_token: 'fake-test-refresh-token', token_type: 'bearer', expires_in: 3600, user };
await context.route('https://axncazensmjdqpczvzwf.supabase.co/**', route => {
  const path = new URL(route.request().url()).pathname;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(path.endsWith('/user') ? user : path.endsWith('/token') ? session : []) });
});
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  assert.ok(worker.url().startsWith(`chrome-extension://${config.id}/`));
  await worker.evaluate(({ session, callback }) => {
    globalThis.testRequests = [];
    globalThis.oauthMode = 'cancel';
    globalThis.fetch = async (input, options = {}) => {
      const url = String(input);
      globalThis.testRequests.push({ url, body: options.body });
      if (url.includes('/auth/v1/token')) return new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/auth/v1/user')) return new Response(JSON.stringify(session.user), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/logout')) return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      throw new Error('Unexpected worker network request');
    };
    chrome.identity.launchWebAuthFlow = async options => {
      globalThis.testAuthURL = options.url;
      if (globalThis.oauthMode === 'cancel') throw new Error('The user did not approve access.');
      if (globalThis.oauthMode === 'wrong-origin') return 'https://wrong.example/supabase?code=stolen';
      return `${callback}?code=test-one-time-code`;
    };
  }, { session, callback: config.redirectUrl });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`chrome-extension://${config.id}/index.html`);
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await page.getByText('Google sign-in was cancelled. You can try again.', { exact: true }).waitFor();
  const cancelled = await worker.evaluate(async () => await chrome.storage.local.get());
  assert.equal(cancelled['quiet-vault.auth.v1-code-verifier'], undefined);
  assert.equal(cancelled['quiet-vault.auth.v1'], undefined);
  await worker.evaluate(() => { globalThis.oauthMode = 'wrong-origin'; });
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await page.getByText(/Google sign-in could not finish/).waitFor();
  const beforeSuccess = await worker.evaluate(() => globalThis.testRequests);
  assert.equal(beforeSuccess.filter(r => r.url.includes('/token')).length, 0);
  await worker.evaluate(() => { globalThis.oauthMode = 'success'; });
  const nextPage = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  const signedIn = await nextPage;
  await signedIn.getByRole('button', { name: 'Create my vault', exact: true }).waitFor();
  assert.equal(signedIn.url(), `chrome-extension://${config.id}/index.html`);
  const state = await worker.evaluate(async () => ({ stored: await chrome.storage.local.get(), requests: globalThis.testRequests, authURL: globalThis.testAuthURL }));
  const authURL = new URL(state.authURL);
  assert.equal(authURL.searchParams.get('redirect_to'), config.redirectUrl);
  assert.equal(authURL.searchParams.get('code_challenge_method'), 's256');
  assert.ok(authURL.searchParams.get('code_challenge')?.length > 30);
  const exchange = state.requests.find(r => r.url.includes('/token'));
  const body = JSON.parse(exchange.body);
  assert.equal(body.auth_code, 'test-one-time-code'); assert.ok(body.code_verifier.length > 30);
  assert.equal(JSON.parse(state.stored['quiet-vault.auth.v1']).user.id, user.id);
  assert.equal(state.stored['quiet-vault.auth.v1-code-verifier'], undefined);
  assert.equal(await signedIn.getByRole('searchbox').count(), 0); // Google never unlocks the vault itself.
  assert.deepEqual(errors, []);
  console.log('PASS real extension worker: stable ID, Google button, cancellation, verifier cleanup, wrong-origin rejection, real PKCE challenge/verifier exchange, shared Chrome storage session, and vault tab still requires master password. Google/API responses mocked; no real account consent performed.');
} finally { await context.close(); }
