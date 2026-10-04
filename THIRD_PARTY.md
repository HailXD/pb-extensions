# Third-party attribution

## Netsky's MangaHub 3.1.0

`vendor/mangahub-3.1.0.js` and the MangaHub icon are copied unchanged from the supplied `netskys-extensions-gh-pages/0.8/Mangahub` directory.

Original author: Netsky

Upstream: https://github.com/TheNetsky/netskys-extensions

The upstream bundle includes Paperback types 0.8.7 and html-entities. Existing upstream code and notices are retained. No standalone license was present in the supplied Netsky archive.

## Elrulia's MangaHub compatibility code

The compatibility patch in `src/mangahub.js` retains shared response and access-key handling from HailXD's adaptation of Elrulia's MangaHub source in the supplied `paperback-extension-0.9-stable` directory. The unused chapter page-list decryption implementation and bundled SJCL library were removed in version 3.1.31.

Upstream: https://github.com/Elrulia/paperback-extension

License: GNU General Public License version 3, included in `LICENSE`

HailXD's Paperback 0.8 adaptation, originally dated 2026-10-03, uses Paperback 0.8 requests and discovers chapter image URLs through CDN probing. The adaptation is distributed under GPL-3.0, without warranty. The unchanged Netsky bundle retains its upstream notices; no additional license grant for that bundle is asserted here.

Corresponding source and packaging script: https://github.com/HailXD/pb-extensions
