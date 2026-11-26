import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { mapPin } from '../src/provider.js';
import { openMedia } from '../src/media.js';
const pin = { id: '123456789', title: '<script>unsafe</script>', media: { media_type: 'video', width: 1280, height: 720, video_url: 'https://v.pinimg.com/videos/fixture.mp4' } };
const bytes = Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]);
const response = (data = bytes, headers = {}, statusCode = 200) => Object.assign(Readable.from([data]), { headers: { 'content-type': 'video/mp4', ...headers }, statusCode });
async function setup(t, options = {}) {
  const app = createApp({ provider: { enabled: true, getPin: async () => mapPin(pin, pin.id) }, request: async () => response(), log: () => {}, ...options });
  await new Promise(r => app.listen(0, '127.0.0.1', r)); t.after(() => { app.shutdown(); app.closeAllConnections(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  return { app, base, metadata: (body = {}, headers = {}) => fetch(`${base}/api/metadata`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ url: 'https://pinterest.com/pin/123456789/', permission: true, ...body }) }) };
}
test('metadata, opaque preview and attachment download through real HTTP', async t => {
  const { base, metadata } = await setup(t);
  const res = await metadata(); assert.equal(res.status, 200);
  const data = await res.json(); assert.equal(data.title, pin.title); assert.equal(data.formats.length, 1);
  assert.equal(JSON.stringify(data).includes('v.pinimg.com'), false);
  for (const kind of ['preview', 'download']) {
    const media = await fetch(base + data.formats[0][kind]);
    assert.equal(media.status, 200); assert.equal(media.headers.get('content-type'), 'video/mp4');
    assert.match(media.headers.get('content-disposition'), new RegExp(kind === 'preview' ? 'inline' : 'attachment'));
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), bytes);
  }
});
test('permission, spoofed proxy headers, invalid tickets and default gate', async t => {
  const { metadata, base } = await setup(t, { limits: { rate: 2 } });
  assert.equal((await metadata({ permission: false })).status, 403);
  assert.equal((await fetch(base + '/api/download/' + 'a'.repeat(43))).status, 410);
  assert.equal((await metadata({}, { 'x-forwarded-for': '8.8.8.8', 'x-real-ip': '8.8.8.8' })).status, 429);
  const disabled = await setup(t, { provider: { enabled: false } });
  assert.equal((await disabled.metadata()).status, 503);
  assert.equal((await fetch(disabled.base + '/healthz')).status, 200);
});
test('ticket expiry and arbitrary URLs never reach media transport', async t => {
  let now = 0; const { base, metadata } = await setup(t, { now: () => now, limits: { ticketMs: 100 } });
  const data = await (await metadata()).json(); now = 101;
  assert.equal((await fetch(base + data.formats[0].download)).status, 410);
  assert.equal((await fetch(base + '/api/download?url=https://localhost')).status, 400);
  assert.equal((await metadata({ url: 'https://example.com/' })).status, 400);
});
test('media redirects, wrong MIME and declared lengths fail closed', async () => {
  for (const headers of [{ 'content-type': 'text/html' }, { 'content-length': '101' }, { 'content-encoding': 'gzip' }]) await assert.rejects(openMedia(pin.media.video_url, async () => response(bytes, headers), undefined, 100));
  await assert.rejects(openMedia(pin.media.video_url, async () => response(bytes, { location: 'https://127.0.0.1/a.mp4' }, 302), undefined, 100));
  let calls = 0;
  await assert.rejects(openMedia(pin.media.video_url, async () => { calls++; return response(bytes, { location: '/loop.mp4' }, 302); }, undefined, 100), /upstream_redirect/);
  assert.equal(calls, 4);
});
test('streaming byte cap and MP4 signature reject unsafe bodies', async t => {
  for (const data of [Buffer.alloc(80), Buffer.concat([bytes, Buffer.alloc(80)])]) {
    const { base, metadata } = await setup(t, { limits: { maxBytes: 50 }, request: async (_url, opts) => response(opts.method === 'HEAD' ? bytes : data) });
    const result = await (await metadata()).json();
    await assert.rejects(async () => { const r = await fetch(base + result.formats[0].download); await r.arrayBuffer(); });
  }
});
test('deadline, concurrency and client disconnect abort upstream', async t => {
  let aborted = false;
  const provider = { enabled: true, getPin: (_url, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true })) };
  const { metadata } = await setup(t, { provider, limits: { deadlineMs: 50, concurrent: 1 } });
  const pending = metadata(); await new Promise(r => setTimeout(r, 10));
  assert.equal((await metadata()).status, 503); assert.equal((await pending).status, 504); assert.equal(aborted, true);
});
test('request body and origin boundaries', async t => {
  const { metadata, base } = await setup(t);
  assert.equal((await metadata({}, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await metadata({ url: 'x'.repeat(5000) })).status, 413);
  assert.equal((await fetch(base + '/api/metadata', { method: 'POST', body: 'x' })).status, 415);
});
