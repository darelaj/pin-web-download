# Living implementation plan

Objective: a minimal responsive Pinterest video downloader with an authorized official API provider, defensive streaming, and safe defaults. No deployment is authorized.

## Phases and verification
1. Scaffold and repo instructions: Node 24, native HTTP, node:test, ignore secrets. Verify package and initial tests.
2. URL validation, bounded short-link resolution, official provider and typed schema mapping. Fixture tests for canonical identity, unavailable and unsupported media.
3. Metadata and opaque ticket preview/download, DNS-pinned allowlisted transport, rate/concurrency/deadline/byte limits. Security and HTTP integration tests.
4. Responsive accessible UI: browser tests through the actual form at mobile/tablet/desktop sizes and state transitions.
5. Nonroot single Dockerfile, health, graceful shutdown, environment and proxy documentation. Build/run container if possible; otherwise test-only CI.
6. Review, QA report, verified commits and publish develop for review; no merge or deployment.

## Decisions
- Native Node HTTP avoids framework dependencies; ipaddr.js classifies public IPs.
- Official Get Pin is the only production provider. Both explicit platform approval and server token are required. Content-owner permission is separately confirmed per request.
- Only direct native MP4 from documented media objects is supported. HLS is explicitly unavailable until bounded segment safety can be established.
- Fixtures are injected into exported application factories in tests only. No environment-selected fixture mode.
- Process-local opaque tickets hold only bounded short-lived routing metadata; no database or media files. Restart invalidates tickets. Provider is called for each lookup.

## Progress
- Empty repository verified with git ls-remote and clone. Minimal README seed committed on main; develop created.
- Scaffold verified: Node 24.22.3; npm test (1 passed); entry point syntax checked.
- Provider increment verified: npm test, 7 passed. Strict URL/short redirects, public-only DNS classification (including mapped IPv6 rejection), documented metadata identity, disabled-provider gate and declared/actual API body limits covered. Official schema reviewed at api-description v5.32.0; no live Pin requests made.
- HTTP/security increment verified: npm test, 14 passed. Real loopback HTTP metadata/preview/download payloads, opaque expiry, permission/default gate, spoof-resistant rate limiting, concurrent saturation, deadline, MIME/redirect/declared/streamed byte limits and MP4 signature tested. No live Pinterest media accessed.
- Local git push failed before execution: no HTTPS username/credential helper. Exact-history connector fallback will be evaluated after final review.
- UI increment verified with npm test (15 passed) and public/app.js syntax check. Real HTTP entry page/assets/CSP verified. Added reproducible loopback-only official-provider fixture harness and browser QA covering 1440/768/390/320 widths, preview/download bytes, states and keyboard. Browser execution pending: system launcher binary absent; latest Playwright CDN returns 403; stable-build fallback in progress.
