import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
export const releaseRoots = ['dist','docs','modules','public','scripts','src'];
export const releaseFiles = ['.gitignore','index.html','package.json','package-lock.json','tsconfig.json','vite.config.ts','worker.mjs','README.md','README-交付说明.md','打包说明.md','每日语料接入说明.md','启动整合版.cmd','deploy.env.example'];
const digest = value => createHash('sha256').update(value).digest('hex');
export function collectReleaseFiles(root=defaultRoot) {
  const files = releaseFiles.filter(file=>existsSync(path.join(root,file)));
  function walk(dir) {
    for(const entry of readdirSync(path.join(root,dir),{withFileTypes:true})) {
      const file=dir+'/'+entry.name;
      if(entry.isSymbolicLink()) throw new Error('发布目录不允许符号链接：'+file);
      if(entry.isDirectory()) walk(file);
      else if(entry.isFile()) {
        if(/(?:^|\/)(?:node_modules|\.data|\.git|\.env[^/]*)(?:\/|$)|\.(?:sqlite(?:-[a-z]+)?|db|pem|key|clixml|webm|log|tsbuildinfo)$/i.test(file)) throw new Error('发布目录包含私有或运行时文件：'+file);
        files.push(file);
      }
    }
  }
  for(const dir of releaseRoots) walk(dir);
  return files.sort();
}
export function freezeRelease(root=defaultRoot) {
  const files=Object.fromEntries(collectReleaseFiles(root).map(file=>[file,digest(readFileSync(path.join(root,file)))]));
  const codeDigest=digest(JSON.stringify(files));
  const manifest={schema:1,releaseId:'TCAMP-20261111-'+codeDigest.slice(0,16),createdAt:new Date().toISOString(),codeDigest,files};
  writeFileSync(path.join(root,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return verifyRelease(root);
}
export function verifyRelease(root=defaultRoot) {
  const file=path.join(root,'release-manifest.json');
  if(!existsSync(file)) return {releaseId:'development',verified:false,reason:'unfrozen'};
  const bytes=readFileSync(file), manifest=JSON.parse(bytes);
  if(manifest.schema!==1 || digest(JSON.stringify(manifest.files))!==manifest.codeDigest) throw new Error('发布清单结构或摘要无效');
  const current=collectReleaseFiles(root), expected=Object.keys(manifest.files);
  const missing=expected.filter(file=>!current.includes(file));
  const unexpected=current.filter(file=>!Object.hasOwn(manifest.files,file));
  const changed=expected.filter(file=>!missing.includes(file)&&digest(readFileSync(path.join(root,file)))!==manifest.files[file]);
  if(missing.length||unexpected.length||changed.length) throw new Error('发布完整性校验失败：'+JSON.stringify({missing,unexpected,changed}));
  return {releaseId:manifest.releaseId,verified:true,codeDigest:manifest.codeDigest,manifestSha256:digest(bytes),files:expected.length,verifiedAt:new Date().toISOString()};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const mode=process.argv[2]||'verify',root=process.argv[3]?path.resolve(process.argv[3]):defaultRoot;
    if(!['freeze','verify'].includes(mode)) throw new Error('用法：node scripts/release-integrity.mjs freeze|verify [项目目录]');
    console.log(JSON.stringify(mode==='freeze'?freezeRelease(root):verifyRelease(root),null,2));
  } catch(error) { console.error(error.message);process.exitCode=1; }
}
