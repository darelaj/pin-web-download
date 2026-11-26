import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { mapPin, officialProvider, assertPublicPin } from '../src/provider.js';
import { thumbnailURL } from '../src/urls.js';
import { fetchThumbnail } from '../src/thumbnail.js';
const image = await readFile(new URL('./fixtures/poster.png', import.meta.url));
const pin = { id: '1', board_id: '2', media: { media_type: 'video', video_url: 'https://v.pinimg.com/a.mp4', cover_image_url: 'https://i.pinimg.com/cover.png' } };
const response = (body = image, statusCode = 200, headers = {}) => Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers: { 'content-type': 'image/png', ...headers } });
test('documented video covers and ImageSize entries map with graceful missing/unsafe fallback', () => {
  assert.equal(mapPin(pin, '1').variants[0].thumbnailUrl, pin.media.cover_image_url);
  const media = { ...pin.media, cover_image_url: 'https://evil.test/image.png', images: { '600x': { url: 'https://i.pinimg.com/600x/a.jpg' } } };
  assert.equal(mapPin({ ...pin, media }, '1').variants[0].thumbnailUrl, media.images['600x'].url);
  for (const cover_image_url of [undefined, 'https://i.pinimg.com/x.svg', 'https://i.pinimg.com.evil.test/x.png', 'https://v.pinimg.com/x.png', 'http://i.pinimg.com/x.png']) {
    assert.equal(mapPin({ ...pin, media: { ...pin.media, cover_image_url } }, '1').variants[0].thumbnailUrl, null);
  }
  const mixed = mapPin({ ...pin, media: { media_type: 'multiple_videos', items: [{ ...pin.media, item_type: 'video' }] } }, '1');
  assert.equal(mixed.variants[0].thumbnailUrl, pin.media.cover_image_url);
});
test('image transport uses its own exact allowlist, rejects redirects, SVG, MIME/signature and size violations', async () => {
  const result = await fetchThumbnail(pin.media.cover_image_url, async (_url, options) => {
    assert.deepEqual([...options.hosts], ['i.pinimg.com']); return response();
  });
  assert.deepEqual(result.bytes, image); assert.equal(result.type, 'image/png');
  for (const url of ['https://i.pinimg.com/a.svg', 'https://i.pinimg.com:444/a.png', 'https://127.0.0.1/a.png', 'https://user@i.pinimg.com/a.png']) assert.throws(() => thumbnailURL(url));
  for (const headers of [{ 'content-type': 'image/svg+xml' }, { 'content-type': 'text/html' }, { 'content-length': '9999999' }, { 'content-encoding': 'gzip' }]) {
    await assert.rejects(fetchThumbnail(pin.media.cover_image_url, async () => response(image, 200, headers), undefined, 1000));
  }
  await assert.rejects(fetchThumbnail(pin.media.cover_image_url, async () => response(image), undefined, 8), /upstream_limit/);
  await assert.rejects(fetchThumbnail(pin.media.cover_image_url, async () => response('<svg/>')), /thumbnail_unavailable/);
  for (const location of ['https://v.pinimg.com/image.png', 'https://127.0.0.1/image.png', 'http://i.pinimg.com/image.png', 'https://i.pinimg.com/image.svg']) {
    await assert.rejects(fetchThumbnail(pin.media.cover_image_url, async () => response('', 302, { location })));
  }
  let calls = 0;
  await assert.rejects(fetchThumbnail(pin.media.cover_image_url, async () => { calls++; return response('', 302, { location: '/loop.png' }); }), /thumbnail_unavailable/);
  assert.equal(calls, 4);
});
test('JPEG/WebP approved signatures work and mismatched signatures fail', async () => {
  for (const [type, bytes] of [['image/jpeg', Buffer.from([255,216,255,224])], ['image/webp', Buffer.from('RIFF1234WEBP')]]) {
    assert.equal((await fetchThumbnail(pin.media.cover_image_url, async () => response(bytes, 200, { 'content-type': type }))).type, type);
    await assert.rejects(fetchThumbnail(pin.media.cover_image_url, async () => response(image, 200, { 'content-type': type })), /thumbnail_unavailable/);
  }
});
test('public scope requires a matching explicit public board and rejects ad-only Pins/boards', () => {
  assert.doesNotThrow(() => assertPublicPin(pin, '1', { id: '2', privacy: 'PUBLIC' }));
  for (const board of [undefined, {}, { id: '3', privacy: 'PUBLIC' }, ...['SECRET', 'PROTECTED', undefined, null, 'public', 'UNKNOWN'].map(privacy => ({ id: '2', privacy })), { id: '2', privacy: 'PUBLIC', is_ads_only: true }, { id: '2', privacy: 'PUBLIC', is_ads_only: 'false' }]) {
    assert.throws(() => assertPublicPin(pin, '1', board), /public_access_unverified/);
  }
  assert.throws(() => assertPublicPin({ ...pin, is_removable: true }, '1', { id: '2', privacy: 'PUBLIC' }), /public_access_unverified/);
  assert.throws(() => assertPublicPin({ ...pin, is_removable: 'false' }, '1', { id: '2', privacy: 'PUBLIC' }), /public_access_unverified/);
  assert.throws(() => assertPublicPin({ ...pin, board_id: undefined }, '1', { id: '2', privacy: 'PUBLIC' }), /public_access_unverified/);
});
test('official adapter fetches bounded authenticated board metadata and fails before media for unknown/private access', async () => {
  for (const state of ['PUBLIC', 'SECRET', 'PROTECTED', 'missing', 'denied', 'mismatch']) {
    const calls = [];
    const provider = officialProvider({ token: 'fixture-only', platformAuthorized: true, request: async (url, options) => {
      calls.push(String(url)); assert.equal(options.headers.Authorization, 'Bearer fixture-only');
      assert.deepEqual([...options.hosts], ['api.pinterest.com']);
      const data = String(url).endsWith('/pins/1') ? pin : { id: state === 'mismatch' ? '3' : '2', ...(state === 'missing' ? {} : { privacy: state }) };
      return response(JSON.stringify(data), state === 'denied' && calls.length === 2 ? 403 : 200, { 'content-type': 'application/json' });
    } });
    const pending = provider.getPin('https://pinterest.com/pin/1/');
    if (state === 'PUBLIC') assert.equal((await pending).variants[0].thumbnailUrl, pin.media.cover_image_url);
    else await assert.rejects(pending, /public_access_unverified/);
    assert.deepEqual(calls, ['https://api.pinterest.com/v5/pins/1', 'https://api.pinterest.com/v5/boards/2']);
  }
});
test('official provider rejects missing numeric board identity and oversized board response', async () => {
  let calls = 0;
  const noBoard = officialProvider({ token: 'fixture-only', platformAuthorized: true, request: async () => { calls++; return response(JSON.stringify({ ...pin, board_id: undefined }), 200, { 'content-type': 'application/json' }); } });
  await assert.rejects(noBoard.getPin('https://pinterest.com/pin/1/'), /public_access_unverified/); assert.equal(calls, 1);
  const largeBoard = officialProvider({ token: 'fixture-only', platformAuthorized: true, request: async url => response(JSON.stringify(pin), 200, { 'content-type': 'application/json', ...(String(url).includes('/boards/') ? { 'content-length': String(512 * 1024 + 1) } : {}) }) });
  await assert.rejects(largeBoard.getPin('https://pinterest.com/pin/1/'), /upstream_limit/);
});
