import {copyFileSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
copyFileSync(path.join(root,'src/motion.css'),path.join(root,'public/motion.css'));
const roots=['public/reading','public/writing','public/listening','public/vocab','modules/speaking/dist'];
function apply(directory){
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory()){if(entry.name!=='server')apply(file);continue;}
    if(!entry.name.endsWith('.html'))continue;
    const text=readFileSync(file,'utf8');
    const link=text.includes('href="/motion.css"')?'':'<link rel="stylesheet" href="/motion.css">';
    const runtime=text.includes('src="/motion.js"')?'':'<script src="/motion.js" defer></script>';
    const navStyle=text.includes('href="/navigation-motion.css"')?'':'<link rel="stylesheet" href="/navigation-motion.css">';
    const navRuntime=text.includes('src="/navigation-motion.js"')?'':'<script src="/navigation-motion.js" defer></script>';
    const frameStyle=text.includes('href="/frame-layout.css"')?'':'<link rel="stylesheet" href="/frame-layout.css">';
    const frameRuntime=text.includes('src="/frame-layout.js"')?'':'<script src="/frame-layout.js" defer></script>';
    if(link||runtime||navStyle||navRuntime||frameStyle||frameRuntime)writeFileSync(file,text.replace('</head>',link+runtime+navStyle+navRuntime+frameStyle+frameRuntime+'</head>'));
  }
}
for(const dir of roots)apply(path.join(root,dir));
