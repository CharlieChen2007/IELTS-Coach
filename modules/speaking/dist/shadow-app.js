/* =============================================================
 * SpeakLoop · 每日语料跟读模块 · 交互层
 * 视图：今日跟读 / 语料库 / 跟读记录
 * 闭环：选语料 → 听示范（变速 / 逐句 / 影子）→ 现场录音或示例音频
 *       → 四维评分 + 波形对比 → 带定位的跟读建议 → 按建议再练 → 历史回看
 * ============================================================= */
(function () {
  'use strict';
  var D = SL.shadowData, E = SL.shadowEngine, A = SL.audio;
  var $ = function (s) { return document.querySelector(s); };
  var view = $('#view'), modalEl = $('#modal'), modalInner = $('#modalInner'), toastEl = $('#toast');

  var LS_USERS = 'speakloop.users.v1', LS_LAST = 'speakloop.lastUser.v1';
  function keyOf(id) { return 'speakloop.shadow.' + id; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function yesterday() { var d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  /* 学习计划按「本账号首次使用日」起算：新账号从 Day 1 开始，7 天循环 */
  function planDay() {
    if (!state.db.startDate) { state.db.startDate = today(); saveDb(); }
    var a = new Date(state.db.startDate + 'T00:00:00'), b = new Date(today() + 'T00:00:00');
    var diff = Math.max(0, Math.round((b - a) / 86400000));
    return (diff % 7) + 1;
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtS(sec) {
    sec = Math.max(0, Number(sec) || 0);
    return pad(Math.floor(sec / 60)) + ':' + pad(Math.floor(sec % 60)) + '.' + Math.floor((sec % 1) * 10);
  }
  function esc(s) { return E.esc(s); }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 3200);
  }
  function pill(t, c) { return '<span class="pill ' + (c || '') + '">' + esc(t) + '</span>'; }

  var state = {
    view: 'practice', user: null, db: null,
    day: 1, corpusId: null,
    drillId: 'normal', rate: 1.0,
    transcript: '', pending: null,
    report: null, reportMetrics: null, reportAudioId: '', demoMode: false,
    audioStore: {},
    recording: false, micOpening: false, recSeconds: 0, recTimer: null, micError: '',
    playTimers: [], playStatus: '', playKind: '',
    histOpen: {}, libDay: null
  };

  /* ==================== 持久化（沿用整站账号体系，按账号隔离） ==================== */
  function users() { try { return JSON.parse(localStorage.getItem(LS_USERS) || '[]'); } catch (e) { return []; } }
  function saveUsers(l) { localStorage.setItem(LS_USERS, JSON.stringify(l)); }
  function emptyDb() { return { version: 1, startDate: today(), sessions: [], tasks: {}, streak: { days: 0, last: '' }, curve: [] }; }
  function loadDb() {
    try { state.db = JSON.parse(localStorage.getItem(keyOf(state.user.id)) || 'null') || emptyDb(); }
    catch (e) { state.db = emptyDb(); }
    if (!state.db.sessions) state.db.sessions = [];
    if (!state.db.tasks) state.db.tasks = {};
    if (!state.db.streak) state.db.streak = { days: 0, last: '' };
    if (!state.db.curve) state.db.curve = [];
    if (!state.db.startDate) state.db.startDate = today();
    if (!state.db.tasks[today()]) state.db.tasks[today()] = { done: [], target: 3 };
  }
  /* 宿主嵌入时的最小适配层：只做两件事 —— 学习记录按账号落到服务端、就绪后通知宿主。
     业务逻辑、文案与版式一律沿用交付包原文，不再二次改写。 */
  function saveDb() {
    if (SL.dailyHost.embedded) SL.dailyHost.persist('shadow', keyOf(state.user.id), state.db);
    else localStorage.setItem(keyOf(state.user.id), JSON.stringify(state.db));
  }
  function boot() {
    if (SL.dailyHost.embedded) {
      state.user = SL.dailyHost.user;
      SL.dailyHost.load('shadow').catch(function () { return null; }).then(function (remote) {
        if (remote) localStorage.setItem(keyOf(state.user.id), JSON.stringify(remote));
        loadDb();
        state.day = planDay();
        state.corpusId = D.byDay(state.day)[0].id;
        state.libDay = state.day;
        render();
        SL.dailyHost.ready('daily');
        void restoreAudio();
      });
      return;
    }
    var list = users();
    if (!list.length) {
      var u = { id: E.uid('U'), name: '新学员' };
      list.push(u); saveUsers(list); localStorage.setItem(LS_LAST, u.id);
    }
    var last = localStorage.getItem(LS_LAST);
    state.user = list.filter(function (u) { return u.id === last; })[0] || list[0];
    loadDb();
    state.day = planDay();
    state.corpusId = D.byDay(state.day)[0].id;
    state.libDay = state.day;
    render();
    SL.dailyHost.ready('daily');
  }
  function todayTask() { return state.db.tasks[today()] || { done: [], target: 3 }; }
  function doneCount() { return todayTask().done.length; }
  function updateChrome() {
    $('#accountName').textContent = state.user.name;
    $('#avatar').textContent = (state.user.name || 'S').slice(0, 1).toUpperCase();
    var n = Math.min(3, doneCount());
    $('#miniProgLabel').textContent = '今日 ' + n + '/3';
    $('#miniProgBar').style.width = (n / 3 * 100) + '%';
    document.querySelectorAll('.nav-btn[data-nav]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-nav') === state.view);
    });
    var bn = $('#micBanner');
    if (state.micError) { bn.textContent = state.micError; bn.classList.remove('hidden'); }
    else bn.classList.add('hidden');
  }

  /* ==================== 当前对象 ==================== */
  function currentItem() { return D.find(state.corpusId) || D.byDay(state.day)[0]; }
  function currentParsed() { return E.parseCorpus(currentItem()); }
  function activeReport() { return state.report; }
  function activeMetrics() { return state.reportMetrics; }
  function activeAudioId() { return state.reportAudioId; }
  var audioDb;
  function audioTransaction(mode, run) {
    if (!audioDb) audioDb = new Promise(function (resolve, reject) {
      var opening = indexedDB.open('ielts-daily-audio', 1);
      opening.onupgradeneeded = function () { opening.result.createObjectStore('clips'); };
      opening.onsuccess = function () { resolve(opening.result); };
      opening.onerror = function () { reject(opening.error); };
    });
    return audioDb.then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('clips', mode), result;
        run(tx.objectStore('clips'), function (value) { result = value; });
        tx.oncomplete = function () { resolve(result); };
        tx.onabort = tx.onerror = function () { reject(tx.error || new Error('无法保存原声')); };
      });
    });
  }
  function saveAudio(id, blob) {
    return audioTransaction('readwrite', function (store) { store.put(blob, state.user.id + '/' + id); });
  }
  function dropAudio(sessions) {
    var owner = state.user.id;
    sessions.forEach(function (session) {
      var audio = state.audioStore[session.audioId];
      if (audio?.url) URL.revokeObjectURL(audio.url);
      delete state.audioStore[session.audioId];
    });
    void audioTransaction('readwrite',function(store) {
      sessions.forEach(function(session) { if(session.audioId)store.delete(owner+'/'+session.audioId); });
    }).catch(function() {});
  }
  function restoreAudio() {
    var owner = state.user.id, sessions = state.db.sessions.slice();
    return audioTransaction('readonly', function (store, done) {
      var clips = [];
      sessions.forEach(function (item) {
        if (!item.audioId) return;
        var read = store.get(owner + '/' + item.audioId);
        read.onsuccess = function () { if (read.result) clips.push({item:item, blob:read.result}); };
      });
      done(clips);
    }).then(function (clips) {
      if (state.user.id !== owner) return;
      clips.forEach(function (clip) {
        if (!state.audioStore[clip.item.audioId]) state.audioStore[clip.item.audioId] = {
          url:URL.createObjectURL(clip.blob), name:clip.item.audioName, metrics:clip.item.metrics
        };
      });
      render();
    }).catch(function () {});
  }
  function audioRec(id) { return id ? state.audioStore[id] : null; }
  function scoreOf(cid) {
    var s = state.db.sessions.filter(function (x) { return x.corpusId === cid; })[0];
    return s ? s.overall : null;
  }

  /* ==================== 语料标记渲染 ==================== */
  function segHtml(seg) {
    var s = esc(seg);
    s = s.replace(/([A-Za-z]+(?:~[A-Za-z]+)+)/g, function (m) {
      return '<span class="ln">' + m.replace(/~/g, '‿') + '</span>';
    });
    s = s.replace(/\*([^*]+)\*/g, '<em class="st">$1</em>');
    return s;
  }
  function markedHtml(item) {
    return item.en.split('|').map(function (seg, i) {
      return (i ? '<span class="br">⏸ 意群</span>' : '') +
        '<span class="clause" data-clause="' + i + '">' + segHtml(seg.trim()) + '</span>';
    }).join(' ');
  }
  function tipsHtml(item) {
    return item.tips.map(function (t) {
      /* 提示标签里的 *...* 只是数据层的重音记号，界面上不必显示星号 */
      return '<div class="tip"><b>' + esc(String(t.k).replace(/\*/g, '')) + '</b><span>' + esc(t.v) + '</span></div>';
    }).join('');
  }
  function vocabHtml(item) {
    return item.vocab.map(function (v) { return '<span class="vocab-chip">' + esc(v) + '</span>'; }).join('');
  }

  /* ==================== 播放控制 ==================== */
  function clearTimers() { state.playTimers.forEach(clearTimeout); state.playTimers = []; }
  function setPlay(txt, kind) {
    state.playStatus = txt || ''; state.playKind = kind || '';
    var el = $('.play-status');
    if (el) { el.textContent = state.playStatus; el.className = 'play-status' + (state.playStatus ? ' on' : ''); }
  }
  function stopPlay() {
    clearTimers(); A.stopSpeak(); A.stopPlay(); setPlay('');
    document.querySelectorAll('.clause.hl').forEach(function (c) { c.classList.remove('hl'); });
  }
  function highlight(i) {
    document.querySelectorAll('.clause.hl').forEach(function (c) { c.classList.remove('hl'); });
    var el = document.querySelector('.clause[data-clause="' + i + '"]');
    if (el) el.classList.add('hl');
  }
  /* 长语料（P2 可达 80 秒）一次性交给 speechSynthesis 会被浏览器截断，
     因此按意群串联朗读：用 onend 衔接，超时兜底防止个别引擎不回调。 */
  function playAll() {
    stopPlay();
    var item = currentItem(), p = currentParsed(), i = 0;
    setPlay('正在朗读整段示范（' + state.rate + '×，约 ' + E.r1(p.expectedSec / state.rate) + ' 秒，按意群分段）', 'all');
    function next() {
      if (i >= p.clauses.length) {
        setPlay('');
        document.querySelectorAll('.clause.hl').forEach(function (c) { c.classList.remove('hl'); });
        return;
      }
      var c = p.clauses[i];
      var cw = c.text.split(/\s+/).filter(Boolean).length;
      var sec = Math.max(0.9, cw / (item.wpm * state.rate) * 60);
      var advanced = false;
      function advance() { if (advanced) return; advanced = true; i++; next(); }
      highlight(i);
      A.speak(c.text, { rate: state.rate, onend: advance });
      state.playTimers.push(setTimeout(advance, (sec + 1.2) * 1000));
    }
    next();
  }
  function playClauses(mode) {
    stopPlay();
    var item = currentItem(), p = currentParsed(), i = 0;
    var label = mode === 'shadow' ? '影子跟读' : mode === 'chunk' ? '意群停顿' : '逐句示范';
    function next() {
      if (i >= p.clauses.length) {
        setPlay(label + '完成，可以录一遍自己的版本了', 'done');
        document.querySelectorAll('.clause.hl').forEach(function (c) { c.classList.remove('hl'); });
        state.playTimers.push(setTimeout(function () { setPlay(''); }, 2600));
        return;
      }
      var c = p.clauses[i];
      var cw = c.text.split(/\s+/).filter(Boolean).length;
      var sec = Math.max(0.9, cw / (item.wpm * state.rate) * 60);
      var gap = mode === 'shadow' ? sec : mode === 'chunk' ? 0.7 : 0.25;
      highlight(i);
      setPlay(label + ' · 第 ' + (i + 1) + '/' + p.clauses.length + ' 句' +
        (mode === 'shadow' ? ' → 示范后留 ' + E.r1(sec) + ' 秒给你同步复述' : mode === 'chunk' ? ' → 在 | 处停 0.7 秒' : ''), mode);
      A.speak(c.text, { rate: state.rate });
      state.playTimers.push(setTimeout(function () { i++; next(); }, (sec + gap) * 1000 + 650));
    }
    next();
  }

  /* ========== 示例音频：与现场录音走完全相同的解码 / 评分链路 ========== */
  function encodeWav(samples, sr) {
    var len = samples.length, buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, len * 2, true);
    for (var i = 0; i < len; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }
  function synthSample(item, weak) {
    var p = E.parseCorpus(item), sr = 16000, wpm = item.wpm * (weak ? 1.42 : 1.0);
    var per = 60 / wpm, t = 0.3, events = [];
    p.tokens.forEach(function (tok, i) {
      var syl = p.syll[i], seg = per / Math.max(1, syl);
      var tail = i > p.wc * 0.86;
      for (var k = 0; k < syl; k++) {
        events.push({
          t: t, d: seg * 0.80,
          f0: (weak ? 158 : 172) * (1 + 0.055 * Math.sin(i * 0.61 + k * 0.9)) * (tail ? (weak ? 1.13 : 0.80) : 1),
          amp: (p.stressIdx.indexOf(i) >= 0 ? (weak ? 0.36 : 0.56) : (weak ? 0.32 : 0.31))
        });
        t += seg;
      }
      if (p.pauseWords.indexOf(i + 1) >= 0 || p.punctWords.indexOf(i + 1) >= 0) t += weak ? 0.42 : 0.22;
    });
    var dur = t + 0.45;
    if (weak) {
      var cut = t * 0.44;
      events.forEach(function (e) { if (e.t > cut) e.t += 1.8; });
      dur += 1.8;
    }
    var out = new Float32Array(Math.floor(dur * sr));
    events.forEach(function (e) {
      var start = Math.floor(e.t * sr), cnt = Math.floor(e.d * sr);
      for (var k = 0; k < cnt && start + k < out.length; k++) {
        var q = k / Math.max(1, cnt), env = Math.pow(Math.sin(Math.PI * q), 0.8), tt = k / sr;
        var ph = 2 * Math.PI * e.f0 * tt;
        out[start + k] += e.amp * env * (Math.sin(ph) + 0.33 * Math.sin(2 * ph) + 0.10 * Math.sin(3 * ph))
          + (Math.random() - 0.5) * 0.004;
      }
    });
    return encodeWav(out, sr);
  }

  function busy(value) {
    if (SL.dailyHost.embedded) parent.postMessage({source:'ielts-speaking', type:'busy', busy:value}, location.origin);
  }

  /* ==================== 音频接收 / 解码 ==================== */
  function handleFile(file, name, autoSubmit) {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) { toast('文件超过 30 MB，请换一段较短的录音'); return; }
    if (state.pending?.url) URL.revokeObjectURL(state.pending.url);
    busy(true);
    var url = URL.createObjectURL(file);
    state.pending = { blob: file, name: name || file.name || '录音', size: file.size, url: url, metrics: null };
    state.report = null; state.reportMetrics = null; state.reportAudioId = ''; state.demoMode = false;
    render();
    E.decodeAudio(file).then(function (m) {
      if (!state.pending || state.pending.blob !== file) return;
      state.pending.metrics = m;
      render();
      if (autoSubmit) submit(false);
      else toast(m.usable
        ? '音频已解析：' + m.durationSec + ' 秒，检测到 ' + m.syllableCount + ' 个音节核 / ' + m.pauseCount + ' 处停顿\n点「开始评分」生成报告'
        : '音频不足以评估：' + m.reason + '\n仍可提交查看缺项报告');
    });
  }
  function startRec() {
    if (state.recording || state.micOpening) return;
    stopPlay();
    if (!A.supported()) { state.micError = '当前环境不支持麦克风录音（需要 https 或 localhost）。可以点顶部「示例音频」，评分链路完全一样。'; render(); return; }
    state.micOpening = true; state.transcript = ''; busy(true);
    render();
    A.start({
      wantASR: true,
      onText: function (t) {
        state.transcript = t;
        var el = $('#transcript'); if (el) el.value = t;
        var live = $('#recLive'); if (live) live.textContent = t ? ('实时转写：' + t.slice(-90)) : '';
      }
    }).then(function () {
      state.micOpening = false; state.recording = true; state.recSeconds = 0; state.micError = '';
      render();
      state.recTimer = setInterval(function () {
        state.recSeconds++;
        var el = $('#recTimer'); if (el) el.textContent = fmtS(state.recSeconds);
        var bar = $('#recProg');
        if (bar) bar.style.width = Math.min(100, state.recSeconds / currentParsed().expectedSec * 100) + '%';
      }, 1000);
      toast('录音中：请朗读屏幕上的语料，读完点「停止并使用」');
    }).catch(function (e) {
      state.micError = '麦克风不可用：' + (e && e.message ? e.message : '权限被拒绝') + '。可点顶部「示例音频」，评分链路完全一样。';
      state.micOpening = false; state.recording = false; busy(!!state.pending); render();
    });
  }
  function stopRec() {
    clearInterval(state.recTimer); state.recTimer = null;
    A.stop().then(function (r) {
      state.recording = false;
      if (r.text) state.transcript = r.text;
      render();
      if (r.blob) handleFile(r.blob, '现场录音 · ' + fmtDate(new Date().toISOString()));
      else toast('没有录到音频，请重试，或点顶部示例音频');
    });
  }

  /* ==================== 提交评分 / 保存记录 ==================== */
  async function submit(isDemo) {
    var item = currentItem(), p = state.pending;
    if (!p || !p.metrics) { toast('先现场录一遍，或点顶部示例音频'); return; }
    if (p.saving) return;
    if (p.submitted) { toast('这段录音已保存，可重新录音继续练习。'); return; }
    var audioId = E.uid(p.name.indexOf('现场录音') === 0 ? 'A_REC' : 'A_SAMPLE');
    /* 报告回听用独立 URL：之后移除待评音频不会把已保存报告的回听弄失效 */
    state.audioStore[audioId] = { url: URL.createObjectURL(p.blob), name: p.name, metrics: p.metrics };
    var rep = E.buildReport(item, p.metrics, {
      userId: state.user.id, transcript: state.transcript.trim(), audioId: audioId,
      drillId: state.drillId, doneIds: todayTask().done
    });
    var sample = p.name.indexOf('示例音频') === 0;
    state.report = rep; state.reportMetrics = p.metrics; state.reportAudioId = audioId; state.demoMode = sample;
    if (!rep.pending) {
      if (!sample) {
        p.saving = true; render();
        try { await saveAudio(audioId, p.blob); }
        catch (_) { p.saving = false; toast('原声保存失败，请检查浏览器存储空间后重试。'); render(); return; }
        p.saving = false;
        if(state.pending !== p) return;
        saveSession(rep, p.metrics, audioId, p.name);
      }
      p.submitted = true; busy(false);
    }
    toast(rep.pending
      ? '音频不足，已生成「评分暂缓」报告：' + (p.metrics.reason || '')
      : sample ? '示例评分已生成，可查看反馈和回听；学习记录未增加。' : '评分完成：' + rep.overall + ' 分 · ' + rep.issues.length + ' 条建议，已写入今日任务与分数曲线');
    render();
    setTimeout(function () { var el = $('#report'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 90);
  }
  function saveSession(rep, metrics, audioId, audioName) {
    var item = currentItem();
    state.db.sessions.unshift({
      id: rep.sessionId, reportId: rep.id, userId: state.user.id, corpusId: item.id,
      corpusTitle: item.title, day: item.day, part: item.part,
      createdAt: rep.createdAt, overall: rep.overall, band: rep.band,
      dims: rep.dims, issues: rep.issues, keep: rep.keep, nextStep: rep.nextStep,
      metrics: metrics, audioId: audioId, audioName: audioName,
      transcript: rep.transcript, drillId: state.drillId, disclaimer: rep.disclaimer,
      pending: false, demo: false
    });
    if (state.db.sessions.length > 60) dropAudio(state.db.sessions.splice(60));
    var t = todayTask();
    if (t.done.indexOf(item.id) < 0) t.done.push(item.id);
    state.db.tasks[today()] = t;
    state.db.curve.push({ date: rep.createdAt, score: rep.overall, corpusId: item.id });
    if (state.db.curve.length > 40) state.db.curve.shift();
    if (t.done.length >= 3 && state.db.streak.last !== today()) {
      state.db.streak.days = state.db.streak.last === yesterday() ? state.db.streak.days + 1 : 1;
      state.db.streak.last = today();
    }
    saveDb();
  }
  function loadDemoReport() {
    var item = currentItem();
    var m = E.demoMetrics(item, 'weak');
    var rep = E.buildReport(item, m, { userId: state.user.id, transcript: '', drillId: state.drillId, doneIds: todayTask().done });
    state.report = rep; state.reportMetrics = m; state.reportAudioId = ''; state.demoMode = true;
    render();
    setTimeout(function () { var el = $('#report'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 90);
    toast('已载入示例报告（未写入学习记录）');
  }
  function runSample(weak) {
    var item = currentItem();
    var blob = synthSample(item, weak);
    handleFile(blob, weak ? '示例音频 · 读得吃力.wav' : '示例音频 · 读得不错.wav', true);
    toast('正在生成示例音频并走完整评分链路…');
  }

  /* ==================== 波形对比图 ==================== */
  function renderWave(rep, metrics, item) {
    if (!metrics || !metrics.envelope) return '';
    var p = E.parseCorpus(item), ref = E.referenceEnvelope(p, 180);
    var W = 720, H = 172, L = 10, R = W - 10, TOP = 14, BOT = H - 26, SPAN = R - L;
    function xy(arr, dur, i) {
      var x = L + i / (arr.length - 1) * SPAN;
      return [x, BOT - Math.max(0, Math.min(1, arr[i])) * (BOT - TOP)];
    }
    function path(arr, dur) {
      var s = '';
      for (var i = 0; i < arr.length; i++) { var q = xy(arr, dur, i); s += (i ? 'L' : 'M') + E.r1(q[0]) + ' ' + E.r1(q[1]); }
      return s;
    }
    var mine = metrics.envelope, d = Math.max(0.1, metrics.durationSec);
    var area = path(mine, d) + 'L' + R + ' ' + BOT + 'L' + L + ' ' + BOT + 'Z';
    var bands = (metrics.pauses || []).map(function (pa) {
      var x1 = L + pa.start / d * SPAN, x2 = L + Math.min(d, pa.end) / d * SPAN;
      return '<rect x="' + E.r1(x1) + '" y="' + TOP + '" width="' + E.r1(Math.max(2, x2 - x1)) + '" height="' + (BOT - TOP) + '" fill="#98a2c4" opacity=".14"/>';
    }).join('');
    var marks = (rep.issues || []).slice(0, 4).map(function (iss, i) {
      var x1 = L + Math.max(0, iss.audioStart) / d * SPAN;
      var x2 = L + Math.min(d, iss.audioEnd) / d * SPAN;
      var color = iss.level === 'high' ? '#ff7a59' : iss.level === 'medium' ? '#f5a524' : '#8a7cf8';
      return '<rect x="' + E.r1(x1) + '" y="' + TOP + '" width="' + E.r1(Math.max(3, x2 - x1)) + '" height="' + (BOT - TOP) +
        '" fill="' + color + '" opacity=".13"/><rect x="' + E.r1(x1) + '" y="' + TOP + '" width="' + E.r1(Math.max(3, x2 - x1)) +
        '" height="3" fill="' + color + '"/><text x="' + E.r1(x1 + 2) + '" y="' + (TOP + 13) + '" font-size="9" fill="' + color + '" font-weight="700">' + (i + 1) + '</text>';
    }).join('');
    var stress = ref.stressTimes.map(function (s) {
      var x = L + s / ref.durationSec * SPAN;
      return '<path d="M' + E.r1(x - 3) + ' ' + (TOP + 1) + 'L' + E.r1(x + 3) + ' ' + (TOP + 1) + 'L' + E.r1(x) + ' ' + (TOP + 7) + 'Z" fill="#5b5bf0" opacity=".65"/>';
    }).join('');
    return '<div class="wave-wrap"><div class="between"><div class="card-title" style="font-size:13.5px">节奏波形对比</div>' +
      '<span class="small muted">横轴＝各自朗读进度（%），用于比节奏形状</span></div>' +
      '<svg class="wave-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="示范节奏与跟读录音的能量包络对比">' +
      '<defs><linearGradient id="wfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b5bf0" stop-opacity=".30"/><stop offset="1" stop-color="#12b8a6" stop-opacity=".04"/></linearGradient></defs>' +
      '<line x1="' + L + '" y1="' + BOT + '" x2="' + R + '" y2="' + BOT + '" stroke="#dfe3f2"/>' + bands + marks +
      '<path d="' + area + '" fill="url(#wfill)"/>' +
      '<path d="' + path(ref.points, ref.durationSec) + '" fill="none" stroke="#b3aef5" stroke-width="1.8" stroke-dasharray="5 4"/>' +
      '<path d="' + path(mine, d) + '" fill="none" stroke="#4f4fe0" stroke-width="2.1" stroke-linejoin="round"/>' + stress +
      '<text x="' + L + '" y="' + (H - 7) + '" font-size="10" fill="#8892ad">0s</text>' +
      '<text x="' + (W / 2) + '" y="' + (H - 7) + '" font-size="10" fill="#8892ad" text-anchor="middle">参考 ' + E.r1(ref.durationSec) + 's ｜ 我的 ' + d + 's</text>' +
      '<text x="' + R + '" y="' + (H - 7) + '" font-size="10" fill="#8892ad" text-anchor="end">100%</text>' +
      '</svg><div class="wave-legend">' +
      '<span><i style="background:#4f4fe0"></i>我的录音（能量包络）</span>' +
      '<span><i style="background:#b3aef5"></i>节奏参考线（由文本生成，非真人录音）</span>' +
      '<span><i style="background:#98a2c4"></i>检测到的停顿</span>' +
      '<span><i style="background:#ff7a59"></i>建议定位片段（数字对应下方建议）</span>' +
      '<span><i style="background:#5b5bf0"></i>文本重音位置</span>' +
      '</div></div>';
  }

  /* ==================== 报告渲染 ==================== */
  function verdict(rep) {
    if (rep.pending) return '本次音频不足以评估，四维评分与总分暂缓。请按下面给出的补录方法重新录一遍。';
    if (rep.overall >= 85) return '整体节奏、停顿与语调都在参考区间。下一步不是换题，而是在提速或连续跟读时保持这些指标不退化。';
    if (rep.overall >= 70) return '基本节奏已经成立，但有 1–2 个可测量的具体问题。按下面带时间定位的建议逐条改，改完立刻复录对比。';
    return '这一遍的主要差距集中在节奏与断句上。先别追求读得更快，用建议里指定的训练模式把一个问题改掉，再录一次。';
  }
  function renderReport(rep, metrics, audioId, opts) {
    opts = opts || {};
    var item = D.find(rep.corpusId) || currentItem();
    var ring = rep.pending ? '—' : rep.overall;
    var html = '<section class="sh-report" id="report">' +
      '<div class="section-title">本次跟读报告</div>' +
      (opts.demo ? '<div class="demo-flag">示例报告 · 仅用于查看反馈样式，未写入学习记录</div>' : '') +
      '<div class="sh-band' + (rep.pending ? ' pending' : '') + '">' +
        '<div class="ring"><div class="center"><div class="num">' + ring + '</div><div class="cap">' + (rep.pending ? 'PENDING' : '参考分 / 100') + '</div></div></div>' +
        '<div><h3>' + esc(item.title) + (rep.pending ? ' · 评分暂缓' : ' · 跟读反馈') + '</h3>' +
        '<p>' + esc(verdict(rep)) + '</p></div></div>' +
      '<div class="sdim-grid">' + rep.dims.map(function (d) {
        return '<div class="sdim d-' + d.key + (d.score == null ? ' null' : '') + '">' +
          '<div class="sc">' + (d.score == null ? '—' : d.score) + (d.score == null ? '' : '<small>/100 · 权重 ' + Math.round(d.weight * 100) + '%</small>') + '</div>' +
          '<div class="nm">' + esc(d.name) + '</div><div class="en">' + esc(d.en) + ' · ' + esc(d.source) + '</div>' +
          '<ul>' + d.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>';
      }).join('') + '</div>' +
      '<div class="small muted mt8">依据来源：RHY / PAU / INT 来自原始音频的声学指标；TXT 仅在有识别转写或自填文本时计算，缺项时总分按其余维度权重折算。</div>';

    if (!rep.pending && metrics) html += renderWave(rep, metrics, item);
    if (rep.keep) html += '<div class="keep-box">' + esc(rep.keep) + '</div>';

    html += '<div class="section-title">优先改进 · 共 ' + rep.issues.length + ' 条</div>';
    if (!rep.issues.length) {
      html += '<div class="card empty">音频不足，暂不生成改进建议。补录后会自动给出带数字依据与片段定位的建议。</div>';
    } else {
      html += rep.issues.map(function (iss, i) {
        var canPlay = !!audioRec(audioId);
        return '<div class="issue"><div class="issue-head">' +
          '<span class="issue-lv lv-' + iss.level + '">' + (iss.level === 'high' ? '优先' : iss.level === 'medium' ? '建议' : '巩固') + '</span>' +
          '<span class="issue-title">' + (i + 1) + '. ' + esc(iss.title) + '</span>' + pill(iss.dim) + '</div>' +
          '<div class="issue-ev"><b>依据：</b>' + esc(iss.evidence) + '</div>' +
          '<div class="quote">对应文本：' + esc(iss.quote) + '</div>' +
          '<div class="issue-act"><b>怎么练：</b>' + esc(iss.action) + '</div>' +
          '<div class="issue-meta">复练目标：' + esc(iss.focus) + ' ｜ 片段 ' + fmtS(iss.audioStart) + '–' + fmtS(iss.audioEnd) + ' ｜ ' + esc(iss.id) + '</div>' +
          '<div class="issue-foot">' +
            '<button class="btn sm" data-act="playIssue" data-idx="' + i + '"' + (canPlay ? '' : ' disabled') + '>🔊 听这段 ' + fmtS(iss.audioStart) + '–' + fmtS(iss.audioEnd) + '</button>' +
            '<button class="btn sm soft" data-act="drillBy" data-drill="' + esc(iss.drillId) + '">按「' + esc(D.drill(iss.drillId).name) + '」再练</button>' +
            (canPlay ? '' : '<span class="small muted">请在提交这段录音的浏览器中回听</span>') +
          '</div></div>';
      }).join('');
    }

    if (rep.nextStep) {
      html += '<div class="next-card"><h4>下一步练什么 → ' + esc(rep.nextStep.drillName) + '</h4>' +
        '<p>' + esc(rep.nextStep.reason) + '<br>建议动作：保持同一条语料「' + esc(item.title) + '」，切换训练模式后再录一次，直接对比两次报告里的该维度分数。</p>' +
        '<div class="mt12 flex gap8 wrap"><button class="btn primary sm" data-act="drillBy" data-drill="' + esc(rep.nextStep.drillId) + '">按此模式再练 →</button>' +
        '<button class="btn sm" data-act="goLibrary">去语料库挑一条</button></div></div>';
    }
    html += '<div class="disclaimer mt16"><b>关于这份分数</b>' + esc(rep.disclaimer) +
      ' 录音保存在提交时的浏览器，刷新后可以回听。跟读反馈在本机生成，练习报告同步到账号。</div>';
    html += '</section>';
    return html;
  }

  /* ==================== 视图：今日跟读 ==================== */
  function heroHtml() {
    var info = D.dayInfo(state.day), n = Math.min(3, doneCount());
    var d = new Date();
    return '<div class="sh-hero"><h1>Day ' + state.day + ' · ' + esc(info.theme) + ' <span style="font-size:14px;opacity:.8;font-weight:600">' + esc(info.en) + '</span></h1>' +
      '<p>' + d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 今日目标：' + esc(info.goal) +
      '。三条语料分别对应 Part 1 短答 / Part 2 长答 / Part 3 论述，录音后提交，可查看本地跟读反馈。示例音频用于演示，自己的录音计入学习记录。</p>' +
      '<div class="sh-hero-row"><div class="sh-prog"><div class="sh-prog-top"><span>今日跟读进度</span><span>' + n + ' / 3 条</span></div>' +
      '<div class="bar"><i style="width:' + (n / 3 * 100) + '%"></i></div></div>' +
      '<div class="sh-streak"><b>' + state.db.streak.days + '</b><span>连续打卡（天）</span></div>' +
      '<div class="sh-hero-btns">' +
      '<button class="btn outline sm" data-act="sampleGood">▶ 示例音频 · 读得不错</button>' +
      '<button class="btn outline sm" data-act="sampleWeak">▶ 示例音频 · 需要改进</button>' +
      '<button class="btn sm" data-act="demoReport">载入示例报告</button>' +
      '<span class="small" style="align-self:center;opacity:.85">无麦克风也能跑通完整评分链路</span>' +
      '</div></div></div>';
  }
  function corpusListHtml() {
    return '<div class="section-title">今日 3 条语料</div><div class="corpus-list">' +
      D.byDay(state.day).map(function (c, i) {
        var sc = scoreOf(c.id), done = todayTask().done.indexOf(c.id) >= 0;
        return '<button class="corpus-card' + (state.corpusId === c.id ? ' sel' : '') + '" data-act="select" data-id="' + c.id + '">' +
          '<div class="corpus-head">' + pill(c.part, c.part === 'P1' ? 'blue' : c.part === 'P2' ? 'green' : 'orange') +
          '<span class="corpus-title">' + (i + 1) + '. ' + esc(c.title) + '</span>' +
          (done ? '<span class="corpus-score">✓ ' + (sc == null ? '已完成' : sc + ' 分') + '</span>' : '') + '</div>' +
          '<div class="corpus-meta">' + esc(c.focus.join(' · ')) + ' ｜ 示范 ' + c.wpm + ' 词/分 ｜ 难度 ' + '★'.repeat(c.level) + '</div></button>';
      }).join('') + '</div>';
  }
  function practicePanelHtml() {
    var item = currentItem(), p = E.parseCorpus(item), drill = D.drill(state.drillId);
    var pend = state.pending, m = pend && pend.metrics;
    var html = '<div class="card"><div class="card-head"><div>' +
      '<div class="card-title">' + esc(item.title) + '</div>' +
      '<div class="card-sub">' + esc(item.theme) + ' · ' + p.wc + ' 词 / 约 ' + E.r1(p.expectedSec) + ' 秒 · ' + esc(item.id) + '</div></div>' +
      pill(item.part + ' · ' + item.focus.join(' / '), 'blue') + '</div>' +
      '<div class="marked">' + markedHtml(item) + '<div class="marked-zh">' + esc(item.zh) + '</div></div>' +
      '<div class="tip-list">' + tipsHtml(item) + '</div>' +
      '<div class="vocab-row">' + vocabHtml(item) + '</div>' +
      '<div class="divider"></div>' +
      '<div class="label">① 听示范 / 跟读</div>' +
      '<div class="control-bar">' +
        '<div class="seg"><button data-act="speed" data-v="0.75" class="' + (state.rate === 0.75 ? 'on' : '') + '">0.75×</button>' +
        '<button data-act="speed" data-v="0.9" class="' + (state.rate === 0.9 ? 'on' : '') + '">0.9×</button>' +
        '<button data-act="speed" data-v="1" class="' + (state.rate === 1 ? 'on' : '') + '">1.0×</button>' +
        '<button data-act="speed" data-v="1.1" class="' + (state.rate === 1.1 ? 'on' : '') + '">1.1×</button></div>' +
        '<button class="btn primary sm" data-act="playAll">▶ 整段示范</button>' +
        '<button class="btn sm" data-act="playClause">▤ 逐句播放</button>' +
        '<button class="btn sm" data-act="playChunk">⏸ 意群停顿</button>' +
        '<button class="btn sm" data-act="playShadow">👥 影子跟读</button>' +
        '<button class="btn sm ghost" data-act="stopAudio">■ 停止</button>' +
        '<select class="sh-select" id="drillSelect">' + D.DRILLS.map(function (x) {
          return '<option value="' + x.id + '"' + (x.id === state.drillId ? ' selected' : '') + '>' + x.name + '</option>';
        }).join('') + '</select></div>' +
      '<div class="play-status' + (state.playStatus ? ' on' : '') + '">' + esc(state.playStatus) + '</div>' +
      '<div class="small muted">' + esc(drill.icon + ' ' + drill.desc) + '（示范朗读使用浏览器内置英文语音，无需联网下载音频）</div>' +
      '<div class="divider"></div>' +
      '<div class="label">② 跟读文本（可选，用于「文本完整度」维度）</div>' +
      '<textarea class="textarea" id="transcript" rows="2" placeholder="录音时若浏览器提供实时语音识别会自动填入；也可以把自己说的内容粘贴到这里。留空则该维度记为「未评估」，总分按其余三项折算。">' + esc(state.transcript) + '</textarea>' +
      '<div class="small muted mt8">留空不会拉低分数，也不会猜测补分。</div>' +
      '<div class="divider"></div>' +
      '<div class="label">③ 现场录一遍（无麦克风可用顶部「示例音频」）</div>' +
      '<div class="rec-wrap"><div class="rec-row">' +
        '<button class="rec-btn' + (state.recording ? ' on' : '') + '" data-act="rec"' + (state.micOpening ? ' disabled' : '') + '>' + (state.recording ? '■' : '🎙') + '</button>' +
        '<div class="grow"><div class="flex between"><span class="small" style="font-weight:700">' + (state.recording ? '录音中 · 请朗读上面的语料' : '现场录一遍') + '</span>' +
        '<span class="timer mono" id="recTimer">' + fmtS(state.recSeconds) + '</span></div>' +
        '<div class="bar mt8"><i id="recProg" style="width:' + Math.min(100, state.recSeconds / Math.max(1, p.expectedSec) * 100) + '%"></i></div>' +
        '<div class="small muted mt8" id="recLive">' + (state.recording ? '进度条对齐本条预期时长 ' + E.r1(p.expectedSec) + ' 秒' : '需要 https / localhost 与麦克风授权；不可用请点顶部的示例音频') + '</div></div>' +
        (state.recording ? '<button class="btn sm danger" data-act="recStop">停止并使用</button>' : '') +
      '</div></div>';

    if (pend) {
      var bad = m && !m.usable;
      html += '<div class="audio-ready' + (bad ? ' bad' : '') + '"><span class="nm">🎵 ' + esc(pend.name) + '</span>' +
        '<span class="mt">' + (pend.size / 1024).toFixed(0) + ' KB' + (m ? ' ｜ ' +
          (m.usable ? m.durationSec + ' 秒 ｜ 有效发声 ' + Math.round(m.speechRatio * 100) + '% · ' + m.syllableCount + ' 个音节核' : esc(m.reason)) : ' 解码中…') + '</span>' +
        '<button class="btn sm" data-act="preview">🔊 试听</button>' +
        '<button class="btn sm ghost" data-act="clearAudio">移除</button></div>';
    }
    html += '<div class="submit-row"><button class="btn primary lg" data-act="submit"' + (!m || pend.submitted || pend.saving ? ' disabled' : '') + '>' + (pend && pend.submitted ? '已保存评分' : '开始评分 →') + '</button>' +
      '<span class="small muted">' + (m ? (m.usable ? '音频已就绪，评分全部在本机完成' : '音频不足，仍可提交查看「评分暂缓」报告') : '录一段音频或点顶部示例音频后即可评分') + '</span></div>' +
      '</div>';
    return html;
  }
  function tasksHtml() {
    var t = todayTask(), list = D.byDay(state.day);
    return '<div class="card"><div class="card-title">今日任务</div><div class="card-sub">完成 3 条语料的跟读与评分</div>' +
      '<div class="mt12">' + list.map(function (c) {
        var done = t.done.indexOf(c.id) >= 0;
        return '<div class="task' + (done ? ' done' : '') + '"><div class="task-check">' + (done ? '✓' : '') + '</div>' +
          '<span class="task-name">' + c.part + ' · ' + esc(c.title) + '</span>' +
          (!done ? '<button class="btn sm" data-act="select" data-id="' + c.id + '">去练</button>' : '<span class="small muted">已完成</span>') + '</div>';
      }).join('') + '</div>' +
      '<div class="bar mt12"><i style="width:' + (Math.min(3, t.done.length) / 3 * 100) + '%"></i></div>' +
      '<div class="small muted mt8">' + Math.min(3, t.done.length) + '/3 已完成 · 全部完成记 1 天连续打卡</div></div>';
  }
  function curveSvg() {
    var pts = state.db.curve.slice(-7);
    if (!pts.length) return '<div class="empty" style="padding:18px">还没有评分记录，完成一次跟读后这里会出现分数曲线</div>';
    var W = 270, H = 110, L = 22, R = W - 10, T = 12, B = H - 22;
    var xy = function (i, v) { return [L + (pts.length === 1 ? (R - L) / 2 : i / (pts.length - 1) * (R - L)), B - v / 100 * (B - T)]; };
    var line = pts.map(function (p, i) { var q = xy(i, p.score); return (i ? 'L' : 'M') + E.r1(q[0]) + ' ' + E.r1(q[1]); }).join(' ');
    var dots = pts.map(function (p, i) {
      var q = xy(i, p.score);
      return '<circle cx="' + E.r1(q[0]) + '" cy="' + E.r1(q[1]) + '" r="3.4" fill="#5b5bf0"/>' +
        '<text x="' + E.r1(q[0]) + '" y="' + E.r1(q[1] - 8) + '" font-size="9" fill="#4a5474" text-anchor="middle">' + p.score + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '"><line x1="' + L + '" y1="' + B + '" x2="' + R + '" y2="' + B + '" stroke="#e8ecf6"/>' +
      '<line x1="' + L + '" y1="' + T + '" x2="' + R + '" y2="' + T + '" stroke="#f0f2fa" stroke-dasharray="3 4"/>' +
      '<text x="2" y="' + (T + 4) + '" font-size="9" fill="#8892ad">100</text>' +
      '<text x="6" y="' + (B + 3) + '" font-size="9" fill="#8892ad">0</text>' +
      '<path d="' + line + '" fill="none" stroke="#5b5bf0" stroke-width="2.2" stroke-linejoin="round"/>' + dots + '</svg>';
  }
  function statsHtml() {
    var ss = state.db.sessions.filter(function (s) { return !s.pending; });
    var avg = ss.length ? Math.round(ss.reduce(function (a, s) { return a + s.overall; }, 0) / ss.length) : 0;
    var best = ss.length ? Math.max.apply(null, ss.map(function (s) { return s.overall; })) : 0;
    return '<div class="card"><div class="card-title">学习进展</div>' +
      '<div class="rail-stat"><div><b>' + ss.length + '</b><span>累计评分</span></div><div><b>' + avg + '</b><span>平均分</span></div><div><b>' + best + '</b><span>最佳分</span></div></div>' +
      '<div class="card-sub mt16">最近 7 次跟读分数</div><div class="curve">' + curveSvg() + '</div></div>';
  }
  function drillCardHtml() {
    return '<div class="card"><div class="card-title">训练模式</div><div class="card-sub">切换后示范语速与提示会同步变化</div>' +
      '<div class="mt12">' + D.DRILLS.map(function (x) {
        return '<button class="btn sm' + (x.id === state.drillId ? ' soft' : ' ghost') + '" style="margin:0 5px 6px 0" data-act="setDrill" data-drill="' + x.id + '">' +
          x.icon + ' ' + esc(x.name) + '</button>';
      }).join('') + '</div><div class="small muted mt8">' + esc(D.drill(state.drillId).desc) + '</div></div>';
  }
  function disclaimerHtml() {
    return '<div class="disclaimer"><b>评分口径（请先读）</b>本页是本地可解释的韵律 / 节奏评估：从你的录音原始音频里计算语速、有效发声、停顿落点、音节节奏、音量动态与基频走向，再对照语料的示范节奏给分。它<b>不判断单个音素是否标准</b>，也不等同官方 IELTS 发音评分；文本维度只在提供转写时计算。所有计算在本机完成，音频不上传。</div>';
  }
  function renderPractice() {
    var rep = state.report, metrics = state.reportMetrics;
    view.innerHTML = heroHtml() + '<div class="sh-layout mt16"><div>' +
      corpusListHtml() + practicePanelHtml() +
      (rep ? renderReport(rep, metrics, state.reportAudioId, { demo: state.demoMode }) : '') +
      '</div><div class="sh-rail">' + tasksHtml() + statsHtml() + drillCardHtml() + disclaimerHtml() + '</div></div>';
  }

  /* ==================== 视图：语料库 ==================== */
  function renderLibrary() {
    var day = state.libDay || state.day, info = D.dayInfo(day);
    view.innerHTML = '<div class="section-title" style="margin-top:4px">语料库 · 7 天学习计划</div>' +
      '<div class="small muted">共 21 条学术类雅思口语语料，按 Part 1 / 2 / 3 编排。标记说明：<em class="st">下划线加粗</em>＝重音词，<span class="ln">word‿word</span>＝连读，<span class="br">⏸ 意群</span>＝预期停顿。</div>' +
      '<div class="day-tabs mt16">' + D.DAYS.map(function (x) {
        return '<button class="day-tab' + (x.day === day ? ' on' : '') + '" data-act="libDay" data-day="' + x.day + '">Day ' + x.day + ' · ' + esc(x.theme) + '<small>' + esc(x.goal) + '</small></button>';
      }).join('') + '</div>' +
      '<div class="card" style="margin-bottom:16px;background:linear-gradient(120deg,#f7f7ff,#f2fbfb)"><div class="card-title">Day ' + day + ' · ' + esc(info.en) + '</div>' +
      '<div class="card-sub">' + esc(info.goal) + ' ｜ 3 条语料，按短答 → 长答 → 论述递进</div></div>' +
      D.byDay(day).map(function (c) {
        var done = state.db.tasks[today()] && state.db.tasks[today()].done.indexOf(c.id) >= 0;
        return '<div class="lib-card"><div class="lib-head">' + pill(c.part, c.part === 'P1' ? 'blue' : c.part === 'P2' ? 'green' : 'orange') +
          '<span class="lib-title">' + esc(c.title) + '</span>' + (done ? pill('今日已完成', 'green') : '') +
          '<button class="btn primary sm" data-act="practiceThis" data-id="' + c.id + '" data-day="' + day + '">去练这条 →</button></div>' +
          '<div class="marked">' + markedHtml(c) + '<div class="marked-zh">' + esc(c.zh) + '</div></div>' +
          '<div class="tip-list">' + tipsHtml(c) + '</div><div class="vocab-row">' + vocabHtml(c) + '</div>' +
          '<div class="small muted mt12">' + esc(c.id) + ' ｜ 示范 ' + c.wpm + ' 词/分 ｜ 训练目标：' + esc(c.focus.join(' · ')) + '</div></div>';
      }).join('');
  }

  /* ==================== 视图：跟读记录 ==================== */
  function historyReport(s) {
    return {
      id: s.reportId, sessionId: s.id, corpusId: s.corpusId, pending: !!s.pending,
      overall: s.overall, band: s.band, dims: s.dims, issues: s.issues,
      keep: s.keep, nextStep: s.nextStep, disclaimer: s.disclaimer || '本地可解释韵律评估，非官方 IELTS 评分。'
    };
  }
  function renderHistory() {
    var ss = state.db.sessions;
    var head = '<div class="section-title" style="margin-top:4px">跟读记录</div>' +
      '<div class="small muted">按账号隔离，共 ' + ss.length + ' 条。报告、指标与建议同步到账号；原声保存在提交时的浏览器，可刷新后回听。</div>';
    if (!ss.length) {
      view.innerHTML = head + '<div class="card empty mt16">还没有跟读记录。去「今日跟读」选一条语料，现场录一遍或点顶部示例音频即可生成第一份报告。</div>';
      return;
    }
    view.innerHTML = head + '<div class="mt16">' + ss.map(function (s) {
      var open = !!state.histOpen[s.id];
      var item = D.find(s.corpusId);
      var canPlay = !!audioRec(s.audioId);
      return '<div class="hist-item"><div class="hist-head">' +
        '<span class="hist-score">' + (s.pending ? '—' : s.overall) + '</span>' +
        '<span class="small muted">' + (s.pending ? '评分暂缓' : '本地跟读练习') + '</span>' +
        '<span class="list-title">' + esc(s.corpusTitle || (item ? item.title : s.corpusId)) + '</span>' +
        pill(s.part || (item ? item.part : 'P1'), 'blue') +
        '<span class="small muted">' + fmtDate(s.createdAt) + '</span>' +
        '<button class="btn sm" data-act="histToggle" data-id="' + s.id + '">' + (open ? '收起' : '查看报告') + '</button></div>' +
        '<div class="hist-bars">' + s.dims.map(function (d) {
          return '<div class="hist-bar">' + esc(d.key) + ' ' + (d.score == null ? '—' : d.score) +
            '<i><b style="width:' + (d.score == null ? 0 : d.score) + '%"></b></i></div>';
        }).join('') + '</div>' +
        '<div class="list-body">' + (s.issues.length ? '优先问题：' + esc(s.issues[0].title) : '音频不足，未生成建议') +
          ' ｜ 音频：' + esc(s.audioName || '—') + (canPlay ? '（可回听）' : '（请在原提交浏览器回听）') +
          ' ｜ ' + esc(s.id) + '</div>' +
        (open ? '<div class="divider"></div>' + renderReport(historyReport(s), s.metrics, s.audioId, { embedded: true }) +
          '<div class="flex gap8 mt8 wrap">' +
          '<button class="btn sm soft" data-act="practiceThis" data-id="' + s.corpusId + '" data-day="' + (item ? item.day : state.day) + '">再练这条 →</button></div>' : '') +
        '</div>';
    }).join('') + '</div>' +
      '<div class="mt16"><button class="btn sm danger" data-act="clearHistory">清空本账号跟读记录</button></div>';
  }

  /* ==================== 账号弹窗 ==================== */
  function accountModal() {
    var list = users();
    modalInner.innerHTML = '<div class="modal-head"><h3>账号 · 学习记录按账号隔离</h3><button class="btn sm" data-act="closeModal">关闭</button></div>' +
      '<div class="modal-body"><div class="label">切换账号</div>' +
      list.map(function (u) {
        return '<button class="btn sm' + (u.id === state.user.id ? ' soft' : '') + '" style="margin:0 6px 6px 0" data-act="switchUser" data-id="' + esc(u.id) + '">' +
          esc(u.name) + (u.id === state.user.id ? '（当前）' : '') + '</button>';
      }).join('') +
      '<div class="divider"></div><div class="label">新建账号（第 7 天验收可用新账号从零开始）</div>' +
      '<div class="flex gap8"><input class="input" id="newUserName" placeholder="例如：验收账号 B"><button class="btn primary" data-act="newUser">创建并切换</button></div>' +
      '<div class="small muted mt12">当前账号：' + esc(state.user.id) + ' ｜ 存储键 ' + esc(keyOf(state.user.id)) + '</div></div>';
    modalEl.classList.remove('hidden');
  }

  /* ==================== 事件 ==================== */
  function render() {
    updateChrome();
    if (state.view === 'practice') renderPractice();
    else if (state.view === 'library') renderLibrary();
    else renderHistory();
    /* 嵌入总站时宿主用的是二级页签，靠这条消息把「我在哪一页」告诉它 */
    if (window.SL.dailyHost.embedded) {
      window.parent.postMessage({ source: 'ielts-speaking', type: 'view', view: state.view }, location.origin);
    }
  }
  document.addEventListener('click', function (e) {
    var nav = e.target.closest('[data-nav]');
    if (nav && nav.classList.contains('nav-btn')) { stopPlay(); state.view = nav.getAttribute('data-nav'); render(); return; }
    if (e.target.closest && e.target.closest('#accountBtn')) { accountModal(); return; }
    if (e.target === modalEl) { modalEl.classList.add('hidden'); return; }
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act'), id = el.getAttribute('data-id'), v;
    switch (act) {
      case 'closeModal': modalEl.classList.add('hidden'); break;
      case 'switchUser':
        localStorage.setItem(LS_LAST, id); boot(); modalEl.classList.add('hidden'); toast('已切换账号'); break;
      case 'newUser': {
        var nm = ($('#newUserName') || {}).value || '';
        nm = nm.trim() || ('学员 ' + (users().length + 1));
        var u = { id: E.uid('U'), name: nm }, l = users();
        l.push(u); saveUsers(l); localStorage.setItem(LS_LAST, u.id);
        modalEl.classList.add('hidden'); boot(); toast('已创建并切换到「' + nm + '」，记录从零开始'); break;
      }
      case 'select':
        stopPlay(); busy(false); state.transcript = ''; busy(false); state.transcript = ''; state.corpusId = id; state.pending = null; state.report = null;
        state.reportMetrics = null; state.reportAudioId = ''; state.view = 'practice'; render(); break;
      case 'speed': state.rate = parseFloat(el.getAttribute('data-v')); render(); break;
      case 'playAll': playAll(); break;
      case 'playClause': playClauses('clause'); break;
      case 'playChunk': playClauses('chunk'); break;
      case 'playShadow': playClauses('shadow'); break;
      case 'stopAudio': stopPlay(); toast('已停止播放'); break;
      case 'setDrill':
      case 'drillBy': {
        v = el.getAttribute('data-drill');
        state.drillId = v; state.rate = D.drill(v).rate;
        state.pending = null; state.report = null; state.reportMetrics = null;
        state.view = 'practice'; render();
        toast('已切换为「' + D.drill(v).name + '」：' + D.drill(v).desc);
        setTimeout(function () { window.scrollTo({ top: 0, behavior: 'smooth' }); }, 60);
        break;
      }
      case 'submit': submit(false); break;
      case 'demoReport': loadDemoReport(); break;
      case 'sampleGood': runSample(false); break;
      case 'sampleWeak': runSample(true); break;
      case 'preview': {
        var pr = state.pending;
        if (pr) A.playSegment(pr.url, 0, 0, function () {});
        break;
      }
      case 'clearAudio':
        if (state.pending && state.pending.url) URL.revokeObjectURL(state.pending.url);
        state.pending = null; state.report = null; state.reportMetrics = null; busy(false); render(); break;
      case 'rec': state.recording ? stopRec() : startRec(); break;
      case 'recStop': stopRec(); break;
      case 'playIssue': {
        var rep = activeReport(), idx = parseInt(el.getAttribute('data-idx'), 10);
        if (!rep || !rep.issues[idx]) return;
        var iss = rep.issues[idx], rec = audioRec(activeAudioId());
        if (!rec) { toast('这段录音本体未保存（刷新后不保留）。\n请在本次会话内回听，或重新录一遍。'); return; }
        A.playSegment(rec.url, iss.audioStart, iss.audioEnd, function (s) {
          if (s && s.error) toast(s.error);
          else if (s && s.playing) toast('正在回放 ' + fmtS(iss.audioStart) + '–' + fmtS(iss.audioEnd) + '：' + iss.title);
        });
        break;
      }
      case 'goLibrary': state.libDay = state.day; state.view = 'library'; render(); break;
      case 'libDay': state.libDay = parseInt(el.getAttribute('data-day'), 10); render(); break;
      case 'practiceThis':
        stopPlay();
        state.day = parseInt(el.getAttribute('data-day'), 10);
        busy(false); state.transcript = ''; state.corpusId = id; state.pending = null; state.report = null; state.reportMetrics = null;
        state.view = 'practice'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'histToggle': state.histOpen[id] = !state.histOpen[id]; render(); break;
      case 'clearHistory':
        if (!window.confirm('确定清空当前账号的全部跟读记录？此操作不可恢复。')) return;
        dropAudio(state.db.sessions); state.db = emptyDb(); saveDb(); state.report = null; render(); toast('已清空'); break;
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'transcript') state.transcript = e.target.value;
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'drillSelect') {
      state.drillId = e.target.value; state.rate = D.drill(state.drillId).rate; render();
    }
  });

  /* 宿主的一级/二级页签点击：直接切视图，不重载 iframe */
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    if (e.data && e.data.source === 'ielts-coach' && e.data.type === 'go' && window.SL.shadowApp) {
      window.SL.shadowApp.setView(e.data.view);
    }
  });

  /* 给宿主用的一层薄接口：只暴露「切到哪个视图」，不改任何业务状态 */
  window.SL = window.SL || {};
  SL.shadowApp = {
    setView: function (name) {
      if (['practice', 'library', 'history'].indexOf(name) < 0) return;
      stopPlay();
      state.view = name;
      if (name === 'library' && !state.libDay) state.libDay = state.day;
      render();
    }
  };

  /* 宿主指定的首屏视图（地址栏里的 dailyView）：在 boot 里渲染之前先生效，
     这样「语料库」直接打开就是语料库，不会先闪一下今日跟读。 */
  if (SL.dailyHost && SL.dailyHost.wantedView) state.view = SL.dailyHost.wantedView;

  boot();
})();
