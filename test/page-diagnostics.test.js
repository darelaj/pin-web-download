import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { parsePublicPinHTML, publicPageProvider } from '../src/public-page.js';
import { publicHTML, publicShellHTML, publicPin } from '../scripts/public-page-fixture.mjs';
const script = (name, state) => `<script id="${name}" type="application/json">${typeof state === 'string' ? state : JSON.stringify(state)}</script>`;
const initial = pin => script('__PWS_INITIAL_PROPS__', { initialReduxState: { pins: { 1: pin } } });
const runtime = script('__PWS_DATA__', { props: { runtimeConfig: { recaptchaEnabled: true } } });
test('sanitized video shell with inert recaptcha CSS and no requested state reports unavailable, not blocked or wrong identity', () => {
  assert.throws(() => parsePublicPinHTML(publicShellHTML(), '1'), { code: 'page_video_unavailable' });
  assert.throws(() => parsePublicPinHTML(publicShellHTML('1', '2'), '1'), { code: 'pin_identity_mismatch' });
  const missingRecord = publicHTML().replace('"pins":{"1":', '"pins":{"2":');
  assert.throws(() => parsePublicPinHTML(missingRecord, '1'), { code: 'page_video_unavailable' });
});
test('observed route bootstrap without props is not an alternative source of Pin data', () => {
  const bootstrap = script('__PWS_DATA__', { initialHandlerId: 'fixture', routeTree: { route: 'pin' } });
  assert.equal(parsePublicPinHTML(publicHTML('1', {}, '__PWS_INITIAL_PROPS__') + bootstrap, '1').id, '1');
  const noPinData = '<link rel="canonical" href="https://pinterest.com/pin/1/">' +
    script('__PWS_INITIAL_PROPS__', { initialReduxState: { pins: {} } }) + bootstrap;
  assert.throws(() => parsePublicPinHTML(noPinData, '1'), { code: 'page_video_unavailable' });
});
test('normal valid page ignores global style/script metadata and accepts runtime shell alongside applicable state', () => {
  const html = publicHTML('1', {}, '__PWS_INITIAL_PROPS__') + runtime + '<style id="recaptcha">/* Access denied; Verify you are human */</style><script src="https://example.test/recaptcha.js">const label = "Robot check";</script>';
  assert.equal(parsePublicPinHTML(html, '1').variants.length, 1);
  assert.equal(parsePublicPinHTML(publicHTML() + initial(publicPin()), '1').variants.length, 1);
  assert.equal(parsePublicPinHTML(publicHTML() + '<div hidden>Verify you are human</div><div inert><input type="password"></div>', '1').id, '1');
});
test('visible challenge/auth widgets and private/DRM signals remain rejected', () => {
  for (const visible of ['<div id="captcha">Verify you are human</div>', '<iframe src="https://challenges.cloudflare.com/turnstile/widget"></iframe>', '<div class="g-recaptcha" data-sitekey="fixture"></div>', '<form action="/login/"><input type="password"></form>']) {
    assert.throws(() => parsePublicPinHTML(publicHTML() + visible, '1'), { code: 'page_blocked' });
  }
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { is_private: true }), '1'), { code: 'public_access_unverified' });
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { is_drm: true }), '1'), { code: 'page_blocked' });
});
test('coexisting sources cannot hide malformed, conflicting, private or misbound applicable records', () => {
  for (const extra of [script('__PWS_INITIAL_PROPS__', '{broken'), initial(null), script('__PWS_INITIAL_PROPS__', { initialReduxState: { pins: [] } }), initial(publicPin('1', { title: 'Conflicting data' })), initial(publicPin('1', { is_private: true }))]) {
    assert.throws(() => parsePublicPinHTML(publicHTML() + extra, '1'), { code: 'page_metadata_unsupported' });
  }
  assert.throws(() => parsePublicPinHTML(publicHTML() + initial(publicPin('2')), '1'), { code: 'pin_identity_mismatch' });
  assert.throws(() => parsePublicPinHTML(publicHTML() + script('__PWS_DATA__', {}), '1'), { code: 'page_metadata_unsupported' });
  assert.throws(() => parsePublicPinHTML(publicHTML('1', {}, '__PWS_INITIAL_PROPS__') + script('__PWS_DATA__', '{broken'), '1'), { code: 'page_metadata_unsupported' });
  assert.throws(() => parsePublicPinHTML(publicHTML().replace('</head>', '<link rel="canonical" href="https://pinterest.com/pin/1/"></head>'), '1'), { code: 'page_metadata_unsupported' });
  assert.throws(() => parsePublicPinHTML(publicHTML().replace('rel="canonical"', 'rel="alternate"'), '1'), { code: 'page_metadata_unsupported' });
  assert.throws(() => parsePublicPinHTML(publicHTML().replace('</head>', '<meta property="og:url" content="https://pinterest.com/pin/2/"></head>'), '1'), { code: 'pin_identity_mismatch' });
});
test('visible video shell or public record without direct video data is never treated as a downloadable source', () => {
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { videos: undefined }) + '<video controls><track kind="captions"></video>', '1'), { code: 'page_video_unavailable' });
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { videos: { video_list: {} } }), '1'), { code: 'page_video_unavailable' });
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { is_private: undefined, videos: undefined }), '1'), { code: 'public_access_unverified' });
});
test('HTTP metadata entry distinguishes unavailable signed-out shell, conflicting identity and real challenge without media requests', async t => {
  let html = publicShellHTML(); let mediaRequests = 0; const pageRequests = [];
  const provider = publicPageProvider({ enabled: true, request: async value => { pageRequests.push(String(value)); return Object.assign(Readable.from([Buffer.from(html)]), { statusCode: 200, headers: { 'content-type': 'text/html' } }); } });
  const app = createApp({ provider, request: async () => { mediaRequests++; throw new Error('No media must be fetched'); }, log: () => {} });
  await new Promise(r => app.listen(0, '127.0.0.1', r)); t.after(() => { app.shutdown(); app.closeAllConnections(); });
  for (const [page, code] of [[publicShellHTML(), 'page_video_unavailable'], [publicShellHTML('1', '2'), 'pin_identity_mismatch'], [publicShellHTML() + '<p>Verify you are human</p>', 'page_blocked'], [publicShellHTML().replace('"pins":{}', '"pins":null'), 'page_metadata_unsupported']]) {
    html = page;
    const result = await fetch(`http://127.0.0.1:${app.address().port}/api/metadata`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://pinterest.com/pin/1/', permission: true }) });
    assert.equal(result.status, 422); assert.deepEqual(await result.json(), { error: code });
  }
  assert.equal(mediaRequests, 0);
  assert.deepEqual(pageRequests, Array(4).fill('https://www.pinterest.com/pin/1/'));
});
