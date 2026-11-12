import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {publicCloudScript} from './public-config.mjs';

// Read-only: no user creation, no OTP/model request and no database writes.
const root=fileURLToPath(new URL('../',import.meta.url));
const base=new URL(process.argv[2]||'http://127.0.0.1:4192');
if(!['http:','https:'].includes(base.protocol)||base.username||base.password) throw new Error('请提供不含凭据的站点地址');
const manifest=JSON.parse(readFileSync(path.join(root,'release-manifest.json')));
const hash=value=>createHash('sha256').update(value).digest('hex');
const manifestSha256=hash(readFileSync(path.join(root,'release-manifest.json')));
async function download(file) {
  const url=new URL(file,base.origin);
  if(base.searchParams.has('sharecode')) url.searchParams.set('sharecode',base.searchParams.get('sharecode'));
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const r=await fetch(url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(30000)});
      if(!r.ok) throw new Error('HTTP '+r.status);
      return Buffer.from(await r.arrayBuffer());
    } catch(error){if(attempt===2)throw new Error(file+': '+error.message);}
  }
}
try {
  const online=JSON.parse((await download('/api/release')).toString('utf8'));
  if(online.verified!==true||online.releaseId!==manifest.releaseId||online.codeDigest!==manifest.codeDigest||online.manifestSha256!==manifestSha256) throw new Error('线上发布身份与本地锁定清单不一致');
  // This one endpoint intentionally comes from server PUBLIC settings, not dist.
  // Parse its exact JSON assignment without evaluating any remote JavaScript.
  const configText=(await download('/cloud-config.js')).toString('utf8');
  const hit=/^window\.__IELTS_CLOUD_CONFIG__=(\{[\s\S]*\});$/.exec(configText);
  if(!hit)throw new Error('公开云配置不是预期的安全 JSON 赋值');
  const config=JSON.parse(hit[1]),names={endpoint:'WORKBUDDY_CLOUD_ENDPOINT',publishableKey:'WORKBUDDY_PUBLISHABLE_KEY',oauthRelayBaseUrl:'WORKBUDDY_OAUTH_RELAY_BASE_URL'};
  if(Object.keys(config).some(key=>!Object.hasOwn(names,key)||typeof config[key]!=='string'))throw new Error('公开云配置出现非白名单字段');
  const publicEnv=Object.fromEntries(Object.entries(config).map(([key,value])=>[names[key],value]));
  if(publicCloudScript(publicEnv)!==configText)throw new Error('公开云配置字段不符合服务端过滤规则');
  const files=Object.keys(manifest.files).filter(file=>file.startsWith('dist/')&&file!=='dist/cloud-config.js');
  let next=0,bytes=0;const failed=[];
  await Promise.all(Array.from({length:6},async()=>{
    while(next<files.length) {
      const file=files[next++];
      try {
        const data=await download('/'+file.slice(5));bytes+=data.length;
        if(hash(data)!==manifest.files[file]) failed.push({file,error:'SHA256 mismatch'});
      }catch(error){failed.push({file,error:error.message});}
    }
  }));
  console.log(JSON.stringify({releaseId:manifest.releaseId,verified:failed.length===0,staticFiles:files.length,bytes,dynamicPublicConfig:{validated:true,fields:Object.keys(config)},failed},null,2));
  if(failed.length)process.exitCode=1;
} catch(error) {console.error(error.message);process.exitCode=1;}
