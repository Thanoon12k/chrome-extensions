# Quiet Vault — Chrome preview

A small personal vault for API keys, passwords, secrets, and variables. The home screen focuses on **Search** and **Add**. Each row offers Copy; open a row to edit or reveal its value. The Android app is deferred until the Chrome version is approved.

## Install in Chrome

1. Unzip `quiet-vault-chrome.zip` into a permanent folder.
2. Open `chrome://extensions`, turn on **Developer mode**, and choose **Load unpacked**.
3. Select the folder containing `manifest.json`, then pin Quiet Vault.
4. Choose **Continue with Google** to use your Google account, or **Use email instead** to create an email/password account. Confirm the email if requested, then sign in again. Existing users of this Supabase project can sign in with their existing email/password account.
5. Create a separate **master password** (12 characters minimum). This password encrypts your vault; it is not your Supabase account password. Keep it safe: there is no reset or recovery.

If the email provider rate-limits signup, wait before retrying or use an existing email/password account. No project-wide email or auth settings were changed. Google sign-in is supported in the installed extension. Website autofill is not included.

## Daily use

- Search by name or type. Secret values are never searched or displayed in the list.
- Add a name and value; type is optional to change. Values are copied exactly, including leading/trailing spaces.
- Open an item to edit, reveal for 15 seconds, or delete with a second click to confirm.
- The top-right menu provides Lock, encrypted backup, restore backup, and Sign out.
- The popup locks when closed/hidden or after 2 minutes without keyboard/pointer activity. Escape locks immediately. Unlock again when opening the popup.
- Offline access works after the first successful sign-in and vault setup on that device. Edits are saved encrypted locally and sync when connected, on opening/unlocking, or by clicking the small sync status. The extension does not run a background vault-sync service; its background worker only finishes Google sign-in.
- Copied secrets remain on your system clipboard until replaced; this extension never reads your clipboard.

## Encryption and storage

- Web Crypto AES-256-GCM encrypts the complete contents, including names and types, before saving or syncing. Each encryption uses a fresh random 96-bit nonce.
- A random 256-bit vault key is wrapped using a key derived from the master password with PBKDF2-HMAC-SHA-256, 600,000 iterations and a random 128-bit salt. The unwrapped CryptoKey is non-exportable.
- Authenticated additional data binds ciphertext to the account, format version, and purpose. Local cache and cloud payloads use different purpose contexts.
- Master passwords and decrypted values are never saved in local storage or sent to Supabase. Decrypted values exist in the open popup's memory while unlocked. JavaScript cannot guarantee physical memory erasure; a compromised device/browser can still capture secrets.
- Supabase stores encrypted contents, wrapped key, salt, nonces, user ID, revision, and update time. Supabase also holds normal account and session data. Its publishable API key is intentionally public; no secret/service-role key is bundled.
- The Supabase account session is stored in this extension's chrome.storage.local under its own key, shared with its background sign-in worker. The encrypted vault cache stays in extension localStorage. Use a trusted browser profile. The master password is still required to unlock. No content scripts, analytics, remote code, or page-reading permissions.
- RLS restricts vault rows to `auth.uid() = user_id`. The save RPC is SECURITY INVOKER and checks a revision to reject stale writes.
- Independent edits merge. Conflicting edits preserve the other device's version and create a local “conflict copy.” An offline deletion conflicting with an edit keeps the other device's edit. A second window is locked when the shared encrypted cache changes.
- Version 1 supports a small personal vault: at most 900 KB of serialized local state and 32,000 characters per value. Deleted records retain encrypted tombstones for synchronization. Large vaults need a later per-record protocol.

## Backups

Save encrypted backup in the menu. The JSON contains no plaintext secrets; keep the master password separately. Restore while unlocked using the same account/master password. Restore adds missing items and keeps changed items as “restored copy”; it does not delete or overwrite current items. Imported deletion tombstones are ignored. Backups from a different vault/account are rejected.

Encrypted local caches survive sign-out, so unsynced edits can be recovered by signing back into the same account. Uninstalling the extension, clearing its storage, or losing the device removes local-only edits. Sync or save a backup before doing so.

## Development

Node.js 22.12+ or 24+:

```sh
npm ci
npm test
npm run build
```

Load `dist/` as an unpacked extension. `npm run dev` previews the same UI at `http://127.0.0.1:5173`; it uses separate browser storage from the installed extension. `npm run test:browser` runs browser integration tests with fake API responses and real Web Crypto, without creating accounts or sending emails. Set `CHROME_PATH` to a local Chrome/Edge executable if needed.

Backend: existing `clinic_queue` project. `supabase/schema.sql` documents the additive migration: one new `quiet_vaults` table, its ownership policies, and `quiet_vault_save` RPC. Existing tables, auth settings, triggers, and clinic data are untouched by the migration. Current project usage limits are shared with the existing apps; no additional project or paid service was created.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Chrome extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy).

## Validation for the Chrome preview

- 11 Node tests passed: real Web Crypto, wrong-password/tamper/account rejection, conflict preservation and idempotent retries, offline saves/restart/sync, encrypted caches, quota rollback, and locking.
- Production browser integration passed using demo API responses: sign-in, vault setup, search/add/copy/edit/delete, backup/restore, offline reopening, later sync, master-password rejection, idle lock, sign-out, CSP, and checks that secrets/master passwords never appear in persisted state or sync requests.
- The built Manifest V3 package loaded successfully in an isolated Chromium (Edge) profile. The test did not install anything into the user's normal browser profile.
- Live Supabase transactional tests passed for owner access, cross-account isolation, anonymous denial, immutable key metadata, and stale-write rejection. Test writes were rolled back. No test accounts or confirmation emails were created.
- Existing public table columns/policies, functions, and triggers had the same fingerprint before and after the additive migration. No security advisor findings referred to the new vault objects.

To repeat the packaged extension smoke test on Windows: `node tests/extension-smoke.mjs` (requires Microsoft Edge). Actual email delivery and sign-in with your own account should be checked during your review.


## Google sign-in (0.1.1)

The login screen focuses on **Continue with Google**, with **Use email instead** opening the existing email/password form. Google sign-in runs in a browser-managed authorization window. A background worker finishes sign-in even when the popup closes, then opens a vault tab. A master password is still required to create or unlock the encrypted vault.

OAuth uses PKCE. The callback accepts only a single authorization code at the exact registered URL; implicit access tokens and unexpected callback origins/paths are rejected. No Google client secret is in the extension. Only standard Google identity scopes are requested by the configured Supabase provider.

The manifest contains a public key for a stable extension ID. This is a one-time ID change from the earlier development preview; synced vaults remain available by signing back in. Export/sync any local-only edits in the old preview before removing it. Load the updated dist folder through **Load unpacked**. The configured ID is `ecoganpmeologajglpdbkjnjmmllflga`.

Supabase Authentication > URL Configuration must include exactly:
`https://ecoganpmeologajglpdbkjnjmmllflga.chromiumapp.org/supabase`

Add this callback alongside the existing clinic callback. Keep the existing Site URL and Google provider credentials unchanged. No Google Cloud redirect changes are needed: Google still returns to the existing Supabase Auth callback.
