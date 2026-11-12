import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

await import('./build-daily.mjs');

// Sites accepts a single Worker ES module. Bundle only the named public assets.
const root = fileURLToPath(new URL('../', import.meta.url));
const assets = {};
const mime = {js:'text/javascript',css:'text/css',svg:'image/svg+xml'};
for (const entry of await readdir(path.join(root, 'dist'), {withFileTypes:true})) {
  if (!entry.isFile() || !/^[a-zA-Z0-9_-]+\.(js|css|svg)$/.test(entry.name)) continue;
  const type = mime[path.extname(entry.name).slice(1)];
  assets['/' + entry.name] = [type + '; charset=utf-8', await readFile(path.join(root, 'dist', entry.name), 'utf8')];
}
const html = await readFile(path.join(root, 'dist/index.html'), 'utf8');
assets['/'] = assets['/index.html'] = ['text/html; charset=utf-8', html];
assets['/campus.html'] = assets['/'];
const local = html.replace('<main id="main"', '<div class="shell" style="padding-top:12px;padding-bottom:0">本机旧记录 · <a href="/">返回云端模考室</a></div><main id="main"');
assets['/local'] = ['text/html; charset=utf-8', local];

// The Worker runtime accepts one file. Keep each server module's helpers private.
const serverFiles = ['../../ai/deepseek.mjs','speaking-identity.mjs','speaking-evidence.mjs','tencent-soe.mjs', 'soe-route.mjs', 'coaching.mjs',
  'campus-teams.mjs', 'pair-speaking.mjs', 'campus.mjs', 'daily.mjs', 'api.mjs'];
const loaded = new Map([['assets.generated.mjs', ['assets']]]);
const parts = ['const assets = ' + JSON.stringify(assets) + ';'];
async function loadServerFile(name) {
  const source = await readFile(path.join(root, 'server', name), 'utf8');
  return source.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]([.\/\w-]+)['"];?\s*$/gm,
    (line, names, dependency) => {
      if(dependency.startsWith('./'))dependency=dependency.slice(2);
      if (!names.split(',').every(symbol => loaded.get(dependency)?.includes(symbol.trim()))) throw new Error('Unknown Worker import in ' + name + ': ' + line);
      return '';
    });
}
for (const file of serverFiles) {
  const source = await loadServerFile(file);
  const exports = [...source.matchAll(/^export (?:(?:async )?function|class) (\w+)/gm)].map(match => match[1]);
  if (!exports.length) throw new Error('Missing server export in ' + file);
  const names = '{' + exports.join(', ') + '}';
  parts.push('const ' + names + ' = (() => {\n' + source.replace(/^export (?=(?:async )?function |class )/gm, '') + '\nreturn ' + names + ';\n})();');
  loaded.set(file, exports);
}
parts.push(await loadServerFile('entry.mjs'));
const moduleSource = parts.join('\n');
const target = path.join(root, 'dist/server');
await mkdir(target, { recursive: true });
await writeFile(path.join(target, 'index.js'), moduleSource, 'utf8');
console.log('Built speaking studio Worker.');


