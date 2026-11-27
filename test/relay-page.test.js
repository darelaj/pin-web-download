import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parsePublicPinHTML, publicPageProvider } from '../src/public-page.js';
import { publicHTML, publicShellHTML, relayHTML, relayScript } from '../scripts/public-page-fixture.mjs';
const response = html => Object.assign(Readable.from([Buffer.from(html)]), { statusCode: 200, headers: { 'content-type': 'text/html' } });
test('only exact marked completions provide media; runtime shells and generic sign-in prompts may coexist', () => {
  const generic = '<aside><p>Sign in to Pinterest</p><form action="/login/"><input type="password"></form></aside>';
  assert.equal(parsePublicPinHTML(relayHTML('1', { prompt: generic }), '1').variants[0].width, 540);
  assert.throws(() => parsePublicPinHTML(relayHTML('1', { script: relayScript('1').replace('data-relay-completed-request="true"', 'data-relay-completed-request="false"') }), '1'), { code: 'page_video_unavailable' });
  assert.throws(() => parsePublicPinHTML(relayHTML('1', { script: relayScript('1', { raw: 'window.other({});' }) }), '1'), { code: 'page_metadata_unsupported' });
  assert.throws(() => parsePublicPinHTML(relayHTML('1', { script: relayScript('1').replace('<script ', '<script src="https://evil.test/a.js" ') }), '1'), { code: 'page_metadata_unsupported' });
  assert.throws(() => parsePublicPinHTML(relayHTML('1', { prompt: '<p>Log in to view this Pin</p>' }), '1'), { code: 'page_blocked' });
  assert.throws(() => parsePublicPinHTML(relayHTML('1', { prompt: '<div data-required-login="true"></div>' }), '1'), { code: 'page_blocked' });
  assert.throws(() => parsePublicPinHTML(relayHTML('1', { prompt: '<iframe src="https://challenges.cloudflare.com/turnstile/widget"></iframe>' }), '1'), { code: 'page_blocked' });
  assert.throws(() => parsePublicPinHTML(publicHTML('1', { is_private: true }) + relayScript('1'), '1'), { code: 'public_access_unverified' });
});
test('aliases require agreeing canonical/OG, exact anonymous records on both independently fetched pages and matching actual MP4', async () => {
  const pages = { '1': relayHTML('1', { canonicalID: '2' }), '2': relayHTML('2') }; const calls = [];
  const provider = publicPageProvider({ enabled: true, request: async (url, options) => {
    calls.push(String(url)); assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
    const id = new URL(url).pathname.split('/')[2]; return response(pages[id]);
  } });
  const result = await provider.getPin('https://id.pinterest.com/pin/1/');
  assert.equal(result.id, '1'); assert.equal(result.variants[0].url, 'https://v1.pinimg.com/generated.mp4');
  assert.deepEqual(calls, ['https://id.pinterest.com/pin/1/', 'https://www.pinterest.com/pin/2/']);
  assert.throws(() => parsePublicPinHTML(pages['1'], '1'), { code: 'pin_identity_mismatch' });
});
test('alias mismatches, chains, missing proof, auth/private canonical pages and disagreeing OG fail without fallback', async () => {
  const media = { pages: [{ blocks: [{ __typename: 'StoryPinVideoBlock', videoDataV2: { videoList720P: { v720P: { url: 'https://v1.pinimg.com/different.mp4', width: 540, height: 960 } } } }] }] };
  for (const canonical of [relayHTML('2', { script: relayScript('2', { pin: { storyPinData: media } }) }), relayHTML('2', { canonicalID: '3' }), publicShellHTML('2'), relayHTML('2', { script: relayScript('2', { variables: { isAuth: true } }) }), relayHTML('2', { script: relayScript('2', { pin: { isPrivate: true } }) }), relayHTML('2', { script: relayScript('2', { pin: { id: Buffer.from('Pin:3').toString('base64') } }) })]) {
    const calls = [];
    const provider = publicPageProvider({ enabled: true, request: async url => { calls.push(String(url)); return response(calls.length === 1 ? relayHTML('1', { canonicalID: '2' }) : canonical); } });
    await assert.rejects(provider.getPin('https://pinterest.com/pin/1/')); assert.equal(calls.length, 2);
    assert.ok(calls.every(u => !u.includes('/pin/3/')));
  }
  let calls = 0;
  const bad = publicPageProvider({ enabled: true, request: async () => { calls++; return response(relayHTML('1', { canonicalID: '2' }).replace('property="og:url" content="https://www.pinterest.com/pin/2/"', 'property="og:url" content="https://www.pinterest.com/pin/3/"')); } });
  await assert.rejects(bad.getPin('https://pinterest.com/pin/1/'), { code: 'pin_identity_mismatch' }); assert.equal(calls, 1);
});
test('sparse same-Pin completions deduplicate but unrelated or malformed sources cannot bind target video', () => {
  const full = relayScript('1');
  assert.equal(parsePublicPinHTML(relayHTML('1', { script: relayScript('1', { pin: { storyPinData: null } }) + full + full }), '1').variants.length, 1);
  assert.equal(parsePublicPinHTML(relayHTML('1', { script: relayScript('2') + full }), '1').variants.length, 1);
  assert.throws(() => parsePublicPinHTML(relayHTML('1', { script: relayScript('2') }), '1'), { code: 'page_video_unavailable' });
  assert.throws(() => parsePublicPinHTML(relayHTML('1', { script: full + relayScript('1', { pin: { requiresLogin: true, storyPinData: null } }) }), '1'), { code: 'public_access_unverified' });
  assert.throws(() => parsePublicPinHTML(relayHTML('1', { script: full + relayScript('1', { raw: 'window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("%invalid",{});' }) }), '1'), { code: 'page_metadata_unsupported' });
});
test('alias canonical/OG origin and agreement remain strict before any independent fetch', async () => {
  const initial = relayHTML('1', { canonicalID: '2' });
  for (const html of [initial.replace('<meta property="og:url" content="https://www.pinterest.com/pin/2/">', ''), initial.replaceAll('https://www.pinterest.com/pin/2/', 'https://pinterest.com.evil.test/pin/2/'), initial.replace('rel="canonical"', 'rel="alternate"')]) {
    let calls = 0;
    await assert.rejects(publicPageProvider({ enabled: true, request: async () => { calls++; return response(html); } }).getPin('https://pinterest.com/pin/1/'));
    assert.equal(calls, 1);
  }
});
