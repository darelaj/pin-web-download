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
test('deadline and concurrency abort upstream', async t => {
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
test('entry page and assets are served with offline CSP and native controls', async t => {
  const { base } = await setup(t);
  const page = await fetch(base + '/'); const html = await page.text();
  assert.equal(page.status, 200); assert.match(html, /<form id="download-form">/); assert.match(html, /<video id="preview" controls/);
  assert.match(page.headers.get('content-security-policy'), /media-src 'self'/);
  for (const asset of ['/app.css', '/app.js']) { const r = await fetch(base + asset); assert.equal(r.status, 200); assert.ok((await r.text()).length > 100); }
});
test('client disconnect aborts upstream work and releases concurrency', async t => {
  const http = await import('node:http');
  let started; const ready = new Promise(r => { started = r; });
  let aborted; const stopped = new Promise(r => { aborted = r; });
  const provider = { enabled: true, getPin: (_url, signal) => new Promise((_, reject) => {
    started(); signal.addEventListener('abort', () => { aborted(); reject(signal.reason); }, { once: true });
  }) };
  const { base } = await setup(t, { provider, limits: { deadlineMs: 1000 } });
  const req = http.request(base + '/api/metadata', { method: 'POST', headers: { 'content-type': 'application/json' } });
  req.on('error', () => {}); req.end(JSON.stringify({ url: 'https://pinterest.com/pin/1/', permission: true }));
  await ready; req.destroy();
  await Promise.race([stopped, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('disconnect did not abort')), 500); timer.unref(); })]);
});
test('same-origin thumbnail capability serves exact image bytes and expires without leaking CDN URLs', async t => {
  const { readFile } = await import('node:fs/promises');
  const image = await readFile(new URL('./fixtures/poster.png', import.meta.url));
  let now = 0;
  const dataPin = { ...pin, media: { ...pin.media, cover_image_url: 'https://i.pinimg.com/fixture.png' } };
  const { base, metadata } = await setup(t, { now: () => now, limits: { ticketMs: 100 }, provider: { enabled: true, getPin: async () => mapPin(dataPin, pin.id) }, request: async value => String(value).includes('i.pinimg.com') ? response(image, { 'content-type': 'image/png' }) : response() });
  const data = await (await metadata()).json();
  assert.match(data.formats[0].thumbnail, /^\/api\/thumbnail\/[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(data).includes('pinimg.com'), false);
  const thumbnail = await fetch(base + data.formats[0].thumbnail);
  assert.equal(thumbnail.status, 200); assert.equal(thumbnail.headers.get('content-type'), 'image/png');
  assert.equal(thumbnail.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await thumbnail.arrayBuffer()), image);
  now = 101; assert.equal((await fetch(base + data.formats[0].thumbnail)).status, 410);
  assert.equal((await fetch(base + '/api/thumbnail?url=https://i.pinimg.com/a.png')).status, 400);
});
test('no-thumbnail fallback has no image ticket and SVG image bodies are never served', async t => {
  const noThumbnail = await setup(t);
  const noData = await (await noThumbnail.metadata()).json(); assert.equal(noData.formats[0].thumbnail, null);
  assert.equal((await fetch(noThumbnail.base + noData.formats[0].preview.replace('/preview/', '/thumbnail/'))).status, 404);
  const dataPin = { ...pin, media: { ...pin.media, cover_image_url: 'https://i.pinimg.com/fixture.png' } };
  const bad = await setup(t, { provider: { enabled: true, getPin: async () => mapPin(dataPin, pin.id) }, request: async value => String(value).includes('i.pinimg.com') ? response(Buffer.from('<svg/>'), { 'content-type': 'image/svg+xml' }) : response() });
  const data = await (await bad.metadata()).json();
  const result = await fetch(bad.base + data.formats[0].thumbnail);
  assert.equal(result.status, 422); assert.match(result.headers.get('content-type'), /application\/json/);
  assert.equal((await result.text()).includes('<svg'), false);
});
test('private official-board metadata cannot issue public media or thumbnail capabilities', async t => {
  const { officialProvider } = await import('../src/provider.js');
  let mediaCalls = 0;
  const provider = officialProvider({ token: 'fixture-only', platformAuthorized: true, request: async url => response(Buffer.from(JSON.stringify(String(url).includes('/pins/') ? { ...pin, board_id: '2' } : { id: '2', privacy: 'SECRET' })), { 'content-type': 'application/json' }) });
  const { metadata } = await setup(t, { provider, request: async () => { mediaCalls++; return response(); } });
  const result = await metadata(); assert.equal(result.status, 403); assert.deepEqual(await result.json(), { error: 'public_access_unverified' }); assert.equal(mediaCalls, 0);
});
test('public HTML provider completes standard/short metadata → poster → preview → download through HTTP entry points', async t => {
  const { publicPageProvider } = await import('../src/public-page.js');
  const { publicHTML } = await import('../scripts/public-page-fixture.mjs');
  const { readFile } = await import('node:fs/promises');
  const image = await readFile(new URL('./fixtures/poster.png', import.meta.url));
  let htmlRequests = 0; let mediaRequests = 0;
  const publicRequest = async (value, options) => {
    const url = new URL(value);
    assert.equal(options.headers?.Authorization, undefined); assert.equal(options.headers?.Cookie, undefined);
    if (url.hostname === 'pin.it') return response(Buffer.alloc(0), { location: 'https://www.pinterest.com/pin/123456789/' }, 302);
    htmlRequests++; return response(Buffer.from(publicHTML('123456789')), { 'content-type': 'text/html' });
  };
  const provider = publicPageProvider({ enabled: true, request: publicRequest });
  const app = await setup(t, { provider, request: async value => { mediaRequests++; return String(value).includes('i.pinimg.com') ? response(image, { 'content-type': 'image/png' }) : response(); } });
  for (const url of ['https://www.pinterest.com/pin/123456789/', 'https://pin.it/fixture']) {
    const res = await app.metadata({ url }); assert.equal(res.status, 200); const data = await res.json();
    assert.equal(JSON.stringify(data).includes('pinimg.com'), false);
    const thumb = await fetch(app.base + data.formats[0].thumbnail); assert.deepEqual(Buffer.from(await thumb.arrayBuffer()), image);
    for (const key of ['preview', 'download']) { const r = await fetch(app.base + data.formats[0][key]); assert.equal(r.status, 200); assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes); }
  }
  assert.equal(htmlRequests, 2); assert.equal(mediaRequests, 8);
});
test('public page blocks/identity failures return safe HTTP errors before media access', async t => {
  const { publicPageProvider } = await import('../src/public-page.js');
  const { publicHTML } = await import('../scripts/public-page-fixture.mjs');
  let mediaRequests = 0;
  for (const [html, code] of [[publicHTML('123456789', { is_private: true }), 'public_access_unverified'], [publicHTML('999'), 'pin_identity_mismatch'], [publicHTML('123456789') + '<div id="captcha">Verify you are human</div>', 'page_blocked']]) {
    const app = await setup(t, { provider: publicPageProvider({ enabled: true, request: async () => response(Buffer.from(html), { 'content-type': 'text/html' }) }), request: async () => { mediaRequests++; return response(); } });
    const res = await app.metadata(); assert.equal(res.status, code === 'public_access_unverified' ? 403 : 422); assert.deepEqual(await res.json(), { error: code });
  }
  assert.equal(mediaRequests, 0);
});
