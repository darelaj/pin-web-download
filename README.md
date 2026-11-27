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

To unblock live acceptance testing: supply a reviewed automated-access authorization record and a user-owned public sample explicitly permitted for the test. Official API mode additionally requires eligible provider/token access to restricted direct video fields. Do not send credentials in chat or commit them. No real Pin/video has been probed as part of fixture QA.

## Anonymous public-page mode (separate opt-in)

This mode is for permitted personal use of content the user owns or has permission to download. [Pinterest’s terms](https://policy.pinterest.com/en/terms-of-service) restrict unauthorized automated access, and its [developer guidelines](https://policy.pinterest.com/en/developer-guidelines) also apply as relevant. A public URL, an anonymous HTTP 200 response, a content-owner permission or these configuration switches do **not** establish Pinterest authorization. The operator must verify automated access is permitted for the intended use before enabling or making live requests.

Explicitly select the provider and opt in at runtime:

```dotenv
PINTEREST_PROVIDER=public-page
PINTEREST_PUBLIC_PAGE_ENABLED=true
```

Neither an API token nor API app eligibility is needed for this mode. `PINTEREST_PLATFORM_AUTHORIZED` controls official API mode only; the separate public-page opt-in is the operator's attestation that this use is permitted, not a mechanism that obtains permission. Leave the opt-in false until that is established. There is no automatic fallback between providers. Per-request content permission is still required, and the enabled instance must stay private to the intended authenticated user/audience. The app itself supplies no sign-in system.

The provider resolves the requested standard/short Pin link with the existing guarded transport and requests only that Pin's ordinary anonymous HTML page. At most three further same-Pin page redirects are allowed; login, other Pin IDs, arbitrary paths/hosts, 401/403/429 responses and detected challenges fail closed. Requests use an honest Pinfold user agent and no authorization, cookies, stored session, signed-in browser, proxy rotation or bot challenge solver. Server-set cookies are ignored. There are no undocumented resource/API requests, script execution, third-party embed requests or media-resolver services.

The parser uses parse5's HTML tree, not a JavaScript evaluator. It requires exactly one matching canonical Pin URL and one recognized JSON state script: `__PWS_DATA__.props.initialReduxState.pins[requested_id]` or `__PWS_INITIAL_PROPS__.initialReduxState.pins[requested_id]`. The object's ID must match. It never traverses recommendations or arbitrary JSON trees in search of a video, and ignores comments/templates/noscript decoys. The requested Pin must explicitly contain `is_private: false` and a Board with `privacy: public` (or `PUBLIC`), with no conflicting private/protected/ad-only signals. Missing visibility proof is unsupported, even if the page returned HTTP 200. These are unversioned embedded page shapes, not a stable API or proof of copyright/permission.

Only that Pin's native `videos.video_list` direct `v.pinimg.com` MP4 variants are mapped; optional images come from named entries under the same Pin. All existing exact CDN/image allowlists, pinned DNS/TLS transport, MP4 MIME/signature checks, opaque scoped tickets, thumbnail safety, rate/concurrency limits and expiry remain in use. Private/unavailable/DRM/encrypted media, external embeds, login requirements, HLS-only media, story layouts, unknown state formats and malformed/ambiguous/misbound data are rejected. No access-control bypass or synthetic/transcoded resolution is implemented.

HTML is limited to 2 MiB, each recognized JSON script to 512 KiB, the tree to 50,000 nodes / 100 levels and the native list to 20 entries. The shared 10-second per-connection and 30-second work deadlines apply. Pages/images/media are not persisted. Public visibility is a short-lived snapshot for five-minute capability issuance; do not share capabilities, and recheck permission/visibility before use if circumstances change.

**Live compatibility is unverified.** No permissioned real sample or authorization for automated Pinterest access was available in this task, so only synthetic HTML and locally generated media were tested. Real pages may omit the positive visibility fields, use another state layout, require login, or block automation; those cases return errors. Do not weaken the checks or add session/challenge workarounds to make such pages succeed.

## Security and limits

- HTTPS-only explicit Pinterest input hosts, canonical numeric Pin paths and `pin.it` links. Short links use at most four manually validated, anonymous HEAD hops. The exact `api.pinterest.com/url_shortener/<original-code>/redirect/` handoff is accepted only as a redirect from the same `pin.it` short code; it is never valid external input and receives no authorization/cookies. Terminal `/pin/<digits>/sent/` links are reduced to canonical Pin identity and their query is discarded, without fetching the terminal route. Official mode reads no page bodies; opted-in public mode reads one requested Pin page with bounded same-Pin redirects. Unsupported locale hosts fail closed; new ones require code review.
- Fixed official API origin (`api.pinterest.com`), exact native video CDN origin (`v.pinimg.com`) and a separate exact image CDN allowlist (`i.pinimg.com`). No wildcard CDN, URL download parameter, cookies, login, undocumented resources or arbitrary environment-configurable remote provider.
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

For public-page browser QA, start `node scripts/fixture-server.mjs --public-page` and run `python scripts/browser-qa.py --public-page`. For official-mode browser QA, install Python Playwright and its Chromium browser, start `node scripts/fixture-server.mjs`, then run `python scripts/browser-qa.py` in another terminal. Screenshots are written under ignored `artifacts/official/` or `artifacts/public-page/`. If using an already installed browser build, set the test-only `BROWSER_EXECUTABLE_PATH` variable to its executable. The checked-in sample is a one-second locally generated VP9-in-MP4 file; no third-party content is included. The test-only GitHub Actions workflow runs container integration, safe default entry-point checks, and fixture browser QA on `develop`; it has read-only repository permission and no deployment step. See [QA.md](QA.md) for actual results and unverified gates.

## Review branch and verification

Use the published [`develop` branch](https://github.com/darelaj/pin-web-download/tree/develop). GitHub commit metadata differs from the original local bundle, but the individual task boundaries and file trees were preserved. Do not force-push the original bundle refs over the published branches.

[GitHub Actions](https://github.com/darelaj/pin-web-download/actions/runs/45834060039) verified Docker image build, running container health, the integration/security suite inside Docker, and responsive Chromium checks with fixtures. This verifies the previous official-mode application tree; it does not verify this new public-page change, live Pinterest access, real codecs, or a Coolify deployment. The current change needs a fresh verify-only CI run after review/publication. See [QA.md](QA.md).

## Sources and compatibility decisions

- [Official Get Board](https://developers.pinterest.com/docs/api/v5/boards-get/) and [official Board schema](https://github.com/pinterest/pinterest-python-generated-api-client/blob/main/docs/Board.md) inform the explicit public-board gate.
- [Official Get Pin](https://developers.pinterest.com/docs/api/v5/pins-get/) and [official OpenAPI schema](https://github.com/pinterest/api-description/blob/main/v5/openapi.yaml) (reviewed schema version 5.32.0; `PinMediaWithVideo`, `VideoMetadataWithItemType`, `PinMediaWithVideos`, `PinMediaWithImageAndVideo`).
- [Pinterest FAQs](https://developers.pinterest.com/docs/faqs/faqs/), [terms](https://policy.pinterest.com/en/terms-of-service), [developer guidelines](https://policy.pinterest.com/en/developer-guidelines).
- [yt-dlp Pinterest extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/pinterest.py) was compatibility research only (native video-list field names, with no upstream code copied): its native/story/HLS/embed handling does not grant authorization and is not reused for network traversal. Public HTML layouts are explicitly unversioned and fail closed when unsupported.
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) informed allowlisting, DNS validation, pinned connections and redirect handling.
