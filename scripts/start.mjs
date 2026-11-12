import {createServer} from 'node:http';
import {createReadStream, existsSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {createSpeakingMiddleware, root, mime} from './speaking-runtime.mjs';
import {verifyRelease} from './release-integrity.mjs';
if(Number(process.versions.node.split('.')[0])<24)throw new Error('本版写作算法需要 Node.js 24 或更高版本。');

// Deploy-time settings live in deploy.env so the hosting platform can start the
// service with nothing but `npm start`. Real environment variables win, so the
// same checkout still works locally with `PORT=4192 node scripts/start.mjs`.
for (const name of ['deploy.env', '.env']) {
  const file = path.join(root, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const hit = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!hit || line.trim().startsWith('#')) continue;
    if (process.env[hit[1]] === undefined) process.env[hit[1]] = hit[2].replace(/^["']|["']$/g, '');
  }
}

const dist = path.join(root,'dist');
if (!existsSync(path.join(dist,'index.html')) || !existsSync(path.join(dist,'speaking','index.html'))) {
  throw new Error('缺少总站或口语页面的构建文件，请运行 npm ci 和 npm run build。');
}
const port = Number(process.env.PORT || 4192);
// A container needs 0.0.0.0 so the platform proxy can reach the port; local
// runs still answer on 127.0.0.1 because that is the same interface.
const host = process.env.HOST || '127.0.0.1';
const speaking = createSpeakingMiddleware();
// A frozen release must start exactly as delivered. Runtime data and secrets
// remain outside the manifest; edited source or assets fail before listening.
const releaseInfo=verifyRelease(root);
if(!releaseInfo.verified) throw new Error('缺少锁定发布清单，拒绝启动。请使用完整交付包；开发修改须重新验收后生成新清单。');

// A player can ask for the next block, a bounded interval or the tail of an MP3.
function audioRange(range, size) {
  const parts = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!parts || (!parts[1] && !parts[2]) || !size) return null;
  const start = parts[1] ? Number(parts[1]) : Math.max(0, size - Number(parts[2]));
  const end = parts[1] && parts[2] ? Math.min(size - 1, Number(parts[2])) : size - 1;
  return start <= end && start < size ? {start, end} : null;
}

function staticResponse(input, output) {
  if (!['GET','HEAD'].includes(input.method)) { output.writeHead(405); output.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(input.url, 'http://localhost').pathname); }
  catch { output.writeHead(400); output.end(); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  if (pathname.includes('\\') || pathname.includes(':') || pathname.includes('\0') ||
      pathname.split('/').some(part => part.startsWith('.'))) {
    output.writeHead(404); output.end(); return;
  }
  const file = path.resolve(dist, '.' + pathname);
  const stat = file.startsWith(dist + path.sep) && statSync(file,{throwIfNoEntry:false});
  if (!stat || !stat.isFile()) {
    output.writeHead(404); output.end(); return;
  }
  const ext = path.extname(file).slice(1).toLowerCase();
  const audioType = {mp3:'audio/mpeg',wav:'audio/wav'}[ext];
  const headers = {
    'Content-Type': audioType || mime[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options':'nosniff',
  };
  let range;
  if (audioType) {
    headers['Accept-Ranges'] = 'bytes';
    headers['Last-Modified'] = stat.mtime.toUTCString();
    const request = input.headers.range;
    const current = !input.headers['if-range'] || input.headers['if-range'] === headers['Last-Modified'];
    if (request && current && /^bytes=/i.test(request) && !request.includes(',')) {
      range = audioRange(request, stat.size);
      if (!range) {
        output.writeHead(416, {...headers, 'Content-Range': 'bytes */' + stat.size, 'Content-Length': 0});
        output.end();
        return;
      }
      headers['Content-Length'] = range.end - range.start + 1;
      headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + stat.size;
    }
  }
  output.writeHead(range ? 206 : 200, headers);
  if (input.method === 'HEAD') output.end();
  else {
    const stream = createReadStream(file, range);
    output.once('close', () => stream.destroy());
    stream.on('error', () => output.destroy()).pipe(output);
  }
}

const server = createServer((input, output) => {
  if(input.url.split('?')[0]==='/api/release') {
    if(!['GET','HEAD'].includes(input.method)){output.writeHead(405);output.end();return;}
    output.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    output.end(input.method==='HEAD'?undefined:JSON.stringify(releaseInfo));return;
  }
  return speaking.handle(input,output,()=>staticResponse(input,output));
});
server.on('close', speaking.close);
server.on('error', error => { console.error('服务无法启动：', error.message); process.exitCode = 1; });
server.listen(port,host,()=>console.log('IELTS Coach ' + (process.env.PUBLIC_ORIGIN || ('http://'+host+':'+port)) + '/'));
