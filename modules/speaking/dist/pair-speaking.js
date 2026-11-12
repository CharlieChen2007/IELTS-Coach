import { apiFetch, scopedKey, scope, reportResult, setBusy } from './host-bridge.js';
import { ExamAudio } from './audio.js';
import { scheduleScore, scoreSlot, scoreNotice } from './pronunciation.js';

const base = '/api/campus/pair/';
const labels = {waiting:'等待搭子', ready:'准备开始', active:'限时作答', review:'搭子评阅', complete:'已完成', cancelled:'已结束'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const button = (action, text, primary = false) => `<button type="button" class="btn btn-${primary ? 'primary' : 'secondary'}" data-pair-action="${action}">${text}</button>`;
const time = seconds => `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
const safeRound = room => room.rounds?.find(item => item.round === room.round);
const roomBody = room => ({code:room.code, round:room.round});
const audioPath = (room, turn) => `${base}audio?code=${encodeURIComponent(room.code)}&round=${turn.round}`;
const feedbackTitles = {strength:'做得好的地方', focus:'需要改进的地方', suggestion:'下一次怎么练'};
const feedbackHints = {strength:'例如：先给出观点，再用个人经历举例。', focus:'指出一个具体表达或一次停顿。', suggestion:'给搭子一个下次可以直接做的练习。'};

// Keep only the most recent unsent take on this device, for a reload during upload.
async function pendingTake(key, update) {
    const db = await new Promise((resolve,reject) => {
        const req = indexedDB.open(scopedKey('speaking-pair-draft'), 1);
        req.onupgradeneeded = () => req.result.createObjectStore('draft');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    try {
        return await new Promise((resolve,reject) => {
            const tx = db.transaction('draft',update === undefined ? 'readonly' : 'readwrite');
            const store = tx.objectStore('draft'); let result = null;
            if (update instanceof Blob) store.put({key,blob:update},'pending');
            else {
                const get = store.get('pending');
                get.onsuccess = () => {
                    if (get.result?.key !== key) return;
                    result = get.result.blob;
                    if (update === null) store.delete('pending');
                };
            }
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => reject(tx.error || new Error('草稿存储不可用。'));
        });
    } finally { db.close(); }
}

function lobby() {
    return `<div class="pair-lobby">
      <div class="pair-lobby-primary"><h3>匹配一位搭子</h3>
        <p>共享题卡，轮流考一次、评一次。每轮作答最长 2 分钟。</p>
        ${button('match','快速匹配',true)}</div>
      <div class="pair-lobby-invite"><h3>和认识的同学练</h3>
        <div class="pair-actions">${button('create','创建邀请房间')}</div>
        <form data-pair-form="join" class="pair-code-form">
          <label>对方的邀请码<input name="code" required maxlength="16" autocomplete="off" spellcheck="false" autocapitalize="characters" placeholder="输入邀请码"></label>
          <button class="btn btn-secondary" type="submit">加入房间</button>
        </form></div></div>`;
}
function roomHead(room) {
    return `<div class="pair-room-head"><div><span class="pair-state">${esc(labels[room.status])}</span>
      ${room.partner ? `<span class="pair-sep">·</span><span>搭子 <b>${esc(room.partner)}</b></span>` : ''}</div>
      ${['waiting','ready','active','review'].includes(room.status) ? '<button type="button" class="pair-text" data-pair-action="leave-check">退出本场</button>' : ''}</div>`;
}
function waiting(room) {
    return `<div class="pair-wait"><span class="pair-pulse" aria-hidden="true"></span><div>
      <h3>${room.quick ? '正在匹配另一位同学' : '等待对方加入'}</h3>
      <p>${room.quick ? '另一位同学进入快速匹配后，这里会自动显示题卡。' : '请对方打开口语双人模考，输入下面的邀请码。'}</p>
      <div class="pair-code"><strong>${esc(room.code)}</strong>${button('copy','复制邀请码')}</div>
    </div></div>`;
}
function card(room, turn) {
    const questions = [turn.prompt, ...(turn.followups || [])];
    const selected = turn.promptIndex || 0;
    const choose = room.status === 'active' && room.role === 'examiner';
    return `<div class="pair-card"><div class="pair-card-label"><span>第 ${room.round} / 2 轮</span><span>你是${room.role === 'examiner' ? '考官' : '考生'}</span></div>
      <h3>${esc(turn.title)}</h3><p class="pair-prompt" lang="en">${esc(turn.prompt)}</p>
      ${(turn.followups || []).length ? `<div class="pair-follow"><strong>${choose ? '可选择一道追问发给考生' : '参考追问'}</strong><ol>
      ${questions.slice(1).map((q,i) => `<li><span lang="en">${esc(q)}</span>${choose ? ` <button type="button" class="pair-text" data-pair-action="prompt" data-index="${i+1}" ${selected === i+1 ? 'disabled' : ''}>${selected === i+1 ? '已发送' : '发送追问'}</button>` : ''}</li>`).join('')}</ol></div>` : ''}
      ${selected > 0 && questions[selected] ? `<p class="pair-current"><b>考官当前追问</b><br><span lang="en">${esc(questions[selected])}</span></p>` : ''}</div>`;
}
function player(src) {
    if (scope && src.startsWith(base + 'audio?')) {
        const round = Number(new URL(src, location.href).searchParams.get('round'));
        return `<button type="button" class="btn btn-secondary" data-pair-action="play-saved" data-round="${round}">回听本轮作答</button>`;
    }
    return `<audio controls preload="metadata" src="${esc(src)}" aria-label="回听本轮作答"></audio>`;
}
function renderStage(room, turn, local) {
    const examiner = room.role === 'examiner';
    if (room.status === 'ready') {
        return examiner ? `<div class="pair-controls"><p>你将担任本轮考官。双方准备好后，开始本轮计时。</p>${button('start','开始本轮',true)}</div>` :
            '<p class="pair-controls">你将担任本轮考生。可以先看题，等待考官开始。</p>';
    }
    if (room.status === 'active') {
        const clock = '<div class="pair-time"><span data-pair-time-label>作答剩余</span><b data-pair-clock>--:--</b></div>';
        if (examiner) return clock + '<p class="pair-controls">考生正在作答，你可以在题卡中发送追问。提交后即可回听并写反馈。</p>';
        let controls;
        if (local.recording) controls = `<div class="pair-controls"><p><i class="pair-dot"></i> 正在录音</p>${button('stop','停止并回听',true)}</div>`;
        else if (local.url) controls = `<div class="pair-controls"><p>先回听，再将录音提交给本场搭子。</p>${player(local.url)}
          <div class="pair-actions">${button('send','提交本轮录音',true)}${button('record','重新录制')}</div></div>`;
        else if (turn.hasAudio) controls = `<div class="pair-controls"><p>这轮录音已经上传，可以继续提交。</p>${button('send','提交本轮录音',true)}</div>`;
        else controls = `<div class="pair-controls"><p>提交录音后搭子即可回听。${scoreNotice}</p>${button('record','开始录音',true)}</div>`;
        return clock + controls;
    }
    if (room.status === 'review') {
        return `<div class="pair-controls"><h3>${examiner ? '回听并给搭子反馈' : '已提交，等待考官反馈'}</h3>
          ${turn.hasAudio ? player(audioPath(room, turn)) : '<p>本轮没有可回听的录音。</p>'}
          ${examiner ? `<form data-pair-form="feedback" class="pair-fields">${Object.entries(feedbackTitles).map(([name,label]) =>
          `<label>${label}<textarea name="${name}" maxlength="240" required rows="2" placeholder="${esc(feedbackHints[name])}">${esc(local.notes[name] || '')}</textarea></label>`).join('')}
          <button class="btn btn-primary" type="submit">${room.round === 1 ? '提交反馈并交换角色' : '提交反馈并完成模考'}</button></form>` : ''}</div>`;
    }
    return '';
}
function pastRound(room, turn, open = false) {
    const feedback = turn.feedback;
    return `<details class="pair-report" ${open ? 'open' : ''}><summary>第 ${turn.round} 轮 · ${esc(turn.title)}</summary>
      <p>考生 ${esc(turn.candidate)}　考官 ${esc(turn.examiner)}</p>${turn.hasAudio ? player(audioPath(room, turn)) : ''}
      ${feedback ? `<h4>搭子反馈</h4><dl>${Object.entries(feedbackTitles).map(([key,label]) =>
        `<div><dt>${label}</dt><dd>${esc(feedback[key])}</dd></div>`).join('')}</dl>` : ''}
      ${turn.retryTip ? `<p><b>题目重练建议</b><br>${esc(turn.retryTip)}</p>` : ''}
      ${turn.mine && turn.hasAudio ? scoreSlot('pair',room.code,turn.round,scopedKey('campus-pair-soe:'+room.code+':'+turn.round)) : ''}</details>`;
}

export function mountSpeakingPair(root, onRoomChange) {
    const life = new AbortController();
    const mic = new ExamAudio();
    const opts = {signal:life.signal};
    root.classList.add('speaking-pair');
    root.innerHTML = '<header class="pair-heading"><h2>和同学实练</h2></header><div data-pair-content><p></p></div><p role="status" data-pair-message></p>';
    const content = root.querySelector('[data-pair-content]');
    const note = root.querySelector('[data-pair-message]');
    let room = null, loaded = false, busy = false, polling = false, revision = 0, confirmLeave = false;
    let url = '', recording = false, draft = null, notes = {}, clockOffset = 0, doneRoom = '';
    let stateKey = '', key = '', pollTimer, clockTimer;

    const playbackUrls = new Set();
    function releasePlayback() { for (const item of playbackUrls) URL.revokeObjectURL(item); playbackUrls.clear(); }
    function updateBusy() { setBusy('pair',Boolean(recording || draft || Object.values(notes).some(value => value.trim()))); }
    function message(text, problem = false) {
        if (life.signal.aborted) return;
        note.textContent = text || '';
        note.classList.toggle('pair-error', Boolean(problem));
    }
    function discardRecording() {
        mic.cancel();
        recording = false;
        if (url) URL.revokeObjectURL(url);
        url = ''; draft = null;
    }
    function lock() {
        root.setAttribute('aria-busy', String(busy));
        content.inert = busy;
    }
    function refreshClock() {
        const clock = content.querySelector('[data-pair-clock]');
        if (!clock || !room?.deadline) return;
        const remaining = Math.max(0, Math.ceil((room.deadline - Date.now() - clockOffset) / 1000));
        const label = content.querySelector('[data-pair-time-label]');
        label.textContent = remaining ? '作答剩余' : '提交录音剩余';
        clock.textContent = time(remaining || Math.max(0, Math.ceil((room.deadline + 60000 - Date.now() - clockOffset) / 1000)));
        const record = content.querySelector('[data-pair-action=record]');
        if (record) record.disabled = remaining === 0;
        if (!remaining && recording && !busy) void run(stopRecording);
    }
    function draw() {
        if (life.signal.aborted) return;
        releasePlayback(); updateBusy();
        if (!loaded) {
            content.innerHTML = `<p>房间状态尚未加载。</p>${button('refresh','重新连接')}`;
        } else if (!room || room.status === 'cancelled') {
            content.innerHTML = (room ? `<p class="pair-controls">${esc(room.reason || '上一场已结束。')} 可以重新找搭子。</p>` : '') + lobby();
        } else {
            let html = roomHead(room);
            if (confirmLeave) html += `<div class="pair-confirm"><p>退出会结束双方的这场练习。</p><div class="pair-actions">${button('stay','继续练习',true)}${button('leave','确认退出')}</div></div>`;
            if (room.status === 'waiting') html += waiting(room);
            else if (room.status === 'complete') {
                html += `<div class="pair-done"><h3>两轮模考已完成</h3><p>回听回答，按搭子的建议选一个问题重练。</p></div>`;
                html += room.rounds.map(turn => pastRound(room, turn, turn.mine)).join('');
                html += `<div class="pair-actions"><button type="button" class="btn btn-primary" data-action="campus-team">查看小组周进度</button>${button('create','再开一场邀请房间')}${button('match','重新匹配')}</div>`;
            } else {
                const turn = safeRound(room);
                if (turn) html += card(room, turn) + renderStage(room, turn, {recording,url,notes});
                if (room.round === 2 && room.rounds[0]?.feedback) html += pastRound(room,room.rounds[0]);
            }
            content.innerHTML = html;
        }
        lock(); refreshClock();
    }
    function sync(data, force = false) {
        if (life.signal.aborted || !Object.hasOwn(data, 'room')) return;
        const next = data.room;
        const nextKey = next ? [next.code,next.round,next.status].join(':') : '';
        const changedRound = key !== nextKey;
        if (changedRound) {
            if (room?.role === 'candidate' && room.status === 'active') void pendingTake(key,null).catch(()=>{});
            discardRecording();
            notes = {};
            confirmLeave = false;
            key = nextKey;
            message('');
        }
        if (next?.serverNow) clockOffset = next.serverNow - Date.now();
        const nextStateKey = JSON.stringify(next ? {...next, serverNow:0} : null);
        const changed = !loaded || nextStateKey !== stateKey;
        stateKey = nextStateKey; room = next; loaded = true;
        onRoomChange?.(Boolean(room && !['cancelled','complete'].includes(room.status)));
        if (changed || force) draw();
        if (changedRound && next?.status === 'active' && next.role === 'candidate' && !safeRound(next)?.hasAudio) {
            void pendingTake(nextKey).then(blob => {
                if (life.signal.aborted || nextKey !== key || !blob || draft || recording || busy) return;
                draft = blob; url = URL.createObjectURL(blob); draw(); message('已恢复本设备上尚未提交的录音。');
            }).catch(()=>{});
        }
        if (room?.status === 'complete' && doneRoom !== room.code) {
            doneRoom = room.code;
            const responses = room.rounds.filter(turn => turn.mine && turn.submitted && turn.hasAudio);
            const pairReviews = room.rounds.filter(turn => turn.submitted && turn.feedback).map(turn => ({
                round:turn.round, role:turn.mine ? 'candidate' : 'examiner', question:turn.prompt,
                extraQuestions:turn.followups || [],
                feedback:{strength:turn.feedback.strength, improve:turn.feedback.focus, retry:turn.feedback.suggestion}
            }));
            if (responses.length) reportResult({id:room.code, kind:'pair', title:'校园双人口语模考',
                startedAt:room.createdAt || room.startedAt || room.completedAt, endedAt:room.completedAt,
                route:'campus', turns:responses.length, pairReviews}, responses);
            window.dispatchEvent(new Event('campus:progress'));
        }
    }
    async function api(path, data, blob) {
        const init = {signal:life.signal, cache:'no-store', credentials:'same-origin', redirect:'error'};
        if (data !== undefined || blob) {
            init.method = 'POST';
            init.headers = {'Content-Type':blob ? blob.type : 'application/json'};
            init.body = blob || JSON.stringify(data);
        }
        const response = await apiFetch(base + path, init);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || result.message || '房间同步失败，请稍后再试。');
        return result;
    }
    async function poll() {
        if (life.signal.aborted || busy || polling) return;
        polling = true;
        const stamp = revision;
        try {
            const data = await api('state');
            if (stamp === revision && !busy) {
                sync(data);
                if (note.dataset.offline === 'true') {message(''); delete note.dataset.offline;}
            }
        } catch (error) {
            if (!life.signal.aborted && !busy && stamp === revision) {
                if (!loaded) draw();
                message(error instanceof TypeError ? '网络连接中断，恢复后会继续同步本场。' : error.message, true);
                note.dataset.offline = 'true';
            }
        } finally { polling = false; }
    }
    async function run(action) {
        if (busy || life.signal.aborted) return;
        busy = true; revision++; lock(); message(''); delete note.dataset.offline;
        try { await action(); }
        catch (error) {
            if (!life.signal.aborted) message(error instanceof TypeError ? '连接失败，可恢复网络后重试。' : error.message, true);
        } finally { busy = false; if (!life.signal.aborted) lock(); }
    }
    async function mutation(path, data) {
        const result = await api(path,data);
        sync(result);
    }
    async function startRecording() {
        if (room?.role !== 'candidate' || room.status !== 'active') return;
        if (room.deadline && room.deadline <= Date.now()+clockOffset) throw new Error('本轮计时已结束。');
        await mic.start({onError(error) {
            recording = false; draw(); message(error.message,true);
        }});
        if (life.signal.aborted) { mic.cancel(); return; }
        if (url) URL.revokeObjectURL(url);
        draft = null; url = ''; recording = true; draw();
    }
    async function stopRecording() {
        if (!recording) return;
        recording = false;
        try {
            const take = await mic.stop();
            if (life.signal.aborted) return;
            draft = take.blob; url = URL.createObjectURL(draft);
            await pendingTake(key,draft).catch(()=>{});
            if (take.silent) message('这段录音音量较低，可先回听再决定是否重录。');
        } finally { draw(); }
    }
    async function sendRecording() {
        if (!room) return;
        const payload = roomBody(room);
        if (draft && !safeRound(room)?.hasAudio) {
            const query = new URLSearchParams({code:payload.code, round:String(payload.round)});
            const saved = await api('audio?' + query, undefined, draft);
            if (life.signal.aborted) return;
            await scheduleScore('pair',payload.code,payload.round,'第 '+payload.round+' 轮',draft,0).catch(()=>message('录音已提交，评测队列暂时不可用。'));
            discardRecording();
            void pendingTake(key,null).catch(()=>{});
            sync(saved, true);
        }
        await mutation('submit', payload);
    }
    function onClick(event) {
        const btn = event.target.closest('button[data-pair-action]');
        if (!btn || !root.contains(btn) || btn.disabled) return;
        void run(async () => {
            const action = btn.dataset.pairAction;
            if (['match','create'].includes(action)) return mutation(action,{});
            if (action === 'refresh') return sync(await api('state'),true);
            if (!room) return;
            if (action === 'play-saved') {
                const turn = room.rounds.find(item => item.round === Number(btn.dataset.round));
                if (!turn?.hasAudio) return;
                const response = await apiFetch(audioPath(room, turn), {signal:life.signal, cache:'no-store'});
                if (!response.ok) throw new Error('无法读取这段录音，请稍后重试。');
                const blob = await response.blob();
                if (!btn.isConnected) return;
                const src = URL.createObjectURL(blob);
                playbackUrls.add(src);
                const audio = new Audio(src); audio.controls = true;
                audio.setAttribute('aria-label','回听本轮作答');
                btn.replaceWith(audio);
                await audio.play().catch(()=>{});
            } else if (action === 'copy') {
                try { await navigator.clipboard.writeText(room.code); message('邀请码已复制。'); }
                catch { message('请手动复制上方的邀请码。'); }
            } else if (action === 'start') await mutation('start',roomBody(room));
            else if (action === 'prompt') await mutation('prompt',{...roomBody(room),index:Number(btn.dataset.index)});
            else if (action === 'record') await startRecording();
            else if (action === 'stop') await stopRecording();
            else if (action === 'send') await sendRecording();
            else if (action === 'leave-check' || action === 'stay') { confirmLeave = action === 'leave-check'; draw(); }
            else if (action === 'leave') await mutation('leave',{code:room.code});
        });
    }
    function onSubmit(event) {
        const form = event.target.closest('form[data-pair-form]');
        if (!form) return;
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        void run(async () => {
            if (form.dataset.pairForm === 'join') {
                const code = data.code.trim().toUpperCase();
                if (!code) throw new Error('请输入搭子的邀请码。');
                await mutation('join',{code});
            }
            if (form.dataset.pairForm === 'feedback' && room) {
                for (const name of Object.keys(feedbackTitles)) {
                    data[name] = String(data[name] || '').trim();
                    if (!data[name]) throw new Error('请填写' + feedbackTitles[name] + '。');
                }
                await mutation('feedback',{...roomBody(room), ...data});
            }
        });
    }
    content.addEventListener('click',onClick,opts);
    content.addEventListener('submit',onSubmit,opts);
    content.addEventListener('input',e => {
        if (Object.hasOwn(feedbackTitles, e.target.name)) { notes[e.target.name] = e.target.value; updateBusy(); }
    },opts);
    document.addEventListener('visibilitychange',() => {if (!document.hidden) void poll();},opts);
    window.addEventListener('online',() => void poll(),opts);
    pollTimer = setInterval(() => {
        if (!document.hidden && (!loaded || (room && !['cancelled','complete'].includes(room.status)))) void poll();
    },1800);
    clockTimer = setInterval(refreshClock,300);
    void poll();
    return () => {
        life.abort(); clearInterval(pollTimer); clearInterval(clockTimer);
        discardRecording(); releasePlayback(); setBusy('pair',false); content.replaceChildren();
    };
}

