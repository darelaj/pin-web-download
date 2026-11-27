import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCompletedRelay, readRelayPins } from '../src/relay.js';
import { relayScript } from '../scripts/public-page-fixture.mjs';
const content = html => html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'));
const body = options => content(relayScript('1', options));
test('exact completed wrapper is decoded strictly as JSON data with no JS execution', () => {
  assert.equal(decodeCompletedRelay(body()).descriptor.variables.pinId, '1');
  for (const text of [body() + 'globalThis.bad = true;', body().replace('window.', ''), body().replace('});', '},"extra");'), 'window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__(alert(1),{});', body().replace(');', ');other();'), body().replace('%7B', '%XX')]) assert.throws(() => decodeCompletedRelay(text));
  assert.equal(globalThis.bad, undefined);
});
test('strict anonymous self-bound identity exposes exact v1 MP4 dimensions rather than quality-key guesses', () => {
  const result = readRelayPins([body()], '1'); assert.equal(result.variants.length, 1); assert.equal(result.variants[0].width, 540); assert.equal(result.variants[0].height, 960); assert.equal(result.variants[0].url, 'https://v1.pinimg.com/generated.mp4');
  for (const variables of [{ isAuth: true }, { isAuth: undefined }, { isAuth: 'false' }, { isAuthDesktop: true }, { isUnauth: false }]) assert.throws(() => readRelayPins([body({ variables })], '1'), { code: 'public_access_unverified' });
  for (const pin of [{ entityId: '2' }, { id: Buffer.from('User:1').toString('base64') }, { id: Buffer.from('Pin:2').toString('base64') }, { seoUrl: '/pin/2/' }]) assert.throws(() => readRelayPins([body({ pin })], '1'), { code: 'pin_identity_mismatch' });
});
test('related completions are ignored and sparse duplicate results cannot hide restrictions or supply unbound media', () => {
  assert.equal(readRelayPins([body({ variables: { pinId: '2' } })], '1'), null);
  assert.equal(readRelayPins([body({ pin: { storyPinData: null } }), body(), body()], '1').variants.length, 1);
  assert.equal(readRelayPins([body({ payload: { data: { v3GetPinQueryv2: { data: null } } } }), body()], '1').variants.length, 1);
  assert.throws(() => readRelayPins([body(), body({ pin: { storyPinData: null, isPrivate: true } })], '1'), { code: 'public_access_unverified' });
  assert.throws(() => readRelayPins([body({ pin: { entityId: undefined } })], '1'), { code: 'public_access_unverified' });
});
test('Relay media rejects restricted/DRM records, unapproved CDN hosts, HLS and conflicting dimensions', () => {
  for (const pin of [{ isPrivate: true }, { privacy: 'secret' }, { requiresLogin: true }, { isDrm: true }, { drm: {} }, { board: { privacy: 'protected' } }]) assert.throws(() => readRelayPins([body({ pin })], '1'));
  const make = entry => body({ pin: { storyPinData: { pages: [{ blocks: [{ __typename: 'StoryPinVideoBlock', videoDataV2: { videoList720P: { v720P: entry } } }] }] } } });
  for (const url of ['https://v2.pinimg.com/a.mp4', 'https://v1.pinimg.com.evil.test/a.mp4', 'https://127.0.0.1/a.mp4', 'http://v1.pinimg.com/a.mp4', 'https://v1.pinimg.com/a.m3u8']) assert.throws(() => readRelayPins([make({ url, width: 540, height: 960 })], '1'));
  assert.throws(() => readRelayPins([body(), make({ url: 'https://v1.pinimg.com/generated.mp4', width: 720, height: 1280 })], '1'), { code: 'page_metadata_unsupported' });
  assert.equal(readRelayPins([make({ url: 'https://v1.pinimg.com/generated.mp4' })], '1'), null);
});
test('Relay source and descriptor size/depth/count caps apply before accepting media', () => {
  assert.throws(() => decodeCompletedRelay('x'.repeat(512 * 1024 + 1)), { code: 'page_limit' });
  const large = { variables: { pinId: '1', isAuth: false }, extra: 'x'.repeat(65 * 1024) };
  assert.throws(() => decodeCompletedRelay(`window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__(${JSON.stringify(encodeURIComponent(JSON.stringify(large)))},{});`), { code: 'page_limit' });
  assert.throws(() => readRelayPins(Array(65).fill(body()), '1'), { code: 'page_limit' });
  assert.throws(() => decodeCompletedRelay(`window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("{}",{});`), { code: 'page_metadata_unsupported' });
});
test('explicit access errors cannot be masked by otherwise usable anonymous media', () => {
  for (const pin of [{ error: { message: 'restricted fixture' } }, { errors: [{ message: 'denied fixture' }] }, { statusCode: 403 }, { requires_auth: true }, { is_restricted: true }, { isAuth: true }]) assert.throws(() => readRelayPins([body({ pin })], '1'));
  assert.throws(() => readRelayPins([body({ payload: { data: { v3GetPinQueryv2: { error: { message: 'access denied' }, data: null } } } }), body()], '1'), { code: 'page_blocked' });
});
