import { fail } from './errors.js';
import { IMAGE_HOSTS, thumbnailURL } from './urls.js';
import { collect } from './network.js';
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
function matchesSignature(bytes, type) {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return type === 'image/webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}
// Small images are bounded in memory and verified before any image bytes are served. No persistent cache.
export async function fetchThumbnail(url, request, signal, maxBytes = 2 * 1024 * 1024) {
  let current = thumbnailURL(url);
  for (let hop = 0; hop <= 3; hop++) {
    const response = await request(current, { hosts: IMAGE_HOSTS, signal });
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      response.destroy();
      if (hop === 3 || typeof response.headers.location !== 'string') fail('thumbnail_unavailable', 422);
      current = thumbnailURL(new URL(response.headers.location, current).href); continue;
    }
    const type = (response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (response.statusCode !== 200 || !TYPES.has(type)) { response.destroy(); fail('thumbnail_unavailable', 422); }
    const bytes = await collect(response, maxBytes);
    if (!matchesSignature(bytes, type)) fail('thumbnail_unavailable', 422);
    return { bytes, type };
  }
}
