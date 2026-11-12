import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'daily');
const target = path.join(root, 'dist');
await mkdir(target, { recursive: true });
for (const name of ['shadow.html']) {
  await copyFile(path.join(source, name), path.join(target, name));
}
for (const entry of await readdir(path.join(source, 'assets'), { withFileTypes: true })) {
  if (entry.isFile() && /^[a-z0-9-]+\.(?:js|css)$/.test(entry.name)) {
    await copyFile(path.join(source, 'assets', entry.name), path.join(target, entry.name));
  }
}
console.log('Built daily corpus assets.');

/* 静态资源加版本号：按内容哈希改写页面引用，避免浏览器继续用旧缓存。
   模块自身 dist/ 与总站 dist/speaking/ 两处都要处理：总站的 vite 构建会把模块资产再拷一份过去。 */
for (const dir of [target, path.resolve(root, '../../dist/speaking')]) {
  const files = (await readdir(dir).catch(() => [])).filter(name => /^[a-z0-9-]+\.(?:css|js)$/.test(name));
  if (!files.length) continue;
  const stamps = new Map();
  await Promise.all(files.map(async name => {
    stamps.set(name, createHash('sha256').update(await readFile(path.join(dir, name))).digest('hex').slice(0, 8));
  }));
  for (const page of ['index.html', 'shadow.html']) {
    const file = path.join(dir, page);
    let html;
    try { html = await readFile(file, 'utf8'); } catch { continue; }
    html = html.replace(/(href|src)="([a-z0-9-]+\.(?:css|js))(?:\?v=[a-z0-9]+)?"/g, (whole, attr, name) =>
      stamps.has(name) ? attr + '="' + name + '?v=' + stamps.get(name) + '"' : whole);
    await writeFile(file, html);
  }
}
