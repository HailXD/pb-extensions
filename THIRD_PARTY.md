# Third-party attribution

## Netsky's MangaHub 3.1.0

`vendor/mangahub-3.1.0.js` and the MangaHub icon are copied unchanged from the supplied `netskys-extensions-gh-pages/0.8/Mangahub` directory.

Original author: Netsky

Upstream: https://github.com/TheNetsky/netskys-extensions

The upstream bundle includes Paperback types 0.8.7 and html-entities. Existing upstream code and notices are retained. No standalone license was present in the supplied Netsky archive.

## Elrulia's MangaHub chapter decryption

The encryption envelope, key endpoint, key lifetime handling, and page decoding flow in `src/chapter-crypto.js` are adapted from `src/MangaHub/chapterCrypto.ts` and `main.ts` in the supplied `paperback-extension-0.9-stable` directory.

Upstream: https://github.com/Elrulia/paperback-extension

License: GNU General Public License version 3, included in `LICENSE`

HailXD's Paperback 0.8 adaptation, dated 2026-10-03, replaces Application/WebCrypto calls with Paperback 0.8 requests and SJCL, validates encrypted payloads, shares concurrent key requests, and adds bounded retries for access-key errors and encryption-key rotation. The adaptation is distributed under GPL-3.0, without warranty. The unchanged Netsky bundle retains its upstream notices; no additional license grant for that bundle is asserted here.

Corresponding source and packaging script: https://github.com/HailXD/pb-extensions

## Stanford JavaScript Crypto Library 1.0.8

Only the namespace, AES, bit arrays, UTF-8 codec, Base64 codec, and GCM modules are included. They are unmodified upstream source files, not a runtime download.

Upstream: https://github.com/bitwiseshiftleft/sjcl

Distribution: https://cdn.jsdelivr.net/npm/sjcl@1.0.8/

Copyright (c) 2009-2015, Emily Stark, Mike Hamburg and Dan Boneh at Stanford University

Used under the BSD-2-Clause option. The full upstream dual-license notice is included in `vendor/sjcl/LICENSE.txt` and the installable extension's `includes/SJCL-LICENSE.txt`.
