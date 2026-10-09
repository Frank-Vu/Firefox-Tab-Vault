# Port verification

Upstream: original Tab Vault 1.7.3, commit
`751481b5ba812d7375cfed72d9c0efa945d829ec`.

Tested on Windows using Mozilla Firefox 142.0 (build `20250811145442`) and Firefox 157.0.1
(build `20261005135250`) in disposable headless profiles. All **26 unit tests** and
**63 integration checks per Firefox version** passed. The runner loads the actual extension
scripts and tests its real browser APIs.

- Unit tests: archive normalization, JSON/TXT metadata round trips, malformed input,
  prototype-safe group keys, upstream fixture imports, Firefox export identifiers and headers,
  AES-GCM authentication (including identifier changes), wrong passwords,
  context filtering, tab ordering, pins, groups, window layout, blocked URLs, setting failures,
  stale geometry fallback, and download blob lifetime.
- Native Firefox: export and restore native group title/color/collapse, tab order, pins,
  mute, active and discarded state, window dimensions, normal/private separation, private
  restore destinations, blocked URL counts, and Web Crypto decryption of upstream fixtures.
- Actual extension UI in both modes: correct defaults, export review, individual selection,
  select-all behavior, cancellation, password length/confirmation validation, encrypted JSON
  download, plain TXT review, wrong-password failure, encrypted upstream TXT import, private
  source warning, append, selective unencrypted TXT export, and background restoration after
  the initiating extension page closes.
- Import regression: the toolbar import button opens a persistent tab in the originating
  window and browsing mode without opening a file picker in the toolbar popup. The import
  tab preserves the selected destination and owns file selection, decryption and review.
  Plain/encrypted upstream and Firefox JSON/TXT backups restore to both destinations in normal/private
  browsing. Existing tabs survive append and no restored tabs open before confirmation.
- Mozilla `web-ext lint`: zero errors, notices, or warnings.
- Popup layout: inspected at 390 × 600 in light and dark themes, including review/password dialogs.
- Package: production scripts and icons only; no tests, fixture servers, dependencies, or remote code.

The previous test suite exercised file import in ordinary extension tabs, which did not catch
Firefox closing the toolbar popup when the native file picker takes focus. Import now always
uses a persistent tab, avoiding that popup lifetime dependency.

Headless integration tests do not operate the native file picker or Save As dialog; they supply
a real `File` object to Firefox's file input and bypass Save As only in the temporary test copy.
Window focus and fullscreen depend on operating-system behavior. Permanent installation
requires Mozilla signing; the local package is unsigned.
