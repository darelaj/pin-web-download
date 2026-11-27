# Pinfold · Pinterest video downloader

A native responsive page and small Node.js 24 HTTP server. It previews and streams original native MP4 videos using either the documented Pinterest API or a separately opted-in anonymous public-page reader for permitted personal use. No database, temporary media files, bulk crawling, external resolvers, transcoding, analytics, paid services or deployment is included.

**Downloads are disabled by default.** Choose exactly one permitted provider. Official API mode remains the default and requires eligible account/app access. Public-page mode requires separate explicit opt-in; it does not use API credentials. Public availability and personal use do not establish permission for automated Pinterest access. Creator permission and Pinterest permission are separate.

## Run locally

Use Node 24 LTS:

```sh
npm ci --ignore-scripts
npm test
npm start
```

Visit `http://localhost:3000`. `GET /healthz` reports process health and whether a provider is configured; `provider: disabled` is healthy and intentional. It does not probe Pinterest or validate live credentials. The server listens on `0.0.0.0:3000`; keep local access bound/firewalled appropriately.

`.env.example` documents the variables. The app reads the process environment, not `.env` automatically. If using a local `.env`, use `node --env-file=.env src/index.js`; keep it untracked. Never put a token in browser code, URLs, Git, Docker build arguments, or shell history.

## Official API mode (default)

Before enabling, the operator must obtain and retain documented Pinterest approval covering this downloader's use, including short-link resolution and transient ticket metadata handling, and verify the content owner's permission. Review Pinterest's terms and developer guidelines; an API token alone is not approval for downloading. This repository does not establish those permissions.

Keep `PINTEREST_PROVIDER=official`, configure `PINTEREST_PLATFORM_AUTHORIZED=true` only after that review, and inject `PINTEREST_ACCESS_TOKEN` as a server-side runtime secret. Use an eligible Pinterest application and a token with both `pins:read` and `boards:read` and the access required for Get Pin and Get Board. No OAuth enrollment UI is provided. A `permission: true` attestation is required for every lookup. Only authorized account-owned/shared Pins on explicitly public boards are supported; this is not a user authentication system, so restrict an enabled instance to the intended trusted audience with reverse-proxy authentication.

The current documented schema exposes `media.video_url` (MP4, documented as 720p) and per-item `video_url` in `multiple_videos`/`multiple_mixed`. The app offers every compatible direct native URL in those objects and reports only actual dimensions supplied by the API, never invented quality choices. It verifies MP4 MIME and declared limits before issuing tickets and checks the MP4 file signature while streaming. No codec/transcoding guarantee is made. Missing restricted fields, non-video Pins, unavailable access and HLS-only Pins have distinct errors. HLS, encrypted media, third-party embeds and synthetic resolutions are unsupported. This mode never falls back to HTML extraction when API access is denied.

Get Pin does **not** expose a definitive privacy flag in the reviewed official schema. After each Pin lookup, the adapter requires a numeric `board_id`, calls documented `GET /v5/boards/{board_id}` with the same server token, and verifies the returned `id` matches and `privacy` is explicitly `PUBLIC`. It never assumes the schema's default means a missing response field is public. Secret/protected/unknown/missing privacy, mismatched boards, missing board access, ad-only boards (`is_ads_only: true`) and ad-only Pins (`is_removable: true`) fail closed before any image/video fetch or ticket creation. This adds one bounded official API request per lookup (512 KiB response limit, 10-second transport deadline within the existing 30-second overall deadline). No board metadata is returned to the browser.

The operator must restrict the enabled instance to the intended authenticated trusted audience and ensure board/public status remains appropriate during the five-minute capability lifetime. Public-board verification does not establish copyright, creator permission or platform approval. If the provider cannot affirmatively establish public access, the Pin is unsupported; do not bypass this check or substitute an operator/user-supplied privacy flag.

When available, each MP4 format carries an opaque same-origin thumbnail capability from its documented video `cover_image_url`; top-level video media can also use only the named `ImageSize` entries (`600x`, `400x300`, `1200x`, `150x150`). Per-item video covers are supported. Optional absent/unsafe thumbnails fall back to a preview with no poster, and a rejected/failed image fetch leaves preview/download usable. The browser receives no CDN image URL. Image delivery accepts only exact `i.pinimg.com` HTTPS URLs, revalidates up to three redirects with the existing public-DNS/TLS-pinned transport, allows JPEG/PNG/WebP MIME types with matching magic bytes, rejects SVG and other formats, and limits both declared and streamed data to 2 MiB. Images are briefly buffered within that bound for verification, then served with `no-store`; they are never persisted or cached. This is signature validation, not a full image decoder. Image tickets share the format's opaque expiry and rate/concurrency limits. No arbitrary thumbnail URL input is accepted.

To unblock live acceptance testing: supply a reviewed automated-access authorization record and a user-owned public sample explicitly permitted for the test. Official API mode additionally requires eligible provider/token access to restricted direct video fields. Do not send credentials in chat or commit them. Fixture QA uses only synthetic HTML/local media. Separately approved live attempts and their actual limitations are recorded in QA.md.

## Anonymous public-page mode (separate opt-in)

This mode is for permitted personal use of content the user owns or has permission to download. [Pinterest’s terms](https://policy.pinterest.com/en/terms-of-service) restrict unauthorized automated access, and its [developer guidelines](https://policy.pinterest.com/en/developer-guidelines) also apply as relevant. A public URL, an anonymous HTTP 200 response, a content-owner permission or these configuration switches do **not** establish Pinterest authorization. The operator must verify automated access is permitted for the intended use before enabling or making live requests.

Explicitly select the provider and opt in at runtime:

```dotenv
PINTEREST_PROVIDER=public-page
PINTEREST_PUBLIC_PAGE_ENABLED=true
```

Neither an API token nor API app eligibility is needed for this mode. `PINTEREST_PLATFORM_AUTHORIZED` controls official API mode only; the separate public-page opt-in is the operator's attestation that this use is permitted, not a mechanism that obtains permission. Leave the opt-in false until that is established. There is no automatic fallback between providers. Per-request content permission is still required, and the enabled instance must stay private to the intended authenticated user/audience. The app itself supplies no sign-in system.

The provider resolves the requested standard/short Pin link with the existing guarded transport and requests that Pin's ordinary anonymous HTML page; the tightly corroborated alias case below permits one additional canonical page. At most three further same-Pin page redirects are allowed; login, other Pin IDs, arbitrary paths/hosts, 401/403/429 responses and detected challenges fail closed. Requests use an honest Pinfold user agent and no authorization, cookies, stored session, signed-in browser, proxy rotation or bot challenge solver. Server-set cookies are ignored. There are no undocumented resource/API requests, script execution, third-party embed requests or media-resolver services.

The parser uses parse5's HTML tree, not a JavaScript evaluator. It retains the legacy `__PWS_DATA__` / `__PWS_INITIAL_PROPS__` readers, runtime-shell handling and fail-closed malformed/conflicting-source checks. Legacy Pin records still require explicit `is_private: false` and public Board privacy. Missing video state is distinguished from genuine conflicting identities; inert CSS/script text is not a visible challenge. A visible video shell alone is never an extraction source.

The newer anonymous completed-Relay path reads **only** inline script elements whose exact attribute is `data-relay-completed-request="true"`, and whose entire text is the exact `window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__(JSON-string, JSON-object);` wrapper. A bounded scanner finds the two JSON arguments and `JSON.parse` decodes them; no eval, VM, browser script execution, callback invocation, internal GraphQL/resource request or network request described by the data occurs. Other scripts are not searched for a media URL.

For the requested Pin only, the URI-encoded descriptor must have `variables.pinId` as the matching string, `isAuth: false`, optional `isAuthDesktop: false` and optional `isUnauth: true`. Only `.data.v3GetPinQueryv2.data` is considered. A media-bearing record must match in all three places: `entityId`, strict base64 typed ID decoding exactly to `Pin:<id>`, and `seoUrl` exactly `/pin/<id>/`. Unrelated completed requests are ignored rather than searched. Sparse/duplicate self-bound completions may provide the same media, but conflicting identities/dimensions, malformed applicable data or explicit error/access/private/auth/restricted/DRM/encrypted flags fail closed, even if another completion contains usable media.

This exact anonymous provenance path can handle the observed record shape without explicit privacy fields; it does **not** assert ownership, platform permission, permanent visibility or eligibility of arbitrary records. Generic sign-in UI can coexist with data already exposed to the anonymous request, but explicit Pin gates, login-required instructions, active challenges, authenticated descriptors, private/protected data and DRM remain rejected. No credentials, cookie jar, signed-in session or access-control workaround is used.

Native media is read only from the bound Pin's `storyPinData.pages[].blocks[]` with `__typename: StoryPinVideoBlock`, then `videoDataV2.videoList720P` values. Only explicit, validated MP4 `url`, `width` and `height` are used. A `v720P` key can contain a 540px-wide file; the UI reports the numeric dimensions supplied, not a guessed resolution. Sparse entries never create dimensions or media paths. Legacy native `videos.video_list` remains supported. Exact approved media hosts are `v.pinimg.com` and `v1.pinimg.com`; other hosts are rejected. Optional thumbnails still use the separate exact `i.pinimg.com` allowlist and existing image protections. No HLS, external embeds, arbitrary CDN guessing, transcode or synthetic format is supported.

A differing canonical Pin ID is **not** an automatic fallback. Canonical and OG must agree on one allowed Pin URL, the original page must contain an exactly self-bound anonymous Relay record for the requested ID, and one independent anonymous GET of that canonical page must provide an equally self-bound record for its own ID. That second page must be self-canonical (no chain). Only variants with an identical validated MP4 URL **and dimensions** on both pages may be served. Missing, private, blocked, authenticated or conflicting proof fails without issuing a media ticket. The initial locale host is retained for ordinary standard links; all page redirects retain the exact Pin ID and existing allowlist/IP pinning.

HTML is limited to 2 MiB/page, each completed script to 512 KiB, the encoded descriptor to 64 KiB, decoded payload nesting to 80 levels, and completed scripts to 64/page. Existing HTML tree limits (50,000 nodes / 100 levels) remain. Relay pages/blocks/format maps are bounded at 20 each and total usable variants at 20. Alias proof adds at most one independently fetched page, with at most three same-ID redirects per page, under the shared 30-second request deadline and 10-second connection deadlines. No page/media is persisted; five-minute opaque capabilities remain process-local snapshots.

**Local live acceptance remains unverified.** The two explicitly approved public samples were attempted through the app's metadata endpoint. This runtime returned `502 upstream_unavailable` for both; a guarded request exposed `EAI_AGAIN` at DNS before any Pinterest response. The parent supplied separately verified no-cookie page/HEAD observations that informed the synthetic fixtures; those are not counted as local end-to-end passes. See QA.md. No live HTML, personal media or raw Relay fixture was committed. Do not weaken transport/auth/privacy checks to make a failed live request succeed.

## Security and limits

- HTTPS-only explicit Pinterest input hosts, canonical numeric Pin paths and `pin.it` links. Short links use at most four manually validated, anonymous HEAD hops. The exact `api.pinterest.com/url_shortener/<original-code>/redirect/` handoff is accepted only as a redirect from the same `pin.it` short code; it is never valid external input and receives no authorization/cookies. Terminal `/pin/<digits>/sent/` links are reduced to canonical Pin identity and their query is discarded, without fetching the terminal route. Official mode reads no page bodies; opted-in public mode reads the requested Pin page plus at most one independently corroborated canonical alias page, with bounded same-Pin redirects. Unsupported locale hosts fail closed; new ones require code review.
- Fixed official API origin (`api.pinterest.com`), exact native video CDN origins (`v.pinimg.com`, `v1.pinimg.com`) and a separate exact image CDN allowlist (`i.pinimg.com`). No wildcard CDN, URL download parameter, cookies, login, undocumented resources or arbitrary environment-configurable remote provider.
- All upstream connections resolve DNS, reject any non-global answer (including mapped IPv6), pin a checked address for that connection, retain the original TLS hostname/certificate validation and recheck each allowed redirect. Network proxy environment variables are not used. Unexpected CDN hosts require a reviewed allowlist update; never broaden to arbitrary hosts.
- Public HTML cap 2 MiB / embedded JSON cap 512 KiB; each Pin/Board API response cap 512 KiB; image cap 2 MiB; input cap 4 KiB; video cap 100 MiB for both declared and streamed bodies; transport deadline 10 seconds; request work deadline 30 seconds. Preview uses the same byte limit. Client disconnect aborts active upstream work. MP4 signature or streaming failures may close a partially started response; the browser shows preview failure and downloads should be retried.
- At most 8 active API operations globally, 2 per client, 30 API requests per minute/client, 1,000 client counters, 500 opaque 256-bit tickets and 20 native media entries per Pin. Tickets expire after 5 minutes and disappear on restart. Tickets are bearer capabilities; logs must redact their paths. Request counts and concurrency limits are process-local; run one instance or enforce shared limits at your proxy.
- Only short-lived routing metadata is held in process memory; no media is cached or written to disk. The selected provider fetches fresh metadata for each lookup. Review this transient use against your specific authorization. Range requests receive bounded full `200` responses; seek support depends on the browser and downloaded file. No resume support.
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

The health check uses `/healthz`; SIGINT/SIGTERM abort work and close connections with a five-second exit bound. Runtime image includes only production source/assets and production dependencies (IP classification and HTML parsing), not fixture scripts/tests. The base uses Node 24 Alpine; review/pin its digest in your deployment supply-chain process before release.

Terminate HTTPS at a reverse proxy, authenticate access if enabled, limit request bodies to 4 KiB, impose rate/concurrency/bandwidth limits, disable response buffering for streaming, allow at least 35 seconds for responses, and keep upstream app access private. Do not log `/api/preview/*`, `/api/download/*` or `/api/thumbnail/*` capability paths. Set a suitable HSTS policy at the HTTPS proxy. Avoid serving multiple instances without sticky/shared tickets and shared limits.

## Future Coolify setup — requires approval; not performed

After review and explicit deployment approval only, follow [Coolify's Dockerfile build instructions](https://coolify.io/docs/applications/builds/dockerfile): create a Git repository application from this repository, select `develop`, choose Dockerfile, set Base Directory `/`, Dockerfile Location `/Dockerfile`, port `3000`, and health path `/healthz`. Keep auto-deployment and public preview disabled until separately approved. Inject secrets as runtime variables; do not add storage. Configure private upstream networking, TLS, authentication, redacted proxy logs and resource limits. No Coolify/Hostinger/VPS account or deployment was accessed during implementation.

## Verification

`npm test` runs unit/security tests and real loopback HTTP integrations with dependency-injected fixtures. `scripts/fixture-server.mjs` uses the official adapter by default, or `--public-page` to exercise the anonymous HTML parser with synthetic pages, with a strictly local in-memory transport and locally generated MP4; it listens on `127.0.0.1:3100` only. It is not a production configuration option.

For public-page browser QA, start `node scripts/fixture-server.mjs --public-page` and run `python scripts/browser-qa.py --public-page`. For official-mode browser QA, install Python Playwright and its Chromium browser, start `node scripts/fixture-server.mjs`, then run `python scripts/browser-qa.py` in another terminal. Screenshots are written under ignored `artifacts/official/` or `artifacts/public-page/`. If using an already installed browser build, set the test-only `BROWSER_EXECUTABLE_PATH` variable to its executable. The checked-in clips are one-second locally generated VP9-in-MP4 files (320×180 legacy and 540×960 Relay); no third-party content is included. The test-only GitHub Actions workflow runs container integration, safe default entry-point checks, and fixture browser QA on `develop`; it has read-only repository permission and no deployment step. See [QA.md](QA.md) for actual results and unverified gates.

## Review branch and verification

Use the published [`develop` branch](https://github.com/darelaj/pin-web-download/tree/develop). GitHub commit metadata differs from the original local bundle, but the individual task boundaries and file trees were preserved. Do not force-push the original bundle refs over the published branches.

[GitHub Actions](https://github.com/darelaj/pin-web-download/actions/runs/45834060039) verified Docker image build, running container health, the integration/security suite inside Docker, and responsive Chromium checks with fixtures. This verifies the previous official-mode application tree; it does not verify this new public-page change, live Pinterest access, real codecs, or a Coolify deployment. The current change needs a fresh verify-only CI run after review/publication. See [QA.md](QA.md).

## Sources and compatibility decisions

- [Official Get Board](https://developers.pinterest.com/docs/api/v5/boards-get/) and [official Board schema](https://github.com/pinterest/pinterest-python-generated-api-client/blob/main/docs/Board.md) inform the explicit public-board gate.
- [Official Get Pin](https://developers.pinterest.com/docs/api/v5/pins-get/) and [official OpenAPI schema](https://github.com/pinterest/api-description/blob/main/v5/openapi.yaml) (reviewed schema version 5.32.0; `PinMediaWithVideo`, `VideoMetadataWithItemType`, `PinMediaWithVideos`, `PinMediaWithImageAndVideo`).
- [Pinterest FAQs](https://developers.pinterest.com/docs/faqs/faqs/), [terms](https://policy.pinterest.com/en/terms-of-service), [developer guidelines](https://policy.pinterest.com/en/developer-guidelines).
- [yt-dlp Pinterest extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/pinterest.py) was compatibility research only (native video-list field names, with no upstream code copied): its native/story/HLS/embed handling does not grant authorization and is not reused for network traversal. Public HTML layouts are explicitly unversioned and fail closed when unsupported.
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) informed allowlisting, DNS validation, pinned connections and redirect handling.
