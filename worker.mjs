import {isSpeakingApi, speakingApi} from './scripts/speaking-api.mjs';
import {publicCloudScript} from './scripts/public-config.mjs';

// Generic Workers host: ASSETS = built dist, DB = migrated D1, BUCKET = private R2.
// The module also runs directly on Node via scripts/start.mjs with a persistent data directory.
export default {
  fetch(request, env) {
    const {pathname} = new URL(request.url);
    if(pathname==='/cloud-config.js')return new Response(['GET','HEAD'].includes(request.method)?request.method==='HEAD'?null:publicCloudScript(env):null,{status:['GET','HEAD'].includes(request.method)?200:405,headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    return isSpeakingApi(pathname) ? speakingApi(request, env) : env.ASSETS.fetch(request);
  },
};
