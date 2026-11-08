import { defineConfig, Plugin } from 'vite';
import { resolve } from 'node:path';

/**
 * Link previews need absolute URLs. index.html writes them as %SITE_URL%/..., filled in here from
 * SITE_URL, or on Vercel from the production domain (falling back to the deployment URL).
 */
function siteUrl(): Plugin {
  const env = process.env;
  const origin = (env.SITE_URL ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : env.VERCEL_URL ? `https://${env.VERCEL_URL}` : '')).replace(/\/+$/, '');
  return {
    name: 'site-url',
    configResolved(c) {
      if (!origin && c.command === 'build') c.logger.warn('[site-url] SITE_URL is not set: link-preview URLs will be relative, which most platforms ignore.');
    },
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
