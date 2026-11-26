# QA report

Date: 2026-11-26. Workspace: isolated `pin-web-download` clone. Node: 24.22.3. No live Pinterest Pin or video was accessed. No public preview or deployment was created.

## Executed checks

| Check | Actual result |
|---|---|
| `npm test` after final application changes | 28 tests passed; 0 failed, skipped or cancelled |
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
