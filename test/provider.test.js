import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pinInput, resolvePin, mediaURL } from '../src/urls.js';
import { isPublic, checkedAddress, collect } from '../src/network.js';
import { officialProvider, mapPin } from '../src/provider.js';
export const pin = { id: '123456789', title: 'A quiet morning', description: 'Permission-owned fixture', media: { media_type: 'video', width: 1280, height: 720, video_url: 'https://v.pinimg.com/videos/fixture.mp4' } };
const response = (body, statusCode = 200, headers = {}) => Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers });
test('explicit Pinterest domains and strict canonical identity', () => {
  for (const host of ['pinterest.com', 'www.pinterest.co.uk', 'id.pinterest.com']) {
    if (host.startsWith('id.')) assert.throws(() => pinInput(`https://${host}/pin/123/`));
    else assert.equal(pinInput(`https://${host}/pin/123/?utm_source=test`).id, '123');
  }
  for (const url of ['http://pinterest.com/pin/1/', 'https://pinterest.com.evil.test/pin/1/', 'https://pinterest.com@evil.test/pin/1/', 'https://pinterest.com:444/pin/1/', 'https://pinterest.com/pin/1/#x', 'https://pinterest.com/pin/../1/', 'https://pin.it/abc?url=x', 'https://127.0.0.1/pin/1/', 'https://pinterest.com\\@evil.test/pin/1/']) assert.throws(() => pinInput(url), url);
});
test('short links follow only validated bounded HEAD redirects', async () => {
  let calls = 0;
  assert.equal(await resolvePin('https://pin.it/abc', async (_u, options) => { calls++; assert.equal(options.method, 'HEAD'); return response('', 302, { location: 'https://www.pinterest.com/pin/123/' }); }), '123');
  assert.equal(calls, 1);
  await assert.rejects(resolvePin('https://pin.it/abc', async () => response('', 302, { location: 'http://localhost/' })));
  await assert.rejects(resolvePin('https://pin.it/abc', async () => response('', 302, { location: '/abc' })), /too_many_redirects/);
});
test('reject special and mapped addresses and mixed DNS answers', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '192.0.0.8', '192.0.2.1', '198.18.0.1', '224.0.0.1', '0.0.0.0', '255.255.255.255', '::', '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8', '2001:db8::1', '2001::1']) assert.equal(isPublic(ip), false, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublic(ip), true, ip);
  await assert.rejects(checkedAddress('test', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]), /unsafe_upstream/);
});
test('official provider is disabled without both access gates', async () => {
  let calls = 0;
  for (const opts of [{}, { token: 'test' }, { platformAuthorized: true }]) {
    const provider = officialProvider({ ...opts, request: async () => { calls++; } });
    await assert.rejects(provider.getPin('https://pinterest.com/pin/123/'), /provider_disabled/);
  }
  assert.equal(calls, 0);
});
test('official adapter maps documented schema and never returns token', async () => {
  const provider = officialProvider({ token: 'fixture-only', platformAuthorized: true, request: async (url, opts) => {
    assert.equal(String(url), 'https://api.pinterest.com/v5/pins/123456789'); assert.equal(opts.headers.Authorization, 'Bearer fixture-only');
    return response(JSON.stringify(pin), 200, { 'content-type': 'application/json' });
  } });
  const result = await provider.getPin('https://www.pinterest.com/pin/123456789/');
  assert.equal(result.variants[0].height, 720); assert.equal(result.id, pin.id);
  assert.throws(() => mapPin({ ...pin, id: 'other' }, pin.id), /invalid_metadata/);
  assert.throws(() => mapPin({ id: pin.id, media: { media_type: 'image' } }, pin.id), /not_video/);
  assert.throws(() => mapPin({ id: pin.id, media: { media_type: 'video' } }, pin.id), /video_access_unavailable/);
  assert.throws(() => mapPin({ id: pin.id, media: { media_type: 'video', video_url_hls: 'https://v.pinimg.com/a.m3u8' } }, pin.id), /hls_unsupported/);
  assert.throws(() => mediaURL('https://v.pinimg.com.evil.test/a.mp4'));
  assert.throws(() => mediaURL('https://v.pinimg.com/a.m3u8'));
});
test('bounded API bodies reject declared and actual excess', async () => {
  await assert.rejects(collect(response('x', 200, { 'content-length': '100' }), 4), /upstream_limit/);
  await assert.rejects(collect(response('12345'), 4), /upstream_limit/);
});
test('transport pins a checked IP and retains TLS hostname without proxy or pooling', async () => {
  const { EventEmitter } = await import('node:events');
  const { createPinnedRequest } = await import('../src/network.js');
  let lookups = 0;
  const request = createPinnedRequest({
    resolver: async () => { lookups++; return [{ address: '8.8.8.8', family: 4 }]; },
    connect: (url, options, callback) => {
      assert.equal(url.hostname, 'v.pinimg.com'); assert.equal(options.servername, 'v.pinimg.com'); assert.equal(options.agent, false);
      options.lookup('v.pinimg.com', {}, (_err, address, family) => { assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
      options.lookup('v.pinimg.com', { all: true }, (_err, records) => assert.deepEqual(records, [{ address: '8.8.8.8', family: 4 }]));
      const req = new EventEmitter(); req.end = () => callback(response('')); return req;
    },
  });
  const res = await request('https://v.pinimg.com/test.mp4', { hosts: new Set(['v.pinimg.com']) }); res.destroy();
  assert.equal(lookups, 1); assert.equal(isPublic('3fff::1'), false);
});
test('mixed media mapping includes every documented direct native item without synthetic formats', () => {
  const result = mapPin({ id: pin.id, media: { media_type: 'multiple_mixed', items: [{ item_type: 'image' }, { item_type: 'video', video_url: pin.media.video_url, width: null, height: null }, { item_type: 'video', video_url: 'https://v.pinimg.com/second.mp4', width: 640, height: 360 }] } }, pin.id);
  assert.equal(result.variants.length, 2); assert.equal(result.variants[0].height, null); assert.equal(result.variants[1].height, 360);
  assert.throws(() => pinInput('https://pinterest.com/x/../pin/1/'));
  assert.throws(() => pinInput('https://pinterest.com/x/%2e%2e/pin/1/'));
});
