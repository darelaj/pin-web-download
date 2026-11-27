import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { publicPageProvider } from '../src/public-page.js';
import { relayHTML, relayScript } from '../scripts/public-page-fixture.mjs';
const video = await readFile(new URL('./fixtures/relay-sample.mp4', import.meta.url));
const poster = await readFile(new URL('./fixtures/poster.png', import.meta.url));
const response = (body, headers) => Object.assign(Readable.from([Buffer.from(body)]), { statusCode: 200, headers });
test('Relay/self-bound canonical alias metadata → poster → preview/download uses opaque tickets through HTTP', async t => {
  const pages = []; const media = [];
  const pageRequest = async value => {
    pages.push(String(value)); const id = new URL(value).pathname.split('/')[2];
    return response(relayHTML(id, { canonicalID: id === '2' ? '3' : id }), { 'content-type': 'text/html' });
  };
  const app = createApp({ provider: publicPageProvider({ enabled: true, request: pageRequest }), request: async (url, options) => {
    media.push(String(url)); assert.equal(options.hosts.has(new URL(url).hostname), true);
    if (String(url).includes('i.pinimg.com')) return response(poster, { 'content-type': 'image/png' });
    assert.equal(String(url), 'https://v1.pinimg.com/generated.mp4');
    return response(options.method === 'HEAD' ? '' : video, { 'content-type': 'video/mp4', 'content-length': String(video.length) });
  }, log: () => {} });
  await new Promise(r => app.listen(0, '127.0.0.1', r)); t.after(() => { app.shutdown(); app.closeAllConnections(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  for (const id of ['1', '2']) {
    const result = await fetch(base + '/api/metadata', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: `https://id.pinterest.com/pin/${id}/`, permission: true }) });
    assert.equal(result.status, 200); const data = await result.json(); assert.equal(data.id, id); assert.equal(data.formats.length, 1);
    assert.match(data.formats[0].label, /540 × 960/); assert.equal(JSON.stringify(data).includes('pinimg.com'), false);
    for (const kind of ['thumbnail', 'preview', 'download']) {
      const stream = await fetch(base + data.formats[0][kind]); assert.equal(stream.status, 200);
      assert.deepEqual(Buffer.from(await stream.arrayBuffer()), kind === 'thumbnail' ? poster : video);
      if (kind === 'download') assert.match(stream.headers.get('content-disposition'), /attachment/);
    }
  }
  assert.deepEqual(pages, ['https://id.pinterest.com/pin/1/', 'https://id.pinterest.com/pin/2/', 'https://www.pinterest.com/pin/3/']);
  assert.equal(media.length, 8);
});
test('restricted canonical proof returns safe error before any media ticket/probe through metadata entry', async t => {
  let media = 0;
  const provider = publicPageProvider({ enabled: true, request: async url => {
    const id = new URL(url).pathname.split('/')[2];
    return response(id === '1' ? relayHTML('1', { canonicalID: '2' }) : relayHTML('2', { script: relayScript('2', { pin: { requiresLogin: true } }) }), { 'content-type': 'text/html' });
  } });
  const app = createApp({ provider, request: async () => { media++; }, log: () => {} });
  await new Promise(r => app.listen(0, '127.0.0.1', r)); t.after(() => { app.shutdown(); app.closeAllConnections(); });
  const result = await fetch(`http://127.0.0.1:${app.address().port}/api/metadata`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://pinterest.com/pin/1/', permission: true }) });
  assert.equal(result.status, 403); assert.deepEqual(await result.json(), { error: 'public_access_unverified' }); assert.equal(media, 0);
});
