import https from 'node:https';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { safeURL } from './urls.js';
import { fail } from './errors.js';
export function isPublic(address) {
  try {
    const ip = ipaddr.parse(address);
    if (ip.range() !== 'unicast') return false;
    if (ip.kind() === 'ipv6') return ip.match(ipaddr.parse('2000::'), 3) && !ip.match(ipaddr.parse('2001::'), 23);
    return !ip.match(ipaddr.parse('192.0.0.0'), 24) && !ip.match(ipaddr.parse('192.88.99.0'), 24);
  } catch { return false; }
}
export async function checkedAddress(hostname, resolver = lookup, signal) {
  const records = await Promise.race([
    resolver(hostname, { all: true, verbatim: true }),
    new Promise((_, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  ]);
  if (!records.length || records.length > 32 || records.some(r => !isPublic(r.address))) fail('unsafe_upstream', 502);
  return records[0];
}
// No proxy environment, automatic redirects, cookies or connection-pool DNS reuse.
export async function pinnedRequest(value, { hosts, method = 'GET', headers = {}, signal } = {}) {
  const u = safeURL(String(value), hosts);
  const deadline = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
  const record = await checkedAddress(u.hostname, lookup, deadline);
  return new Promise((resolve, reject) => {
    const req = https.request(u, {
      method, headers: { 'accept-encoding': 'identity', ...headers }, signal: deadline,
      agent: false, servername: u.hostname, maxHeaderSize: 16384,
      lookup: (_hostname, options, cb) => options.all ? cb(null, [record]) : cb(null, record.address, record.family),
    }, response => {
      // Keep an error listener even if a caller discards a redirect body.
      response.on('error', () => {});
      resolve(response);
    });
    req.on('error', reject); req.end();
  });
}
export async function collect(response, max) {
  const encoding = response.headers['content-encoding'];
  const length = response.headers['content-length'];
  if ((encoding && encoding !== 'identity') || (length !== undefined && (!/^\d+$/.test(length) || Number(length) > max))) {
    response.destroy(); fail('upstream_limit', 502);
  }
  const chunks = []; let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > max) { response.destroy(); fail('upstream_limit', 502); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
