import { fail } from './errors.js';
import { mediaURL, resolvePin, thumbnailURL } from './urls.js';
import { collect, pinnedRequest } from './network.js';
const API_HOSTS = new Set(['api.pinterest.com']);
const dimension = n => Number.isInteger(n) && n > 0 && n <= 16384 ? n : null;
const text = (s, max) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
function thumbnail(item, allowImages) {
  // Only documented video cover fields / named ImageSize entries. Optional failures do not block video.
  const candidates = [item.cover_image_url, ...(allowImages ? ['600x', '400x300', '1200x', '150x150'].map(key => item.images?.[key]?.url) : [])];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    try { return thumbnailURL(candidate); } catch { /* Safe no-thumbnail fallback. */ }
  }
  return null;
}
export function assertPublicPin(data, id, board) {
  if (!data || data.id !== id) fail('invalid_metadata', 502);
  if (typeof data.board_id !== 'string' || !/^[1-9]\d{0,29}$/.test(data.board_id) ||
      !board || board.id !== data.board_id || board.privacy !== 'PUBLIC' ||
      (board.is_ads_only !== undefined && typeof board.is_ads_only !== 'boolean') ||
      (data.is_removable != null && typeof data.is_removable !== 'boolean') ||
      board.is_ads_only === true || data.is_removable === true) fail('public_access_unverified', 403);
}
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
    variants.push({ url, type: 'video/mp4', width: dimension(item.width), height: dimension(item.height), item: i + 1, thumbnailUrl: thumbnail(item, media.media_type === 'video') });
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
      async function officialJSON(path, unavailableCode) {
        const response = await request(`https://api.pinterest.com/v5/${path}`, { hosts: API_HOSTS, signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        if (response.statusCode !== 200) { response.destroy(); fail(unavailableCode, unavailableCode === 'public_access_unverified' ? 403 : 422); }
        if (!/^application\/json(?:;|$)/i.test(response.headers['content-type'] ?? '')) { response.destroy(); fail('invalid_metadata', 502); }
        const bytes = await collect(response, 512 * 1024);
        try { return JSON.parse(bytes); } catch { fail('invalid_metadata', 502); }
      }
      const data = await officialJSON(`pins/${id}`, 'pin_unavailable');
      if (!data || data.id !== id) fail('invalid_metadata', 502);
      if (typeof data.board_id !== 'string' || !/^[1-9]\d{0,29}$/.test(data.board_id)) fail('public_access_unverified', 403);
      // Get Pin has no privacy signal. Never infer public access from a successful authenticated lookup.
      const board = await officialJSON(`boards/${data.board_id}`, 'public_access_unverified');
      assertPublicPin(data, id, board);
      return mapPin(data, id);
    },
  };
}
