# Paperback 0.8 installation

The installable repository is `0.8/`. It contains MangaHub 3.1.12, based on Netsky's 3.1.0 source, with chapter decryption adapted from Elrulia's 0.9 extension.

## Publish on GitHub Pages

1. In `HailXD/pb-extensions`, open Settings > Pages.
2. Set the build and deployment source to GitHub Actions.
3. Run the `Publish Paperback 0.8 repository` workflow if the initial push did not deploy.
4. Add this repository URL in Paperback 0.8:

   `https://hailxd.github.io/pb-extensions/0.8/`

The same URL opens a page with an Add to Paperback button.

Alternatively, serve the `0.8/` directory from any HTTPS static host and add its URL in Paperback. The installation button is configured for the GitHub Pages URL above.

## Update MangaHub

Install MangaHub 3.1.12 from this repository. The source ID remains `Mangahub`, and manga and chapter IDs are unchanged. This preserves the identifiers used by the original source; no library migration is intended. If the old repository also offers MangaHub, make sure Paperback selects version 3.1.12 from this repository.

If MangaHub asks for Cloudflare verification, use the source's Cloudflare bypass and retry the chapter. Previously failed downloads may need to be retried in Paperback.

## Optional ScrapingAnt page lists and images

ScrapingAnt is disabled by default. To try it:

1. Open MangaHub's source settings in Paperback after updating to 3.1.12
2. Enter one or both keys in `ScrapingAnt key 1` and `ScrapingAnt key 2`
3. Enable `ScrapingAnt page lists and images`
4. Open a chapter or retry a failed download

The masked fields save keys through Paperback's keychain-backed source store. No keys are embedded in the extension or committed to this repository. Clear both fields to remove the stored keys. Disabling the switch returns page-list and image requests to the direct connection without deleting the keys. The existing switch and saved keys carry over from earlier versions.

Chapter page-list GraphQL requests and chapter images from `imgx.mghcdn.com` go through ScrapingAnt, with `browser=false` and standard datacenter proxies. Cover images, search, manga details, chapter-list updates, access-token refresh, and decryption-key requests stay direct. Requests are rewritten in Paperback's request interceptor, so saved page lists retain the original image URLs without API keys. For page-list requests, ScrapingAnt receives the POST query, JSON content type, and MangaHub access token. Image requests do not forward that token, and neither request type forwards Cloudflare cookies. The interceptor returns Paperback's original native response object, preserving binary data for the image loader while updating the target status and headers. This avoids the `interceptRResponse` invalid-return-type error caused by returning a plain JavaScript object.

- With one key entered in either field, uses only that key for every proxied request; empty fields and duplicate keys are ignored
- Prefers a free usable key; alternates when both distinct keys are free, and waits when all usable keys are busy
- On a provider HTTP 403, marks that key unavailable for subsequent proxied requests; ScrapingAnt uses this status for invalid keys or exhausted credits
- On provider HTTP 409 or 429, temporarily skips that key using `Retry-After` or a 60-second fallback; retry the failed page after the cooldown or with another available key
- On a MangaHub chapter-page-list rate limit, requests a fresh MangaHub access token and retries once without adding a local cooldown
- Does not silently fall back to direct page-list or image requests when ScrapingAnt is enabled but unavailable
- Queues ScrapingAnt chapter-page-list and image requests together with one in-flight request per distinct key within a source instance: one usable key permits one request, two usable keys permit up to two
- Tracks slots by the actual key value, so duplicate entries share one slot and a key cannot be used concurrently with itself
- Holds each key's network slot until its response processing finishes, including provider errors and key-availability updates; direct requests do not use these slots
- Selects and reserves keys atomically with settings and key-state updates, but waits for network slots outside that state queue so waiting images cannot block active responses
- Leaves image retries to Paperback; queued requests that have waited at least the 30-second request timeout are rejected before sending when their turn arrives

After credits renew, use `Reset ScrapingAnt key availability` to let unavailable keys be tried again. Replacing a key also resets its local availability. This button does not reset either service's actual quota. Two keys may share one account's credits or concurrency limit.

A request with no response callback can hold the slot for up to 60 seconds before it is eligible for recovery. The watchdog releases it automatically where JavaScript timers are available. Otherwise, retry a page or reopen the source settings after 60 seconds to recover the expired slot. Late responses cannot release a newer request's slot. This recovery assumes native requests have stopped by then; the queue cannot cancel native transfers or coordinate other source instances, devices, or applications using the same ScrapingAnt account.

This is experimental and may add latency. It does not remove MangaHub's API rate limits or access-token requirements, or guarantee that ScrapingAnt can retrieve the image CDN's binary responses. Disable the switch if proxying does not help. In-app image downloads and live requests with user keys have not been verified during implementation.

Provider references: [request format](https://docs.scrapingant.com/request-response-format), [POST requests](https://docs.scrapingant.com/post-put-delete), [forwarded headers](https://docs.scrapingant.com/custom-headers), [errors and free-plan concurrency](https://docs.scrapingant.com/errors), [browser rendering](https://docs.scrapingant.com/headless-browser).

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
- Allows one access-token refresh and extra page-list request per chapter load after a MangaHub rate-limit response, separately from access-key and encryption-key retries

## Request optimizations

- Shares simultaneous requests for the same manga details, chapter list, or chapter pages; failed requests are not cached
- Keeps up to 16 chapter page lists in memory for 60 seconds, avoiding another API request and decryption when reopening a recent chapter
- Returns separate page arrays so callers cannot modify the cached page list
- Requests only chapter numbers, titles, and dates when refreshing a chapter list, omitting unused manga titles and chapter slugs
- Does not cache completed chapter-list requests, so a new refresh still checks for updates
- Limits scheduled requests to one per second to reduce bursts
- Separately serializes ScrapingAnt page lists and images per distinct key, allowing up to two concurrent requests with two usable keys; this is an in-flight limit, not just request spacing

## Rate-limit errors

- Detects HTTP 429 and rate-limit messages or codes in GraphQL errors; MangaHub chapter-page-list checks run in the loader so retryable errors do not cross Paperback's native interceptor boundary
- Formats chapter-list and chapter-page GraphQL errors with route details even when they reach the loader instead of being rejected by the interceptor
- Starts the error message with `[ScrapingAnt key 1]`, `[ScrapingAnt key 2]`, or `[Direct (local)]`, followed by the service and server reason, so the route is visible in a short toast; uses `ScrapingAnt` without a key number if the key cannot be identified, or `Unknown route` if Paperback supplies no request URL
- Includes the request stage, endpoint without query parameters, and HTTP status in the remaining error details
- Includes the server's message and GraphQL error code when supplied, plus `Retry-After` when available; this header is informational for MangaHub errors and does not impose a local cooldown
- Labels page-list, image, other API, decryption-key, access-token-refresh, and website requests separately
- Explains known provider statuses and identifies saved provider key availability blocks as local, with no HTTP request sent
- Redacts known keys and request credentials from server error details; diagnostics appear in the popup, not a log file
- Does not impose a local MangaHub cooldown or block manual retries; ignores cooldown state saved by older versions
- Refreshes the saved `x-mhub-access` token and retries a rate-limited MangaHub chapter page list once per chapter load; creates a new request so the retry uses the refreshed token through the configured direct or ScrapingAnt route
- Shares overlapping access-token refreshes; a repeated rate limit or failed refresh is surfaced instead of starting a refresh loop
- Does not refresh the MangaHub token for ScrapingAnt provider limits, local key-availability blocks, images, or other request stages
- MangaHub may return the same token or enforce an IP/account limit, so refreshing does not guarantee recovery
- Keeps the existing page-list cache and one-request-per-second scheduling
- ScrapingAnt provider key cooldowns remain separate and unchanged

Opening a chapter fetches its page list and images through ScrapingAnt when enabled, but access-token and decryption-key requests remain direct. The diagnostic identifies where a failure occurs; it cannot determine whether MangaHub's limit is per IP, token, or account unless the server supplies that information. The extension does not add a MangaHub cooldown or remove server-side limits.

Search and browse retain Netsky's original queries and parsing, using the shared rate-limited request manager. Cloudflare restrictions, site outages, and server rate limits can still prevent requests. In-app compatibility, live chapter loading, and performance gains have not been verified here.

See `THIRD_PARTY.md` for upstream attribution and licenses.
