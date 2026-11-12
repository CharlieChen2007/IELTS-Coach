// Only these public cloud identifiers may be exposed; never serialize process.env.
export function publicCloudScript(env = {}) {
  const keys = {endpoint:'WORKBUDDY_CLOUD_ENDPOINT',publishableKey:'WORKBUDDY_PUBLISHABLE_KEY',oauthRelayBaseUrl:'WORKBUDDY_OAUTH_RELAY_BASE_URL'};
  const config = {};
  for (const [key,name] of Object.entries(keys)) {
    const value=env[name];
    if(typeof value==='string' && value.trim()) {
      if(key==='publishableKey'){config[key]=value.trim().startsWith('wbpk_')?value.trim():'';continue;}
      let url;try{url=new URL(value.trim());}catch{continue;}
      if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash)config[key]=url.toString().replace(/\/$/,'');
    }
  }
  return 'window.__IELTS_CLOUD_CONFIG__='+JSON.stringify(config).replace(/</g,'\\u003c')+';';
}
