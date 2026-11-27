# Living implementation plan

Objective: a minimal responsive Pinterest video downloader with an official API provider and separately opted-in permitted personal public-page provider, defensive streaming, and safe defaults. No deployment is authorized.

## Phases and verification
1. Scaffold and repo instructions: Node 24, native HTTP, node:test, ignore secrets. Verify package and initial tests.
2. URL validation, bounded short-link resolution, official provider and typed schema mapping. Fixture tests for canonical identity, unavailable and unsupported media.
3. Metadata and opaque ticket preview/download, DNS-pinned allowlisted transport, rate/concurrency/deadline/byte limits. Security and HTTP integration tests.
4. Responsive accessible UI: browser tests through the actual form at mobile/tablet/desktop sizes and state transitions.
5. Nonroot single Dockerfile, health, graceful shutdown, environment and proxy documentation. Build/run container if possible; otherwise test-only CI.
6. Review, QA report, verified commits and publish develop for review; no merge or deployment.

## Decisions
- Native Node HTTP avoids framework dependencies; ipaddr.js classifies public IPs.
- Official Get Pin remains the default provider and requires explicit platform approval and a server token. On 2026-11-27 the user superseded the API-only decision with a separate opt-in permitted personal anonymous public-page provider. Neither public visibility nor personal use grants automated-access permission. Content-owner permission is separately confirmed per request; no fallback between providers.
- Only direct native MP4 from the selected provider’s explicitly supported media objects is supported. HLS is explicitly unavailable until bounded segment safety can be established.
- Fixtures are injected into exported application factories in tests only. No environment-selected fixture mode.
- Process-local opaque tickets hold only bounded short-lived routing metadata; no database or media files. Restart invalidates tickets. Provider is called for each lookup.

## Progress
- Empty repository verified with git ls-remote and clone. Minimal README seed committed on main; develop created.
- Scaffold verified: Node 24.22.3; npm test (1 passed); entry point syntax checked.
- Provider increment verified: npm test, 7 passed. Strict URL/short redirects, public-only DNS classification (including mapped IPv6 rejection), documented metadata identity, disabled-provider gate and declared/actual API body limits covered. Official schema reviewed at api-description v5.32.0; no live Pin requests made.
- HTTP/security increment verified: npm test, 14 passed. Real loopback HTTP metadata/preview/download payloads, opaque expiry, permission/default gate, spoof-resistant rate limiting, concurrent saturation, deadline, MIME/redirect/declared/streamed byte limits and MP4 signature tested. No live Pinterest media accessed.
- Local git push failed before execution: no HTTPS username/credential helper. Exact-history connector fallback will be evaluated after final review.
- UI increment verified with npm test (15 passed) and public/app.js syntax check. Real HTTP entry page/assets/CSP verified. Added reproducible loopback-only official-provider fixture harness and browser QA covering 1440/768/390/320 widths, preview/download bytes, states and keyboard. Browser execution pending: system launcher binary absent; latest Playwright CDN returns 403; stable-build fallback in progress.
- Production packaging/docs increment verified: npm test (15 passed), entry syntax passed, npm audit --omit=dev found 0 vulnerabilities. Added Node 24 nonroot runtime/test targets, health check and test-only CI (no deploy). No Docker/Podman/Buildah binary or daemon socket is available, and no supported rootless runtime was found. Container build/run remains pending on a suitable runner. Production HTTP entry-point smoke check follows final review.
- Final security review verified: npm test (18 passed), JS syntax and git diff --check passed. Added explicit TLS-hostname/IP-pinning test, disconnect cancellation, mixed native item mapping, dot-segment rejection, IPv6 3fff documentation range rejection, and disposal of DNS abort listeners. No production test bypass introduced.
- Browser and real-entry QA verified: Chromium headless shell 134 (stable fallback installed outside repo) passed at 1440, 768, 390 and 320 pixels. Each size completed real form → injected official adapter → preview metadata (320px video width) → attachment download with byte-for-byte fixture comparison and no horizontal overflow. Non-video/HLS/unavailable/loading states, safe text insertion, keyboard focus and zero browser page errors passed. Corrected fixture stream buffers and used a locally generated VP9 MP4 because this Chromium build lacks H264. No CSP relaxation was used.
- Production entry test added; npm test now 19 passed. Actual node src/index.js serves health/UI with disabled provider, returns 503 for download lookup, logs no URL, and exits cleanly on SIGTERM.
- Screenshot review completed for desktop empty and mobile success states. Replaced emoji-dependent decorative marks with native SVG. Re-ran all four responsive browser flows with actual preview play/currentTime advancement and byte-exact download; all passed, zero page errors. npm test remained 19/19; diff whitespace check passed.

## Completion and remaining gates
- Implementation, tests, native responsive UI, safe defaults, docs and test-only workflow complete locally.
- Browser QA passed all four widths with actual playback and exact download bytes. Unit/integration suite: 28 passed after thumbnail/privacy follow-up. See QA.md for evidence and scope.
- Workflow host Node version explicitly set to 24; Docker test/build/run remains unexecuted without a runtime. CI cannot start while repository publication is blocked.
- GitHub connector access verified, but exposed APIs cannot upload exact root/author/committer objects. Local Git authentication is absent. The original local commits were preserved in a Git bundle; GitHub publication subsequently used the commit-by-commit content verification below.
- Remote remains empty. No merge, force push, deployment, public preview, paid service, Hostinger/VPS/Coolify action or RuteX modification occurred.
- Live acceptance awaits documented platform approval, eligible official direct-video access and a user-owned explicitly permitted sample. HLS remains unsupported.
- Final compatibility check added explicit common Pinterest locale subdomains (including id.pinterest.com and in.pinterest.com) alongside country domains. Wildcard/unlisted subdomains remain rejected. npm test: 19 passed. No live network probe was made.


## Thumbnail and privacy review follow-up
- Added optional per-format documented cover metadata and same-origin poster capabilities. Separate exact image host i.pinimg.com, 2 MiB body cap, approved JPEG/PNG/WebP MIME+signature validation, no SVG, bounded validated redirects, no arbitrary client image URLs or CDN URL disclosure; missing/unsafe/failed images fall back gracefully.
- Reviewed official PinBase and Board schemas: Pin has no definitive public flag. Official adapter now requires a numeric board_id and matching official Get Board response with explicit PUBLIC privacy, rejecting missing/unknown/SECRET/PROTECTED, inaccessible boards, ad-only signals and malformed signal types before media/tickets. Added boards:read requirement; extra response bounded to 512 KiB under existing deadlines.
- Node suite: 28 passed. Chromium responsive form/poster/image-bytes/playback/download flows and privacy/fallback states passed at 1440, 768, 390 and 320 widths. All activity used injected local fixtures. Runtime remains disabled by default; no live calls, remote publication changes or deployments in this follow-up.
- README/QA updated with operator-only authenticated access, independent permissions, explicit public-only verification and the five-minute privacy snapshot/capability lifetime. Container verification still pending.


## GitHub verification

- Published `develop` with a separate conventional commit for every verified increment. The original local history is retained in a bundle; the GitHub commits have different metadata but the respective file trees matched byte-for-byte. `main` contains only the initialization README; nothing was merged or deployed.
- [GitHub Actions](https://github.com/darelaj/pin-web-download/actions/runs/45834060039) passed: 28 integration/security tests in the nonroot test image, production image build, container startup and HTTP health/assets/disabled-provider checks, and responsive Chromium fixture QA. Live authorized Pinterest acceptance and deployment approval remain open.


## Public-page provider update (2026-11-27)
- User superseded the API-only decision: add separate opt-in anonymous public HTML support for permitted personal use, preserve official API mode and never bypass restrictions.
- Base: published develop 83a9adbe9710eb15e397ed16b6ee0031fb9f3cbc. Original local history retained under local-original-develop.
- Narrow HTML parsing via parse5, known embedded state slots only, exact requested Pin/canonical identity, positive Pin and Board public flags, bounded direct native MP4 mapping. Unknown shapes/login/challenges/private/DRM/embeds fail closed. No undocumented API, executable page JavaScript, cookies or session storage.
- Parser/security fixture suite and HTTP/browser entry flows are being verified. No permissioned live sample or automated-access authorization is available, so no live Pin/media fetch is planned.
- Core provider verified: npm test 36 passed, 0 failures/skips. Synthetic standard/short URLs, known state slots, canonical/state identity, optional thumbnails, direct variants, opt-in/default/API isolation, login/CAPTCHA/blocks/privacy/DRM/embed rejection, HTTP redirect/MIME/size bounds covered. No live Pin/content requests. parse5 8.0.0 is pinned; original implementation references upstream shapes without copying extractor code.
- Integration/UI increment verified: 39 Node tests passed (including production-command public-mode selection without API credentials/live lookups), public HTML standard/short → metadata → poster → preview/download HTTP flow, and safe blocked/misbound responses before media access. npm audit: 0 vulnerabilities. Responsive Chromium flows for both official and public-page providers passed at 1440/768/390/320 widths with actual playback, exact image/video bytes, fallback/errors, keyboard focus, no overflow and zero page errors. Workflow YAML/syntax/diff checks passed; verify-only workflow now covers both providers. No local OCI runtime is available; new-commit Docker CI awaits review/publication.

- Final review: public-page mobile poster screenshot inspected; all 39 tests and both provider/browser suites passed. QA distinguishes the previous successful Docker CI from this unbuilt/unpublished new tree. No live sample/automated-access authorization was available. Prepare incremental bundle/patch from exact published base for review; do not deploy or merge.


## Focused short-link fix — 2026-11-27
- Base: published develop 740129935137ca7996c6566c55d2edba1b389d7c; previous local chain preserved under local-before-short-link.
- Reproduced the reported first-party resolver → terminal sent shape using synthetic fixtures: targeted pre-fix tests had 1 pass / 6 failures, including invalid_url on the resolver hop. No real short link, tracking values or video were fetched for this fix.
- Permit only the exact same-code first-party resolver as a pin.it redirect, anonymous HEAD with a separate exact host allowlist, retaining four-hop bounds and shared DNS/IP pinning. API resolver URLs remain invalid external input. Changed codes, arbitrary API routes, lookalikes, userinfo, non-HTTPS, query/fragment resolver variants fail closed.
- Accept exact terminal /pin/<digits>/sent/ on existing Pinterest input hosts and discard query while canonicalizing. Resolve identity without fetching sent; later public page redirects are also canonicalized before fetch. Broken/unsafe upstream short redirects return short_link_unavailable; invalid initial inputs keep invalid_url.
- Verification: npm test 48 passed (0 failures/skips); JS syntax and diff checks passed. Both provider paths and real metadata HTTP flow covered. Browser fixtures now use the two-hop resolver/sent shape; official/public modes both passed 1440/768/390/320 flows with poster, playback, exact download bytes, keyboard/errors/fallbacks and zero page errors/overflow.
- One local focused commit for root review; publication left to parent. No deployment or actual video fetch. Live end-to-end Pinterest/video compatibility and a fresh container/CI run remain unverified for this commit.


## Focused public-page diagnostics fix — 2026-11-27
- Base: published develop 9ff58a1411288fc2fdbc2777f381250bcda5213c; previous local branch preserved as local-before-diagnostics.
- Sanitized observation fixtures reproduce global style#recaptcha, generic runtime text, video+track without source, missing requested Pin record and a separate canonical-ID conflict. No new live requests or hidden-media recovery.
- Challenge checks now exclude non-rendered CSS/script/metadata/hidden contexts and require rendered text or active auth/challenge UI. Known runtime-shell + applicable-state coexistence is accepted; malformed/duplicate/conflicting applicable sources still fail closed. Missing requested data/direct list gets page_video_unavailable, while explicit canonical/OG or record ID conflicts retain pin_identity_mismatch. No alternative Pin is followed.
- Verification: 54 Node tests passed (0 failures/skips), including real POST metadata error distinction with zero media calls and no alternate-ID page calls. Official/public responsive browser suites passed at 1440/768/390/320; public fixtures cover inert styles/runtime coexistence success, signed-out shell unavailable, conflicting identity, malformed applicable state and visible challenge. Playback/download regression, keyboard, no overflow and zero page errors passed.
- This is a diagnostics fix; a visible player is not an exposed MP4. Live download compatibility and new container CI remain unverified. One local focused commit; root will review/publish. No deployment or actual media fetch.

## Approved completed-Relay extraction update — 2026-11-27
- Base: published develop 9025e5493dea650e239d0c3b35b097056713a357; previous local chain retained under local-before-relay. User approved exact anonymous page-embedded completed-Relay data and independently corroborated aliases, without executing JS, internal requests or access-control bypass.
- Added bounded exact-wrapper JSON decoder, requested pinId/isAuth:false provenance, self-bound entityId/typed Pin ID/seoUrl, native StoryPinVideoBlock videoList720P mapping using actual dimensions, sparse duplicate handling, restriction checks, and exact v1.pinimg.com alongside v.pinimg.com.
- Targeted decoder tests: 4 passed. Initial guarded live structural request failed at DNS with EAI_AGAIN before any response; no raw HTML/media URL was persisted or exposed. Integration/alias and app entry-point QA follows.
