import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError, fail } from './errors.js';
import { MEDIA_HOSTS, mediaURL } from './urls.js';
export async function openMedia(url, request, signal, maxBytes, method = 'GET') {
  let current = mediaURL(url);
  for (let hop = 0; hop <= 3; hop++) {
    const response = await request(current, { hosts: MEDIA_HOSTS, method, signal });
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      response.destroy();
      if (hop === 3 || typeof response.headers.location !== 'string') fail('upstream_redirect', 502);
      current = mediaURL(new URL(response.headers.location, current).href); continue;
    }
    const length = response.headers['content-length'];
    if (response.statusCode !== 200 || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity' || !/^video\/mp4(?:;|$)/i.test(response.headers['content-type'] ?? '')) {
      response.destroy(); fail('unsupported_media', 422);
    }
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes || Number(length) < 12)) {
      response.destroy(); fail('media_limit', 422);
    }
    return response;
  }
}
export async function streamMedia(upstream, output, maxBytes, signal) {
  let size = 0; let prefix = Buffer.alloc(0); let verified = false;
  const guard = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) return callback(new AppError('media_limit', 422));
      if (verified) return callback(null, chunk);
      prefix = Buffer.concat([prefix, chunk]);
      if (prefix.length < 12) return callback();
      if (prefix.toString('ascii', 4, 8) !== 'ftyp') return callback(new AppError('unsupported_media', 422));
      verified = true; callback(null, prefix); prefix = null;
    },
    flush(callback) { callback(verified ? undefined : new AppError('unsupported_media', 422)); },
  });
  await pipeline(upstream, guard, output, { signal });
}
