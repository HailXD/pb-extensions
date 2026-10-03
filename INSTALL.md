# Paperback 0.8 installation

The installable repository is `0.8/`. It contains MangaHub 3.1.6, based on Netsky's 3.1.0 source, with chapter decryption adapted from Elrulia's 0.9 extension.

## Publish on GitHub Pages

1. In `HailXD/pb-extensions`, open Settings > Pages.
2. Set the build and deployment source to GitHub Actions.
3. Run the `Publish Paperback 0.8 repository` workflow if the initial push did not deploy.
4. Add this repository URL in Paperback 0.8:

   `https://hailxd.github.io/pb-extensions/0.8/`

The same URL opens a page with an Add to Paperback button.

Alternatively, serve the `0.8/` directory from any HTTPS static host and add its URL in Paperback. The installation button is configured for the GitHub Pages URL above.

## Update MangaHub

Install MangaHub 3.1.6 from this repository. The source ID remains `Mangahub`, and manga and chapter IDs are unchanged. This preserves the identifiers used by the original source; no library migration is intended. If the old repository also offers MangaHub, make sure Paperback selects version 3.1.6 from this repository.

If MangaHub asks for Cloudflare verification, use the source's Cloudflare bypass and retry the chapter. Previously failed downloads may need to be retried in Paperback.

## Optional ScrapingAnt page image downloads

ScrapingAnt is disabled by default. To try it:

1. Open MangaHub's source settings in Paperback after updating to 3.1.6
2. Enter one or both keys in `ScrapingAnt key 1` and `ScrapingAnt key 2`
3. Enable `ScrapingAnt page image downloads`
4. Open a chapter or retry a failed download

The masked fields save keys through Paperback's keychain-backed source store. No keys are embedded in the extension or committed to this repository. Clear both fields to remove the stored keys. Disabling the switch returns page image requests to the direct connection without deleting the keys. The existing switch and saved keys carry over from 3.1.4.

Only chapter page images from `imgx.mghcdn.com` go through ScrapingAnt, with `browser=false` and standard datacenter proxies. Chapter page lists, cover images, search, manga details, chapter-list updates, access-token refresh, and decryption-key requests stay direct. Image requests are rewritten in Paperback's request interceptor, so saved page lists retain the original image URLs without API keys. ScrapingAnt receives the image URL and image request headers, not the MangaHub access token or Cloudflare cookies. Binary response data is preserved for Paperback's image loader.

- With one key entered in either field, uses only that key for every image request; empty fields and duplicate keys are ignored
- Alternates keys only when both distinct keys are entered and usable
- On a provider HTTP 403, marks that key unavailable for subsequent image requests; ScrapingAnt uses this status for invalid keys or exhausted credits
- On provider HTTP 409 or 429, temporarily skips that key using `Retry-After` or a 60-second fallback; retry the failed page after the cooldown or with another available key
- Reports MangaHub rate-limit responses without adding a local cooldown
- Does not silently fall back to direct image requests when ScrapingAnt is enabled but unavailable
- Leaves image scheduling and retries to Paperback; source key selection is serialized, but native image downloads may overlap and reach the provider's concurrency limit

After credits renew, use `Reset ScrapingAnt key availability` to let unavailable keys be tried again. Replacing a key also resets its local availability. This button does not reset either service's actual quota. Two keys may share one account's credits or concurrency limit.

This is experimental and may add latency. It does not remove MangaHub's API rate limits or access-token requirements, or guarantee that ScrapingAnt can retrieve the image CDN's binary responses. Disable the switch if proxying does not help. In-app image downloads and live requests with user keys have not been verified during implementation.

Provider references: [request format](https://docs.scrapingant.com/request-response-format), [forwarded headers](https://docs.scrapingant.com/custom-headers), [errors and free-plan concurrency](https://docs.scrapingant.com/errors), [browser rendering](https://docs.scrapingant.com/headless-browser).

## Maintain the extension

Edit `src/chapter-crypto.js`, `src/scrapingant.js`, `src/mangahub.js`, or `src/source-info.json`, then run:

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

## Rate-limit errors

- Detects HTTP 429 and rate-limit messages or codes in GraphQL errors across the shared request manager
- Shows the server's error message when available, or HTTP 429 when no message is available
- Labels the failing request as MangaHub API, decryption key, page image, or website
- Does not impose a local MangaHub cooldown or block manual retries; ignores cooldown state saved by older versions
- Does not automatically retry or renew the access key in response to a rate-limit error
- Keeps the existing page-list cache and one-request-per-second scheduling
- ScrapingAnt provider key cooldowns remain separate and unchanged

Opening a chapter first fetches its page list directly from MangaHub's API and may also fetch an access token or decryption key. ScrapingAnt only proxies the subsequent image requests, so it does not affect rate limits on those direct requests. Removing the extension's cooldown exposes the underlying server error but does not remove MangaHub's server-side limits.

Search and browse retain Netsky's original queries and parsing, using the shared rate-limited request manager. Cloudflare restrictions, site outages, and server rate limits can still prevent requests. In-app compatibility, live chapter loading, and performance gains have not been verified here.

See `THIRD_PARTY.md` for upstream attribution and licenses.
