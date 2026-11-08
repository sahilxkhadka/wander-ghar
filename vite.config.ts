import { defineConfig, Plugin } from 'vite';
import { resolve } from 'node:path';

/** Used when no host provides an address (local builds), so previews never end up with relative URLs. */
const DEFAULT_ORIGIN = 'https://ghar-wpix.vercel.app';

/**
 * Link previews need absolute URLs. index.html writes them as %SITE_URL%/..., filled in here.
 * Order: SITE_URL, Vercel, Netlify (production URL, or the deploy's own URL for previews), then
 * DEFAULT_ORIGIN.
 */
function siteUrl(): Plugin {
  const env = process.env;
  const netlify = env.NETLIFY ? (env.CONTEXT === 'production' ? env.URL : env.DEPLOY_PRIME_URL ?? env.URL) : undefined;
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined;
  const origin = (env.SITE_URL ?? vercel ?? netlify ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
  return {
    name: 'site-url',
    // 'pre': substitute before Vite parses the HTML (it rejects '%' in href values)
    transformIndexHtml: { order: 'pre', handler: (html) => html.replaceAll('%SITE_URL%', origin) },
  };
}

// two pages: the scroll tour (index) and the original model inspector (viewer)
export default defineConfig({
  plugins: [siteUrl()],
  build: {
    target: 'es2019',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        viewer: resolve(__dirname, 'viewer.html'),
      },
    },
  },
});
