import { scheduleScore, scoreSlot, scoreSummary, scoreNotice } from './pronunciation.js';
import { scope, scopedKey, setBusy, publishDialogue, reportRoute } from './host-bridge.js';
import { ExamAudio, cancelSpeech, speakPrompt } from './audio.js';
import { cloud } from './cloud.js';
import { trackSpeaking } from './campus-events.js';

const topics = [
  { name: '日常生活', prompt: 'What is one part of your daily routine that you enjoy?', detail: '习惯、喜好和具体经历' },
  { name: '学习与工作', prompt: 'What is a skill you are working on these days?', detail: '目标、挑战和学习方法' },
  { name: '家乡与旅行', prompt: 'Which place would you show a friend visiting your hometown?', detail: '地点、人物和旅行记忆' },
  { name: '科技与社会', prompt: 'Which piece of technology has changed your daily life the most?', detail: '表达观点，比较不同选择' }
];
const escPractice = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const wordsIn = text => text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
const corrections = [
  [/\bI am agree\b/i, 'I agree', 'agree 本身就是动词'],
  [/\bmore better\b/i, 'better', 'better 自带比较含义'],
  [/\bdiscuss about\b/i, 'discuss', 'discuss 后可以直接接讨论对象'],
  [/\bdepend of\b/i, 'depend on', '搭配是 depend on'],
  [/\b(?:many|a lot of) informations\b/i, 'a lot of information', 'information 通常用作不可数名词'],
  [/\bpeople is\b/i, 'people are', '这里 people 表示复数'],
  [/\bI have went\b/i, 'I have gone', 'have 后用过去分词'],
  [/\bI didn['’]t went\b/i, "I didn't go", 'did 后接动词原形'],
  [/\b(?:he|she) have\b/i, m => m.replace(/have/i, 'has'), '一般现在时第三人称单数用 has'],
  [/\byesterday I go\b/i, 'yesterday I went', '叙述昨天的经历时这里用过去式'],
  [/\bI very like\b/i, 'I really like', 'really 可以修饰动词 like'],
  [/\bI (?:am )?look forward to see\b/i, 'I look forward to seeing', 'look forward to 后接动名词']
];
const threads = [
  [/\b(?:run|running|jogging|hiking|football|basketball|swimming|cycling|gym|exercise|yoga)\b/i,
    ['What first got you interested in this activity?', 'How does doing it with someone else change the experience?', 'What would you tell a beginner who wanted to try it?']],
  [/\b(?:cook(?:ing)?|baking|food|restaurant|eating|meal|dish|coffee)\b/i,
    ['Can you describe a particular meal or drink that stands out?', 'Who would you share that experience with, and why?', 'How have your tastes changed since childhood?']],
  [/\b(?:music|piano|guitar|singing|song|band|concert)\b/i,
    ['Can you describe a time when music changed your mood?', 'Who introduced you to that kind of music?', 'Would it feel different to experience it live? Why?']],
  [/\b(?:park|beach|museum|library|garden|temple|mountain|city|hometown)\b/i,
    ['What would a visitor notice first about that place?', 'How has the place changed since you first saw it?', 'What would you like to keep the same there?']],
  [/\b(?:phone|app|online|computer|internet|technology|smartphone|software|AI)\b/i,
    ['Can you give a recent example of using that technology?', 'What would become more difficult without it?', 'Who might benefit less from it than you do?']],
  [/\b(?:study|studying|practice|practise|learn(?:ing)?|lesson|teacher|school|university|language|English)\b/i,
    ['Tell me about a moment when you noticed a change in your learning.', 'Which part takes the most practice, and why?', 'How would you explain your approach to a new learner?']],
  [/\b(?:friend|family|brother|sister|father|mother|parents|colleague|team)\b/i,
    ['Can you describe one occasion you spent together?', 'What did you learn from that person or group?', 'How might they describe the same experience?']],
  [/\b(?:book|reading|novel|story|film|movie)\b/i,
    ['Which part of that story has stayed with you?', 'Would you recommend it to a friend? Why?', 'How did it compare with something else you read or watched?']]
];
const practicePrompts = [
  'Can you give a specific example from your own experience?',
  'What difference did that make for you?',
  'How would someone with a different background see it?',
  'How has your view of that changed over time?',
  'What would you do differently on a similar occasion?',
  'What would you most like to find out about this in the future?'
];

function detailQuestion(answer) {
  // Preserve the learner's noun phrase without turning their entire sentence into a question.
  const preference = answer.match(/\bI (?:really |particularly |usually )?(?:enjoy|prefer|love|like|struggle with|am interested in)\s+([^.!?,;]+)/i);
  if (!preference) return [];
  const phrase = preference[1].split(/\s+(?:because|although|since|when|which|but|so that|and then)\b/i)[0].trim();
  const size = wordsIn(phrase).length;
  if (!size || size>9 || /^(?:it|this|that|them|these|those|to|how)\b/i.test(phrase)) return [];
  return ['You mentioned “' + phrase + '”. What is a particular moment you associate with it?',
    'How has your experience with “' + phrase + '” changed over the years?'];
}

export function practiceReply(answer, question, turns = []) {
  const words = wordsIn(answer), used = new Set([question, ...turns.map(t => t.question)]);
  const corrected = corrections.find(([rule]) => rule.test(answer));
  const example = /\b(for example|for instance|last (?:week|year|month)|yesterday|when I was|once I)\b/i.test(answer);
  const reason = /\b(because|since|as a result|which means|so that|the reason)\b/i.test(answer);
  let feedback;
  if (corrected) {
    const [rule, replacement, why] = corrected;
    const original = answer.match(rule)[0];
    feedback = '你说了 “' + original + '”。可以改成 “' + original.replace(rule, replacement) + '”，' + why + '。用改好的短语再说一遍原句。';
  } else if (words.length < 9) {
    feedback = '你的回答有 ' + words.length + ' 个英文词。试着用 “One reason is that …” 补充理由，再给一个生活中的细节。';
  } else if (reason && !example) {
    feedback = '你已经解释了原因。下一句可以用 “For example, last week I …” 把这个观点落到一次具体经历上。';
  } else if (example && !reason) {
    feedback = '你给了具体情境。试着用 “That mattered to me because …” 点明这个细节和观点的关系。';
  } else if (reason && example) {
    feedback = '你的回答同时包含理由和例子。再用 “Although …, I still …” 加入一个不同角度，保持同一条主线。';
  } else {
    const opener = words.slice(0, 5).join(' ');
    feedback = '从 “' + opener + '…” 接下去，可以补一句 “What I remember most is …”，说清是谁、何时或发生了什么。';
  }
  const matched = threads.find(([rule]) => rule.test(answer));
  const prior = [...turns].reverse().map(t => threads.find(([rule]) => rule.test(t.answer))).find(Boolean);
  const pool = [
    ...(matched?.[1] || []), ...detailQuestion(answer),
    ...(/\b(prefer|better|whereas|rather than)\b/i.test(answer) ? ['When might the other option be a better choice?'] : []),
    ...(example ? ['What happened next, and how did you feel about it?'] : []),
    ...(reason ? ['Would your reason still apply in a different situation?'] : []),
    ...(prior?.[1] || []), ...practicePrompts
  ];
  const quote = words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '');
  const nextQuestion = pool.find(q => !used.has(q)) || 'You said “' + quote + '”. What detail would help a listener understand that better?';
  return {feedback, nextQuestion};
}

function openPracticeStore(owner) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('speaking-practice-v1-' + encodeURIComponent(owner), 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('sessions', {keyPath:'id'});
      req.result.createObjectStore('audio');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function practiceRead(db, store, key) {
  return new Promise((resolve, reject) => {
    const table = db.transaction(store).objectStore(store);
    const req = key === undefined ? table.getAll() : table.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function practiceWrite(db, record, clips = []) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'audio'], 'readwrite');
    const table = tx.objectStore('sessions');
    const prev = table.get(record.id);
    let conflict = false;
    prev.onsuccess = () => {
      if ((prev.result?.revision || 0) !== (record.revision || 0)) { conflict = true; tx.abort(); return; }
      table.put({...record, revision:(record.revision || 0)+1});
      const audio = tx.objectStore('audio');
      for (const clip of clips) {
        if (clip.blob) audio.put(clip.blob, clip.key);
        else audio.delete(clip.key);
      }
    };
    tx.oncomplete = () => { record.revision = (record.revision || 0)+1; resolve(); };
    tx.onerror = tx.onabort = () => reject(conflict ? new Error('这段对话已在另一页更新，请刷新页面后继续。') : new Error('浏览器未能保存这次回答，请检查可用空间后重试。'));
  });
}

function archiveBody(s) {
  return {id:s.id, topic:s.topic, createdAt:s.createdAt, endedAt:s.endedAt, turns:s.turns.map(t => {
    const {question,answer,feedback,nextQuestion,firstAnswer,firstFeedback} = t;
    return {question,answer,feedback,nextQuestion,firstAnswer,firstFeedback};
  })};
}

function practiceButton(action, title, primary=false, attrs='') {
  return '<button class="btn btn-' + (primary?'primary':'secondary') + '" type="button" data-pr="' + action + '" ' + attrs + '>' + title + '</button>';
}
const shortDate = ms => new Date(ms).toLocaleString('zh-CN', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});

export function mountPractice(main, options = {}) {
  const wrap = document.createElement('section');
  wrap.className = 'practice';
  main.replaceChildren(wrap);
  const owner = scope ? 'host:' + scope : cloud.enabled ? cloud.userId : 'local-device';
  const mic = new ExamAudio(), urls = new Set();
  let db, active, archived = [], screen = 'menu', notice = '', busy = false, disposed = false, recording = false, pending;
  const browserAsrAvailable = typeof (globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition) === 'function';
  let captureTimer, captureEpoch = 0, modelAvailable = false, useModel = false, retry = false, transcribe = browserAsrAvailable;
  try { transcribe = browserAsrAvailable && localStorage.getItem(scopedKey('speaking-asr-v1')) !== 'off'; } catch {}
  let draft = '', remoteError = '', modeNote = '', playing = false, sourceSession = '';
  // `owner` names the local IndexedDB store ('host:<scope>' when embedded); the
  // identity returned by /api/me is the guest/account id, so comparing them
  // disabled the whole dialogue view. Keep the store name and the live identity
  // separate: a resolved cloud userId is enough to render.
  const alive = () => !disposed && wrap.isConnected && (!cloud.enabled || Boolean(cloud.userId));
  const local = text => escPractice(text);
  const storeLabel = cloud.enabled ? '对话文字同步到账号，录音保存在本机。' : '对话和录音保存在本浏览器。';
  const button = practiceButton;
  const statusHTML = () => '<p class="pr-status" role="status">' + local(notice) + '</p>';
  function releaseUrls() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
  function resetCapture() {
    clearTimeout(captureTimer); captureEpoch++; mic.cancel(); cancelSpeech(); recording = false; pending = null; playing = false;
  }
  function player(blob) {
    const url = URL.createObjectURL(blob); urls.add(url);
    return '<audio controls preload="metadata" src="' + url + '"></audio>';
  }
  function status(text) {
    notice = text;
    const node = wrap.querySelector('.pr-status'); if (node) node.textContent = text;
  }
  function syncNote(s) { return cloud.enabled ? (s.synced ? '已同步' : '待同步') : '本机'; }
  function sorted() { archived.sort((a,b)=>(b.endedAt || b.createdAt) - (a.endedAt || a.createdAt)); }
  function remember(s) { archived = archived.filter(item => item.id !== s.id); archived.push(s); sorted(); }
  function bubble(turn,i) {
    const renderAnswer = (body, feedback, take, hasAudio) => '<div class="pr-answer"><div class="pr-turn-kind">' + (take === 'first' ? '第一次回答' : turn.firstAnswer ? '重新回答' : '我的回答') + '</div><p lang="en">' + local(body) + '</p>' +
      (hasAudio ? button('play-clip','回听这次回答',false,'data-slot="'+take+'" data-index="'+i+'"') : '') +
      (hasAudio ? scoreSlot('dialogue',active.id,take==='first'?turn.firstScoreKey:turn.scoreKey) : '')+
      '<p class="pr-feedback">' + local(feedback) + '</p></div>';
    return '<article class="pr-turn"><h3><span>第 ' + (i+1) + ' 轮</span><span lang="en">' + local(turn.question) + '</span></h3>' +
      (turn.firstAnswer !== undefined ? renderAnswer(turn.firstAnswer,turn.firstFeedback,'first',turn.firstAudio) : '') +
      renderAnswer(turn.answer,turn.feedback,'latest',turn.hasAudio) + '</article>';
  }
  function question() {
    const last = active.turns.at(-1);
    return retry && last ? last.question : last?.nextQuestion || active.prompt;
  }
  function updateBusy() { setBusy('dialogue', Boolean(recording || pending || draft.trim() || busy)); }
  function paint() {
    if (!alive()) return;
    updateBusy();
    releaseUrls();
    const heading = '<div class="pr-heading"><div><h1>自由对话</h1><p>' + (screen==='menu' ? '选择话题，用英语开口。每轮都可以按反馈再答一次。' : local(active.topic)) + '</p></div>' +
      (screen==='live' && active.turns.length ? button('end','结束并保存',false,busy||recording?'disabled':'') : screen==='view'||(screen==='live'&&!active.turns.length) ? button('menu','返回选题',false,busy||recording?'disabled':'') : '') + '</div>';
    if (screen === 'menu') {
      const custom = wrap.querySelector('#pr-topic-input')?.value || '';
      wrap.innerHTML = heading + '<div class="pr-grid"><section class="pr-card"><h2>今天想聊什么？</h2><div class="pr-topics">' +
        topics.map((t,i)=>'<button class="pr-topic" data-pr="topic" data-index="'+i+'"><strong>'+local(t.name)+'</strong><span>'+local(t.detail)+'</span></button>').join('') +
        '</div><form class="pr-custom"><label for="pr-topic-input">自选话题</label><input id="pr-topic-input" maxlength="100" value="'+local(custom)+'" placeholder="用英语写，例如 street photography" aria-describedby="pr-topic-hint" required><button class="btn btn-secondary" type="submit" '+(wordsIn(custom).length?'':'disabled')+'>开始聊</button></form><p id="pr-topic-hint" class="pr-muted">点击上方话题卡即可开始，或输入一个英语话题后点「开始聊」。</p></section>' +
        '<aside class="pr-card"><h2>我的对话</h2><p class="pr-muted">' + local(storeLabel) + '</p>' +
        (remoteError ? '<p class="pr-error">' + local(remoteError) + '</p>' + button('refresh','重试连接') : '') +
        '<div class="pr-history">' + (archived.length ? archived.map(s=>'<button data-pr="open" data-id="' + local(s.id) + '"><b>' + local(s.topic) + '</b><small>' + local(shortDate(s.createdAt)) + ' · '+s.turns.length+' 轮 · '+(s.endedAt?syncNote(s):'草稿')+'</small></button>').join('') : '<p class="pr-muted">完成第一段对话后可在这里回看。</p>') +
        '</div></aside></div>' + statusHTML();
      return;
    }
    if (screen === 'view') {
      wrap.innerHTML = heading + '<div class="pr-archive-title"><h2>对话回顾</h2><span>' + active.turns.length + ' 轮 · ' + syncNote(active) + '</span></div>' +
        scoreSummary('dialogue',active.id) + (cloud.enabled && !active.synced ? button('sync','同步到账号',false,busy?'disabled':'') : '') +
        '<div class="pr-recap">' + active.turns.map(bubble).join('') + '</div>' + statusHTML();
      return;
    }
    const allowInput = !(recording || busy);
    const q = question();
    wrap.innerHTML = heading + '<div class="pr-grid"><section class="pr-card pr-current"><div class="pr-small">'+(retry?'重新作答':'第 '+(active.turns.length+1)+' 轮')+'</div><h2 lang="en">'+local(q)+'</h2>' +
      button('listen',playing?'停止朗读':'听问题',false,allowInput?'':'disabled') +
      (active.focus ? '<p class="pr-goal">本次目标 · ' + local(active.focus) + '</p>' : '') +
      (sourceSession===active.id && (options.originalBlob || options.originalText) ? '<details class="pr-original"><summary>对照模考首答</summary>' + (options.originalText?'<p lang="en">'+local(options.originalText)+'</p>':'')+(options.originalBlob?player(options.originalBlob):'')+'</details>' : '') +
      '<label for="pr-answer">我的回答</label><textarea id="pr-answer" lang="en" maxlength="3000" rows="4" placeholder="Type your answer in English…" ' + (allowInput?'':'readonly') + '>'+local(draft)+'</textarea>' +
      (pending ? '<div class="pr-pending"><span>本次录音</span>'+player(pending.blob)+button('remove-clip','移除录音',false,allowInput?'':'disabled')+'</div>' : '') +
      '<div class="pr-actions">'+ '<p class="pr-muted">'+scoreNotice+'</p>'+button('record',recording?'结束录音':pending?'重新录音':'录音回答',false,busy?'disabled':'')+
      button('send',busy?'处理中…':retry?'提交重答':'发送回答',true,allowInput?'':'disabled') +
      (retry ? button('cancel-retry','取消重答',false,allowInput?'':'disabled') : '')+'</div>' +
      '<label class="pr-opt"><input data-opt="asr" type="checkbox" '+(transcribe?'checked ':'')+(allowInput&&browserAsrAvailable?'':'disabled')+'> 浏览器语音转写（可能使用浏览器厂商的在线服务）</label>' +
      (!browserAsrAvailable?'<p class="pr-muted">此浏览器不支持语音转写。录音仍可自动评测发音；可输入文字练习表达，或换用支持英语转写的浏览器。</p>':'')+
      (modelAvailable ? '<label class="pr-opt"><input data-opt="model" type="checkbox" '+(useModel?'checked ':'')+(allowInput?'':'disabled')+'> 使用云端 AI 反馈（发送本次对话文字）</label>' : '') +
      '<p class="pr-muted">'+local(modeNote || (modelAvailable&&useModel?'DeepSeek 仅分析本轮转写文字，腾讯独立评测录音。':'本机陪练会根据回答中的用词、理由和例子给出反馈与追问。'))+'</p>'+statusHTML()+'</section>' +
      '<aside class="pr-card pr-recent"><h2>上一轮反馈</h2>'+(active.turns.length ? '<p>'+local(active.turns.at(-1).feedback)+'</p>'+(!retry?button('retry','重答上一题',false,allowInput?'':'disabled'):'') : '<p class="pr-muted">回答后，在这里查看建议。</p>')+
      '<p class="pr-muted">'+local(storeLabel)+'</p></aside></div>'+
      (active.turns.length ? '<details class="pr-recap"><summary>本次对话 · '+active.turns.length+' 轮</summary>'+active.turns.map(bubble).join('')+'</details>' : '');
  }
  async function loadMenu() {
    if (!db) throw new Error('本机练习存储尚未就绪。');
    const cached = await practiceRead(db, 'sessions');
    if (!alive() || screen!=='menu') return;
    archived = cached; archived.forEach(publishDialogue); sorted(); paint();
    if (!cloud.enabled) return;
    try {
      const records = [];
      let offset = 0;
      do {
        const result = await (await cloud.request('/api/practice'+(offset?'?offset='+offset:''))).json();
        if (!Array.isArray(result.sessions)) throw new Error('无法读取云端对话。');
        records.push(...result.sessions);
        if (result.nextOffset == null) break;
        if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset<=offset) throw new Error('云端对话列表无效。');
        offset=result.nextOffset;
      } while (alive() && screen==='menu');
      if (!alive() || screen!=='menu') return;
      const map = new Map(records.map(s=>[s.id,{...s,synced:true}]));
      for (const localRecord of cached) {
        map.set(localRecord.id, {...localRecord,synced:map.has(localRecord.id)||!!localRecord.synced});
      }
      archived = [...map.values()]; sorted(); remoteError='';
    } catch (error) { remoteError = error.message; }
    if (screen==='menu') paint();
  }
  function begin(name,prompt,focus='') {
    if (!db) return status('请等待本机存储就绪。');
    const rand = globalThis.crypto?.randomUUID?.() || ('p'+Date.now().toString(36)+Math.random().toString(36).slice(2));
    active = {id:rand, topic:name.slice(0,200), prompt:prompt.slice(0,1100), focus:focus.slice(0,300), createdAt:Date.now(), turns:[]};
    trackSpeaking('start','practice',active.id);
    resetCapture(); screen='live'; retry=false; draft=''; modeNote=''; notice=''; paint();
  }
  async function syncRecord() {
    const saving = active;
    await cloud.request('/api/practice', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(archiveBody(saving))});
    if (!alive()) return;
    const updated = {...saving,synced:true};
    await practiceWrite(db,updated);
    active = updated; remember(updated);
  }
  async function finish() {
    if (!active.turns.length) return;
    const ended = {...active, endedAt:Date.now(), synced:false};
    await practiceWrite(db,ended);
    trackSpeaking('finish','practice',ended.id);
    if (!alive()) return;
    publishDialogue(ended); reportRoute('dialogue/' + ended.id);
    active = ended; remember(ended); resetCapture(); screen = 'view'; notice = '已保存本次对话。'; paint();
    if (cloud.enabled) {
      try { await syncRecord(); notice = '对话文字已同步到账号。'; }
      catch (err) { notice='已保存在本机，稍后可重试同步。'+err.message; }
    }
  }
  async function sendAnswer() {
    const answer = draft.trim().slice(0,3000);
    if (!pending && (!answer || !wordsIn(answer).length)) { status('请用英语回答。录音尚无转写时，可以先回听，再把答句填入文本框。'); return; }
    const currentQuestion = question();
    const history = retry ? active.turns.slice(0,-1) : active.turns;
    let reply = answer && wordsIn(answer).length ? practiceReply(answer,currentQuestion,history) : {feedback:'已保存本轮录音。可在发音反馈中查看本次表现。',nextQuestion:'Could you give a specific example from your own experience?'};
    modeNote='本轮反馈来自本机自适应陪练。';
    if (modelAvailable && useModel && answer) {
      try {
        const data = await (await cloud.request('/api/coach/reply',{
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({topic:active.topic,question:currentQuestion,answer,turns:history.slice(-5).map(({question,answer})=>({question,answer}))})
        })).json();
        if (typeof data.feedback !== 'string' || !data.feedback.trim() || typeof data.nextQuestion !== 'string' || !data.nextQuestion.trim()) throw new Error('反馈格式无效');
        reply = {feedback:data.feedback.slice(0,5000),nextQuestion:data.nextQuestion.slice(0,1200)}; modeNote='本轮追问与表达建议来自 DeepSeek 文本分析；发音由腾讯评测。';
      } catch { modeNote='云端反馈暂不可用，本轮已使用本机自适应陪练。'; }
    }
    if (!alive()) return;
    const index = history.length;
    const entry = {question:currentQuestion,answer,...reply,hasAudio:!!pending};
    if (pending) entry.scoreKey=crypto.randomUUID();
    const clipID = active.id+':'+index+':';
    const clips = [{key:clipID+'latest',blob:pending?.blob}];
    if (retry) {
      const last = active.turns.at(-1);
      entry.firstAnswer = last.firstAnswer ?? last.answer;
      entry.firstScoreKey = last.firstScoreKey ?? last.scoreKey;
      entry.firstFeedback = last.firstFeedback || last.feedback;
      entry.firstAudio = last.firstAnswer !== undefined ? last.firstAudio : last.hasAudio;
      if (last.firstAnswer === undefined && last.hasAudio) {
        const original = await practiceRead(db,'audio',clipID+'latest');
        if (original) clips.push({key:clipID+'first',blob:original});
      }
    }
    const updated = {...active,turns:[...history,entry]};
    await practiceWrite(db,updated,clips);
    if(pending) await scheduleScore('dialogue',updated.id,entry.scoreKey,'第 '+(index+1)+' 轮'+(retry?' · 重答':''),pending.blob,pending.durationMs).catch(()=>status('回答已保存，评测队列暂时不可用。'));
    trackSpeaking('answer','practice',updated.id,String(index));
    if (!alive()) return;
    active=updated; remember(updated);
    pending=null; draft=''; retry=false; notice='';
    if (active.turns.length>=80) await finish();
  }
  async function stopRecording() {
    clearTimeout(captureTimer);
    const taken = await mic.stop();
    if (!alive()) return;
    recording = false; pending = taken;
    if (taken.transcript.trim()) draft = taken.transcript.slice(0,3000);
    notice = taken.silent ? '录音音量较低，可以回听后重录。' : taken.transcript ? '请核对转写，再发送回答。' : '可以直接发送录音，也可以先补充文字以获得表达反馈。';
  }
  async function toggleRecord() {
    if (recording) { try { await stopRecording(); } finally { recording=false; } return; }
    const epoch = ++captureEpoch;
    cancelSpeech(); playing = false;
    await mic.start({transcribe,
      onTranscript: t => {
        if (!alive() || epoch!==captureEpoch || !t.trim()) return;
        const field = wrap.querySelector('#pr-answer'); if (field) field.value=t.slice(0,3000);
      },
      onError: err => { if (alive() && epoch===captureEpoch) { recording=false; clearTimeout(captureTimer); notice=err.message; paint(); } }
    });
    if (!alive() || epoch!==captureEpoch) { mic.cancel(); return; }
    recording=true; notice='正在录音，最长 2 分钟。';
    captureTimer=setTimeout(()=>{ if (!busy && recording && alive()) runAction('record'); },120000);
  }
  async function playClip(target) {
    const article = target.closest('.pr-answer');
    const existing = article.querySelector('audio');
    if (existing) { existing.paused ? await existing.play() : existing.pause(); return; }
    const clip = await practiceRead(db,'audio',active.id+':'+target.dataset.index+':'+target.dataset.slot);
    if (!alive() || !article.isConnected) return;
    if (!clip) { status('这段录音保存在最初练习的浏览器。'); return; }
    target.insertAdjacentHTML('afterend',player(clip));
    await article.querySelector('audio').play().catch(()=>{});
  }
  async function runAction(action,target) {
    if (!alive() || busy) return;
    if (action==='play-clip') { try { await playClip(target); } catch { status('无法回听这段录音。'); } return; }
    if (action==='listen') {
      if (playing) { cancelSpeech(); playing=false; paint(); return; }
      playing=true; paint();
      const played = await speakPrompt(question());
      if (!alive() || !playing) return;
      playing=false; if (!played) notice='当前浏览器无法朗读，可以直接阅读问题。'; paint(); return;
    }
    if (action==='topic') { const t=topics[Number(target.dataset.index)]; begin(t.name,t.prompt); return; }
    if (action==='open') {
      active=archived.find(s=>s.id===target.dataset.id);
      if (!active) return;
      if (active.endedAt) reportRoute('dialogue/' + active.id);
      resetCapture(); retry=false; screen=active.endedAt?'view':'live'; draft=''; notice=''; modeNote=''; paint(); return;
    }
    if (action==='retry' || action==='cancel-retry') {
      if (draft.trim() || pending) { status('请先发送当前回答，或清空文本并移除录音后切换。'); return; }
      cancelSpeech(); playing=false; retry=action==='retry'; notice=''; paint(); wrap.querySelector('#pr-answer')?.focus(); return;
    }
    if (action==='remove-clip') { pending=null; notice='已移除本次录音。'; paint(); return; }
    if (action==='menu' || action==='refresh') {
      resetCapture(); draft=''; reportRoute('practice'); screen='menu'; active=null; notice=''; await loadMenu(); return;
    }
    if (!['record','send','end','sync'].includes(action)) return;
    // Serialize capture controls and saves. Preserve the editor text across paints.
    if (action === 'end' && (draft.trim() || pending)) { status('先发送当前回答。也可以清空回答并移除录音，再结束对话。'); return; }
    busy=true;
    if (action==='send' && draft.trim()) notice='生成反馈中…';
    paint();
    try {
      if (action==='record') await toggleRecord();
      if (action==='send') await sendAnswer();
      if (action==='end') await finish();
      if (action==='sync') { await syncRecord(); notice='对话文字已同步到账号。'; }
    } catch (error) { notice=error.message || '操作未完成，请重试。'; }
    finally { busy=false; paint(); }
  }
  wrap.addEventListener('click',e=>{
    const target=e.target.closest('[data-pr]');
    if (target) void runAction(target.dataset.pr,target).catch(err=>status(err.message));
  });
  wrap.addEventListener('input',e=>{
    if (e.target.id==='pr-answer') { draft=e.target.value; updateBusy(); }
    if (e.target.id==='pr-topic-input') {
      const start=wrap.querySelector('.pr-custom button[type="submit"]');
      if(start)start.disabled=wordsIn(e.target.value).length===0;
    }
  });
  wrap.addEventListener('change',e=>{
    if (e.target.dataset.opt==='asr') {
      transcribe=browserAsrAvailable&&e.target.checked;
      try { localStorage.setItem(scopedKey('speaking-asr-v1'),transcribe?'on':'off'); } catch {}
    }
    if (e.target.dataset.opt==='model') useModel=e.target.checked;
  });
  wrap.addEventListener('submit',e=>{
    e.preventDefault();
    const topic = wrap.querySelector('#pr-topic-input')?.value.trim();
    if (!topic || !wordsIn(topic).length) { status('请用英文输入想聊的话题。'); return; }
    begin(topic,'What interests you about '+topic+'?');
  });
  wrap.innerHTML='<h1>自由对话</h1><p role="status"></p>';
  (async () => {
    if (cloud.enabled && !owner) throw new Error('请先登录账号，然后重新进入自由对话。');
    db = await openPracticeStore(owner);
    if (!alive()) { db.close(); return; }
    if (options.prompt || options.focus) {
      begin('针对练习',String(options.prompt || topics[0].prompt),String(options.focus || ''));
      sourceSession=active.id; paint();
    }
    else {
      await loadMenu();
      if (alive() && options.recordId) {
        const record = archived.find(s => s.id === options.recordId);
        if (record) await runAction('open', {dataset:{id:record.id}});
        else { reportRoute('practice'); notice='这台设备上找不到这份对话记录。'; paint(); }
      }
    }
    if (cloud.enabled && alive()) {
      try {
        const response=await (await cloud.request('/api/coach/status')).json();
        modelAvailable=response.available === true;
        useModel=modelAvailable;
        if (alive() && modelAvailable && screen==='live' && !recording && !busy) paint();
      } catch { /* Text practice remains available without a model. */ }
    }
  })().catch(err=>{ if (alive()) wrap.innerHTML='<h1>自由对话</h1><p role="status">'+local(err.message || '无法打开练习存储，请重新进入。')+'</p>'; });
  return () => { disposed=true; setBusy('dialogue',false); resetCapture(); releaseUrls(); db?.close(); };
}
