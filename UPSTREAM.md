# Upstream source

Ported from [Frank-Vu's original Tab Vault](https://github.com/Frank-Vu/Chrome-Tab-Vault),
commit `751481b5ba812d7375cfed72d9c0efa945d829ec` (version 1.7.3).
The backup parsing, encryption, popup layout, and icons originate from that project.

New exports use Firefox Tab Vault identifiers and TXT headers. Legacy format identifiers
and headers remain supported on import so existing backups and passwords continue to work.
Legacy encrypted identifiers are preserved during decryption because they are authenticated.
Firefox-specific browser operations live in `firefox.js` and `background.js`.
