import { mkdir, copyFile, writeFile } from 'node:fs/promises';
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src https://axncazensmjdqpczvzwf.supabase.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const manifest = {
  manifest_version: 3, name: 'Quiet Vault', version: '0.1.0',
  description: 'A quiet place for API keys, passwords, and variables. Encrypted on your device, synced to your account.',
  minimum_chrome_version: '120', permissions: ['clipboardWrite'],
  host_permissions: ['https://axncazensmjdqpczvzwf.supabase.co/*'],
  action: { default_popup: 'index.html', default_title: 'Quiet Vault', default_icon: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' } },
  icons: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  content_security_policy: { extension_pages: csp }
};
await mkdir('dist', { recursive: true });
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await copyFile('README.md', 'dist/README.md');
console.log('Chrome extension ready in dist/');
