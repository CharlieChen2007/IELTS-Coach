import http from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Readable} from 'node:stream';
import worker from '../dist/server/index.js';
import {openLocalBindings} from './local-bindings.mjs';
const root = fileURLToPath(new URL('../',import.meta.url));
const port = Number(process.env.SPEAKING_PREVIEW_PORT || 4176);
const dataDir = process.env.SPEAKING_PREVIEW_DATA || path.join(root,'.preview-data');
const bindings = openLocalBindings(dataDir);
const server=http.createServer(async(incoming,outgoing)=>{
  try {
    const host=incoming.headers.host || '';
    if (![ '127.0.0.1:'+port, 'localhost:'+port ].includes(host)) {
      outgoing.writeHead(403); outgoing.end(); return;
    }
    const headers=new Headers();
    for (const [name,value] of Object.entries(incoming.headers)) {
      if (name.startsWith('oai-') || name.startsWith('cf-') || value == null) continue;
      headers.set(name,Array.isArray(value)?value.join(', '):value);
    }
    const method=incoming.method;
    const request=new Request('http://'+host+incoming.url,{method,headers,
      ...(!['GET','HEAD'].includes(method)?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
    const response=await worker.fetch(request,bindings);
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing); else outgoing.end();
  } catch(error) {
    console.error('Preview request failed:',error.name);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log('Open http://127.0.0.1:'+port+'/#campus'));
