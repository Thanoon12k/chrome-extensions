import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const extensionPath = resolve('dist');
const profile = resolve('test-results/extension-profile');
await mkdir(profile, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});
try {
  const page = await context.newPage();
  await page.goto('chrome://extensions-internals');
  const text = await page.locator('body').innerText();
  const extensions = JSON.parse(text);
  const vault = extensions.find(item => item.name === 'Quiet Vault');
  if (!vault) throw new Error('Quiet Vault was not loaded in the isolated Edge profile.');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${vault.id}/index.html`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`PASS: packaged Manifest V3 extension loaded in an isolated Chromium (Edge) profile: ${vault.id}`);
} finally { await context.close(); }
