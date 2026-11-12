import {task2Cases} from './task2-live-cases.mjs';
import {anchorSentences,countWords} from '../src/text.mjs';
const sentences=anchorSentences(task2Cases[0].text,'fixture');
const select=indices=>indices.map(group=>group.map(i=>sentences[i].text).join(' ')).join('\n\n');
// Author-written boundary cases derived from our own essay; not the host's unseen original.
export const task2ShortCases=[
  {name:'short-140',words:140,questionId:'T2-026',text:select([[0,1],[2,4,5],[8,9],[13]])+' Academic courses and practical projects can therefore support each other effectively.'},
  {name:'short-225',words:225,questionId:'T2-026',text:select([[0,1],[2,4,5,6],[8,9,10,12],[13,14,15,16]])},
  {name:'control-256',words:256,questionId:'T2-026',text:select([[0,1],[2,3,5,6,7],[8,9,10,11,12],[13,15,16]])},
];
for(const c of task2ShortCases)if(countWords(c.text)!==c.words)throw new Error('Boundary fixture word count changed: '+c.name);
