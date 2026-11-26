import { fail } from './errors.js';
import { mediaURL, resolvePin } from './urls.js';
import { collect, pinnedRequest } from './network.js';
const API_HOSTS = new Set(['api.pinterest.com']);
const dimension = n => Number.isInteger(n) && n > 0 && n <= 16384 ? n : null;
const text = (s, max) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
export function mapPin(data, id) {
  if (!data || data.id !== id) fail('invalid_metadata', 502);
  const media = data.media;
  const items = media?.media_type === 'video' ? [media] :
    ['multiple_videos', 'multiple_mixed'].includes(media?.media_type) && Array.isArray(media.items) ? media.items.filter(v => v?.item_type === 'video' || v?.media_type === 'video') : [];
  if (items.length > 20) fail('invalid_metadata', 502);
  const variants = []; let hls = false;
  for (const [i, item] of items.entries()) {
    hls ||= typeof item.video_url_hls === 'string' && item.video_url_hls.length > 0;
    if (item.video_url == null) continue;
    const url = mediaURL(item.video_url);
    if (variants.some(v => v.url === url)) continue;
    variants.push({ url, type: 'video/mp4', width: dimension(item.width), height: dimension(item.height), item: i + 1 });
  }
  if (!variants.length) fail(hls ? 'hls_unsupported' : items.length ? 'video_access_unavailable' : 'not_video', 422);
  return { id, title: text(data.title, 100) || 'Untitled Pin', description: text(data.description, 500), variants };
}
export function officialProvider({ token, platformAuthorized = false, request = pinnedRequest } = {}) {
  const enabled = platformAuthorized === true && typeof token === 'string' && token.trim().length > 0 && !/[\r\n]/.test(token);
  return {
    enabled,
    async getPin(input, signal) {
      if (!enabled) fail('provider_disabled', 503);
      const id = await resolvePin(input, request, signal);
      const response = await request(`https://api.pinterest.com/v5/pins/${id}`, { hosts: API_HOSTS, signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (response.statusCode !== 200) { response.destroy(); fail('pin_unavailable', 422); }
      if (!/^application\/json(?:;|$)/i.test(response.headers['content-type'] ?? '')) { response.destroy(); fail('invalid_metadata', 502); }
      const bytes = await collect(response, 512 * 1024);
      let data; try { data = JSON.parse(bytes); } catch { fail('invalid_metadata', 502); }
      return mapPin(data, id);
    },
  };
}
