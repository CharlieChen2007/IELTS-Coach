import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../',import.meta.url));

export function openLocalBindings(dataDir, {campus = false} = {}) {
  mkdirSync(dataDir,{recursive:true});
  const sqlite = new DatabaseSync(path.join(dataDir,'studio.sqlite'));
  sqlite.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS preview_migrations(name TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS preview_objects(key TEXT PRIMARY KEY, bytes BLOB NOT NULL)');
  const drillDir = path.join(root, 'drizzle');
  const migrations = readdirSync(drillDir).filter(name => name.endsWith('.sql')).sort().map(name => [name, path.join(drillDir, name)]);
  if (campus) {
    migrations.push(['campus-social-final',path.resolve(root, '../campus-social/schema.sql')],
      ['campus-buddy-plaza-1',path.resolve(root, '../campus-social/buddy.sql')],
      ['campus-buddy-portraits-1',path.resolve(root, '../campus-social/buddy-portraits.sql')],
      ['campus-buddy-meets-1',path.resolve(root, '../campus-social/buddy-meets.sql')],
      ['campus-growth-exam-2',path.resolve(root, '../campus-social/growth.sql')],
      ['campus-clinic-1',path.resolve(root, '../campus-clinic/clinic.sql')],
      ['campus-clinic-places-1',path.resolve(root, '../campus-clinic/places.sql')],
      ['reading-attempts-1',path.resolve(root, '../reading/schema.sql')],
      ['listening-sections-1',path.resolve(root, '../listening/schema.sql')],
      ['listening-type-results-1',path.resolve(root, '../listening/type-results.sql')]);
  }
  for (const [file, filename] of migrations) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      if (sqlite.prepare('SELECT 1 FROM preview_migrations WHERE name=?').get(file)) {
        sqlite.exec('COMMIT');
        continue;
      }
      sqlite.exec(readFileSync(filename,'utf8'));
      sqlite.prepare('INSERT INTO preview_migrations VALUES(?)').run(file);
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
  // D1 accepts both anonymous placeholders and numbered ones (?1, ?2, also
  // reused inside a statement). node:sqlite only binds anonymous ones, so a
  // numbered statement throws "column index out of range". Rewrite to anonymous
  // placeholders once, remembering which argument each slot refers to.
  const TOKEN=/(\'(?:[^']|'')*\'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/)|(\?)(\d*)/g;
  const compiled=new Map();
  function compile(sql) {
    if (!sql.includes('?')) return {sql,order:null};
    let cached=compiled.get(sql);
    if (cached) return cached;
    const order=[]; let next=1;
    const text=sql.replace(TOKEN,(match,literal,mark,digits)=>{
      if(literal!==undefined) return match;
      order.push(digits?Number(digits):next++);
      return '?';
    });
    cached={sql:text,order};
    compiled.set(sql,cached);
    return cached;
  }
  function bindable(sql,args) {
    const {sql:text,order}=compile(sql);
    return [text,order?order.map(index=>args[index-1]):args];
  }
  function prepare(sql,args=[]) {
    const [text,values]=bindable(sql,args);
    const statement=sqlite.prepare(text);
    return {
      bind:(...next)=>prepare(sql,next),
      first(key){const row=statement.get(...values); return key ? row?.[key] ?? null : row ?? null;},
      all(){return {results:statement.all(...values),success:true};},
      run(){const {changes}=statement.run(...values); return {meta:{changes:Number(changes)},success:true};}
    };
  }
  const DB={prepare,batch(statements){
    sqlite.exec('BEGIN');
    try {const results=statements.map(s=>s.run());sqlite.exec('COMMIT');return results;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
  const BUCKET={
    async put(key,data){const bytes=Buffer.from(await new Response(data).arrayBuffer());
      sqlite.prepare('INSERT OR REPLACE INTO preview_objects VALUES(?,?)').run(key,bytes);return {key,size:bytes.length};},
    head(key){return sqlite.prepare('SELECT length(bytes) AS size FROM preview_objects WHERE key=?').get(key) || null;},
    get(key,options={}){
      const row=sqlite.prepare('SELECT bytes FROM preview_objects WHERE key=?').get(key);
      if (!row) return null;
      const {offset=0,length=row.bytes.length}=options.range || {};
      const response=new Response(row.bytes.subarray(offset,offset+length));
      return {body:response.body,size:row.bytes.length,arrayBuffer:()=>response.arrayBuffer()};
    },
    delete(keys){for (const key of [keys].flat()) sqlite.prepare('DELETE FROM preview_objects WHERE key=?').run(key);}
  };
  return {
    DB, BUCKET,
    SOE_SITE_DAILY_LIMIT: process.env.SOE_SITE_DAILY_LIMIT,
    SOE_VISITOR_DAILY_LIMIT: process.env.SOE_VISITOR_DAILY_LIMIT,
    TENCENT_APP_ID: process.env.TENCENT_APP_ID,
    TENCENT_SECRET_ID: process.env.TENCENT_SECRET_ID,
    TENCENT_SECRET_KEY: process.env.TENCENT_SECRET_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    openTencentSocket: signedUrl => new WebSocket(signedUrl.replace(/^https:/, 'wss:')),
    close: () => sqlite.close(),
  };
}
