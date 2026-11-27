import { parse } from 'parse5';
import { isDeepStrictEqual } from 'node:util';
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
  const stack = [{ node: document, depth: 0, inert: false }];
  const canonical = []; const stateScripts = []; let nodes = 0; let blocked = false;
  while (stack.length) {
    const { node, depth, inert } = stack.pop();
    if (++nodes > 50_000 || depth > 100) fail('page_limit', 422);
    const a = attributes(node);
    if (node.tagName === 'link' && (a.rel ?? '').toLowerCase().split(/\s+/).includes('canonical')) canonical.push(a.href);
    if (node.tagName === 'meta' && a.property === 'og:url' && !samePin(a.content, id)) fail('pin_identity_mismatch', 422);
    // Challenge evidence must come from potentially rendered content or active UI,
    // never global CSS, script strings, metadata, templates or hidden/inert descendants.
    const nonRendered = inert || ['head', 'script', 'style', 'template', 'noscript'].includes(node.tagName) ||
      Object.hasOwn(a, 'hidden') || Object.hasOwn(a, 'inert') || a['aria-hidden'] === 'true' ||
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(a.style ?? '');
    if (!nonRendered) {
      const widget = /(?:captcha|recaptcha|turnstile|challenge|cf-chl)/i.test(`${a.id ?? ''} ${a.class ?? ''}`);
      if (node.tagName === 'input' && a.type?.toLowerCase() === 'password' ||
          node.tagName === 'form' && /(?:login|signin|auth|challenge|captcha)/i.test(a.action ?? '') ||
          node.tagName === 'iframe' && /(?:recaptcha|hcaptcha|challenges\.cloudflare|turnstile)/i.test(a.src ?? '') ||
          widget && Object.hasOwn(a, 'data-sitekey') || a['data-required-login'] === 'true') blocked = true;
      if (node.nodeName === '#text' && /verify (?:that )?you are human|unusual traffic|access denied|automated requests|complete the captcha|robot check|just a moment|(?:log in|sign in|sign up) to (?:view|continue|watch|see)/i.test(node.value)) blocked = true;
    }
    if (node.tagName === 'script' && ['__PWS_DATA__', '__PWS_INITIAL_PROPS__'].includes(a.id)) {
      if (a.type !== 'application/json' || a.src) fail('page_metadata_unsupported', 422);
      const content = (node.childNodes ?? []).map(child => child.value ?? '').join('');
      if (Buffer.byteLength(content) > JSON_LIMIT) fail('page_limit', 422);
      stateScripts.push({ name: a.id, content });
    }
    // Template contents are inert, and are never an extraction source.
    for (const child of node.childNodes ?? []) stack.push({ node: child, depth: depth + 1, inert: nonRendered });
  }
  if (blocked) fail('page_blocked', 422);
  if (canonical.some(value => !samePin(value, id))) fail('pin_identity_mismatch', 422);
  if (canonical.length !== 1) fail('page_metadata_unsupported', 422);
  if (!stateScripts.length) fail('page_metadata_unsupported', 422);
  const names = new Set(); const candidates = [];
  for (const source of stateScripts) {
    if (names.has(source.name)) fail('page_metadata_unsupported', 422);
    names.add(source.name);
    let state; try { state = JSON.parse(source.content); } catch { fail('page_metadata_unsupported', 422); }
    if (!record(state)) fail('page_metadata_unsupported', 422);
    if (source.name === '__PWS_DATA__' && !record(state.props)) {
      // The current route bootstrap carries routing metadata, not Pin records.
      if (!Object.hasOwn(state, 'props') && state.routeTree && typeof state.routeTree === 'object' &&
          Object.hasOwn(state, 'initialHandlerId')) continue;
      fail('page_metadata_unsupported', 422);
    }
    const redux = source.name === '__PWS_DATA__' ? state.props.initialReduxState : state.initialReduxState;
    // __PWS_DATA__ can be a runtime shell alongside __PWS_INITIAL_PROPS__.
    if (redux === undefined && source.name === '__PWS_DATA__') continue;
    if (!record(redux) || redux.pins !== undefined && !record(redux.pins)) fail('page_metadata_unsupported', 422);
    const pins = redux.pins;
    if (!pins || !Object.hasOwn(pins, id)) continue; // Missing requested data is not a conflicting identity.
    const candidate = pins[id];
    if (!record(candidate) || typeof candidate.id !== 'string') fail('page_metadata_unsupported', 422);
    if (candidate.id !== id) fail('pin_identity_mismatch', 422);
    candidates.push(candidate);
  }
  if (!candidates.length) fail('page_video_unavailable', 422);
  if (candidates.some(candidate => !isDeepStrictEqual(candidate, candidates[0]))) fail('page_metadata_unsupported', 422);
  const pin = candidates[0]; const board = pin.board;
  if (pin.is_private !== false || !record(board) || !['public', 'PUBLIC'].includes(board.privacy) ||
      [pin.is_secret, pin.is_removable, board.is_private, board.is_protected, board.is_ads_only].some(value => value !== undefined && value !== false)) fail('public_access_unverified', 403);
  if (pin.is_unavailable === true || pin.is_playable === false || pin.requires_login === true || pin.is_drm === true || pin.is_encrypted === true || pin.drm != null || pin.license_url || pin.embed?.src) fail('page_blocked', 422);
  const videoList = pin.videos?.video_list;
  if (videoList == null) fail('page_video_unavailable', 422);
  if (!record(videoList)) fail('page_metadata_unsupported', 422);
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
  if (!items.length) fail(hls ? 'hls_unsupported' : 'page_video_unavailable', 422);
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
