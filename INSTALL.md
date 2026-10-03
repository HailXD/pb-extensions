# Paperback 0.8 installation

The installable repository is `0.8/`. It contains MangaHub 3.1.1, based on Netsky's 3.1.0 source, with chapter decryption adapted from Elrulia's 0.9 extension.

## Publish on GitHub Pages

1. In `HailXD/pb-extensions`, open Settings > Pages.
2. Set the build and deployment source to GitHub Actions.
3. Run the `Publish Paperback 0.8 repository` workflow if the initial push did not deploy.
4. Add this repository URL in Paperback 0.8:

   `https://hailxd.github.io/pb-extensions/0.8/`

The same URL opens a page with an Add to Paperback button.

Alternatively, serve the `0.8/` directory from any HTTPS static host and add its URL in Paperback. The installation button is configured for the GitHub Pages URL above.

## Update MangaHub

Install MangaHub 3.1.1 from this repository. The source ID remains `Mangahub`, and manga and chapter IDs are unchanged. This preserves the identifiers used by the original source; no library migration is intended. If the old repository also offers MangaHub, make sure Paperback selects version 3.1.1 from this repository.

If MangaHub asks for Cloudflare verification, use the source's Cloudflare bypass and retry the chapter. Previously failed downloads may need to be retried in Paperback.

## Maintain the extension

Edit `src/chapter-crypto.js`, `src/mangahub.js`, or `src/source-info.json`, then run:

```sh
bun run package
```

Packaging concatenates the unmodified upstream bundle, the vendored SJCL modules, and the compatibility patch. It updates `0.8/Mangahub/source.js`, `0.8/versioning.json`, and the distributed license files. It does not compile TypeScript, install dependencies, or execute tests. The manifest retains the upstream bundle's 0.8.7 SDK/toolchain metadata.

Commit the updated `0.8/` files to publish changes. The Pages workflow deploys those files without rebuilding them. The supplied reference folders and ZIP archives are not required for packaging or deployment.

## Decryption behavior

- Supports both the old plaintext page JSON and the `enc:v1:keyId:iv:authTag:ciphertext` format
- Requests the rotating AES-256 key directly from MangaHub's `/api/chapter-crypto` endpoint
- Authenticates and decrypts AES-GCM using bundled JavaScript, without `Application`, WebCrypto, Node APIs, or external decryption services at runtime
- Caches keys in memory, refreshes before expiry, and shares concurrent key requests
- Refreshes the key on key-ID mismatch and retries the chapter request once if rotation leaves it out of sync
- Rejects malformed page data and authentication failures rather than returning an empty chapter
- Normalizes old stored access cookies into API tokens and retries recognized access-key/rate-limit errors once

Search, browse, manga details, and chapter listing retain Netsky's original implementation. Cloudflare restrictions, site outages, and server rate limits can still prevent requests. In-app compatibility and live chapter loading have not been verified here.

See `THIRD_PARTY.md` for upstream attribution and licenses.
