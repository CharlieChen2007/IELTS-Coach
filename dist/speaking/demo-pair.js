import { ExamAudio, cancelSpeech, speakPrompt } from './audio.js';
import { assessSession } from './coach-engine.js';
import { setBusy } from './host-bridge.js';

const prompt = 'Where do you usually study on campus, and why?';
const sample = 'I usually study in the library because it is quiet.';
const revisedSample = 'I usually study on the third floor of the library. Last Tuesday I finished a difficult essay there because I could concentrate without the noise from my dorm.';
const interview = [
  { question:'What makes it difficult to concentrate in your dorm?',
    answer:'My desk is next to the door. Every time someone comes in, I look up and lose my place. Last Tuesday I went to the library to finish an essay.' },
  { question:'How would you improve the study spaces on campus?',
    answer:'I would add a few quiet rooms. Last week my group needed somewhere to rehearse, but all the rooms were full. A booking system would help us plan ahead.' },
];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn = (id, label, main = false) => '<button type="button" class="btn btn-' + (main ? 'primary' : 'secondary') + '" data-demo="' + id + '">' + label + '</button>';

export function mountPairDemo(root, onActive) {
  const life = new AbortController();
  const mic = new ExamAudio();
  const clips = new Set();
  let stage = 'lobby', first, retry, input, chosen, review;
  let capture = 'idle', ticks, started, clock, closing = false;
  function emptyTake() { return {text:'', url:'', duration:0}; }
  function releaseClip(url) {
    if (url && clips.delete(url)) URL.revokeObjectURL(url);
  }
  function clean() {
    clearInterval(ticks);
    mic.cancel();
    cancelSpeech();
    for (const url of clips) URL.revokeObjectURL(url);
    clips.clear();
    capture = 'idle'; closing = false;
    setBusy('pair-demo', false);
  }
  function enter(next) {
    cancelSpeech();
    stage = next;
    if (next === 'lobby' || next === 'first') {
      clean(); first = emptyTake(); retry = null; chosen = null; review = '';
    }
    if (next === 'first') input = first;
    if (next === 'retry') { releaseClip(retry?.url); retry = emptyTake(); input = retry; }
    setBusy('pair-demo',next !== 'lobby' && next !== 'done');
    onActive(next !== 'lobby');
    draw();
    root.querySelector('[data-stage-title]')?.focus({preventScroll:true});
  }
  function feedback(take) {
    if (!take.text) return '回听你的 ' + take.duration + ' 秒录音。找出解释原因的那句话，再补一个具体的校园场景。';
    const row = assessSession({turns:[{part:1,prompt,transcript:take.text,transcriptSource:'manual'}]}).turns[0];
    return row.strength + ' ' + row.advice;
  }
  function playback(take) {
    return take.url ? '<audio controls preload="metadata" aria-label="回听我的回答" src="' + escape(take.url) + '"></audio>' : '';
  }
  function answer(take) {
    return (take.text ? '<blockquote lang="en">' + escape(take.text) + '</blockquote>' : '') + playback(take);
  }
  function recorder() {
    const tag = capture === 'recording' ? '停止录音' : input.url ? '重录回答' : '录音作答';
    return '<div class="demo-record"><div class="pair-actions">' + btn('record',tag) +
      (capture === 'recording' ? '<small data-clock role="timer">录音中 · 0:00 / 2:00</small>' : '') + '</div>' +
      playback(input) + '</div>';
  }
  function editor() {
    return '<div class="pair-card"><p class="pair-prompt" lang="en">' + prompt + '</p>' + btn('listen','听题') + '</div>' +
      recorder() + '<form class="pair-fields" data-demo-answer><label>英文回答<textarea name="answer" rows="2" maxlength="2000" placeholder="可以直接打字，也可以在录音后补上文字以获取表达反馈。">' +
      escape(input.text) + '</textarea></label><div class="pair-actions"><button type="submit" class="btn btn-primary">' +
      (stage === 'retry' ? '比较两次作答' : '查看搭子反馈') + '</button>' + btn('sample','填入示例回答') + '</div></form>';
  }
  function draw() {
    if (life.signal.aborted) return;
    root.classList.toggle('demo-intro',stage === 'lobby');
    if (stage === 'lobby') {
      root.innerHTML = '<div><h2>和模拟搭子练一场</h2><p>你先答题，再当考官。模拟搭子随时就绪，两轮结束后可回看反馈、重答原题。</p></div>' + btn('start','开始人机模拟',true);
      return;
    }
    const name = {first:'第 1 轮 · 你当考生',feedback:'搭子给你的反馈',second:'第 2 轮 · 你当考官',done:retry?'复练对比':'两轮练习已完成',retry:'重答第一轮'}[stage];
    let content = '';
    if (stage === 'first' || stage === 'retry') content = editor();
    if (stage === 'feedback') content = answer(first) + '<div class="demo-feedback"><h3>下次怎么说</h3><p>' + escape(feedback(first)) + '</p></div>' + btn('swap','交换角色',true);
    if (stage === 'second') {
      content = '<p>选择一个问题向模拟搭子提问，读完回答后给一条建议。</p><div class="demo-prompts">' +
        interview.map((turn,i) => '<button type="button" data-demo="ask" data-index="' + i + '" aria-pressed="' + (chosen === i) + '" lang="en">' + turn.question + '</button>').join('') + '</div>';
      if (chosen !== null) content += '<div class="demo-feedback"><h3>模拟搭子的回答</h3><blockquote lang="en">' + interview[chosen].answer + '</blockquote>' + btn('listen','听回答') + '</div>' +
        '<form class="pair-fields" data-demo-review><label>给搭子的反馈<textarea name="review" maxlength="360" required rows="2" placeholder="指出一个说得好的细节，或想继续追问的地方。">' + escape(review) +
        '</textarea></label><div class="pair-actions"><button class="btn btn-primary" type="submit">完成互评</button>' + btn('hint','填入示例建议') + '</div></form>';
    }
    if (stage === 'done') {
      content = '<div class="demo-recap"><article><h3>我的首次作答</h3>' + answer(first) +
        '<p>' + escape(feedback(first)) + '</p></article>' + (retry ? '<article><h3>我的复练</h3>' + answer(retry) + '<p>' + escape(feedback(retry)) + '</p></article>' : '') + '</div>' +
        '<details class="pair-report"><summary>我给搭子的反馈</summary><p lang="en">' + interview[chosen].question + '</p><blockquote lang="en">' + interview[chosen].answer + '</blockquote><p>' + escape(review) + '</p></details>' +
        '<div class="pair-actions">' + btn('retry',retry?'再次复练':'按建议复练',true) + btn('finish','返回双人模考') + '</div>';
    }
    root.innerHTML = '<header class="demo-head"><div><span>模拟搭子 · 本场不计分</span><h2 data-stage-title tabindex="-1">' + name + '</h2></div>' +
      (stage !== 'done' ? '<button type="button" class="pair-text" data-demo="leave">退出演示</button>' : '') + '</header>' +
      (closing ? '<div class="pair-confirm">结束本次演示？本场回答只在当前页面保留。<div class="pair-actions">' + btn('stay','继续演示') + btn('finish','结束演示') + '</div></div>' : '') +
      content + '<p class="demo-message" role="status"></p>';
    const editing = stage === 'first' || stage === 'retry';
    if (editing) {
      for (const el of root.querySelectorAll('[data-demo-answer] button, [data-demo="listen"]')) el.disabled = capture !== 'idle';
      root.querySelector('[data-demo="record"]').disabled = ['starting','stopping'].includes(capture);
      clock = root.querySelector('[data-clock]');
    }
  }
  function message(text) { const node = root.querySelector('.demo-message'); if (node) node.textContent = text; }
  async function record() {
    if (capture === 'recording') {
      clearInterval(ticks); capture = 'stopping'; draw();
      try {
        const take = await mic.stop();
        if (life.signal.aborted || capture !== 'stopping') return;
        releaseClip(input.url);
        input.url = URL.createObjectURL(take.blob); clips.add(input.url);
        input.duration = Math.max(1,Math.round(take.durationMs/1000));
        capture = 'idle'; draw();
        if (take.silent) message('录音音量较低，请回听或重录。');
      } catch(error) { if (!life.signal.aborted) { capture = 'idle'; draw(); message(error.message); } }
      return;
    }
    if (capture !== 'idle') return;
    capture = 'starting'; draw();
    try {
      await mic.start({onError(error) {clearInterval(ticks); capture = 'idle'; draw(); message(error.message);}});
      if (life.signal.aborted || capture !== 'starting') { mic.cancel(); return; }
      capture = 'recording'; started = Date.now(); draw();
      ticks = setInterval(() => {
        const elapsed = Math.floor((Date.now()-started)/1000);
        if (elapsed >= 120) { void record(); return; }
        if (clock) clock.textContent = '录音中 · ' + Math.floor(elapsed/60) + ':' + String(elapsed%60).padStart(2,'0') + ' / 2:00';
      },250);
    } catch(error) { if (!life.signal.aborted && capture === 'starting') { capture = 'idle'; draw(); message(error.message); } }
  }
  const opts = {signal:life.signal};
  root.addEventListener('input',event => {
    if (event.target.name === 'answer') input.text = event.target.value;
    if (event.target.name === 'review') review = event.target.value;
  },opts);
  root.addEventListener('submit',event => {
    event.preventDefault();
    if (event.target.hasAttribute('data-demo-answer')) {
      if (capture !== 'idle') return;
      input.text = input.text.trim();
      if (!input.url && !/[a-z]/i.test(input.text)) { message('请用英语写下回答，或录一段自己的声音。');return; }
      enter(stage === 'retry' ? 'done' : 'feedback');
    } else if (event.target.hasAttribute('data-demo-review')) {
      if (!review.trim()) { message('请给搭子写一条建议。');return; }
      enter('done');
    }
  },opts);
  root.addEventListener('click',async event => {
    const button = event.target.closest('[data-demo]');
    if (!button || button.disabled) return;
    switch (button.dataset.demo) {
      case 'start': enter('first'); break;
      case 'record': await record(); break;
      case 'sample': input.text = stage === 'retry' ? revisedSample : sample; draw(); break;
      case 'swap': enter('second'); break;
      case 'ask': {
        const index = Number(button.dataset.index);
        if (chosen === index) return;
        cancelSpeech(); chosen = index; review = ''; draw(); break;
      }
      case 'hint': review = chosen === 0 ? '上周二的例子很清楚，还可以补一句换地方后的效果。' : '预约系统的建议很具体，可以举例说明怎样预约。'; draw(); break;
      case 'listen': {
        const said = await speakPrompt(stage === 'second' ? interview[chosen].answer : prompt);
        if (!said && button.isConnected) message('当前设备的英文朗读不可用，可以直接阅读上方英文。');
        break;
      }
      case 'retry': enter('retry'); break;
      case 'leave': closing = true; draw(); break;
      case 'stay': closing = false; draw(); break;
      case 'finish': enter('lobby'); break;
    }
  },opts);
  enter('lobby');
  return () => { life.abort(); clean(); };
}
