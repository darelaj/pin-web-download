import { officialProvider } from './provider.js';
import { publicPageProvider } from './public-page.js';
export function configuredProvider(env = process.env) {
  const mode = env.PINTEREST_PROVIDER || 'official';
  if (mode === 'official') return officialProvider({ token: env.PINTEREST_ACCESS_TOKEN, platformAuthorized: env.PINTEREST_PLATFORM_AUTHORIZED === 'true' });
  if (mode === 'public-page') return publicPageProvider({ enabled: env.PINTEREST_PUBLIC_PAGE_ENABLED === 'true' });
  throw new Error('Invalid PINTEREST_PROVIDER');
}
