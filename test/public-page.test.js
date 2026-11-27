import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parsePublicPinHTML, publicPageProvider } from '../src/public-page.js';
import { configuredProvider } from '../src/config.js';
import { publicHTML, publicPin } from '../scripts/public-page-fixture.mjs';
const response = (body = '', statusCode = 200, headers = {}) => Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
test('public mode has a separate exact opt-in and never silently falls back from official mode', async () => {
  for (const env of [{}, { PINTEREST_PUBLIC_PAGE_ENABLED: 'true' }, { PINTEREST_PROVIDER: 'public-page' }, { PINTEREST_PROVIDER: 'public-page', PINTEREST_PUBLIC_PAGE_ENABLED: '1' }]) assert.equal(configuredProvider(env).enabled, false);
  assert.equal(configuredProvider({ PINTEREST_PROVIDER: 'public-page', PINTEREST_PUBLIC_PAGE_ENABLED: 'true' }).enabled, true);
  assert.equal(configuredProvider({ PINTEREST_PROVIDER: 'official', PINTEREST_ACCESS_TOKEN: 'fixture', PINTEREST_PLATFORM_AUTHORIZED: 'true' }).enabled, true);
  assert.throws(() => configuredProvider({ PINTEREST_PROVIDER: 'other' }), /Invalid PINTEREST_PROVIDER/);
  let calls = 0; await assert.rejects(publicPageProvider({ request: async () => { calls++; } }).getPin('https://pinterest.com/pin/1/'), /provider_disabled/); assert.equal(calls, 0);
});
test('known requested-Pin state slots map all direct MP4 variants and optional poster without executing HTML', () => {
  for (const slot of ['__PWS_DATA__', '__PWS_INITIAL_PROPS__']) {
    const result = parsePublicPinHTML(publicHTML('1', {}, slot), '1');
    assert.equal(result.id, '1'); assert.equal(result.variants[0].width, 320); assert.equal(result.variants[0].thumbnailUrl, 'https://i.pinimg.com/generated.png');
  }
  const result = parsePublicPinHTML(publicHTML('1', { videos: { video_list: { one: { url: 'https://v.pinimg.com/a.mp4', width: 1280, height: 720 }, duplicate: { url: 'https://v.pinimg.com/a.mp4' }, two: { url: 'https://v.pinimg.com/b.mp4', width: 640, height: 360 }, hls: { url: 'https://v.pinimg.com/a.m3u8' } } }, images: {} }), '1');
  assert.equal(result.variants.length, 2); assert.equal(result.variants[1].height, 360); assert.equal(result.variants[0].thumbnailUrl, null);
  assert.doesNotThrow(() => parsePublicPinHTML(publicHTML() + '<script>throw new Error("must not execute")</script>', '1'));
});
test('public parser rejects canonical/state identity mismatch, unrelated recommendations and ambiguous/inert/malformed state', () => {
  for (const html of [publicHTML('2'), publicHTML().replace('"id":"1"', '"id":"2"'), publicHTML().replace('property="og:url" content="https://www.pinterest.com/pin/1/"', 'property="og:url" content="https://www.pinterest.com/pin/2/"')]) assert.throws(() => parsePublicPinHTML(html, '1'), /pin_identity_mismatch/);
  for (const html of [publicHTML() + '<script id="__PWS_DATA__" type="application/json">{}</script>', publicHTML().replace('application/json', 'text/javascript'), publicHTML().replace('{"props":', '{broken:'), publicHTML().replace('<script id=', '<template><script id=').replace('</script>', '</script></template>'), publicHTML().replace('<script id=', '<!-- <script id=').replace('</script>', '</script> -->'), publicHTML().replace('<script id=', '<noscript><script id=').replace('</script>', '</script></noscript>')]) assert.throws(() => parsePublicPinHTML(html, '1'), /page_metadata_unsupported/);
});
test('private, unknown, contradictory or malformed public flags fail closed', () => {
  for (const overrides of [{ is_private: true }, { is_private: undefined }, { is_private: 'false' }, { board: {} }, { board: { privacy: 'secret' } }, { board: { privacy: 'protected' } }, { board: { privacy: 'public', is_private: true } }, { board: { privacy: 'public', is_protected: true } }, { board: { privacy: 'public', is_ads_only: true } }, { is_removable: true }, { is_secret: true }]) assert.throws(() => parsePublicPinHTML(publicHTML('1', overrides), '1'), /public_access_unverified/);
});
test('login, CAPTCHA, bot blocks, DRM, unavailable media and third-party embeds are never bypassed', () => {
  for (const block of ['<form action="/login/">', '<input type="password">', '<div id="captcha">Verify you are human</div>', '<iframe src="https://challenges.cloudflare.com/turnstile/widget"></iframe>', '<p>Verify you are human</p>', '<p>Log in to view this Pin</p>', '<div data-test-id="login-modal"><input type="password"></div>', '<p>Sign in to see this Pin</p>', '<h1>Robot check</h1>']) assert.throws(() => parsePublicPinHTML(publicHTML() + block, '1'), /page_blocked/);
  for (const overrides of [{ requires_login: true }, { is_unavailable: true }, { is_playable: false }, { is_drm: true }, { is_encrypted: true }, { drm: {} }, { license_url: 'https://evil.test/' }, { embed: { src: 'https://youtube.com/watch?v=1' } }]) assert.throws(() => parsePublicPinHTML(publicHTML('1', overrides), '1'), /page_blocked/);
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { videos: { video_list: { mp4: { url: 'https://v.pinimg.com/a.mp4', is_encrypted: true } } } }), '1'), /page_blocked/);
});
test('unsupported/no video/HLS/external media and bounded parser structures fail closed', () => {
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { videos: undefined }), '1'), /page_video_unavailable/);
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { videos: { video_list: { hls: { url: 'https://v.pinimg.com/a.m3u8' } } } }), '1'), /hls_unsupported/);
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { videos: { video_list: { mp4: { url: 'https://evil.test/a.mp4' } } } }), '1'), /invalid_url/);
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { videos: { video_list: { malformed: null } } }), '1'), /page_metadata_unsupported/);
  assert.throws(() => parsePublicPinHTML('x'.repeat(2 * 1024 * 1024 + 1), '1'), /page_limit/);
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { description: 'x'.repeat(512 * 1024) }), '1'), /page_limit/);
  assert.throws(() => parsePublicPinHTML(publicHTML() + '<div>'.repeat(102), '1'), /page_limit/);
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { videos: { video_list: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i, { url: 'https://v.pinimg.com/a.mp4' }])) } }), '1'), /page_limit/);
});
test('anonymous public provider supports standard and short links using only bounded page requests', async () => {
  for (const input of ['https://pinterest.com/pin/1/', 'https://pin.it/abc']) {
    const calls = [];
    const provider = publicPageProvider({ enabled: true, request: async (url, options) => {
      calls.push(String(url)); assert.equal(options.headers?.Authorization, undefined); assert.equal(options.headers?.Cookie, undefined);
      if (String(url).includes('pin.it')) { assert.equal(options.method, 'HEAD'); return response('', 302, { location: 'https://www.pinterest.com/pin/1/' }); }
      assert.equal(options.headers.Accept, 'text/html'); assert.equal(options.hosts.has('api.pinterest.com'), false);
      return response(publicHTML(), 200, { 'set-cookie': 'ignored_fixture=1' });
    } });
    assert.equal((await provider.getPin(input)).id, '1'); assert.equal(calls.at(-1), input.includes('pin.it') ? 'https://www.pinterest.com/pin/1/' : 'https://pinterest.com/pin/1/');
    assert.equal(calls.length, input.includes('pin.it') ? 2 : 1);
  }
});
test('page HTTP block statuses, MIME, oversized bodies and wrong/login redirect targets fail closed', async () => {
  for (const status of [401, 403, 429, 500]) await assert.rejects(publicPageProvider({ enabled: true, request: async () => response(publicHTML(), status) }).getPin('https://pinterest.com/pin/1/'), /page_blocked/);
  for (const headers of [{ 'content-type': 'application/json' }, { 'content-length': String(2 * 1024 * 1024 + 1) }, { 'content-encoding': 'gzip' }]) await assert.rejects(publicPageProvider({ enabled: true, request: async () => response(publicHTML(), 200, headers) }).getPin('https://pinterest.com/pin/1/'));
  for (const location of ['https://pinterest.com/login/', 'https://www.pinterest.com/pin/2/', 'https://127.0.0.1/pin/1/', 'https://api.pinterest.com/v5/pins/1']) await assert.rejects(publicPageProvider({ enabled: true, request: async () => response('', 302, { location }) }).getPin('https://pinterest.com/pin/1/'), /page_blocked/);
  let calls = 0; await assert.rejects(publicPageProvider({ enabled: true, request: async () => { calls++; return response('', 302, { location: '/pin/1/' }); } }).getPin('https://pinterest.com/pin/1/'), /page_blocked/); assert.equal(calls, 4);
});
