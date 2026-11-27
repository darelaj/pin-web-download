import { createApp } from './app.js';
import { configuredProvider } from './config.js';
export const runtimeMajor = Number(process.versions.node.split('.')[0]);
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const trustedProxyIPs = (process.env.TRUST_PROXY_IPS || '').split(',').map(v => v.trim()).filter(Boolean);
  const app = createApp({ provider: configuredProvider(), trustedProxyIPs });
  app.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', port })));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.shutdown(); setTimeout(() => process.exit(0), 5000).unref(); });
}
