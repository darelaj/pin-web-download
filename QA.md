# QA report

Updated: 2026-11-27 (original official-mode QA: 2026-11-26). Workspace: isolated `pin-web-download` clone. Node: 24.22.3. No live Pinterest Pin or video was accessed. No public preview or deployment was created.

## Executed checks

| Check | Actual result |
|---|---|
| `npm test` after final application changes | 48 tests passed; 0 failed, skipped or cancelled |
| Actual production `node src/index.js` | Child process served health and UI, default provider returned 503, logs contained no URL, SIGTERM exited with code 0 |
| Official provider and standard/short link fixtures | Canonical ID, documented metadata mapping, bounded HEAD redirects, unavailable/non-video/HLS behavior passed |
| Metadata → opaque preview/download HTTP flow | MP4 content type/disposition, exact response bytes and no exposed upstream media URL passed |
| Security boundaries | Explicit URL/CDN allowlists, numeric identity, userinfo/port/protocol/fragment/dot-path rejection, special IPv4/IPv6/mapped/documentation addresses, mixed DNS answers and pinned IP with original TLS hostname passed |
| Resource limits | API declared/actual body limits, input cap, declared/streamed media cap, MIME/encoding/MP4 signature checks, redirect cap, rate/proxy spoofing, concurrency saturation, request deadline, ticket expiry and disconnect abort passed |
| Thumbnail/public-access follow-up | Explicit public-board match, privacy/ad-only rejection, missing board ID/access, oversized board body, documented cover/ImageSize mapping, separate image-host allowlist, MIME/signature/redirect/size boundaries, exact HTTP image bytes, no CDN URL leakage and expiry passed |
| Browser desktop 1440 × 1000 | Real form, short-link fixture through official Pin + public Board adapter, decoded poster/image bytes, preview playback/currentTime, attachment bytes, no overflow: passed |
| Browser tablet 768 × 1024 | Same full flow passed |
| Browser mobile 390 × 844 and 320 × 740 | Same full flow passed at both widths |
| Browser UI states | Empty/loading/success/non-video/HLS/unavailable, no-thumbnail/rejected-SVG fallback and secret/unknown/ad-only/inaccessible-board errors passed; safe literal script-text title, native keyboard focus and zero page errors |
| Visual review | Desktop empty, mobile empty and mobile success screenshots inspected; decorative emoji replaced with consistent inline SVG |
| `npm audit --omit=dev` | 0 vulnerabilities at execution time |
| JS syntax / `git diff --check` | Passed |

The browser suite used Python Playwright with locally installed Chromium headless shell 134.0.6998.35. The system Chromium launcher pointed at a missing binary. The newest Playwright download returned HTTP 403, while `npx playwright@1.51.1 install chromium` succeeded outside the repository. The available build lacked H264 playback, so the local fixture was generated as VP9 inside MP4; actual preview playback then passed. This verifies the application path and a compatible MP4, not all codecs, Safari, iOS or real Pinterest H264 playback. Browser and fixture server must run in the same execution network namespace; CI runs them in the same shell.

Reproduce browser QA:

```sh
node scripts/fixture-server.mjs
# In another terminal sharing the same loopback network:
python scripts/browser-qa.py
```

Set `BROWSER_EXECUTABLE_PATH` only for the test harness if necessary. For this environment it was `/home/agent/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell`. Screenshots are in ignored `artifacts/empty-{1440,768,390,320}.png` and `artifacts/success-{1440,768,390,320}.png`, and `artifacts/poster-{1440,768,390,320}.png`. No screenshot or fixture contains real Pinterest content.

## Local container limitation (before GitHub CI)

No `docker`, `podman`, `buildah`, `rootlesskit` or usable daemon socket was available. Only `unshare` was present, which does not provide an OCI build/runtime. No privileged or paid host was provisioned. The Dockerfile was reviewed but image build/run, nonroot execution inside Docker, Docker health checks and container integration did not run in the local codex workspace.

`.github/workflows/verify.yml` provides a public-repository test-only fallback: build test target, run the Node tests inside the nonroot image, build production, run with loopback port/read-only/cap-drop/no-new-privileges, check health/assets/default 503/nonroot UID, then browser fixture QA under Node 24. It has `contents: read`, a ten-minute job bound, no deployment and no secrets. It subsequently ran successfully on GitHub, as recorded below.

## Initial authentication and original-history bundle

`git push --atomic origin main develop` failed before publication with:

```text
fatal: could not read Username for 'https://github.com': No such device or address
```

`gh auth status` confirmed no logged-in GitHub host. The GitHub connector confirmed the repository is public, empty, default `main`, and the connected account has push permission. Its exposed Git APIs were evaluated: `create_commit` requires an existing parent SHA and does not expose author/committer metadata or raw commit-object upload. It cannot reproduce this local root commit and exact tested commit chain. No connector mutation was made on that initial attempt. No credentials were accessed, printed or embedded.

That first `git ls-remote origin` returned no refs, before the GitHub publication described below. A Git bundle outside the checkout preserves both exact refs and every commit: `../pin-web-download-review.bundle`. README provides authenticated push and bundle-restore commands. The repository now has remote refs. Use its published branches; do not push the original bundle refs over them.

## Live acceptance and operational gates

1. Retain documented Pinterest platform authorization for the intended downloader, short-link resolution and transient metadata use.
2. Configure an eligible official provider/token with Get Pin scope/access and restricted direct-video fields available; keep credentials server-side.
3. Provide a user-owned permitted public sample and explicit content-owner permission; test standard/short links and actual returned MP4 variants only after both authorizations are verified.
4. Review codec support on target browsers and real upstream CDN response compatibility within the exact allowlist. Unexpected CDN hosts fail closed and require a reviewed code change.
5. Deployment needs separate approval. Reverse-proxy authentication, TLS, private upstream networking, bounded limits and redacted capability-path logging must be configured before enabling a shared instance. The app has no account sign-in or distributed quotas.

HLS is intentionally unsupported: bounded allowlisted segment validation and encryption handling have not been established, and no remote FFmpeg networking is used. No transcode, synthetic resolution, third-party embed, cookie or anti-bot bypass exists.


## Thumbnail and public-only follow-up

The reviewed v5.32.0 `Pin`/`PinRead` → `PinBase` response has no definitive privacy field. The adapter now makes one additional documented official Get Board request using numeric Pin `board_id`, and requires a matching Board `id` with an explicit `privacy: PUBLIC`. Missing/unknown/private/protected values are never treated as the Board schema default. Ad-only Pin/Board signals are rejected, including malformed signal types. Missing board permission or identity and oversized responses fail closed. This requires `boards:read` plus `pins:read`; Pin and Board responses are independently bounded at 512 KiB and share the existing work deadline. No video/image is fetched and no capability is issued when privacy fails.

Thumbnails use documented video covers (or named top-level video ImageSize entries), exact `i.pinimg.com` allowlisting, the shared checked-public-IP/TLS-pinned transport, at most three validated redirects, 2 MiB declared/streamed byte limits, JPEG/PNG/WebP MIME and magic-byte checks, and opaque same-origin no-store delivery. SVG is rejected. Small images are temporarily bounded in memory for verification; there is no persistent image/media cache. Image fixtures include a locally generated PNG; JPEG/WebP unit checks exercise signatures, not full decoder support. Actual PNG poster decoding/rendering and byte-exact image responses were tested in Chromium at all four widths. Absent thumbnails and rejected SVG responses preserve video preview/download actions.

The operator must keep the enabled instance behind authentication for the intended audience, verify both authorizations independently, and account for five-minute capability validity after a public-board snapshot. No user/operator-supplied privacy flag or undocumented field can bypass verification. This follow-up made no live Pinterest calls, changed no credentials or publication state, and did not run containers. Container validation was completed later on GitHub; the live provider authorization gate remains.


## Final repository and container verification

[GitHub Actions](https://github.com/darelaj/pin-web-download/actions/runs/45834060039) passed at application commit `307d9ecf99a246142769b0f07c7838c94084af3b`. The nonroot Docker test target ran the Node suite successfully; the production image built, started with a read-only filesystem and dropped capabilities, and passed the HTTP health, UI assets, disabled-provider, and nonroot UID checks. Chromium fixture browser QA passed in the workflow after the container checks. No live Pinterest video was tested.

The `develop` branch was published using GitHub's repository API. It preserves the individual task boundaries and commit messages, with each GitHub file-tree SHA verified against its local counterpart. GitHub commit IDs differ because the commit metadata differs. No application code was merged to `main`; no deployment ran.


## Public-page mode update — 2026-11-27

Started from published `develop` commit `83a9adbe9710eb15e397ed16b6ee0031fb9f3cbc`. The original local chain is preserved under `local-original-develop`; no history was rebased or overwritten. The official provider and its Board privacy verification remain available. The earlier API-only decision is superseded by a separate, disabled-by-default `public-page` provider for permitted personal use; no provider fallback occurs automatically.

Actual local results after this change:

```text
npm test: tests 39, pass 39, fail 0, skipped 0, cancelled 0
npm audit --omit=dev: found 0 vulnerabilities
Node/JS syntax and git diff --check: passed
Verify-only workflow YAML: parsed; develop-only trigger and contents:read preserved
```

New unit/security coverage verifies exact separate opt-in, no API token requirement, official-mode isolation, the two recognized embedded JSON slots, only the requested Pin (not recommendations), canonical/state identity, duplicate/malformed/inert/comment/template/noscript rejection, explicit positive Pin/Board public flags, private/unknown/ad-only contradictions, login/password/modal markers, CAPTCHA/robot/Cloudflare markers, status 401/403/429, DRM/encryption and embed rejection, direct MP4 variant mapping, no video/HLS-only results, page/JSON/depth/list limits, MIME/encoding/declared-body bounds, bounded same-Pin redirects and wrong/login/private-host redirect rejection. No upstream extractor code was copied. parse5 8.0.0 is pinned and is used only for HTML tree parsing, never script execution.

Real loopback HTTP integration covers standard and short links → public HTML provider → metadata → opaque poster → streamed preview/download. It checks exact local image/video bytes, no leaked CDN URL, safe blocked/private/misbound errors before media requests, and retained permission/rate/ticket/transport tests. The actual production command was started with the separate public-page opt-in and no API credentials: health reported enabled, a permission-denied lookup was rejected before network use, and SIGTERM exited cleanly. No real Pin request was used for that test.

Responsive Chromium fixture QA passed **both providers** at 1440×1000, 768×1024, 390×844 and 320×740. The 1440px flow uses a standard Pin link; the remaining flows use a short link. Each provider passed poster decoding/exact image bytes, actual preview playback, attachment byte comparison, loading/success/no-video/HLS/unavailable or blocked states, thumbnail fallback, private/unknown/ad-only rejection, keyboard focus, no horizontal overflow and zero browser page errors. Public mode additionally passed login/challenge/misbound-page error states. The synthetic public HTML contains no real Pinterest content. The same locally generated PNG and VP9-in-MP4 fixtures are used.

Reproduce in one loopback network namespace per provider:

```sh
node scripts/fixture-server.mjs --public-page
python scripts/browser-qa.py --public-page
# Official regression: omit --public-page from both commands.
```

Screenshots now live under ignored `artifacts/public-page/` and `artifacts/official/`; mobile public-page poster rendering was visually reviewed. The prior browser cache was absent after environment restart, so the test-only Chromium 134 headless shell was restored outside the repo using the same stable fallback installer. No production browser runtime is introduced.

### What was not verified for this change

- **Live Pinterest HTML/video:** no permissioned sample and no established automated-access authorization were available. No real Pin/media fetch was made. Personal use/public visibility does not grant automated-access permission under Pinterest's restrictions. Live pages may omit the required positive visibility fields or use another layout; such pages fail closed. This is a synthetic-fixture-verified parser, not a claim that current live Pinterest pages work.
- **New Docker image / CI run:** no Docker/Podman/Buildah/runtime socket is available locally. The earlier successful GitHub CI run recorded above covers the previous official-mode tree, not these commits. The verify-only workflow now runs both fixture providers after its container checks, but requires publication/review before a new run. No privileged/paid host or deployment was provisioned.
- **Other browsers/codecs:** Chromium fixture playback is not real Pinterest H264, Safari or iOS acceptance.

Operators must review permission for automated access independently of creator permission, select the provider explicitly, keep the instance limited to the intended authenticated personal audience, and respect private/block/challenge failures. No cookies, signed-in sessions, undocumented API calls, third-party resolvers, HLS/DRM bypass, proxy rotation or CAPTCHA solver is included. Existing platform/privacy/content-owner/live-acceptance and deployment gates remain applicable.


## Short-link regression fix — 2026-11-27

Worked from exact published develop base `740129935137ca7996c6566c55d2edba1b389d7c`. The reported redirect shape was reproduced with synthetic short codes/Pin IDs and a synthetic `fixture_tracking` query, never the real tracking payload. The original focused regression run was 1 passed / 6 failed; the resolver hop and sent input failed with `invalid_url`.

The shared resolver now accepts only `https://api.pinterest.com/url_shortener/<original-code>/redirect/` exactly as a redirect from that original pin.it code, with anonymous HEAD requests and a separate exact host allowlist. It does not widen external input, page, media or arbitrary API allowlists. Redirects to changed codes, arbitrary API paths, lookalikes, private hosts, wrong protocols/ports/userinfo and resolver query/fragment/path variants are rejected before fetching. Existing DNS checking/IP pinning and four-hop bounds remain in place.

The exact terminal `/pin/<digits>/sent/` route on existing allowed Pinterest hosts yields only the Pin ID and canonical URL, with query discarded. It is never fetched by short resolution. Later public page redirects also canonicalize the validated Pin URL before fetching, so the newly accepted sent route cannot accidentally become a page fetch. Official API extraction uses the ID as before. Friendly `short_link_unavailable`/422 now covers unsafe/broken upstream redirects; invalid initial input remains `invalid_url`/400. The distinction is tested through POST `/api/metadata`.

Final results:

```text
npm test: 48 tests passed, 0 failed/skipped/cancelled
JS syntax and git diff --check: passed
Browser public-page provider: 1440/768/390/320px passed
Browser official provider: 1440/768/390/320px passed
```

Both browser fixtures now exercise the synthetic 308 pin.it → exact API resolver → 302 sent chain at short-link viewports. Their resolver fixture asserts HEAD with no auth/cookie and throws if sent is fetched. Poster bytes, actual preview playback and downloaded bytes, keyboard/fallback/error states, no overflow and zero browser page errors passed. Unit tests also exercise both production provider adapters with the same chain and assert only canonical Pin extraction. HTTP integration covers the full public-provider metadata/thumbnail/preview/download entry path.

No new live Pinterest request or actual video fetch was made. The parent's supplied anonymous HEAD observations informed the fixture shape; this work does not claim live extraction/video compatibility. No local Docker runtime or fresh post-fix CI run was used, and publication/deployment remains with the parent. Prior CI evidence applies only to its recorded commits.
