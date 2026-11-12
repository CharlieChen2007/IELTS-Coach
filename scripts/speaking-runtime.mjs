import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {readdirSync, readFileSync} from 'node:fs';
import {openLocalBindings} from '../modules/speaking/scripts/local-bindings.mjs';
import {isSpeakingApi, speakingApi} from './speaking-api.mjs';
import {Readable} from 'node:stream';
import {publicCloudScript} from './public-config.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
const speakingDist = join(root, 'modules', 'speaking', 'dist');
export const mime = {
  html:'text/html; charset=utf-8', js:'application/javascript; charset=utf-8',
  css:'text/css; charset=utf-8', svg:'image/svg+xml', png:'image/png', webp:'image/webp',
  jpg:'image/jpeg', jpeg:'image/jpeg', ico:'image/x-icon', woff:'font/woff', woff2:'font/woff2',
  json:'application/json; charset=utf-8', gif:'image/gif', avif:'image/avif',
};
export function speakingAssets() {
  // The Worker build lives below dist/server. Only browser files at the top level are public.
  return readdirSync(speakingDist,{withFileTypes:true})
    .filter(entry => entry.isFile() && /^[a-zA-Z0-9_-]+\.(?:html|js|css|svg)$/.test(entry.name))
    .map(entry => entry.name);
}
export function readSpeakingAsset(name) {
  return readFileSync(join(speakingDist, name));
}

export function createSpeakingMiddleware({serveSource = false} = {}) {
  let bindings;
  const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : null;
  if (publicOrigin) console.log('Public origin: ' + publicOrigin);
  const browserAssets = new Set(speakingAssets());
  async function handle(input, output, next) {
    try {
      const path = input.url.split('?')[0];
      if (path === '/cloud-config.js') {
        if(!['GET','HEAD'].includes(input.method)){output.writeHead(405);output.end();return;}
        output.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        output.end(input.method==='HEAD'?undefined:publicCloudScript(process.env));return;
      }
      if (serveSource && path === '/modules/listening/core/text.js') return next();
      const privatePath = /^\/(?:\.data|modules|scripts)(?:\/|$)/i.test(path);
      if (privatePath || (path.startsWith('/speaking/') && !browserAssets.has(path.slice(10) || 'index.html'))) {
        output.writeHead(404); output.end(); return;
      }
      if (path === '/speaking') {
        output.writeHead(308, {Location:'/speaking/' + input.url.slice(path.length)});
        output.end();
        return;
      }
      if (serveSource && path.startsWith('/speaking/')) {
        const name = path.slice('/speaking/'.length) || 'index.html';
        if (!browserAssets.has(name)) { output.writeHead(404); output.end(); return; }
        if (!['GET','HEAD'].includes(input.method)) { output.writeHead(405); output.end(); return; }
        output.writeHead(200, {'Content-Type': mime[name.split('.').pop()], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'});
        output.end(input.method === 'HEAD' ? undefined : readSpeakingAsset(name));
        return;
      }
      if (!isSpeakingApi(path)) return next();

      // Behind the hosting proxy the socket is plain HTTP and Host may be
      // rewritten to the upstream address. Deriving the public origin from the
      // forwarded headers keeps the CSRF comparison aligned with the origin the
      // browser actually used; without this every write looks cross-site.
      const first = value => String(value || '').split(',')[0].trim();
      const fwdHost = first(input.headers['x-forwarded-host']);
      const fwdProto = first(input.headers['x-forwarded-proto']).toLowerCase();
      const socketHost = input.headers.host || '';
      const host = fwdHost || socketHost;
      const proto = fwdProto === 'https' || fwdProto === 'http'
        ? fwdProto
        : (input.socket.encrypted ? 'https' : 'http');
      const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
      // Locally the browser talks to 127.0.0.1, so a configured public origin
      // would never match its Origin header; apply it to public requests only.
      const origin = (!localHost && publicOrigin) ? publicOrigin : (proto + '://' + host);
      const proxied = Boolean(fwdHost || fwdProto);
      // A configured PUBLIC_ORIGIN already states the address this deployment
      // answers on, so a rewritten Host behind the proxy is not a rebinding risk.
      if (!localHost && !proxied && !publicOrigin) {
        output.writeHead(403); output.end('Invalid host'); return;
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(input.headers)) {
        if (value != null && !key.startsWith('oai-') && !key.startsWith('cf-')) {
          headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
      }
      if (input.socket.remoteAddress) headers.set('cf-connecting-ip', input.socket.remoteAddress);
      bindings ??= openLocalBindings(process.env.IELTS_DATA_DIR || join(root,'.data'), { campus:true });
      const request = new Request(origin + input.url, {
        method:input.method, headers,
        ...(!['GET','HEAD'].includes(input.method) ? {body:Readable.toWeb(input),duplex:'half'} : {}),
      });
      const response = await speakingApi(request, bindings);
      output.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).on('error', () => output.destroy()).pipe(output);
      else output.end();
    } catch (error) {
      console.error('Speaking service:', error.name);
      if (!output.headersSent) output.writeHead(500, {'Content-Type':'application/json; charset=utf-8'});
      output.end(JSON.stringify({error:'口语服务暂时不可用。'}));
    }
  }
  return {handle, close: () => bindings?.close()};
}
