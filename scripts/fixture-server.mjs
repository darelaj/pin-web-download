// Test-only dependency injection. Not imported by production and not copied into its image.
import { createApp } from '../src/app.js';
import { publicPageProvider } from '../src/public-page.js';
import { publicHTML, publicShellHTML, relayHTML, relayScript } from './public-page-fixture.mjs';
import { officialProvider } from '../src/provider.js';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
const bytes = await readFile(new URL('../test/fixtures/sample.mp4', import.meta.url));
const relayBytes = await readFile(new URL('../test/fixtures/relay-sample.mp4', import.meta.url));
const poster = await readFile(new URL('../test/fixtures/poster.png', import.meta.url));
const response = (body, statusCode, headers) => Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers });
const request = async (value, options) => {
  const u = new URL(value);
  if (u.hostname === 'pin.it') return response('', 308, { location: 'https://api.pinterest.com/url_shortener/fixture/redirect/' });
  if (u.href === 'https://api.pinterest.com/url_shortener/fixture/redirect/') {
    if (options.method !== 'HEAD' || options.headers?.Authorization || options.headers?.Cookie) throw new Error('Resolver must be anonymous HEAD');
    return response('', 302, { location: 'https://www.pinterest.com/pin/1/sent/?fixture_tracking=discard' });
  }
  if (u.pathname.includes('/sent/')) throw new Error('Terminal sent route must not be fetched');
  if (u.hostname === 'i.pinimg.com') {
    if (u.pathname === '/broken.png') return response('<svg/>', 200, { 'content-type': 'image/svg+xml' });
    return response(poster, 200, { 'content-type': 'image/png', 'content-length': String(poster.length) });
  }
  if (u.hostname === 'api.pinterest.com' && u.pathname.startsWith('/v5/boards/')) {
    const id = u.pathname.split('/').pop();
    if (id === '11') return response('{}', 403, { 'content-type': 'application/json' });
    const board = { id, ...(id === '9' ? {} : { privacy: id === '8' ? 'SECRET' : 'PUBLIC' }), is_ads_only: id === '10' };
    return response(JSON.stringify(board), 200, { 'content-type': 'application/json' });
  }
  if (u.hostname === 'api.pinterest.com') {
    const id = u.pathname.split('/').pop();
    if (id === '4') return response('{}', 404, { 'content-type': 'application/json' });
    if (id === '5') await new Promise(r => setTimeout(r, 800));
    const media = id === '2' ? { media_type: 'image' } : id === '3' ? { media_type: 'video', video_url_hls: 'https://v.pinimg.com/fixture.m3u8' } : { media_type: 'video', width: 320, height: 180, video_url: 'https://v.pinimg.com/generated.mp4', ...(id === '6' ? {} : { cover_image_url: id === '7' ? 'https://i.pinimg.com/broken.png' : 'https://i.pinimg.com/generated.png' }) };
    return response(JSON.stringify({ id, board_id: ['8', '9', '10', '11'].includes(id) ? id : '7654321', title: '<script>alert("fixture")</script> Quiet moments', description: 'Locally generated test video. No Pinterest content was accessed.', media }), 200, { 'content-type': 'application/json' });
  }
  if (!['https://v.pinimg.com/generated.mp4', 'https://v1.pinimg.com/generated.mp4'].includes(u.href)) throw new Error('Unexpected fixture URL');
  const selected = u.hostname === 'v1.pinimg.com' ? relayBytes : bytes;
  return response(options.method === 'HEAD' ? '' : selected, 200, { 'content-type': 'video/mp4', 'content-length': String(selected.length) });
};
const publicMode = process.argv.includes('--public-page');
const publicRequest = async (value, options) => {
  const u = new URL(value);
  if (u.hostname === 'pin.it' || u.href === 'https://api.pinterest.com/url_shortener/fixture/redirect/') return request(value, options);
  if (!u.hostname.endsWith('pinterest.com')) return request(value, options);
  const id = u.pathname.split('/').filter(Boolean).pop();
  if (id === '4') return response('Not found', 404, { 'content-type': 'text/html' });
  if (id === '5') await new Promise(r => setTimeout(r, 800));
  const overrides = id === '2' ? { videos: undefined } : id === '3' ? { videos: { video_list: { hls: { url: 'https://v.pinimg.com/fixture.m3u8' } } } } :
    id === '6' ? { images: {} } : id === '7' ? { images: { orig: { url: 'https://i.pinimg.com/broken.png' } } } :
    id === '8' ? { is_private: true } : id === '9' ? { board: {} } : id === '10' ? { is_removable: true } : id === '11' ? { board: { privacy: 'protected' } } : {};
  let html = publicHTML(id, { title: '<script>alert("fixture")</script> Quiet moments', ...overrides });
  if (id === '12') html += '<form action="/login/"><input type="password"></form>';
  if (id === '13') html += '<div id="captcha">Verify you are human</div>';
  if (id === '14') html = publicHTML('99');
  if (id === '15') html = publicShellHTML(id);
  if (id === '16') html = publicShellHTML(id, '99');
  if (id === '17') html = publicShellHTML(id).replace('id="__PWS_INITIAL_PROPS__" type="application/json">', 'id="__PWS_INITIAL_PROPS__" type="application/json">broken');
  if (id === '1') html = relayHTML(id, { script: relayScript(id, { pin: { title: '<script>alert("fixture")</script> Quiet moments' } }), prompt: '<aside>Sign in to Pinterest<form action="/login/"><input type="password"></form></aside>' });
  if (id === '18') html = relayHTML(id, { canonicalID: '19' });
  if (id === '19') html = relayHTML(id);
  if (id === '20') html = relayHTML(id, { canonicalID: '21' });
  if (id === '21') html = relayHTML(id, { script: relayScript(id, { pin: { isPrivate: true } }) });
  return response(html, 200, { 'content-type': 'text/html; charset=utf-8' });
};
const provider = publicMode ? publicPageProvider({ enabled: true, request: publicRequest }) : officialProvider({ token: 'fixture-not-a-credential', platformAuthorized: true, request });
const app = createApp({ provider, request, limits: { rate: 200 }, log: () => {} });
app.listen(3100, '127.0.0.1', () => console.log(`Fixture server (${publicMode ? 'public-page' : 'official'}) on loopback port 3100`));
process.on('SIGTERM', () => app.shutdown());
