import { embedded, scope, scopedKey, connectHost, announceHostReady, setBusy, publishExam, reportRoute } from './host-bridge.js';
import { createSession, listSessions, getSession, resumeSession, beginPart2, advanceExpired, saveAnswer, saveNotes, updateTranscript, submitSession, getAudio, exportSession, currentQuestion, cueCard, useAccountDatabase, markCloudSynced, buildHandoff } from './engine.js';
import { ExamAudio, speakPrompt, cancelSpeech } from './audio.js';
import { cloud } from './cloud.js';
import { mountPractice } from './practice.js';
import { mountCampus, showTeamShelf } from './campus.js';
import { trackSpeaking } from './campus-events.js';
import { scheduleScore, scoreSlot, scoreSummary, scoreNotice, startScores } from './pronunciation.js';
import { inspectRecording } from './acoustics.js';
import { textReport, reportOverview, turnFeedback, renderExercises, acousticResult, modelResult, progressChart } from './report.js';
const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const audio = new ExamAudio();
const labels = { part1: '日常问答', prep: '题卡准备', talk: '个人陈述', followup: '收尾提问', part3: '深入讨论', review: '检查并交卷' };
const icons = {
    mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    layers: '<path d="m3 8 9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    pause: '<path d="M8 5v14m8-14v14"/>',
    message: '<path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-4a3 3 0 0 1-2-3V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z"/><path d="M7 9h9M7 13h6"/>',
    cards: '<rect x="6" y="5" width="14" height="16" rx="2"/><path d="M3 16V4a2 2 0 0 1 2-2h11M9 10h8m-8 4h5"/>',
    discuss: '<path d="M14 4H5a2 2 0 0 0-2 2v8l3-2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2ZM8 16h10l3 3v-9a2 2 0 0 0-2-2"/>',
    sound: '<path d="M3 9h4l5-4v14l-5-4H3zM16 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/>',
    history: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6m3-3v5l4 2"/>',
    headphones: '<path d="M3 15v-3a9 9 0 0 1 18 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
    back: '<path d="m14 6-6 6 6 6"/>', check: '<path d="m4 12 5 5L20 6"/>',
    folder: '<path d="M3 7V5h6l2 2h10v13H3z"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', close: '<path d="M6 6l12 12m0-12L6 18"/>',
    bolt: '<path d="m14 2-9 12h6l-1 8 9-12h-6z"/>', lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'
};
function ic(name) { return `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function btn(action, label, style = 'secondary', icon = '', attrs = '') { return `<button type="button" class="btn btn-${style}" data-action="${action}" ${attrs}>${icon ? ic(icon) : ''}${label}</button>`; }
function time(ms) { const sec = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`; }
function when(ms) { return new Date(ms).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
function modeName(s) { return s.mode === 'quick' ? '快速演练' : '完整模考'; }
function statusName(s) { return s.status === 'submitted' ? '已封卷' : s.phase === 'review' ? '待交卷' : '可继续'; }
let page = 'home', sessions = [], session = null, working = false, probeBusy = false, testing = false, testResult = null, micReady = false, mode = 'full';
const browserAsrAvailable = typeof (globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition) === 'function';
let micError = '', takeError = '', probeURL = '', captureStarted = 0, probeStarted = 0, pendingTake = null, pendingKey = '', asr = browserAsrAvailable;
try { asr = browserAsrAvailable && localStorage.getItem(scopedKey('speaking-asr-v1')) !== 'off'; } catch { /* Preferences may be unavailable in private mode. */ }
let speaking = false, voiceToken = 0, noteTimer = 0, toastTimer = 0, tickRunning = false, probeEpoch = 0, taskError = '';
let accountReady = !cloud.enabled, historyError = '', remoteOnly = false;
let disposePractice = null, currentReport = null, upcomingDrill = null;

let disposeCampus = null;
const accountLogin = '/signin-with-chatgpt?return_to=%2F';
const modelReports = new Map();
const uploading = new Set(), syncErrors = new Map();
const blobUrls = new Set();
function notify(msg) { const el = document.querySelector('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 4200); }
function clearUrls() { for (const url of blobUrls)
    URL.revokeObjectURL(url); blobUrls.clear(); }
function lockWorkspace(message) {
    accountReady = false;
    disposeCampus?.(); disposeCampus = null;
    showTeamShelf();
    disposePractice?.();
    disposePractice = null;
    modelReports.clear();
    currentReport = null;
    upcomingDrill = null;
    audio.cancel();
    stopVoice();
    closeDialog();
    clearUrls();
    clearTimeout(noteTimer);
    page = 'account';
    session = null;
    sessions = [];
    main.innerHTML = heading('打开账号工作区', esc(message)) +
        `<div class="actions"><a class="btn btn-primary" href="${embedded?'/#/auth':'/signin-with-chatgpt?return_to=%2F'}" target="_top">重新进入学习空间</a><a class="btn btn-secondary" href="/">重试连接</a></div>`;
}

function storageLabel(s) {
    if (!cloud.enabled) return statusName(s);
    if (s.status !== 'submitted') return '本机 · ' + statusName(s);
    if (uploading.has(s.id)) return '同步中';
    if (cloud.records.has(s.id) || s.cloudSyncedAt) return '已同步到账号';
    return '本机 · 待同步';
}

async function refreshHistory() {
    if (cloud.enabled) {
        try {
            await cloud.refresh();
            historyError = '';
        } catch (error) {
            if (!accountReady) throw error;
            historyError = error.message;
        }
    }
    const combined = new Map(cloud.records);
    for (const row of await listSessions()) combined.set(row.id, row);
    return [...combined.values()].sort((a, b) => b.createdAt - a.createdAt);
}

async function syncSubmitted(id) {
    if (!accountReady || uploading.has(id)) return;
    uploading.add(id);
    syncErrors.delete(id);
    if (page === 'detail' && session?.id === id) paintSyncStatus();
    try {
        const result = await cloud.save(await exportSession(id));
        if (result.id !== id) throw new Error('收到的云端记录与本场练习不匹配。');
        const saved = await markCloudSynced(id);
        if (session?.id === id) session.cloudSyncedAt = saved.cloudSyncedAt;
    } catch (error) {
        syncErrors.set(id, error.message);
    } finally {
        uploading.delete(id);
        if (page === 'detail' && session?.id === id) paintSyncStatus();
        else if (accountReady && page === 'history') history();
        else if (accountReady && page === 'home') home();
    }
}
function stopVoice() { voiceToken++; speaking = false; cancelSpeech(); }
function setMain() { showTeamShelf(page); const tab = page === 'history' || page === 'detail' ? 'history' : ['practice','campus','campus-team'].includes(page) ? page : 'home'; for (const node of document.querySelectorAll('nav a')) {
    node.classList.toggle('active', node.dataset.action === tab);
    if (node.dataset.action === tab)
        node.setAttribute('aria-current', 'page');
    else
        node.removeAttribute('aria-current');
} }
function heading(title, copy = '', label = '') { return `<div class="page-intro">${label ? `<span class="eyebrow">${label}</span>` : ''}<h1>${title}</h1>${copy ? `<p class="intro-copy">${copy}</p>` : ''}</div>`; }
function meter() { return `<div class="meter" aria-hidden="true">${Array.from({ length: 24 }, () => '<i></i>').join('')}</div>`; }
function onLevel(level) { for (const meter of document.querySelectorAll('.meter')) {
    const strength = Math.max(0, Math.min(1, Number(level) || 0));
    [...meter.children].forEach((el, i) => {
        el.classList.toggle('lit', i < Math.ceil(strength * 24));
        el.style.height = (7 + strength * 20 * (.45 + .55 * Math.sin((i + 1) / 25 * Math.PI))) + 'px';
    });
} }
function listRows(items) { return items.map(s => `<button class="history-item" data-action="open" data-id="${esc(s.id)}"><span class="panel-icon">${ic(s.mode === 'full' ? 'headphones' : 'bolt')}</span><span><strong>${modeName(s)}</strong><small>${when(s.createdAt)} · ${s.turns?.length ?? s.turnCount ?? 0} 段录音</small></span><span class="status-pill">${storageLabel(s)}</span>${ic('arrow')}</button>`).join(''); }
let showcaseReports = [];
function historyRows(limit) {
    const all = [
        ...sessions.map(row=>({at:row.createdAt, html:listRows([row])})),
        ...showcaseReports.map(row=>({at:row.created, html:`<button class="history-item" data-action="showcase-report" data-id="${esc(row.reportId)}"><span class="panel-icon">${ic('mic')}</span><span><strong>${esc(row.title)}</strong><small>${when(row.created)} · 查看模考反馈</small></span><span class="status-pill">${esc(row.score)} 分</span>${ic('arrow')}</button>`}))
    ].sort((a,b)=>b.at-a.at);
    return (limit ? all.slice(0,limit) : all).map(row=>row.html).join('');
}
if (embedded && scope.startsWith('showcase_')) window.addEventListener('message', event=>{
    const msg=event.data;
    if (event.origin!==location.origin || event.source!==parent || msg?.source!=='ielts-coach' || msg.type!=='showcase-history' || !Array.isArray(msg.reports)) return;
    showcaseReports=msg.reports.filter(r=>typeof r?.reportId==='string' && Number.isFinite(r.created));
    if (page==='home') home();
    if (page==='history') history();
});
function home() {
    if (!accountReady) return;
    const parts = [['message', '日常问答', '聊聊学习、生活和熟悉的日常话题。', '4–5 分钟'], ['cards', '个人陈述', '准备一分钟，围绕一张题卡独立陈述。', '3–4 分钟'], ['discuss', '深入讨论', '延伸上一阶段的话题，解释观点和理由。', '4–5 分钟']];
    setMain();
    main.innerHTML = heading('口语模考室', '跟随考官完成模考、查看反馈，或从一个话题开始对话。', 'SPEAKING STUDIO') +
        `<div class="dashboard-grid"><div class="main-col"><section class="hero">
    <div class="hero-copy"><span class="hero-kicker">${ic('headphones')} IELTS SPEAKING</span><h2>全流程口语模考</h2><p>完成三个部分，交卷后逐题回听、查看表达反馈和复练建议。</p>
    <div class="hero-meta"><span>${ic('clock')} 11–14 分钟</span><span>${ic('layers')} 3 个部分</span></div>
    <div class="hero-actions">${btn('start-full', '开始模考', 'light', 'play')}${btn('start-quick', '快速演练', 'ghost', 'bolt')}</div></div><img class="hero-art" src="studio-art.svg" alt="" /></section>
    <section class="panel practice-entry"><div><h2>自由对话陪练</h2><p>选一个熟悉的话题，用英语回答，跟着追问把观点说得更具体。</p></div>${btn('practice', '开始对话', 'secondary', 'message')}</section>
    <section class="panel practice-entry"><div><h2>双人口语模考</h2><p>和模拟搭子交换考官与考生角色，也可以邀请同学一起练。</p></div>${btn('campus','进入双人模考','secondary','discuss')}</section>
    <div class="section-heading"><h2>考试流程</h2><span class="muted">共 3 个部分</span></div>
    <div class="parts-grid">${parts.map((p, i) => `<article class="part-card"><div class="part-top"><span class="part-icon">${ic(p[0])}</span><span class="part-no">PART 0${i + 1}</span></div><h3>${p[1]}</h3><p>${p[2]}</p><span class="part-time">${ic('clock')} ${p[3]}</span></article>`).join('')}</div>
    </div><aside class="side-col"><section class="panel mic-card"><div class="panel-head"><h2 class="panel-title">设备检测</h2><span class="panel-icon">${ic('mic')}</span></div>
    <div class="mic-status"><span class="status-pill">${micReady ? '● 检测通过' : '○ 待检测'}</span></div><p>录一句英语并回放，确认麦克风能清晰收音。</p>${meter()}${btn('device', micReady ? '重新检测设备' : '检测麦克风', 'secondary', 'mic')}</section>
    <section class="panel history-card"><div class="panel-head"><h2 class="panel-title">最近练习</h2><button class="text-link" data-action="history">全部记录 ${ic('arrow')}</button></div>${sessions.length || showcaseReports.length ? `<div class="history-list">${historyRows(2)}</div>` : `<div class="empty-state">${ic('history')}<strong>暂无练习记录</strong><p>完成第一场模考后，在这里回听。</p></div>`}</section></aside></div>`;
}
function history() {
    if (!accountReady) return;
    setMain();
    const copy = cloud.enabled ? (embedded?'已封卷录音与转写同步到本浏览器当前学习身份。换设备或清理 Cookie 后不会自动找回，请保留导出备份。':'已同步的答卷可在其他设备登录同一受认证账号后回听。未交卷的练习保存在这台设备。') :
        document.querySelector('meta[name="speaking-guest"]') ? '访客记录保存在这个浏览器。可从已交卷的练习中导出文件，登录后在此页导入。' : '记录和录音保存在本机当前浏览器，可逐题回听并导出。';
    const empty = `<div class="empty-state">${ic('folder')}<strong>还没有练习记录</strong><p>从设备检测开始你的第一场口语模考。</p>${btn('home', '进入模考室', 'primary')}</div>`;
    main.innerHTML = heading('练习记录', copy, 'PRACTICE HISTORY') +
        `<section class="panel"><div class="section-heading"><h2>模考与快速演练</h2><span class="muted">${sessions.length + showcaseReports.length} 场</span></div>
        ${historyError ? `<p class="error" role="status">云端历史暂未刷新。${esc(historyError)} ${btn('history', '重试', 'ghost')}</p>` : ''}
        ${sessions.length || showcaseReports.length ? historyRows() : historyError ? '' : empty}</section>
        <section class="panel history-trend"><div class="panel-head"><h2 class="panel-title">自由对话记录</h2>${btn('practice', '我的对话', 'secondary', 'message')}</div></section>` +
        (cloud.enabled ? `<section class="panel history-trend"><div class="panel-head"><h2 class="panel-title">语音练习指标趋势</h2>${btn('trend', '查看趋势', 'secondary')}</div><p class="note">展示最近八份已生成练习反馈中，腾讯成功回执的准确度百分制；不合成为雅思总分。</p><div id="trend-result" role="status"></div></section>` : '') +
        (cloud.enabled ? `<details class="panel cloud-import"><summary>导入以前的练习</summary><p>选择一份自己的交接 JSON，确认后将答卷和录音保存到当前账号。旧版记录可先从 <a href="/local#history">本机工作区</a> 导出。</p>
            <input type="file" id="import-file" accept=".json,application/json" aria-label="选择自己的练习文件">
            ${btn('import-cloud', '确认导入到我的账号', 'secondary', '','disabled')}</details>` : '');
}
function closeDialog() { setBusy('probe',false); probeEpoch++; if (testing || probeBusy) {
    audio.cancel();
    testing = false;
    probeBusy = false;
} if (dialog.open)
    dialog.close(); }
let modalKind = '', modePending = false;
function showModal(html, kind) { modalKind = kind; document.querySelector('#dialog-inner').innerHTML = html; if (!dialog.open)
    dialog.showModal(); }
function deviceDialog() {
    setBusy('probe',probeBusy || testing);
    const title = modePending ? (mode === 'full' ? '完整模考准备' : '快速演练准备') : '检测麦克风';
    const desc = modePending ? (mode === 'full' ? '完整模考约 11–14 分钟。请先确认录音清晰。' : '使用缩短计时体验三个部分。演练记录单独标记。') : '请用正常音量读一句英语，停止录音后回听。';
    showModal(`<div class="panel-head"><h2 id="dialog-title">${title}</h2>${btn('close', '关闭', 'ghost', 'close')}</div><p>${desc}</p>
    <div class="question-card"><span class="eyebrow">MIC CHECK</span><p lang="en">I am ready to practise my English today.</p>${meter()}</div>
    <p class="note">${testing ? '正在检测录音… <span class="probe-clock" id="probe-clock" aria-label="试录时长">'+time(Date.now()-probeStarted)+'</span>' : testResult ? (testResult.silent ? '录音较轻或处于静音，请调整设备后重录。' : '已录 '+time(testResult.durationMs)+'，请播放试听，确认声音清晰。') : (micReady ? '麦克风已通过检测。' : '开始检测时，浏览器会请求麦克风权限。')}</p>${micError ? `<p class="error" role="alert">${esc(micError)}</p>` : ''}
    ${probeURL ? `<audio controls src="${probeURL}" aria-label="设备测试录音"></audio>` : ''}
    <div class="actions">${testing ? btn('probe-stop', '结束检测录音', 'primary', 'stop') : btn('probe-start', testResult ? '重新试录' : '开始试录', 'secondary', 'mic', probeBusy ? 'disabled' : '')}
    ${!testing && testResult && !testResult.silent && !micReady ? btn('probe-confirm', '已听清，确认设备', 'primary', 'check') : ''}</div>
    ${modePending ? `<label class="transcribe-opt"><input type="checkbox" id="asr-opt" ${asr ? 'checked' : ''} ${browserAsrAvailable ? '' : 'disabled'} aria-describedby="asr-note"> 浏览器英语转写</label><small class="muted" id="asr-note">${browserAsrAvailable ? '已按你的偏好设置。浏览器可能通过其在线语音服务处理声音；可随时关闭。关闭后仍可录音和腾讯发音评测，原始转写不足时不生成文字维度参考。' : '此浏览器不支持语音转写，仍可录音、回听和腾讯发音评测。需要文字维度反馈时，请换用支持英语转写的浏览器；手工补字仅作文本练习。'}</small>
    <p class="note">${scoreNotice} 设备试录仅在本机播放。</p>${cloud.enabled ? '<p class="note">交卷后，本场录音和转写将保存到你的账号。</p>' : ''}<div class="actions">${btn('launch', mode === 'full' ? '进入完整模考' : '进入快速演练', 'primary', 'arrow', (!micReady || testing || probeBusy) ? 'disabled' : '')}</div>` : ''}`, 'device');
}
function startSetup(quick, deviceOnly = false) { if (!deviceOnly)
    mode = quick ? 'quick' : 'full'; modePending = !deviceOnly; micError = ''; deviceDialog(); }
async function probeStart() {
    if (probeBusy || testing)
        return;
    const epoch = ++probeEpoch;
    probeBusy = true;
    micReady = false;
    micError = '';
    testResult = null;
    if (probeURL)
        URL.revokeObjectURL(probeURL);
    probeURL = '';
    deviceDialog();
    try {
        await audio.start({ onLevel, onError: e => notify(e.message) });
        if (epoch !== probeEpoch) {
            audio.cancel();
            return;
        }
        testing = true;
        probeStarted = Date.now();
    }
    catch (e) {
        if (epoch === probeEpoch)
            micError = e.message;
    }
    finally {
        if (epoch === probeEpoch) {
            probeBusy = false;
            deviceDialog();
        }
    }
}
async function probeStop() { if (!testing || probeBusy)
    return; const epoch = probeEpoch; probeBusy = true; try {
    const result = await audio.stop();
    if (epoch !== probeEpoch)
        return;
    testResult = result;
    probeURL = URL.createObjectURL(result.blob);
}
catch (e) {
    if (epoch === probeEpoch)
        micError = e.message;
}
finally {
    if (epoch === probeEpoch) {
        probeBusy = false;
        testing = false;
        deviceDialog();
    }
} }
function partNo() { return ['part1', 'prep', 'talk', 'followup', 'part3'].indexOf(session.phase) === 0 ? 1 : session.phase === 'part3' ? 3 : 2; }
function exam() {
    setBusy('exam', Boolean(audio.recording || pendingTake));
    setMain();
    const s = session;
    if (s.phase === 'review' || s.status === 'submitted') {
        page = 'detail';
        detail();
        return;
    }
    const q = currentQuestion(s), prep = s.phase === 'prep', p = partNo(), cue = prep || s.phase === 'talk';
    main.innerHTML = heading(modeName(s), s.mode === 'quick' ? '缩短计时，仅用于体验流程。' : '依次完成三个部分，所有回答将在交卷后供回听。', 'EXAM IN PROGRESS') +
        `<div class="exam-grid"><section class="panel session-card"><div class="stage-strip">${['日常问答', '个人陈述', '深入讨论'].map((x, i) => `<span class="stage-pill ${p === i + 1 ? 'active' : ''}">Part ${i + 1} · ${x}</span>`).join('')}</div>
  <div class="panel-head"><span class="eyebrow">PART 0${p} / ${labels[s.phase]}</span><strong class="timer" id="timer" aria-label="阶段剩余时间">${time((s.deadline || Date.now()) - Date.now())}</strong></div>
  <div class="question-card"><span class="muted">${cue ? '话题卡' : '考官提问'}</span><h2 class="question" lang="en">${esc(cue ? cueCard.prompt : q?.prompt)}</h2>
  ${cue ? `<ul lang="en">${cueCard.cues.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${!prep ? btn('hear', '朗读题目', 'ghost', 'sound', audio.recording || pendingTake ? 'disabled' : '') : ''}<span id="voice-status" class="muted" aria-live="polite"></span></div>
  ${prep ? `<label for="scratch"><strong>准备便笺</strong></label><textarea id="scratch" rows="3" maxlength="1200" placeholder="记下几个关键词，仅自己可见">${esc(s.notes)}</textarea><p class="note">准备时间结束后，会自动开始独白录音。</p>` :
            `<div id="record-box"><p id="rec-state" class="note" role="status">${pendingTake ? '录音已暂存，请重试保存。' : audio.recording ? '正在录音…' : '准备好后，点击下方按钮回答。'}</p>${meter()}
  <div class="actions">${pendingTake ? btn('retry-take', '重试保存本轮', 'primary', 'check') : audio.recording ? btn('stop-answer', '结束本轮回答', 'primary', 'stop') : btn('record', '开始回答', 'primary', 'mic')}<span class="muted" id="capture-clock"></span></div>
  <small class="muted" id="live-text"></small></div>`}
  ${takeError ? `<p class="error" role="alert">${esc(takeError)}</p>` : ''}</section>
  <aside class="side-col"><section class="panel"><h2 class="panel-title">本场进度</h2><p>已保存 <strong>${s.turns.length}</strong> 段回答</p><p class="muted">${s.interrupted ? '本场含中断记录。' : '完成每轮回答后自动保存。'}</p>${btn('leave', '暂时离开', 'secondary', 'pause')}</section></aside></div>`;
}
function setNarrationControls(active) {
    const recordButton = main.querySelector('[data-action="record"]');
    const hearButton = main.querySelector('[data-action="hear"]');
    if (recordButton)
        recordButton.disabled = active;
    if (hearButton) {
        hearButton.disabled = audio.recording || Boolean(pendingTake);
        hearButton.innerHTML = active ? ic('pause') + '跳过朗读' : ic('sound') + '朗读题目';
    }
}
async function sayQuestion() {
    if (page !== 'exam' || audio.recording || pendingTake || session.phase === 'prep')
        return;
    const q = currentQuestion(session);
    if (!q)
        return;
    stopVoice();
    const token = voiceToken;
    speaking = true;
    setNarrationControls(true);
    const info = document.querySelector('#voice-status');
    if (info)
        info.textContent = ' 正在朗读…';
    try {
        const ok = await speakPrompt(q.prompt);
        if (token === voiceToken && info)
            info.textContent = ok ? '' : ' 可阅读上方英文题目';
    }
    finally {
        if (token === voiceToken) {
            speaking = false;
            setNarrationControls(false);
        }
    }
}
async function record() {
    if (page !== 'exam' || audio.recording || pendingTake || session.phase === 'prep')
        return;
    stopVoice();
    takeError = '';
    let lastText = '';
    const key = session.id + '|' + currentQuestion(session).id;
    await audio.start({ transcribe: asr, onLevel, onTranscript: t => { lastText = t; const node = document.querySelector('#live-text'); if (node)
            node.textContent = t; }, onError: e => { takeError = e.message; notify(e.message); } });
    if (page !== 'exam' || session.id + '|' + currentQuestion(session)?.id !== key) {
        audio.cancel();
        return;
    }
    captureStarted = Date.now();
    exam();
    const text = document.querySelector('#live-text');
    if (text)
        text.textContent = lastText;
}
async function persistTake() {
    const q = currentQuestion(session), take = pendingTake;
    if (!take || !q || q.id !== pendingKey)
        throw Error('当前题目已变化，请先回到记录核对。');
    session = await saveAnswer(session.id, q.id, { ...take, transcriptSource: take.transcript ? 'browser' : 'unavailable' });
    const turn=session.turns.find(t=>t.questionId===q.id);
    if(turn) await scheduleScore('exam',session.id,q.id,'第 '+turn.turnIndex+' 段',take.blob,take.durationMs).catch(()=>notify('录音已保存，发音评测未能加入队列。'));
    trackSpeaking('answer','exam',session.id,q.id);
    pendingTake = null;
    pendingKey = '';
    takeError = '';
    exam();
    if (page === 'exam' && session.phase !== 'prep')
        void sayQuestion();
}
async function finishAnswer(auto = false) {
    const q = currentQuestion(session);
    if (!q)
        return;
    const take = await audio.stop();
    if (!take.blob?.size || take.silent === true) {
        takeError = '没有检测到清晰的声音，请检查麦克风并重新回答。';
        if (auto)
            session = await advanceExpired(session.id, session.phase, { attempted: true });
        exam();
        return;
    }
    pendingTake = take;
    pendingKey = q.id;
    try {
        await persistTake();
    }
    catch (e) {
        takeError = '保存失败，录音仍在当前页面。' + e.message;
        exam();
    }
}
function confirmLeave(target) { showModal(`<h2 id="dialog-title">暂时离开本场练习？</h2><p>已保存的回答仍可回听。当前尚未保存的录音会丢失，返回后会标记为中断练习。</p><div class="actions">${btn('close', '继续练习', 'secondary')}${btn('leave-yes', '保存进度并离开', 'primary', '', `data-target="${target}"`)}</div>`, 'leave'); }
function saveScratch() { const area = document.querySelector('#scratch'); if (!area || !session)
    return Promise.resolve(); clearTimeout(noteTimer); return saveNotes(session.id, area.value); }
async function nav(to, confirmed = false, announce = true) { if (page === 'exam' && !confirmed) {
    confirmLeave(to);
    return;
} if (page === 'exam') {
    setBusy('exam',false);
    await saveScratch();
    audio.cancel();
    stopVoice();
    pendingTake = null;
    pendingKey = '';
}
    if (page === 'detail' && session?.status !== 'submitted') await edits();
    disposePractice?.();
    disposePractice = null;
    disposeCampus?.();
    disposeCampus = null;
    clearUrls();
    if (dialog.open) closeDialog();
    page = to;
    session = null;
    currentReport = null;
    setMain();
    if (page === 'campus' || page === 'campus-team') {
        disposeCampus = mountCampus(main, page);
    } else if (to === 'practice') {
        disposePractice = mountPractice(main, upcomingDrill || {});
        upcomingDrill = null;
    } else {
        sessions = await refreshHistory();
        if (!accountReady) return;
        if (to === 'history') history();
        else home();
    }
    if (embedded) { if (announce) reportRoute(to === 'home' ? 'studio' : to); }
    else window.history.replaceState(null, '', to === 'home' ? '#studio' : '#' + to);
    window.scrollTo(0, 0);
}
function paintSyncStatus() {
    if (!cloud.enabled || !accountReady || !session) return;
    const badge = main.querySelector('#session-storage');
    const panel = main.querySelector('#sync-status');
    if (badge) badge.textContent = storageLabel(session);
    if (!panel) return;
    const synced = remoteOnly || cloud.records.has(session.id) || session.cloudSyncedAt;
    const modelButton = main.querySelector('[data-action="model-report"]');
    if (modelButton) modelButton.disabled = !synced;
    panel.hidden = !!synced;
    if (!synced) panel.innerHTML = uploading.has(session.id)
        ? '本机已保存，正在上传答卷与录音…'
        : `本机已保存，等待同步。${esc(syncErrors.get(session.id) || '')} ${btn('sync', '重试同步', 'secondary')}`;
}

function detail() {
    if (!accountReady || !session) return;
    setMain();
    const s = session, closed = s.status === 'submitted', waiting = s.phase === 'review' && !closed;
    setBusy('exam',false);
    reportRoute('exam/' + s.id);
    const back = btn('history', '练习记录', 'ghost', 'back');
    const info = closed ? '查看本场反馈，回听原声，再用同一道题练一次。' : waiting ? '检查录音和转写后交卷。没有转写的回答可以回听和分析停顿；补上原话还能获得表达反馈。' : '已保存的回答可回听。继续练习后将按中断练习记录。';
    currentReport = closed ? textReport(s) : null;
    main.innerHTML = back + heading(modeName(s) + (closed ? '报告' : '记录'), info, closed ? 'SPEAKING REPORT' : 'SESSION REVIEW') +
        (closed ? scoreSummary('exam',s.id) + reportOverview(currentReport) : '') +
        (closed && cloud.enabled && s.mode === 'full' && s.assessmentEligible && !s.interrupted ?
            s.turns.some(t => t.transcriptSource === 'manual') ? '<p class="note">本场含手工校正的转写，可查看本机文本反馈与录音分析；组合式练习报告仅接收完整、原始作答。</p>' :
            '<section class="panel model-report" id="model-panel" aria-live="polite" hidden></section>' : '') +
        `<section class="panel review-panel"><div class="panel-head"><h2 class="panel-title">${closed ? '逐题复盘' : '本场回答'}</h2><span id="session-storage" class="status-pill">${storageLabel(s)}</span></div><p class="muted">${when(s.createdAt)} · ${s.turns.length} 段录音${s.interrupted ? ' · 有中断' : ''}</p>
  <div class="turn-list">${s.turns.map((t, i) => `<article class="turn-item" data-question="${esc(t.questionId)}"><small class="eyebrow">PART 0${Number(t.part)} · 第 ${i + 1} 段 · ${time(t.durationMs)}</small><h3 lang="en">${esc(t.prompt)}</h3><div class="actions">${btn('listen', '回听回答', 'secondary', 'play', `data-q="${esc(t.questionId)}"`)}${closed ? btn('acoustic', '分析录音', 'secondary', 'sound', `data-q="${esc(t.questionId)}"`) : ''}</div><div data-player="${esc(t.questionId)}"></div><div data-acoustic="${esc(t.questionId)}" role="status"></div>${scoreSlot('exam',s.id,t.questionId,scopedKey('speaking-soe-v1:'+JSON.stringify([cloud.userId||'guest',s.id,t.questionId])))}
  ${closed ? `<p class="muted" lang="en">${esc(t.transcript || '无转写文本，原声已保留。')}</p>${turnFeedback(currentReport.turns[i], t.questionId)}` : `<label class="transcribe-opt">转写文本（可校正）<textarea rows="2" maxlength="10000" data-transcript="${esc(t.questionId)}" placeholder="自动转写不可用时，可在此补充。">${esc(t.transcript)}</textarea></label>`}</article>`).join('') || '<p class="note">本场还没有保存的录音。</p>'}</div>
  ${cloud.enabled && closed ? '<div id="sync-status" class="cloud-status" role="status" hidden></div>' : ''}
  ${taskError ? `<p class="error">${esc(taskError)}</p>` : ''}
  <div class="actions">${closed ? btn('export', '导出会话与录音', 'secondary', 'download') : waiting ? btn('seal', '确认交卷', 'primary', 'check') : btn('resume', '继续练习', 'primary', 'play')}${!closed && s.turns.length ? btn('save-edits', '保存文字校正', 'secondary') : ''}</div></section>` +
        (closed ? renderExercises(currentReport.exercises) : '');
    paintSyncStatus();
    const modelPanel = document.querySelector('#model-panel');
    if (modelPanel) void loadModelPanel(s, modelPanel);
}
async function openSession(id) {
    clearUrls();
    const local = await getSession(id);
    const row = local || (cloud.enabled ? await cloud.getSession(id) : null);
    if (!row) throw Error('记录不存在。');
    if (!accountReady) return;
    remoteOnly = !local;
    session = row;
    page = 'detail';
    taskError = '';
    detail();
    window.scrollTo(0, 0);
}

async function loadTurnAudio(id, questionId) {
    const local = !remoteOnly && await getAudio(id, questionId);
    if (local) return local;
    if (cloud.enabled) return cloud.getAudio(id, questionId);
    throw new Error('找不到该轮录音。');
}
async function savedModelReport(id) {
    if (modelReports.has(id)) return modelReports.get(id);
    try {
        const res = await cloud.request('/api/coach/report?sessionId=' + encodeURIComponent(id));
        const report = await res.json();
        if (!accountReady) throw Error('账号已切换。');
        modelReports.set(id, report);
        return report;
    } catch (error) {
        if (error.status === 404) return null;
        throw error;
    }
}

async function loadModelPanel(row, panel) {
    try {
        const synced = remoteOnly || cloud.records.has(row.id) || row.cloudSyncedAt;
        const saved = synced && await savedModelReport(row.id);
        if (!panel.isConnected || !accountReady) return;
        panel.hidden = false;
        if (saved) {
            publishExam(row, saved.band);
            panel.innerHTML = modelPanel(saved);
            return;
        }
        const status = await (await cloud.request('/api/coach/status')).json();
        if (!panel.isConnected || !accountReady) return;
        panel.innerHTML = status.available
            ? `<h2>组合式口语练习报告</h2><p class="note">DeepSeek 分析已保存的转写，腾讯评测以百分制呈现发音与语流，录音不会发送给 DeepSeek。两种口径分开展示，不换算雅思发音分或综合分；缺证据留空。</p>${btn('model-report', '生成练习报告', 'primary', 'message')}<p class="report-tool-status" role="status"></p>`
            : '<h2>口语 AI 练习报告</h2><p class="note">尚未配置 DeepSeek。当前可使用本机文本建议、录音回放和腾讯自动发音评测；这些功能不依赖 DeepSeek。</p>';
        paintSyncStatus();
    } catch (error) {
        if (!panel.isConnected || !accountReady) return;
        panel.hidden = false;
        panel.innerHTML = `<h2>口语 AI 练习报告</h2><p class="note">${esc(error.message)}</p>${btn('reload-model', '重新检查', 'secondary')}`;
    }
}

const activeModels = new Map();
function modelPanel(report){
    return modelResult(report)+btn('model-report',report.source?.missing?.length?'腾讯结果到齐后更新反馈':'更新练习反馈','secondary','message')+'<p class="report-tool-status" role="status"></p>';
}
async function runModel(row, panel) {
    let job = activeModels.get(row.id);
    if (!job) {
        job = (async () => {
            if (!accountReady) throw Error('账号状态已改变，请登录后重新打开。');
            const response = await cloud.request('/api/coach/report', {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sessionId:row.id})
            });
            const result = await response.json();
            if (accountReady) { modelReports.set(row.id, result); publishExam(row, result.band); }
            return result;
        })().finally(() => activeModels.delete(row.id));
        activeModels.set(row.id, job);
    }
    const button = panel.querySelector('[data-action="model-report"]');
    button.hidden = true;
    const status = panel.querySelector('.report-tool-status');
    status.textContent = '报告生成中…';
    try {
        const result = await job;
        if (panel.isConnected && accountReady) panel.innerHTML = modelPanel(result);
    } catch (error) {
        if (panel.isConnected && accountReady) {
            status.textContent = error.message || '练习报告暂时无法完成，请稍后重试。';
            button.hidden = false;
        }
    }
}

async function trend(target, button) {
    button.disabled = true;
    target.textContent = '';
    try {
        const recent = sessions.filter(s => s.status === 'submitted' && s.mode === 'full' && s.assessmentEligible && !s.interrupted && (cloud.records.has(s.id) || s.cloudSyncedAt)).slice(0, 8).reverse();
        const points = [];
        for (const row of recent) {
            if (!target.isConnected || !accountReady) return;
            const report = await savedModelReport(row.id);
            const voice=(report?.voiceEvidence||[]).filter(item=>Number.isFinite(item.accuracy));
            if(voice.length){const weight=voice.reduce((sum,item)=>sum+Math.max(1,item.activeMs),0);points.push({value:voice.reduce((sum,item)=>sum+item.accuracy*Math.max(1,item.activeMs),0)/weight,date:row.createdAt});}
        }
        if (target.isConnected && accountReady) target.innerHTML = progressChart(points);
    } catch (error) {
        if (target.isConnected && accountReady) target.textContent = error.message;
    } finally {
        button.disabled = false;
    }
}
async function edits() { for (const t of document.querySelectorAll('[data-transcript]')) {
    const turn = session.turns.find(x => x.questionId === t.dataset.transcript);
    if (turn && t.value !== turn.transcript) {
        session = await updateText(session.id, turn.questionId, t.value);
    }
} setBusy('transcripts',false); }
async function updateText(id, q, text) { return updateTranscript(id, q, text); }
async function handle(action, el) {
    if (!accountReady) return;
    if (action === 'showcase-report' && showcaseReports.some(r=>r.reportId===el.dataset.id)) {
        parent.postMessage({source:'ielts-speaking',type:action,reportId:el.dataset.id},location.origin);
        return;
    }
    if (action === 'reload-model') {
        void loadModelPanel(session, document.querySelector('#model-panel'));
        return;
    }
    if (action === 'model-report') {
        void runModel(session, document.querySelector('#model-panel'));
        return;
    }
    if (action === 'trend') {
        void trend(document.querySelector('#trend-result'), el);
        return;
    }
    if (action === 'acoustic') {
        el.disabled = true;
        const questionId = el.dataset.q;
        const result = main.querySelector(`[data-acoustic="${CSS.escape(questionId)}"]`);
        result.textContent = '正在本机分析录音…';
        const sessionId = session.id;
        void (async () => {
            try {
                const blob = await loadTurnAudio(sessionId, questionId);
                const sound = await inspectRecording(blob);
                if (result.isConnected && accountReady) {
                    result.innerHTML = acousticResult(sound, questionId);
                    el.hidden = true;
                }
            } catch (error) {
                if (result.isConnected) result.textContent = error.message || '此浏览器无法分析该录音，仍可点击回听。';
            } finally {
                el.disabled = false;
            }
        })();
        return;
    }
    if (action === 'drill') {
        const exercise = currentReport.exercises[Number(el.dataset.exercise)];
        const exerciseTurn = exercise && /第\s*(\d+)\s*题/.exec(exercise.title + ' ' + exercise.instruction);
        const i = el.dataset.q ? session.turns.findIndex(t => t.questionId === el.dataset.q)
            : exerciseTurn ? currentReport.turns.findIndex(t => t.turnIndex === Number(exerciseTurn[1])) : 0;
        const original = session.turns[i];
        const originalBlob = original ? await loadTurnAudio(session.id, original.questionId).catch(() => null) : null;
        if (!accountReady) return;
        upcomingDrill = {prompt: original?.prompt || '', focus: exercise?.instruction || currentReport.turns[i]?.advice || '',
            originalBlob, originalText: original?.transcript || ''};
        await nav('practice');
        return;
    }
    if (action === 'sync') {
        await syncSubmitted(session.id);
        return;
    }
    if (action === 'import-cloud') {
        const file = document.querySelector('#import-file')?.files?.[0];
        if (!file) throw new Error('请先选择一份交接 JSON 文件。');
        if (file.size > 25 * 1024 * 1024) throw new Error('文件过大，请选择不超过 25 MB 的答卷。');
        const result = await cloud.save(file);
        if (!accountReady) return;
        await openSession(result.id);
        notify('已导入当前账号');
        return;
    }
    if (action === 'close') {
        if (embedded && page === 'home') reportRoute('studio');
        closeDialog();
        return;
    }
    if (action === 'device' || action === 'start-quick' || action === 'start-full') {
        startSetup(action === 'start-quick', action === 'device');
        return;
    }
    if (action === 'probe-start') {
        await probeStart();
        return;
    }
    if (action === 'probe-stop') {
        await probeStop();
        return;
    }
    if (action === 'probe-confirm') {
        micReady = true;
        if (modePending)
            deviceDialog();
        else {
            closeDialog();
            home();
            notify('设备检测通过');
        }
        return;
    }
    if (['home','history','practice','campus','campus-team'].includes(action)) {
        await nav(action);
        return;
    }
    if (action === 'leave') {
        confirmLeave('home');
        return;
    }
    if (action === 'leave-yes') {
        closeDialog();
        await nav(el.dataset.target, true);
        return;
    }
    if (action === 'launch') {
        if (!micReady || testing)
            return;
        asr = !!document.querySelector('#asr-opt')?.checked;
        closeDialog();
        session = await createSession(mode);
        trackSpeaking('start','exam',session.id);
        remoteOnly = false;
        takeError = '';
        page = 'exam';
        reportRoute('exam/' + session.id);
        exam();
        window.scrollTo(0, 0);
        void sayQuestion();
        return;
    }
    if (action === 'hear') {
        if (speaking) {
            stopVoice();
            setNarrationControls(false);
            const status = document.querySelector('#voice-status');
            if (status)
                status.textContent = '';
        }
        else {
            void sayQuestion();
        }
        return;
    }
    if (action === 'record') {
        await record();
        return;
    }
    if (action === 'stop-answer') {
        await finishAnswer();
        return;
    }
    if (action === 'retry-take') {
        await persistTake();
        return;
    }
    if (action === 'open') {
        await openSession(el.dataset.id);
        return;
    }
    if (action === 'resume') {
        await edits();
        session = await resumeSession(session.id, { lostTurn: true });
        clearUrls();
        takeError = '';
        page = 'exam';
        reportRoute('exam/' + session.id);
        exam();
        if (page === 'exam')
            void sayQuestion();
        return;
    }
    if (action === 'listen' || action === 'seek' || action === 'evidence') {
        const target = main.querySelector(`[data-player="${CSS.escape(el.dataset.q)}"]`);
        if (!target) throw Error('未找到对应的原声。');
        let player = target.querySelector('audio');
        if (!player) {
            const blob = await loadTurnAudio(session.id, el.dataset.q);
            if (!target.isConnected || !accountReady) return;
            const url = URL.createObjectURL(blob);
            blobUrls.add(url);
            player = new Audio(url);
            player.controls = true;
            player.setAttribute('aria-label', '本轮回答录音');
            target.append(player);
        }
        for (const a of main.querySelectorAll('audio'))
            if (a !== player) a.pause();
        if (action === 'seek') player.currentTime = Math.max(0, Number(el.dataset.start) - 0.4);
        if (action === 'evidence') {
            player.currentTime = 0;
            target.closest('.turn-item').scrollIntoView({block:'center'});
        }
        await player.play();
        return;
    }
    if (action === 'save-edits') {
        await edits();
        notify('文字校正已保存');
        return;
    }
    if (action === 'seal') {
        await edits();
        session = await submitSession(session.id);
        publishExam(session);
        trackSpeaking('finish','exam',session.id);
        const sessionId = session.id;
        window.dispatchEvent(new CustomEvent('speaking-a:submitted', { detail: {
                sessionId,
                loadPayload: async () => JSON.parse(await (await exportSession(sessionId)).text())
            } }));
        clearUrls();
        detail();
        window.scrollTo(0, 0);
        if (embedded) parent.scrollTo({top:0,behavior:'instant'});
        notify('本场已封卷');
        if (cloud.enabled) void syncSubmitted(sessionId);
        return;
    }
    if (action === 'export') {
        const existing = main.querySelector('a[data-export-file]');
        if (existing) {
            existing.click();
            return;
        }
        const file = await buildHandoff(session, loadTurnAudio);
        if (!accountReady) return;
        const url = URL.createObjectURL(file);
        blobUrls.add(url);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'speaking-' + session.id + '.json';
        link.dataset.exportFile = '';
        link.className = 'text-link';
        link.textContent = '手动下载交接文件';
        el.after(link);
        link.click();
        notify('文件已就绪，可再次点击下载链接');
    }
}
async function guarded(action, el) { if (working || tickRunning)
    return; working = true; try {
    await handle(action, el);
}
catch (e) {
    console.error(e);
    if (page === 'exam') {
        takeError = e.message;
        exam();
    }
    else if (page === 'detail') {
        taskError = e.message;
        notify(e.message);
    }
    else
        notify(e.message || '操作失败，请重试。');
}
finally {
    working = false;
} }
document.addEventListener('click', e => { const el = e.target.closest('[data-action]'); if (el) {
    e.preventDefault();
    void guarded(el.dataset.action, el);
} });
document.addEventListener('change', e => {
    if (e.target.id === 'import-file') {
        main.querySelector('[data-action="import-cloud"]').disabled = !e.target.files?.length;
    }
});
document.addEventListener('input', e => {
    if (e.target.matches('[data-transcript]')) setBusy('transcripts', true);
    if (e.target.id === 'scratch') {
    const id = session.id, text = e.target.value;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => saveNotes(id, text).catch(e => notify(e.message)), 250);
} if (e.target.id === 'asr-opt') {
    asr = browserAsrAvailable && e.target.checked;
    try { localStorage.setItem(scopedKey('speaking-asr-v1'), asr ? 'on' : 'off'); } catch {}
} });
dialog.addEventListener('cancel', e => { e.preventDefault(); closeDialog(); });
window.addEventListener('pagehide', () => { audio.cancel(); stopVoice(); disposePractice?.(); disposePractice = null; disposeCampus?.(); disposeCampus = null; });
window.addEventListener('beforeunload', e => { if (audio.recording || pendingTake) {
    e.preventDefault();
    e.returnValue = '';
} });
async function tick() {
    const probeClock = document.querySelector('#probe-clock');
    if (testing && probeClock) probeClock.textContent = time(Date.now() - probeStarted);
    if (page !== 'exam' || !session)
        return;
    const now = Date.now(), rem = session.deadline - now;
    const t = document.querySelector('#timer');
    if (t)
        t.textContent = time(rem);
    const c = document.querySelector('#capture-clock');
    if (c && audio.recording)
        c.textContent = time(now - captureStarted);
    if (rem > 0 || !session.deadline || working || tickRunning || pendingTake)
        return;
    if (dialog.open && modalKind === 'leave')
        closeDialog();
    tickRunning = true;
    stopVoice();
    try {
        if (session.phase === 'prep') {
            await saveScratch();
            session = await beginPart2(session.id);
            exam();
            await record();
        }
        else if (audio.recording)
            await finishAnswer(true);
        else {
            session = await advanceExpired(session.id);
            exam();
            if (page === 'exam' && session.phase !== 'prep')
                void sayQuestion();
        }
    }
    catch (e) {
        takeError = e.message;
        exam();
    }
    finally {
        tickRunning = false;
    }
}
const clock = setInterval(tick, 250);
let hostReady = false, pendingRoute = null;
async function openHostRoute(route, initial = false) {
    if (!hostReady) { pendingRoute = route; return; }
    if (!initial && route === location.hash.slice(1) && !['full','quick'].includes(route)) return;
    const record = /^(exam|dialogue)\/([a-zA-Z0-9_-]{1,90})$/.exec(route);
    if (!record && !['studio','practice','history','campus','campus-team','full','quick'].includes(route)) return;
    if (record?.[1] === 'dialogue') {
        upcomingDrill = {recordId:record[2]};
        await nav('practice',true,false);
    } else if (record) {
        await nav('history',true,false);
        try { await openSession(record[2]); }
        catch { reportRoute('history'); notify('当前账号在这台设备上找不到这场模考。'); }
    } else if (route === 'full' || route === 'quick') {
        await nav('home',true,false);
        startSetup(route === 'quick');
        reportRoute(route);
    } else await nav(route === 'studio' ? 'home' : route,true);
}
connectHost(route => openHostRoute(route).catch(e => notify(e.message)));
async function startApp() {
  try {
    if (scope) useAccountDatabase('host:' + scope);
    if (cloud.enabled) {
        document.querySelector('.header-end').innerHTML = '<span class="local-indicator" aria-hidden="true">●</span> 账号工作区';
        main.innerHTML = '<p class="note" role="status"></p>';
        const id = await cloud.verify();
        if(!embedded)useAccountDatabase(id);
        accountReady = true;
    } else if (document.querySelector('meta[name="speaking-guest"]')) {
        document.querySelector('.header-end').innerHTML = `本机练习 · <a href="${accountLogin}" target="_top">登录账号</a>`;
    }
    startScores();
    sessions = await refreshHistory();
    if (!accountReady) return;
    if (embedded) {
        sessions.forEach(row => publishExam(row));
        hostReady = true;
        const initialRoute = pendingRoute || location.hash.slice(1) || 'studio';
        await openHostRoute(initialRoute, true);
        announceHostReady(initialRoute);
    } else if (['#campus','#campus-team'].includes(location.hash) || (!location.hash && location.pathname === '/campus.html')) {
        page = location.hash === '#campus-team' || (!location.hash && new URLSearchParams(location.search).has('team')) ? 'campus-team' : 'campus';
        setMain(); disposeCampus = mountCampus(main, page);
    } else if (location.hash === '#history') {
        page = 'history';
        history();
    }
    else if (location.hash === '#practice') {
        page = 'practice';
        setMain();
        disposePractice = mountPractice(main, {});
    } else
        home();
    if (cloud.enabled && !historyError) {
        for (const row of sessions) {
            if (!accountReady) break;
            if (row.status === 'submitted' && !cloud.records.has(row.id)) await syncSubmitted(row.id);
        }
    }
  } catch (error) {
    if(embedded&&!error.accountChanged){
        cloud.enabled=false;accountReady=true;useAccountDatabase('host:'+scope);
        try{sessions=await listSessions();}catch{sessions=[];}
        hostReady=true;const route=pendingRoute||location.hash.slice(1)||'studio';
        await openHostRoute(route,true).catch(()=>home());announceHostReady(route);
        notify('口语同步服务暂时不可用，本机录音与练习可继续；连接恢复后重新进入可重试同步。');
    }
    else if (cloud.enabled) {lockWorkspace(error.message);if(embedded){hostReady=true;announceHostReady(location.hash.slice(1)||'studio');}}
    else {
        home();
        notify('本机存储不可用，请在普通浏览窗口中打开。');
    }
  }
}
window.addEventListener('speaking-account-lost', () => lockWorkspace('请登录原账号继续查看这份练习。'));
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && cloud.enabled && accountReady) void cloud.verify().catch(() => {});
});
window.addEventListener('pageshow', event => {
    if (event.persisted && cloud.enabled) location.reload();
});
void startApp();
