import { parse } from 'parse5';
import { fail } from './errors.js';
import { PIN_HOSTS, pinInput, resolvePin, mediaURL, thumbnailURL } from './urls.js';
import { collect, pinnedRequest } from './network.js';
import { mapPin } from './provider.js';
const HTML_LIMIT = 2 * 1024 * 1024;
const JSON_LIMIT = 512 * 1024;
const attributes = node => Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function samePin(value, id) {
  try { return pinInput(value).id === id; } catch { return false; }
}
// A deliberately narrow reader, not a JavaScript evaluator or recursive JSON/media search.
// Unknown page/state layouts are unsupported until fixture-backed compatibility review.
export function parsePublicPinHTML(html, id) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > HTML_LIMIT) fail('page_limit', 422);
  if (!/^[1-9]\d{0,29}$/.test(id)) fail('invalid_url');
  const document = parse(html, { scriptingEnabled: true });
  const stack = [{ node: document, depth: 0 }];
  const canonical = []; const stateScripts = []; let nodes = 0; let blocked = false;
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (++nodes > 50_000 || depth > 100) fail('page_limit', 422);
    const a = attributes(node);
    if (node.tagName === 'link' && (a.rel ?? '').toLowerCase().split(/\s+/).includes('canonical')) canonical.push(a.href);
    if (node.tagName === 'meta' && a.property === 'og:url' && !samePin(a.content, id)) fail('pin_identity_mismatch', 422);
    if (node.tagName === 'input' && a.type?.toLowerCase() === 'password' || node.tagName === 'form' && /(?:login|signin|auth|challenge|captcha)/i.test(a.action ?? '') || /(?:captcha|recaptcha|turnstile|challenge-container|challenge-running|cf-chl|login-required|login-modal)/i.test(`${a.id ?? ''} ${a.class ?? ''} ${a['data-test-id'] ?? ''}`) || /(?:recaptcha|hcaptcha|challenges\.cloudflare|turnstile)/i.test(a.src ?? '') || a['data-required-login'] === 'true') blocked = true;
    if (node.nodeName === '#text' && /verify (?:that )?you are human|unusual traffic|access denied|automated requests|complete the captcha|robot check|just a moment|(?:log in|sign in|sign up) to (?:view|continue|watch|see)/i.test(node.value)) blocked = true;
    if (node.tagName === 'script' && ['__PWS_DATA__', '__PWS_INITIAL_PROPS__'].includes(a.id)) {
      if (a.type !== 'application/json' || a.src) fail('page_metadata_unsupported', 422);
      const content = (node.childNodes ?? []).map(child => child.value ?? '').join('');
      if (Buffer.byteLength(content) > JSON_LIMIT) fail('page_limit', 422);
      stateScripts.push({ name: a.id, content });
    }
    // Template contents are inert, and are never an extraction source.
    for (const child of node.childNodes ?? []) stack.push({ node: child, depth: depth + 1 });
  }
  if (blocked) fail('page_blocked', 422);
  if (canonical.length !== 1 || !samePin(canonical[0], id)) fail('pin_identity_mismatch', 422);
  if (stateScripts.length !== 1) fail('page_metadata_unsupported', 422);
  let state; try { state = JSON.parse(stateScripts[0].content); } catch { fail('page_metadata_unsupported', 422); }
  const redux = stateScripts[0].name === '__PWS_DATA__' ? state?.props?.initialReduxState : state?.initialReduxState;
  const pins = redux?.pins;
  if (!record(pins) || !Object.hasOwn(pins, id) || !record(pins[id]) || pins[id].id !== id) fail('pin_identity_mismatch', 422);
  const pin = pins[id]; const board = pin.board;
  if (pin.is_private !== false || !record(board) || !['public', 'PUBLIC'].includes(board.privacy) ||
      [pin.is_secret, pin.is_removable, board.is_private, board.is_protected, board.is_ads_only].some(value => value !== undefined && value !== false)) fail('public_access_unverified', 403);
  if (pin.is_unavailable === true || pin.is_playable === false || pin.requires_login === true || pin.is_drm === true || pin.is_encrypted === true || pin.drm != null || pin.license_url || pin.embed?.src) fail('page_blocked', 422);
  const videoList = pin.videos?.video_list;
  if (!record(videoList)) fail('not_video', 422);
  const entries = Object.entries(videoList);
  if (entries.length > 20) fail('page_limit', 422);
  let cover;
  for (const key of ['orig', '736x', '564x', '474x', '236x']) {
    const candidate = pin.images?.[key]?.url;
    if (candidate == null) continue;
    try { cover = thumbnailURL(candidate); break; } catch { /* Optional image: safe fallback. */ }
  }
  const items = []; let hls = false;
  for (const [key, video] of entries) {
    if (!record(video) || typeof video.url !== 'string') fail('page_metadata_unsupported', 422);
    if (video.is_encrypted === true || video.drm != null || video.license_url) fail('page_blocked', 422);
    if (/hls/i.test(key) || /\.m3u8(?:\?|$)/i.test(video.url)) { hls = true; continue; }
    const url = mediaURL(video.url);
    items.push({ item_type: 'video', video_url: url, width: video.width, height: video.height, cover_image_url: cover });
  }
  if (!items.length) fail(hls ? 'hls_unsupported' : 'not_video', 422);
  return mapPin({ id, title: pin.title || pin.grid_title, description: pin.description || pin.seo_description, media: { media_type: 'multiple_videos', items } }, id);
}
export function publicPageProvider({ enabled = false, request = pinnedRequest } = {}) {
  return {
    enabled: enabled === true,
    async getPin(input, signal) {
      if (enabled !== true) fail('provider_disabled', 503);
      const id = await resolvePin(input, request, signal);
      let current = `https://www.pinterest.com/pin/${id}/`;
      for (let hop = 0; hop <= 3; hop++) {
        const response = await request(current, { hosts: PIN_HOSTS, signal, headers: { Accept: 'text/html', 'User-Agent': 'Pinfold/1.0 (permitted personal public-page reader)' } });
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.destroy();
          if (hop === 3 || typeof response.headers.location !== 'string') fail('page_blocked', 422);
          let next; try { next = new URL(response.headers.location, current).href; } catch { fail('page_blocked', 422); }
          if (!samePin(next, id)) fail('page_blocked', 422);
          current = pinInput(next).url.href; continue;
        }
        if (response.statusCode !== 200) { response.destroy(); fail('page_blocked', 422); }
        if (!/^text\/html(?:;|$)/i.test(response.headers['content-type'] ?? '')) { response.destroy(); fail('page_metadata_unsupported', 422); }
        const html = await collect(response, HTML_LIMIT);
        return parsePublicPinHTML(new TextDecoder('utf-8', { fatal: true }).decode(html), id);
      }
    },
  };
}
