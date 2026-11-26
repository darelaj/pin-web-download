import { fail } from './errors.js';
const roots = ['pinterest.com', 'pinterest.co.uk', 'pinterest.ca', 'pinterest.com.au', 'pinterest.de', 'pinterest.fr', 'pinterest.es', 'pinterest.it', 'pinterest.jp', 'pinterest.co.kr', 'pinterest.com.mx', 'pinterest.com.br', 'pinterest.pt', 'pinterest.at', 'pinterest.ch', 'pinterest.nl', 'pinterest.se', 'pinterest.dk', 'pinterest.no', 'pinterest.fi', 'pinterest.ie', 'pinterest.nz', 'pinterest.co.in', 'pinterest.ph', 'pinterest.cl', 'pinterest.ru'];
const localeHosts = ['au', 'br', 'ca', 'cl', 'co', 'de', 'dk', 'es', 'fi', 'fr', 'hu', 'id', 'in', 'it', 'jp', 'kr', 'mx', 'nl', 'nz', 'ph', 'pl', 'pt', 'ro', 'ru', 'se', 'sk', 'tr', 'uk', 'vn', 'za'].map(locale => `${locale}.pinterest.com`);
export const PIN_HOSTS = new Set([...roots.flatMap(h => [h, `www.${h}`, `m.${h}`]), ...localeHosts]);
export const LINK_HOSTS = new Set([...PIN_HOSTS, 'pin.it']);
export const MEDIA_HOSTS = new Set(['v.pinimg.com']);
export function safeURL(value, hosts) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(value)) fail('invalid_url');
  let u; try { u = new URL(value); } catch { fail('invalid_url'); }
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !hosts.has(u.hostname) || u.hash) fail('invalid_url');
  return u;
}
export function pinInput(value) {
  if (typeof value === 'string' && /(?:\/|%2f|%5c)(?:\.|%2e){1,2}(?:\/|%2f|%5c)/i.test(value)) fail('invalid_url');
  const u = safeURL(value, LINK_HOSTS);
  if (u.hostname === 'pin.it') {
    if (!/^\/[a-zA-Z0-9]{1,64}\/?$/.test(u.pathname) || u.search) fail('invalid_url');
    return { url: u, id: null };
  }
  const id = /^\/pin\/([1-9]\d{0,29})\/?$/.exec(u.pathname)?.[1];
  if (!id) fail('invalid_url');
  return { url: u, id };
}
export async function resolvePin(value, request, signal) {
  let current = pinInput(value);
  for (let hop = 0; !current.id && hop < 4; hop++) {
    const response = await request(current.url, { hosts: LINK_HOSTS, method: 'HEAD', signal });
    response.destroy();
    if (![301, 302, 303, 307, 308].includes(response.statusCode) || typeof response.headers.location !== 'string') fail('short_link_unavailable', 422);
    let next; try { next = new URL(response.headers.location, current.url).href; } catch { fail('invalid_url'); }
    current = pinInput(next);
  }
  if (!current.id) fail('too_many_redirects', 422);
  return current.id;
}
export function mediaURL(value) {
  const u = safeURL(value, MEDIA_HOSTS);
  if (!u.pathname.toLowerCase().endsWith('.mp4')) fail('unsupported_media', 422);
  return u.href;
}
