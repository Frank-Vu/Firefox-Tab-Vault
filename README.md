# Tab Vault

A local-only Firefox desktop extension for tab backups. Requires **Firefox 142 or newer**.
See [upstream attribution](UPSTREAM.md) for the original project.

## Features

- Export the current window or all windows in the current browsing mode.
- Review tabs grouped by window before exporting or importing.
- Select individual tabs for export, with All tabs checked by default.
- Export and import JSON, metadata-rich TXT, and ordinary one-URL-per-line TXT files.
- Optional password encryption for either format, enabled by default in private windows.
- Automatically detect and locally decrypt encrypted backups.
- Preserve tab order, pinned and muted state, active tabs, and discarded tabs.
- Preserve native Firefox tab groups, including names, colors, and collapsed state.
- Restore separate windows, their size and position, state, and preferred focus, or append
  all archived windows into the current window without closing existing tabs.
- Read legacy Tab Vault JSON/TXT backups, including password-encrypted backups.
- Explicitly isolate normal and private windows and associate downloads with their originating mode.
- Complete confirmed restores and downloads in a background script even if the popup closes.
- No account, analytics, remote code, network requests, or persistent storage of backup contents or passwords.

## Install for local use

1. Extract `dist/tab-vault-1.0.3.zip`, or use this source directory.
2. In Firefox, open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select `manifest.json` in the extracted directory.
4. Use the Tab Vault toolbar button. Pin it through Firefox's extensions menu if desired.

Temporary add-ons are removed when Firefox restarts. The generated `.xpi` is **unsigned**;
regular Firefox requires Mozilla signing for permanent installation. Submit the ZIP to
[Mozilla Add-ons](https://addons.mozilla.org/developers/) for signing, either for public listing
or self-distribution. No signing credentials are included or required for local testing.

For permanent installation in regular Firefox, choose **On your own** when submitting to
Mozilla Add-ons, upload the generated ZIP, and download the signed XPI after validation.
Then open `about:addons`, click the gear menu, choose **Install Add-on From File…**, and
select the signed XPI. The add-on name is **Tab Vault** because Mozilla's upload validator
rejects add-on names containing Mozilla or Firefox trademarks.

## Enable private windows

Open `about:addons`, select Tab Vault, and set **Run in Private Windows** to **Allow**.
Open the extension from the private window to export or restore privately.

Firefox uses a shared extension context for normal and private browsing. This extension
captures the originating window ID and filters all-window exports by its `incognito` flag.
Restore destinations always use the mode of the window where you opened the extension,
regardless of the backup's source mode. Importing a private backup into normal browsing
shows a warning before any tabs open.

## Export and import

Choose **Current window** or **All windows in this mode**, optionally change the encryption
checkbox, then choose **Export JSON** or **Export TXT**. Review the tabs, select what to include,
and confirm. Encrypted exports require a password of at least eight characters and confirmation.

To restore, click **Import backup…**. The popup closes after opening an import tab in that
window and browsing mode. In the import tab, select **New window(s)** or **Append to current
window**, then click **Choose backup and restore**,
enter its password if encrypted, review the full list, and confirm. Keep the import tab open
until you confirm. Cancelling the review opens no restored tabs.
File selection runs in this tab because Firefox can close toolbar popups when a native file
chooser takes focus, losing the selection before it can be read.
If the popup closes during restoration, reopen it in the originating window to see the result.

Encryption uses local Web Crypto: AES-256-GCM with an authenticated envelope and
PBKDF2-SHA-256 with 600,000 iterations, a random 16-byte salt, and a random 12-byte IV.
Passwords are never saved. Lost passwords cannot be recovered.

New backups use the `firefox-tab-vault` and `firefox-tab-vault-encrypted` identifiers,
with Firefox Tab Vault TXT headers. Legacy identifiers and headers are accepted on import,
including in previously encrypted backups. New exports require Tab Vault 1.0.1 or
another reader that supports the Firefox identifiers.

## Firefox compatibility and limits

- Firefox restricts privileged URLs, including `about:config`, other extensions' pages,
  JavaScript URLs, and other browsers' settings pages. Failures are counted while remaining tabs restore.
  Legacy New Tab URLs and `about:newtab` are translated to Firefox's supported new-tab operation.
- Firefox exposes discarded state and can create sleeping tabs without loading their contents.
  Activating a sleeping tab loads it, as expected.
- Firefox does not expose the legacy per-tab `autoDiscardable` setting. That backup field is
  accepted for compatibility, but Firefox manages automatic unloading itself.
- Pinned tabs occupy Firefox's pinned section. When appending, restored pins follow existing
  pins; restored unpinned tabs follow existing unpinned tabs. Existing groups are preserved.
- Window geometry can be clamped by Firefox or the operating system. If old geometry is
  rejected, tabs restore using default bounds with a reported setting warning.
- The operating system can restrict window focus and fullscreen behavior. Setting failures
  are reported separately from tab-opening failures. Minimized windows remain minimized.
- Back/forward history, cookies, sign-in sessions, forms, containers, and browser-specific
  split views are outside the original backup format. Pages may require signing in again.
- Unencrypted backups contain URLs and titles. A private download is still a file on disk.
- Firefox for Android is outside the desktop window-management scope of this extension.

## Development and verification

Use Node.js 20 or newer:

```sh
npm ci
npm test
npm run lint
npm run build
```

`npm run build` creates matching ZIP and unsigned XPI files in `dist/`, containing only the
extension's runtime files and icons. Test drivers and development dependencies are excluded.

Run native Firefox integration tests against a disposable headless profile:

```powershell
$env:FIREFOX_BINARY = 'C:/Program Files/Mozilla Firefox/firefox.exe'
npm run test:firefox
```

On macOS/Linux, use `FIREFOX_BINARY=/path/to/firefox npm run test:firefox`.
The runner grants private-window access only in its temporary test profile, exercises real
Firefox APIs and the extension UI, and writes `test-results/firefox.json`. It uses a local
HTTP fixture server; that server and its host permission are absent from the release package.
Headless tests bypass the Save As dialog to inspect downloads; production exports display it.

`node scripts/preview.js` starts a local layout preview with mocked browser APIs. It is
useful for inspecting light/dark themes and dialogs; it does not validate Firefox API behavior.

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the completed checks and
[UPSTREAM.md](UPSTREAM.md) for the pinned source attribution.
