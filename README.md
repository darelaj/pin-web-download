# Pinfold · Pinterest video downloader

A native responsive page and small Node.js 24 HTTP server. It previews and streams original native MP4 videos from the documented Pinterest API. No database, temporary media files, scraping, external resolvers, transcoding, analytics, paid services or deployment is included.

**Downloads are disabled by default.** This is an authorized-access implementation, not a downloader for arbitrary public Pins. Pinterest Get Pin is limited to Pins owned by the token account or shared boards accessible to it. Direct video fields require separate app eligibility. Creator permission does not replace Pinterest platform authorization.

## Run locally

Use Node 24 LTS:

```sh
npm ci --ignore-scripts
npm test
npm start
```

Visit `http://localhost:3000`. `GET /healthz` reports process health and whether a provider is configured; `provider: disabled` is healthy and intentional. It does not probe Pinterest or validate live credentials. The server listens on `0.0.0.0:3000`; keep local access bound/firewalled appropriately.

`.env.example` documents the variables. The app reads the process environment, not `.env` automatically. If using a local `.env`, use `node --env-file=.env src/index.js`; keep it untracked. Never put a token in browser code, URLs, Git, Docker build arguments, or shell history.

## Enable authorized access

Before enabling, the operator must obtain and retain documented Pinterest approval covering this downloader's use, including short-link resolution and transient ticket metadata handling, and verify the content owner's permission. Review Pinterest's terms and developer guidelines; an API token alone is not approval for downloading. This repository does not establish those permissions.

Configure `PINTEREST_PLATFORM_AUTHORIZED=true` only after that review, and inject `PINTEREST_ACCESS_TOKEN` as a server-side runtime secret. Use an eligible Pinterest application and a token with both `pins:read` and `boards:read` and the access required for Get Pin and Get Board. No OAuth enrollment UI is provided. A `permission: true` attestation is required for every lookup. Only authorized account-owned/shared Pins on explicitly public boards are supported; this is not a user authentication system, so restrict an enabled instance to the intended trusted audience with reverse-proxy authentication.

The current documented schema exposes `media.video_url` (MP4, documented as 720p) and per-item `video_url` in `multiple_videos`/`multiple_mixed`. The app offers every compatible direct native URL in those objects and reports only actual dimensions supplied by the API, never invented quality choices. It verifies MP4 MIME and declared limits before issuing tickets and checks the MP4 file signature while streaming. No codec/transcoding guarantee is made. Missing restricted fields, non-video Pins, unavailable access and HLS-only Pins have distinct errors. HLS, encrypted media, third-party embeds and synthetic resolutions are unsupported. There is no live HTML extractor.

Get Pin does **not** expose a definitive privacy flag in the reviewed official schema. After each Pin lookup, the adapter requires a numeric `board_id`, calls documented `GET /v5/boards/{board_id}` with the same server token, and verifies the returned `id` matches and `privacy` is explicitly `PUBLIC`. It never assumes the schema's default means a missing response field is public. Secret/protected/unknown/missing privacy, mismatched boards, missing board access, ad-only boards (`is_ads_only: true`) and ad-only Pins (`is_removable: true`) fail closed before any image/video fetch or ticket creation. This adds one bounded official API request per lookup (512 KiB response limit, 10-second transport deadline within the existing 30-second overall deadline). No board metadata is returned to the browser.

The operator must restrict the enabled instance to the intended authenticated trusted audience and ensure board/public status remains appropriate during the five-minute capability lifetime. Public-board verification does not establish copyright, creator permission or platform approval. If the provider cannot affirmatively establish public access, the Pin is unsupported; do not bypass this check or substitute an operator/user-supplied privacy flag.

When available, each MP4 format carries an opaque same-origin thumbnail capability from its documented video `cover_image_url`; top-level video media can also use only the named `ImageSize` entries (`600x`, `400x300`, `1200x`, `150x150`). Per-item video covers are supported. Optional absent/unsafe thumbnails fall back to a preview with no poster, and a rejected/failed image fetch leaves preview/download usable. The browser receives no CDN image URL. Image delivery accepts only exact `i.pinimg.com` HTTPS URLs, revalidates up to three redirects with the existing public-DNS/TLS-pinned transport, allows JPEG/PNG/WebP MIME types with matching magic bytes, rejects SVG and other formats, and limits both declared and streamed data to 2 MiB. Images are briefly buffered within that bound for verification, then served with `no-store`; they are never persisted or cached. This is signature validation, not a full image decoder. Image tickets share the format's opaque expiry and rate/concurrency limits. No arbitrary thumbnail URL input is accepted.

To unblock live acceptance testing: supply a reviewed platform authorization record, eligible provider/token access to restricted direct video fields, and a user-owned public sample explicitly permitted for the test. Do not send credentials in chat or commit them. No real Pin/video has been probed as part of fixture QA.

## Security and limits

- HTTPS-only explicit Pinterest input hosts, canonical numeric Pin paths and `pin.it` links. Short links use at most four manually validated HEAD hops; no Pinterest page bodies are read. Unsupported locale hosts fail closed; new ones require code review.
- Fixed official API origin (`api.pinterest.com`), exact native video CDN origin (`v.pinimg.com`) and a separate exact image CDN allowlist (`i.pinimg.com`). No wildcard CDN, URL download parameter, cookies, login, undocumented resources or environment-configurable remote provider.
- All upstream connections resolve DNS, reject any non-global answer (including mapped IPv6), pin a checked address for that connection, retain the original TLS hostname/certificate validation and recheck each allowed redirect. Network proxy environment variables are not used. Unexpected CDN hosts require a reviewed allowlist update; never broaden to arbitrary hosts.
- Each Pin/Board API response cap 512 KiB; image cap 2 MiB; input cap 4 KiB; video cap 100 MiB for both declared and streamed bodies; transport deadline 10 seconds; request work deadline 30 seconds. Preview uses the same byte limit. Client disconnect aborts active upstream work. MP4 signature or streaming failures may close a partially started response; the browser shows preview failure and downloads should be retried.
- At most 8 active API operations globally, 2 per client, 30 API requests per minute/client, 1,000 client counters, 500 opaque 256-bit tickets and 20 native media entries per Pin. Tickets expire after 5 minutes and disappear on restart. Tickets are bearer capabilities; logs must redact their paths. Request counts and concurrency limits are process-local; run one instance or enforce shared limits at your proxy.
- Only short-lived routing metadata is held in process memory; no media is cached or written to disk. The API is called on each lookup. Review this transient use against your specific authorization. Range requests receive bounded full `200` responses; seek support depends on the browser and downloaded file. No resume support.
- Logs contain only fixed event/error codes, status and startup port. No raw URLs, ticket paths, IPs, titles or upstream error bodies. Security headers enforce same-origin resources and prevent framing. Frontend metadata is inserted as text.
- Proxy headers are ignored by default. To preserve client rate limits behind a proxy, set `TRUST_PROXY_IPS` to exact directly connected peer addresses and have that proxy overwrite `X-Real-IP` with the actual client IP. `X-Forwarded-For` is never trusted. Never trust every address; keep the app port private. Without explicit proxy trust, all proxied requests share the proxy's quota.

## Container and reverse proxy

One nonroot image serves the API and static assets on port 3000. No volumes are needed. Build/run locally (no public exposure):

```sh
docker build --target test -t pinfold-test .
docker build -t pinfold .
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1:3000:3000 pinfold
```

The health check uses `/healthz`; SIGINT/SIGTERM abort work and close connections with a five-second exit bound. Runtime image includes only production source/assets and the IP classification dependency, not fixture scripts/tests. The base uses Node 24 Alpine; review/pin its digest in your deployment supply-chain process before release.

Terminate HTTPS at a reverse proxy, authenticate access if enabled, limit request bodies to 4 KiB, impose rate/concurrency/bandwidth limits, disable response buffering for streaming, allow at least 35 seconds for responses, and keep upstream app access private. Do not log `/api/preview/*`, `/api/download/*` or `/api/thumbnail/*` capability paths. Set a suitable HSTS policy at the HTTPS proxy. Avoid serving multiple instances without sticky/shared tickets and shared limits.

## Future Coolify setup — requires approval; not performed

After review and explicit deployment approval only, follow [Coolify's Dockerfile build instructions](https://coolify.io/docs/applications/builds/dockerfile): create a Git repository application from this repository, select `develop`, choose Dockerfile, set Base Directory `/`, Dockerfile Location `/Dockerfile`, port `3000`, and health path `/healthz`. Keep auto-deployment and public preview disabled until separately approved. Inject secrets as runtime variables; do not add storage. Configure private upstream networking, TLS, authentication, redacted proxy logs and resource limits. No Coolify/Hostinger/VPS account or deployment was accessed during implementation.

## Verification

`npm test` runs unit/security tests and real loopback HTTP integrations with dependency-injected fixtures. `scripts/fixture-server.mjs` uses the official adapter with a strictly local in-memory transport and locally generated MP4; it listens on `127.0.0.1:3100` only. It is not a production configuration option.

For browser QA, install Python Playwright and its Chromium browser, start `node scripts/fixture-server.mjs`, then run `python scripts/browser-qa.py` in another terminal. Screenshots are written under ignored `artifacts/`. If using an already installed browser build, set the test-only `BROWSER_EXECUTABLE_PATH` variable to its executable. The checked-in sample is a one-second locally generated VP9-in-MP4 file; no third-party content is included. The test-only GitHub Actions workflow runs container integration, safe default entry-point checks, and fixture browser QA on `develop`; it has read-only repository permission and no deployment step. See [QA.md](QA.md) for actual results and unverified gates.

## Publication without losing local history

If credentials are unavailable, keep this checkout or its Git bundle. On an authorized machine with GitHub authentication, run:

```sh
git bundle verify ../pin-web-download-review.bundle
# If using the original checkout:
git push --atomic origin main develop
# Or restore elsewhere:
git clone -b develop /path/to/pin-web-download-review.bundle pin-web-download
git -C pin-web-download remote set-url origin https://github.com/darelaj/pin-web-download.git
git -C pin-web-download branch main origin/main
git -C pin-web-download push --atomic origin main develop
```

Before pushing, confirm the remote is still empty with `git ls-remote`. If it has changed, fetch and review rather than force pushing. Verify the remote refs match local `git rev-parse main develop`. Never merge or deploy as part of publication.

## Sources and compatibility decisions

- [Official Get Board](https://developers.pinterest.com/docs/api/v5/boards-get/) and [official Board schema](https://github.com/pinterest/pinterest-python-generated-api-client/blob/main/docs/Board.md) inform the explicit public-board gate.
- [Official Get Pin](https://developers.pinterest.com/docs/api/v5/pins-get/) and [official OpenAPI schema](https://github.com/pinterest/api-description/blob/main/v5/openapi.yaml) (reviewed schema version 5.32.0; `PinMediaWithVideo`, `VideoMetadataWithItemType`, `PinMediaWithVideos`, `PinMediaWithImageAndVideo`).
- [Pinterest FAQs](https://developers.pinterest.com/docs/faqs/faqs/), [terms](https://policy.pinterest.com/en/terms-of-service), [developer guidelines](https://policy.pinterest.com/en/developer-guidelines).
- [yt-dlp Pinterest extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/pinterest.py) was compatibility research only: its native/story/HLS/embed handling does not grant authorization and is not reused for network traversal.
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) informed allowlisting, DNS validation, pinned connections and redirect handling.
