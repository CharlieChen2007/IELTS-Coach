import { handleApi } from './api.mjs';
import { assets } from './assets.generated.mjs';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env);
      } catch {
        return Response.json({ error: '云端暂时无法处理请求，请稍后重试。' }, {
          status: 503,
          headers: { 'Cache-Control': 'no-store' }
        });
      }
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const resource = assets[pathname];
    if (!resource || !Array.isArray(resource)) return new Response('Not found', { status: 404 });
    const [contentType, asset] = resource;
    const home = pathname === '/' || pathname === '/index.html' || pathname === '/campus.html';
    const mode = request.headers.get('oai-authenticated-user-id') ? 'speaking-cloud' : 'speaking-guest';
    const body = home ? asset.replace('</head>', '<meta name="' + mode + '" content="enabled">\n</head>') : asset;
    return new Response(request.method === 'HEAD' ? null : body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': home ? 'private, no-store' : 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
};
