// Test-only dependency injection. Not imported by production and not copied into its image.
import { createApp } from '../src/app.js';
import { officialProvider } from '../src/provider.js';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
const bytes = await readFile(new URL('../test/fixtures/sample.mp4', import.meta.url));
const poster = await readFile(new URL('../test/fixtures/poster.png', import.meta.url));
const response = (body, statusCode, headers) => Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers });
const request = async (value, options) => {
  const u = new URL(value);
  if (u.hostname === 'pin.it') return response('', 302, { location: 'https://www.pinterest.com/pin/1/' });
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
  if (u.href !== 'https://v.pinimg.com/generated.mp4') throw new Error('Unexpected fixture URL');
  return response(options.method === 'HEAD' ? '' : bytes, 200, { 'content-type': 'video/mp4', 'content-length': String(bytes.length) });
};
const app = createApp({ provider: officialProvider({ token: 'fixture-not-a-credential', platformAuthorized: true, request }), request, limits: { rate: 200 }, log: () => {} });
app.listen(3100, '127.0.0.1', () => console.log('Fixture server on loopback port 3100'));
process.on('SIGTERM', () => app.shutdown());
