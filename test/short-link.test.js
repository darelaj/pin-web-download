import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pinInput, resolvePin } from '../src/urls.js';
import { officialProvider } from '../src/provider.js';
import { publicPageProvider } from '../src/public-page.js';
import { publicHTML } from '../scripts/public-page-fixture.mjs';
const code = 'FixtureCode';
const short = `https://pin.it/${code}`;
const resolver = `https://api.pinterest.com/url_shortener/${code}/redirect/`;
const response = (statusCode, headers = {}, body = '') => Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers });
const unavailable = { code: 'short_link_unavailable', status: 422 };
test('short resolver follows exact same-code anonymous handoff and stops before terminal sent route', async () => {
  const calls = [];
  const id = await resolvePin(short, async (url, options) => {
    calls.push(String(url)); assert.equal(options.method, 'HEAD');
    assert.equal(options.headers?.Authorization, undefined); assert.equal(options.headers?.Cookie, undefined);
    if (String(url) === short) return response(308, { location: resolver });
    assert.equal(String(url), resolver); assert.deepEqual([...options.hosts], ['api.pinterest.com']);
    return response(302, { location: 'https://www.pinterest.com/pin/123/sent/?fixture_tracking=discard' });
  });
  assert.equal(id, '123'); assert.deepEqual(calls, [short, resolver]);
});
test('canonical and exact sent inputs discard query and never fetch terminal routes', async () => {
  for (const host of ['www.pinterest.com', 'id.pinterest.com', 'www.pinterest.co.uk']) {
    const value = `https://${host}/pin/123/sent/?fixture_tracking=discard`;
    const parsed = pinInput(value); assert.equal(parsed.id, '123'); assert.equal(parsed.url.href, `https://${host}/pin/123/`);
    assert.equal(await resolvePin(value, async () => assert.fail('terminal route must not be fetched')), '123');
  }
  assert.equal(pinInput('https://pinterest.com/pin/123/?fixture_tracking=discard').url.search, '');
  for (const path of ['/pin/123/sent', '/pin/123/sent/extra/', '/pin/123/other/']) assert.throws(() => pinInput(`https://pinterest.com${path}`), { code: 'invalid_url' });
});
test('API resolver is never accepted as direct input or by widened domain allowlists', async () => {
  for (const value of [resolver, 'https://api.pinterest.com/v5/pins/123', 'https://api.pinterest.com.evil.test/url_shortener/FixtureCode/redirect/']) {
    await assert.rejects(resolvePin(value, async () => assert.fail('invalid initial input must not fetch')), { code: 'invalid_url' });
  }
});
test('unsafe first hops, changed codes, arbitrary API paths and resolver variants fail before fetching them', async () => {
  for (const location of [
    'https://api.pinterest.com/url_shortener/OtherCode/redirect/',
    'https://api.pinterest.com/v5/pins/123',
    'https://api.pinterest.com/url_shortener/FixtureCode/redirect/extra/',
    resolver + '?fixture_tracking=reject', resolver + '#fragment',
    resolver.replace('https:', 'http:'), resolver.replace('api.pinterest.com', 'api.pinterest.com:444'),
    resolver.replace('api.pinterest.com', 'api.pinterest.com.evil.test'),
    resolver.replace('api.pinterest.com', 'user@api.pinterest.com'),
    resolver.replace('api.pinterest.com', '127.0.0.1'),
    resolver.replace('/FixtureCode/', '/OtherCode/../FixtureCode/'),
    'https://pin.it/OtherCode', 'https://www.pinterest.com/login/',
  ]) {
    let calls = 0;
    await assert.rejects(resolvePin(short, async () => { calls++; return response(308, { location }); }), unavailable);
    assert.equal(calls, 1);
  }
});
test('API resolver is admitted only directly after pin.it and never redirects to another API endpoint', async () => {
  for (const next of [resolver, 'https://api.pinterest.com/v5/pins/123', 'https://api.pinterest.com/url_shortener/OtherCode/redirect/', 'https://pin.it/OtherCode']) {
    let calls = 0;
    await assert.rejects(resolvePin(short, async () => response(++calls === 1 ? 308 : 302, { location: calls === 1 ? resolver : next })), unavailable);
    assert.equal(calls, 2);
  }
});
test('broken upstream redirects get the friendly short-link code; initial input errors stay distinct', async () => {
  for (const result of [response(200), response(302), response(302, { location: 'https://%' }), response(302, { location: 'http://localhost/' })]) await assert.rejects(resolvePin(short, async () => result), unavailable);
  await assert.rejects(resolvePin(short, async () => { throw new Error('synthetic transport failure'); }), unavailable);
  await assert.rejects(resolvePin('not a URL', async () => assert.fail()), { code: 'invalid_url' });
  let calls = 0;
  await assert.rejects(resolvePin(short, async () => { calls++; return response(302, { location: short }); }), { code: 'too_many_redirects' });
  assert.equal(calls, 4);
});
test('both provider paths share the short-link fix and extract only canonical Pin identity', async () => {
  for (const mode of ['official', 'public-page']) {
    const calls = [];
    const request = async (value, options) => {
      const url = String(value); calls.push(url); assert.equal(url.includes('/sent/'), false); assert.equal(url.includes('fixture_tracking'), false);
      if ([short, resolver].includes(url)) {
        assert.equal(options.method, 'HEAD'); assert.equal(options.headers?.Authorization, undefined); assert.equal(options.headers?.Cookie, undefined);
        return response(url === short ? 308 : 302, { location: url === short ? resolver : 'https://www.pinterest.com/pin/123/sent/?fixture_tracking=discard' });
      }
      if (mode === 'public-page') {
        assert.equal(url, 'https://www.pinterest.com/pin/123/'); assert.equal(options.headers?.Authorization, undefined);
        return response(200, { 'content-type': 'text/html' }, publicHTML('123'));
      }
      assert.equal(options.headers.Authorization, 'Bearer fixture-only');
      const data = url.endsWith('/pins/123') ? { id: '123', board_id: '456', media: { media_type: 'video', video_url: 'https://v.pinimg.com/generated.mp4' } } : { id: '456', privacy: 'PUBLIC' };
      return response(200, { 'content-type': 'application/json' }, JSON.stringify(data));
    };
    const provider = mode === 'official' ? officialProvider({ token: 'fixture-only', platformAuthorized: true, request }) : publicPageProvider({ enabled: true, request });
    assert.equal((await provider.getPin(short)).id, '123'); assert.deepEqual(calls.slice(0, 2), [short, resolver]);
  }
});

test('public page redirect validation also canonicalizes sent targets without fetching tracking routes', async () => {
  const calls = [];
  const provider = publicPageProvider({ enabled: true, request: async value => {
    calls.push(String(value));
    return response(302, { location: 'https://www.pinterest.com/pin/123/sent/?fixture_tracking=discard' });
  } });
  await assert.rejects(provider.getPin('https://www.pinterest.com/pin/123/'), { code: 'page_blocked' });
  assert.equal(calls.length, 4);
  assert.ok(calls.every(url => url === 'https://www.pinterest.com/pin/123/'));
});
