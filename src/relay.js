import { fail } from './errors.js';
import { mediaURL, thumbnailURL } from './urls.js';
import { mapPin } from './provider.js';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const WRAPPER = 'window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__(';
const LIMIT = 512 * 1024;
const dimension = n => Number.isInteger(n) && n > 0 && n <= 16384;
// Read one JSON value boundary, respecting quoted escapes. Never evaluate a JS expression.
function valueEnd(text, start) {
  let quoted = false; let escaped = false; let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') { quoted = false; if (depth === 0) return i + 1; }
    } else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') { if (++depth > 80) fail('page_limit', 422); }
    else if (c === '}' || c === ']') { if (--depth === 0) return i + 1; }
  }
  fail('page_metadata_unsupported', 422);
}
export function decodeCompletedRelay(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > LIMIT) fail('page_limit', 422);
  const source = text.trim();
  if (!source.startsWith(WRAPPER)) fail('page_metadata_unsupported', 422);
  let offset = WRAPPER.length;
  const whitespace = () => { while (/\s/.test(source[offset] ?? '') && offset < source.length) offset++; };
  whitespace(); if (source[offset] !== '"') fail('page_metadata_unsupported', 422);
  let descriptor; let payload;
  try {
    const end = valueEnd(source, offset);
    const encoded = JSON.parse(source.slice(offset, end));
    if (encoded.length > 64 * 1024) fail('page_limit', 422);
    if (!/^%7b/i.test(encoded) || !/%7d$/i.test(encoded)) fail('page_metadata_unsupported', 422);
    descriptor = JSON.parse(decodeURIComponent(encoded)); offset = end; whitespace();
    if (source[offset++] !== ',') fail('page_metadata_unsupported', 422);
    whitespace(); if (source[offset] !== '{') fail('page_metadata_unsupported', 422);
    const payloadEnd = valueEnd(source, offset);
    payload = JSON.parse(source.slice(offset, payloadEnd)); offset = payloadEnd;
  } catch (error) { if (error.code) throw error; fail('page_metadata_unsupported', 422); }
  if (!/^\s*\);\s*$/.test(source.slice(offset)) || !record(descriptor) || !record(payload)) fail('page_metadata_unsupported', 422);
  return { descriptor, payload };
}
export function assertUnrestricted(value) {
  if (!record(value)) fail('page_metadata_unsupported', 422);
  for (const key of ['isAuth', 'isPrivate', 'isSecret', 'isProtected', 'isRestricted', 'isUnavailable', 'isDeleted', 'requiresLogin', 'requiresAuth', 'isLoginRequired', 'isAuthRequired', 'isGated', 'isAgeRestricted', 'isBlocked', 'isAdsOnly', 'isDrm', 'isEncrypted', 'is_private', 'is_protected', 'is_restricted', 'requires_auth', 'is_auth_required', 'is_login_required', 'is_secret', 'is_removable', 'is_unavailable', 'requires_login', 'is_drm', 'is_encrypted']) {
    if (Object.hasOwn(value, key) && value[key] !== false) fail('public_access_unverified', 403);
  }
  for (const key of ['privacy', 'visibility']) if (value[key] !== undefined && !['public', 'PUBLIC'].includes(value[key])) fail('public_access_unverified', 403);
  if (value.isPublic !== undefined && value.isPublic !== true) fail('public_access_unverified', 403);
  if (value.isPlayable === false || value.is_playable === false || value.drm != null || value.licenseUrl || value.license_url || value.encryption || value.error || value.errors?.length || Number(value.statusCode) >= 400 || value.accessDenied || value.gateReason || value.restrictionReason || value.embed?.src) fail('page_blocked', 422);
}
function typedIdentity(value, id) {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('pin_identity_mismatch', 422);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '') || decoded.toString('utf8') !== `Pin:${id}`) fail('pin_identity_mismatch', 422);
}
export function readRelayPins(scripts, id) {
  if (scripts.length > 64) fail('page_limit', 422);
  const variants = new Map(); let title; let description; let bound = false;
  for (const text of scripts) {
    const { descriptor, payload } = decodeCompletedRelay(text);
    const variables = descriptor.variables;
    // Unrelated completed requests are never searched for records/media.
    if (!record(variables) || variables.pinId !== id) continue;
    if (variables.isAuth !== false || variables.isAuthDesktop !== undefined && variables.isAuthDesktop !== false || variables.isUnauth !== undefined && variables.isUnauth !== true) fail('public_access_unverified', 403);
    const query = payload.data?.v3GetPinQueryv2;
    if (payload.errors?.length || query?.errors?.length) fail('page_blocked', 422);
    if (query == null) continue; // A sparse unrelated/empty completion cannot supply media.
    assertUnrestricted(query);
    const pin = query.data;
    if (pin == null) continue;
    assertUnrestricted(pin);
    if (pin.board != null) assertUnrestricted(pin.board);
    if (pin.entityId !== undefined && pin.entityId !== id) fail('pin_identity_mismatch', 422);
    if (pin.id !== undefined) typedIdentity(pin.id, id);
    if (pin.seoUrl !== undefined && pin.seoUrl !== `/pin/${id}/`) fail('pin_identity_mismatch', 422);
    const complete = pin.entityId === id && pin.id !== undefined && pin.seoUrl === `/pin/${id}/`;
    const story = pin.storyPinData;
    if (story == null) continue;
    assertUnrestricted(story);
    if (story.pages == null) continue;
    if (!Array.isArray(story.pages) || story.pages.length > 20) fail('page_limit', 422);
    for (const page of story.pages) {
      if (page == null) continue;
      assertUnrestricted(page);
      if (page.blocks == null) continue;
      if (!Array.isArray(page.blocks) || page.blocks.length > 20) fail('page_limit', 422);
      for (const block of page.blocks) {
        if (block == null) continue;
        assertUnrestricted(block);
        if (block.__typename !== 'StoryPinVideoBlock') continue;
        const video = block.videoDataV2;
        if (video == null) continue;
        assertUnrestricted(video);
        const list = video.videoList720P;
        if (list == null) continue;
        if (!record(list) || Object.keys(list).length > 20) fail('page_limit', 422);
        for (const entry of Object.values(list)) {
          if (entry == null) continue;
          assertUnrestricted(entry);
          if (entry.url == null) continue;
          if (!complete) fail('public_access_unverified', 403);
          const url = mediaURL(entry.url);
          if (!dimension(entry.width) || !dimension(entry.height)) continue; // Sparse results never invent dimensions.
          let thumbnail;
          try { thumbnail = thumbnailURL(typeof entry.thumbnail === 'string' ? entry.thumbnail : entry.thumbnail?.url); } catch { /* Optional poster fallback. */ }
          const prior = variants.get(url);
          if (prior && (prior.width !== entry.width || prior.height !== entry.height)) fail('page_metadata_unsupported', 422);
          variants.set(url, { item_type: 'video', video_url: url, width: entry.width, height: entry.height, cover_image_url: thumbnail ?? prior?.cover_image_url });
          if (variants.size > 20) fail('page_limit', 422);
          bound = true;
        }
      }
    }
    if (complete) { title ||= typeof pin.title === 'string' ? pin.title : ''; description ||= typeof pin.description === 'string' ? pin.description : ''; }
  }
  if (!bound) return null;
  return mapPin({ id, title, description, media: { media_type: 'multiple_videos', items: [...variants.values()] } }, id);
}
