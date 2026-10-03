# Paperback 0.8 installation

The installable repository is `0.8/`. It contains MangaHub 3.1.3, based on Netsky's 3.1.0 source, with chapter decryption adapted from Elrulia's 0.9 extension.

## Publish on GitHub Pages

1. In `HailXD/pb-extensions`, open Settings > Pages.
2. Set the build and deployment source to GitHub Actions.
3. Run the `Publish Paperback 0.8 repository` workflow if the initial push did not deploy.
4. Add this repository URL in Paperback 0.8:

   `https://hailxd.github.io/pb-extensions/0.8/`

The same URL opens a page with an Add to Paperback button.

Alternatively, serve the `0.8/` directory from any HTTPS static host and add its URL in Paperback. The installation button is configured for the GitHub Pages URL above.

## Update MangaHub

Install MangaHub 3.1.3 from this repository. The source ID remains `Mangahub`, and manga and chapter IDs are unchanged. This preserves the identifiers used by the original source; no library migration is intended. If the old repository also offers MangaHub, make sure Paperback selects version 3.1.3 from this repository.

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
- Caches keys and initialized AES ciphers in memory, refreshes before expiry, and shares concurrent key requests
- Fetches a key on key-ID mismatch and retries the chapter request once if rotation leaves it out of sync, without fetching the same mismatched key twice
- Rejects malformed page data and authentication failures rather than returning an empty chapter
- Normalizes old stored access cookies into API tokens and retries recognized access-key errors once
- Handles rate-limit errors separately, without immediately retrying or renewing the access key

## Request optimizations

- Shares simultaneous requests for the same manga details, chapter list, or chapter pages; failed requests are not cached
- Keeps up to 16 chapter page lists in memory for 60 seconds, avoiding another API request and decryption when reopening a recent chapter
- Returns separate page arrays so callers cannot modify the cached page list
- Requests only chapter numbers, titles, and dates when refreshing a chapter list, omitting unused manga titles and chapter slugs
- Does not cache completed chapter-list requests, so a new refresh still checks for updates
- Limits scheduled requests to one per second to reduce bursts

## Rate-limit recovery

- Detects HTTP 429 and rate-limit messages or codes in GraphQL errors across the shared request manager
- Honors `Retry-After` in seconds or HTTP-date form, falling back to a 60-second cooldown when no usable value is supplied
- Blocks further scheduled network requests during the cooldown and reports the remaining wait instead of repeatedly hitting MangaHub
- Saves the cooldown in source state so recreating the source does not intentionally reset the wait; if saving fails, the active instance still enforces it
- Defers one access-key renewal until the next uncached chapter request after an API-message cooldown, since MangaHub also uses these messages for exhausted access-key quotas
- Does not renew the access key solely because of HTTP 429
- Continues serving unexpired cached page lists during the cooldown

Retry the chapter after the displayed wait; there is no automatic delayed retry. If the error keeps returning, pause bulk downloads, open the source's Cloudflare bypass, and complete any verification. The fallback cooldown is not a guarantee that MangaHub's server-side limit has expired.

Search and browse retain Netsky's original queries and parsing, using the shared rate-limited request manager. Cloudflare restrictions, site outages, and server rate limits can still prevent requests. In-app compatibility, live chapter loading, and performance gains have not been verified here.

See `THIRD_PARTY.md` for upstream attribution and licenses.
