# Upstream source

Ported from [Frank-Vu/Chrome-Tab-Vault](https://github.com/Frank-Vu/Chrome-Tab-Vault),
commit `751481b5ba812d7375cfed72d9c0efa945d829ec` (version 1.7.3).
The backup parsing, encryption, popup layout, and icons originate from that project.

The `chrome-tab-vault` format, TXT headers, and authenticated encryption identifiers
are deliberately retained so existing Chrome backups and passwords remain compatible.
Firefox-specific browser operations live in `firefox.js` and `background.js`.
