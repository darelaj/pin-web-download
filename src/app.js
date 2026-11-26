import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { AppError, fail } from './errors.js';
import { officialProvider } from './provider.js';
import { pinnedRequest } from './network.js';
import { pinInput } from './urls.js';
import { openMedia, streamMedia } from './media.js';
const staticFiles = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.css', ['app.css', 'text/css; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]]);
const securityHeaders = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cross-Origin-Resource-Policy': 'same-origin',
};
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
async function bodyJSON(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) fail('invalid_request', 415);
  if (Number(req.headers['content-length']) > 4096) fail('request_limit', 413);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 4096) fail('request_limit', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks)); } catch { fail('invalid_request'); }
}
export function createApp({ provider = officialProvider(), request = pinnedRequest, now = Date.now, limits = {}, trustedProxyIPs = [], log = record => console.log(JSON.stringify(record)) } = {}) {
  const config = { maxBytes: 100 * 1024 * 1024, deadlineMs: 30_000, ticketMs: 300_000, ticketCap: 500, rate: 30, windowMs: 60_000, clientCap: 1000, concurrent: 8, perClient: 2, ...limits };
  const tickets = new Map(); const clients = new Map(); let active = 0; const controllers = new Set();
  const prune = () => { const t = now(); for (const [key, v] of tickets) if (v.expires <= t) tickets.delete(key); for (const [key, v] of clients) if (v.reset <= t && v.active === 0) clients.delete(key); };
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 15_000, headersTimeout: 10_000 }, async (req, res) => {
    for (const [key, value] of Object.entries(securityHeaders)) res.setHeader(key, value);
    let release; let timer; let controller;
    try {
      const path = req.url?.split('?')[0];
      if (req.url?.includes('?')) fail('invalid_request');
      if (req.method === 'GET' && path === '/healthz') return json(res, 200, { status: 'ok', provider: provider.enabled ? 'enabled' : 'disabled' });
      if (req.method === 'GET' && staticFiles.has(path)) {
        const [file, mime] = staticFiles.get(path);
        const data = await readFile(new URL(`../public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': mime }); return res.end(data);
      }
      if (!path?.startsWith('/api/')) fail('not_found', 404);
      if (req.headers['sec-fetch-site'] === 'cross-site') fail('invalid_origin', 403);
      prune();
      let ip = req.socket.remoteAddress;
      // Only a specifically trusted peer may supply a single X-Real-IP. X-Forwarded-For is never used.
      if (trustedProxyIPs.includes(ip) && typeof req.headers['x-real-ip'] === 'string' && isIP(req.headers['x-real-ip'])) ip = req.headers['x-real-ip'];
      let client = clients.get(ip);
      if (!client) {
        if (clients.size >= config.clientCap) fail('busy', 503);
        client = { count: 0, reset: now() + config.windowMs, active: 0 }; clients.set(ip, client);
      }
      if (client.reset <= now()) { client.count = 0; client.reset = now() + config.windowMs; }
      if (++client.count > config.rate) { res.setHeader('Retry-After', String(Math.ceil(config.windowMs / 1000))); fail('rate_limited', 429); }
      if (active >= config.concurrent || client.active >= config.perClient) fail('busy', 503);
      active++; client.active++;
      release = () => { active--; client.active--; };
      controller = new AbortController(); controllers.add(controller);
      timer = setTimeout(() => controller.abort(new AppError('timeout', 504)), config.deadlineMs); timer.unref();
      req.on('aborted', () => controller.abort());
      res.on('close', () => { if (!res.writableFinished) controller.abort(); });
      if (req.method === 'POST' && path === '/api/metadata') {
        if (!provider.enabled) fail('provider_disabled', 503);
        const body = await bodyJSON(req);
        if (body?.permission !== true) fail('permission_required', 403);
        pinInput(body.url);
        const result = await provider.getPin(body.url, controller.signal);
        const formats = [];
        // Verify the documented direct media against the same constrained transport before offering it.
        for (const variant of result.variants) {
          const probe = await openMedia(variant.url, request, controller.signal, config.maxBytes, 'HEAD'); probe.destroy();
          if (tickets.size >= config.ticketCap) fail('busy', 503);
          const ticket = randomBytes(32).toString('base64url');
          tickets.set(ticket, { ...variant, id: result.id, expires: now() + config.ticketMs });
          formats.push({ label: `${variant.width && variant.height ? `${variant.width} × ${variant.height}` : 'Original dimensions'} · MP4${result.variants.length > 1 ? ` · Video ${variant.item}` : ''}`, preview: `/api/preview/${ticket}`, download: `/api/download/${ticket}` });
        }
        return json(res, 200, { id: result.id, title: result.title, description: result.description, expiresIn: config.ticketMs / 1000, formats });
      }
      const match = /^\/api\/(preview|download)\/([A-Za-z0-9_-]{43})$/.exec(path);
      if (req.method === 'GET' && match) {
        const ticket = tickets.get(match[2]);
        if (!ticket || ticket.expires <= now()) fail('ticket_expired', 410);
        const media = await openMedia(ticket.url, request, controller.signal, config.maxBytes);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `${match[1] === 'download' ? 'attachment' : 'inline'}; filename="pinterest-${ticket.id}.mp4"`);
        // No persistent files or full buffering. Range requests are intentionally served as bounded 200 responses.
        await streamMedia(media, res, config.maxBytes, controller.signal); return;
      }
      fail('not_found', 404);
    } catch (error) {
      const err = controller?.signal.aborted ? new AppError('timeout', 504) : error instanceof AppError ? error : new AppError('upstream_unavailable', 502);
      log({ event: 'request_error', code: err.code, status: err.status });
      if (!res.destroyed && !res.headersSent) json(res, err.status, { error: err.code }); else if (!res.destroyed) res.destroy();
    } finally {
      clearTimeout(timer); if (controller) controllers.delete(controller); release?.();
    }
  });
  server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  server.shutdown = () => { for (const c of controllers) c.abort(); server.close(); server.closeIdleConnections(); };
  return server;
}
