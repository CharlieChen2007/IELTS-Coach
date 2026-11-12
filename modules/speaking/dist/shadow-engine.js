/* =============================================================
 * SpeakLoop · 每日语料跟读模块
 * 引擎层：文本标记解析 / 音频声学分析 / 四维评分 / 证据化跟读建议
 *
 * 设计原则（与 module-contract.js 一致）：
 *  - 所有分数都来自可复算的数字，页面每条理由都能在 metrics 里找到出处
 *  - 只评估「韵律 / 节奏 / 连贯 / 语调」，不声称判断音素准确度
 *  - 文本维度缺数据时记 null 并从总分权重中剔除，绝不假造
 *  - 纯计算部分不依赖 DOM，可在 Node 下直接跑单测
 * ============================================================= */
(function (root) {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36).toUpperCase() +
      '_' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ============================================================
   * 一、语料文本解析
   * ============================================================ */
  function syllables(word) {
    var w = String(word).toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    var m = w.match(/[aeiouy]{1,2}/g);
    return clamp(m ? m.length : 1, 1, 6);
  }
  function normWord(w) { return String(w || '').toLowerCase().replace(/[^a-z0-9']/g, ''); }

  function parseCorpus(item) {
    var raw = item.en;
    var stressPhrases = (raw.match(/\*[^*]+\*/g) || []).map(function (s) { return s.slice(1, -1); });
    var links = raw.match(/[A-Za-z’']+(?:~[A-Za-z’']+)+/g) || [];

    /* 按 | 切意群，同时记录每个意群起始词序号 */
    var rawClauses = raw.split('|');
    var clauses = [], pauseWords = [], cursor = 0;
    rawClauses.forEach(function (seg, i) {
      var plainSeg = seg.replace(/\*/g, '').replace(/~/g, ' ').replace(/[—–]/g, ' ').replace(/\s+/g, ' ').trim();
      var ws = plainSeg ? plainSeg.split(/\s+/) : [];
      clauses.push({ index: i, text: plainSeg, wordStart: cursor, wordEnd: cursor + ws.length, plain: plainSeg });
      if (i > 0) pauseWords.push(cursor);
      cursor += ws.length;
    });

    var plain = raw.replace(/\*/g, '').replace(/~/g, ' ').replace(/\|/g, ' ')
      .replace(/[—–]/g, ' ').replace(/\s+/g, ' ').trim();
    var tokens = plain.split(/\s+/).filter(Boolean);
    var syll = tokens.map(syllables);
    var totalSyll = syll.reduce(function (s, n) { return s + n; }, 0);

    var stressIdx = [];
    stressPhrases.forEach(function (p) {
      var first = normWord(p.split(/\s+/)[0]);
      for (var i = 0; i < tokens.length; i++) {
        if (normWord(tokens[i]) === first && stressIdx.indexOf(i) < 0) { stressIdx.push(i); break; }
      }
    });
    var punctWords = [];
    tokens.forEach(function (t, i) { if (/[,.;:!?]["'”’]?$/.test(t)) punctWords.push(i + 1); });

    var wc = tokens.length;
    var expectedSec = clamp(wc / (item.wpm || 130) * 60, 5, 90);
    var boundaryWords = [];
    pauseWords.concat(punctWords).forEach(function (w) { if (boundaryWords.indexOf(w) < 0) boundaryWords.push(w); });
    var expectPauses = Math.max(1, boundaryWords.length);

    return {
      raw: raw, plain: plain, tokens: tokens, wc: wc, syll: syll, totalSyll: totalSyll,
      clauses: clauses, pauseWords: pauseWords, punctWords: punctWords,
      expectPauses: expectPauses, stressIdx: stressIdx, stressPhrases: stressPhrases,
      links: links, expectedSec: expectedSec, wpm: item.wpm || 130
    };
  }

  /* 按音节数把时间轴映射到词序号（用于「这一秒在念哪个词」） */
  function timeToWord(parsed, t, speechSec) {
    var total = parsed.totalSyll || 1;
    var target = clamp(t, 0, speechSec) / Math.max(0.01, speechSec) * total;
    var acc = 0;
    for (var i = 0; i < parsed.syll.length; i++) {
      acc += parsed.syll[i];
      if (target <= acc) return i;
    }
    return parsed.wc - 1;
  }
  function quoteAt(parsed, t0, t1, speechSec, pad) {
    var a = timeToWord(parsed, t0, speechSec), b = timeToWord(parsed, t1, speechSec);
    pad = pad == null ? 2 : pad;
    a = clamp(a - pad, 0, parsed.wc - 1);
    b = clamp(b + pad, 0, parsed.wc - 1);
    return parsed.tokens.slice(a, b + 1).join(' ');
  }

  /* 由文本生成的「节奏参考包络」：非真人录音，仅作对齐参考线 */
  function referenceEnvelope(parsed, n) {
    n = n || 180;
    var dur = parsed.expectedSec;
    var events = [];
    var t = 0;
    var pauseWindows = [];
    var stressTimes = [];
    var perSyll = dur / (parsed.totalSyll + parsed.expectPauses * 0.65);

    parsed.tokens.forEach(function (tok, i) {
      var s = parsed.syll[i];
      var stressed = parsed.stressIdx.indexOf(i) >= 0;
      var amp = stressed ? 0.95 : clamp(0.46 + s * 0.07 + (i % 3) * 0.035, 0.4, 0.72);
      for (var k = 0; k < s; k++) {
        events.push({ t: t + (k + 0.5) * perSyll, amp: amp * (k === 0 ? 1 : 0.82), w: perSyll * 0.62 });
      }
      if (stressed) stressTimes.push(t + perSyll * 0.5);
      t += s * perSyll;
      var boundary = parsed.punctWords.indexOf(i + 1) >= 0 || parsed.pauseWords.indexOf(i + 1) >= 0;
      if (boundary) {
        var gap = parsed.punctWords.indexOf(i + 1) >= 0 ? perSyll * 0.9 : perSyll * 0.55;
        pauseWindows.push({ start: t, end: t + gap });
        t += gap;
      }
    });
    var scale = dur / Math.max(0.01, t);

    var pts = [];
    for (var j = 0; j < n; j++) {
      var tt = j / (n - 1) * dur;
      var v = 0;
      for (var q = 0; q < events.length; q++) {
        var e = events[q];
        var d = Math.abs(tt - e.t * scale) / Math.max(0.01, e.w * scale);
        if (d < 2.2) v = Math.max(v, e.amp * Math.exp(-d * d * 1.4));
      }
      pts.push(r2(clamp(v, 0, 1)));
    }
    return {
      points: pts, durationSec: dur,
      pauseWindows: pauseWindows.map(function (p) { return { start: r2(p.start * scale), end: r2(p.end * scale) }; }),
      stressTimes: stressTimes.map(function (s) { return r2(s * scale); })
    };
  }

  /* ============================================================
   * 二、PCM 声学分析（浏览器与 Node 通用）
   * ============================================================ */
  function smooth(arr, radius) {
    var out = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      var s = 0, c = 0;
      for (var k = -radius; k <= radius; k++) {
        var j = i + k;
        if (j >= 0 && j < arr.length) { s += arr[j]; c++; }
      }
      out[i] = s / c;
    }
    return out;
  }
  function pct(sorted, p) { return sorted[clamp(Math.floor(sorted.length * p), 0, sorted.length - 1)]; }

  function f0Track(ch, sr, voiced, frameLen, frameSec) {
    var step = Math.max(1, Math.round(sr / 11000));
    var fsr = sr / step;
    var dec = new Float32Array(Math.floor(ch.length / step));
    for (var i = 0; i < dec.length; i++) dec[i] = ch[i * step];
    var win = Math.round(fsr * 0.04), hop = Math.round(fsr * 0.06);
    var lagMin = Math.max(2, Math.round(fsr / 400)), lagMax = Math.round(fsr / 75);
    var out = [];
    for (var pos = 0; pos + win + lagMax < dec.length; pos += hop) {
      var tSec = pos * step / sr;
      var fi = Math.floor(tSec / frameSec);
      if (!voiced[fi]) continue;
      var mean = 0;
      for (var a = 0; a < win; a++) mean += dec[pos + a];
      mean /= win;
      var best = 0, bestLag = 0;
      for (var lag = lagMin; lag <= lagMax; lag++) {
        var num = 0, d1 = 0, d2 = 0;
        for (var k = 0; k < win; k += 2) {
          var x = dec[pos + k] - mean, y = dec[pos + k + lag] - mean;
          num += x * y; d1 += x * x; d2 += y * y;
        }
        var corr = num / Math.sqrt(d1 * d2 + 1e-12);
        if (corr > best) { best = corr; bestLag = lag; }
      }
      if (best > 0.42 && bestLag) out.push({ t: tSec, hz: fsr / bestLag });
    }
    var cands = out.map(function (o) { return o.hz; }).filter(function (h) { return h > 70 && h < 380; });
    if (cands.length < 8) {
      return { samples: cands.length, median: 0, rangeSemi: 0, finalDropSemi: 0, reliable: false };
    }
    /* 八度校正：自相关偶尔会锁到半频/倍频，把偏离中位数 >6 半音的点折回同一八度 */
    var medHz = pct(cands.slice().sort(function (a, b) { return a - b; }), 0.5);
    var track = [];
    out.forEach(function (o) {
      if (o.hz <= 70 || o.hz >= 380) return;
      var h = o.hz, delta = 12 * Math.log2(h / medHz);
      while (delta > 6) { h /= 2; delta -= 12; }
      while (delta < -6) { h *= 2; delta += 12; }
      track.push({ t: o.t, hz: h });
    });
    var semi = track.map(function (o) { return 12 * Math.log2(o.hz / 100); });
    var ss = semi.slice().sort(function (a, b) { return a - b; });
    var med = pct(ss, 0.5);
    var rangeSemi = pct(ss, 0.85) - pct(ss, 0.15);
    var dur = ch.length / sr;
    var tail = track.filter(function (o) { return o.t >= dur - 0.75; });
    var tailSemi = tail.length ? tail.reduce(function (s, o) { return s + 12 * Math.log2(o.hz / 100); }, 0) / tail.length : med;
    return {
      samples: track.length, median: Math.round(100 * Math.pow(2, med / 12)),
      rangeSemi: r1(rangeSemi), finalDropSemi: r1(tailSemi - med), reliable: true
    };
  }

  function analyzePCM(ch, sr) {
    var frame = Math.max(128, Math.round(sr * 0.02));
    var frameSec = frame / sr;
    var frames = Math.floor(ch.length / frame);
    var durationSec = ch.length / sr;
    if (frames < 10 || durationSec < 0.5) {
      return { usable: false, reason: '音频过短（' + r1(durationSec) + ' 秒），至少需要 3 秒有效语音' };
    }
    var rms = new Array(frames), peak = 0, clipped = 0;
    for (var f = 0; f < frames; f++) {
      var sum = 0;
      for (var i = 0; i < frame; i++) {
        var v = ch[f * frame + i];
        sum += v * v;
        var av = Math.abs(v);
        if (av > peak) peak = av;
        if (av > 0.985) clipped++;
      }
      rms[f] = Math.sqrt(sum / frame);
    }
    var sm = smooth(rms, 2);
    var sorted = sm.slice().sort(function (a, b) { return a - b; });
    var p10 = pct(sorted, 0.10), p90 = pct(sorted, 0.90), pk = pct(sorted, 0.99) || 1e-6;
    var thr = Math.max(p10 + (pk - p10) * 0.13, pk * 0.09, 0.0015);
    var voiced = sm.map(function (v) { return v > thr; });

    /* 形态学：填 <100ms 空隙，去 <80ms 语音岛 */
    var gapMax = 5, islandMin = 4;
    var k = 0;
    while (k < voiced.length) {
      if (voiced[k]) { k++; continue; }
      var st = k; while (k < voiced.length && !voiced[k]) k++;
      if (k - st <= gapMax && st > 0 && k < voiced.length) {
        for (var g = st; g < k; g++) voiced[g] = true;
      }
    }
    k = 0;
    while (k < voiced.length) {
      if (!voiced[k]) { k++; continue; }
      var s0 = k; while (k < voiced.length && voiced[k]) k++;
      if (k - s0 < islandMin) { for (var h = s0; h < k; h++) voiced[h] = false; }
    }

    /* 语音段 / 停顿 */
    var segments = [], pauses = [], cur = null, speechFrames = 0;
    for (var q = 0; q < voiced.length; q++) {
      if (voiced[q]) {
        speechFrames++;
        if (!cur) cur = { start: q * frameSec, end: (q + 1) * frameSec };
        else cur.end = (q + 1) * frameSec;
      } else if (cur) { segments.push(cur); cur = null; }
    }
    if (cur) segments.push(cur);
    for (var z = 1; z < segments.length; z++) {
      var st2 = segments[z - 1].end, en2 = segments[z].start;
      if (en2 - st2 >= 0.18) pauses.push({ start: r2(st2), end: r2(en2), dur: r2(en2 - st2) });
    }
    var speechSec = segments.reduce(function (s, g) { return s + (g.end - g.start); }, 0);
    var speechRatio = speechSec / durationSec;
    var longest = pauses.slice().sort(function (a, b) { return b.dur - a.dur; })[0] || { start: 0, end: 0, dur: 0 };

    /* 音节核：平滑包络上的局部极大值 */
    var nuclei = [], lastT = -1;
    for (var m = 2; m < sm.length - 2; m++) {
      if (!voiced[m] || sm[m] < thr) continue;
      if (sm[m] < sm[m - 1] || sm[m] < sm[m + 1] || sm[m] < sm[m - 2] || sm[m] < sm[m + 2]) continue;
      var t = m * frameSec;
      if (t - lastT < 0.115) continue;
      var valley = Math.min(sm[m - 3] || sm[m], sm[m + 3] || sm[m]);
      if (sm[m] - valley < (pk - p10) * 0.055) continue;
      nuclei.push({ t: r2(t), amp: r2(clamp(sm[m] / pk, 0, 1)) });
      lastT = t;
    }

    /* 1.5 秒窗口音节速率波动 + 最快/最慢窗口 */
    var winSec = 1.5, winCount = Math.ceil(durationSec / winSec), counts = [];
    for (var w = 0; w < winCount; w++) {
      counts.push(nuclei.filter(function (n) { return n.t >= w * winSec && n.t < (w + 1) * winSec; }).length / Math.min(winSec, Math.max(0.2, durationSec - w * winSec)));
    }
    var valid = counts.filter(function (_, idx) { return idx * winSec + 0.5 < durationSec; });
    var cMean = valid.reduce(function (s, v) { return s + v; }, 0) / Math.max(1, valid.length);
    var cVar = valid.reduce(function (s, v) { return s + (v - cMean) * (v - cMean); }, 0) / Math.max(1, valid.length);
    var rateCV = cMean > 0.01 ? Math.sqrt(cVar) / cMean : 1;
    var maxI = 0, minI = 0;
    valid.forEach(function (v, idx) { if (v > valid[maxI]) maxI = idx; if (v < valid[minI]) minI = idx; });

    /* 基频 */
    var f0 = f0Track(ch, sr, voiced, frame, frameSec);

    /* 归一化包络（绘图用） */
    var envN = 180, envRaw = [];
    for (var e = 0; e < envN; e++) {
      var fi2 = Math.min(frames - 1, Math.floor(e / envN * frames));
      envRaw.push(clamp(sm[fi2] / pk, 0, 1));
    }
    /* 绘图用包络做轻度平滑；评分始终使用未平滑的原始帧数据 */
    var envelope = smooth(envRaw, 2).map(function (v) { return r2(clamp(v, 0, 1)); });

    /* 动态范围只统计「有声帧」：数字静音段会把 p10 拉到 0，算出上百 dB 的假起伏 */
    var voicedRms = [];
    for (var vi = 0; vi < sm.length; vi++) if (voiced[vi]) voicedRms.push(sm[vi]);
    voicedRms.sort(function (a, b) { return a - b; });
    var vp15 = voicedRms.length ? pct(voicedRms, 0.15) : p10;
    var vp90 = voicedRms.length ? pct(voicedRms, 0.90) : p90;
    var dynFloor = Math.max(vp15, pk * 0.02, 1e-5);
    var dynamicDb = r1(clamp(20 * Math.log10(Math.max(vp90, 1e-6) / dynFloor), 0, 30));
    var clipping = clipped / Math.max(1, ch.length);
    var usable = durationSec >= 3 && speechSec >= 2.2 && speechRatio >= 0.18 && peak >= 0.012;
    var reason = '';
    if (!usable) {
      if (durationSec < 3) reason = '录音仅 ' + r1(durationSec) + ' 秒，短于可评估下限（3 秒）';
      else if (peak < 0.012) reason = '录音音量过低（峰值 ' + r2(peak) + '），无法分析韵律';
      else reason = '有效发声仅 ' + Math.round(speechRatio * 100) + '%（' + r1(speechSec) + ' 秒），几乎全是静音';
    }

    return {
      usable: usable, reason: reason,
      durationSec: r2(durationSec), speechSec: r2(speechSec), speechRatio: r2(speechRatio),
      longestPause: r2(longest.dur), longestPauseAt: r2(longest.start),
      pauseCount: pauses.length, pauses: pauses,
      syllableCount: nuclei.length, nuclei: nuclei,
      syllableRate: r2(nuclei.length / Math.max(0.1, speechSec)), rateCV: r2(rateCV),
      fastWindow: { start: r2(maxI * winSec), end: r2(Math.min(durationSec, (maxI + 1) * winSec)) },
      slowWindow: { start: r2(minI * winSec), end: r2(Math.min(durationSec, (minI + 1) * winSec)) },
      f0: f0, dynamicDb: dynamicDb, peak: r2(peak), clipping: r2(clipping),
      envelope: envelope, segments: segments.map(function (g) { return { start: r2(g.start), end: r2(g.end) }; }),
      frames: frames, sampleRate: sr
    };
  }

  /* 浏览器：录音 Blob → PCM → metrics */
  function decodeAudio(blob) {
    var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return Promise.resolve({ usable: false, reason: '当前浏览器不支持 Web Audio 解码，请换用 Chrome / Edge' });
    if (!blob) return Promise.resolve({ usable: false, reason: '没有收到音频' });
    var ctx = new AC();
    var read = blob.arrayBuffer ? blob.arrayBuffer() : new Promise(function (res, rej) {
      var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsArrayBuffer(blob);
    });
    return read.then(function (arr) {
      return ctx.decodeAudioData(arr.slice ? arr.slice(0) : arr);
    }).then(function (buf) {
      var ch = buf.getChannelData(0);
      var m = analyzePCM(ch, buf.sampleRate);
      try { ctx.close(); } catch (e) {}
      return m;
    }).catch(function (e) {
      try { ctx.close(); } catch (e2) {}
      return { usable: false, reason: '音频解码失败（' + (e && e.message ? e.message : '格式不支持') + '）。请用 .wav / .mp3 / .m4a / .webm' };
    });
  }

  /* ============================================================
   * 三、文本比对（可选维度）
   * ============================================================ */
  function compareText(ref, hyp) {
    var a = String(ref || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
    var b = String(hyp || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (!a.length || !b.length) return { coverage: 0, matched: [], missed: a, extra: b };
    var n = a.length, m = b.length;
    var dp = [], i, j;
    for (i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
    var matched = [], missed = [], extra = [];
    i = n; j = m;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) { matched.unshift(a[i - 1]); i--; j--; }
      else if (dp[i - 1][j] >= dp[i][j - 1]) { missed.unshift(a[i - 1]); i--; }
      else { extra.unshift(b[j - 1]); j--; }
    }
    while (i > 0) { missed.unshift(a[i - 1]); i--; }
    while (j > 0) { extra.unshift(b[j - 1]); j--; }
    return { coverage: r2(dp[n][m] / n), matched: matched, missed: missed, extra: extra };
  }

  /* ============================================================
   * 四、四维评分
   * ============================================================ */
  var WEIGHTS = { RHY: 0.30, PAU: 0.28, INT: 0.27, TXT: 0.15 };
  var DIM_META = [
    { key: 'RHY', name: '节奏与语速', en: 'Rhythm & Pace', source: '原始音频' },
    { key: 'PAU', name: '连贯与停顿', en: 'Pausing & Flow', source: '原始音频' },
    { key: 'INT', name: '重音与语调', en: 'Stress & Intonation', source: '原始音频' },
    { key: 'TXT', name: '文本完整度', en: 'Text Coverage', source: '识别转写 / 自填文本' }
  ];

  function pauseAlignment(parsed, metrics) {
    if (!metrics.pauses.length) return 0;
    var expected = parsed.pauseWords.concat(parsed.punctWords);
    if (!expected.length) return 0.6;
    var hit = 0;
    metrics.pauses.forEach(function (p) {
      var wi = timeToWord(parsed, (p.start + p.end) / 2, metrics.speechSec);
      var best = Math.min.apply(null, expected.map(function (e) { return Math.abs(e - wi); }));
      if (best <= 2) hit++;
    });
    return hit / metrics.pauses.length;
  }

  function scoreDims(parsed, metrics, opts) {
    opts = opts || {};
    var wc = parsed.wc;
    var wpmEff = wc / Math.max(0.5, metrics.speechSec) * 60;
    var rateRatio = wpmEff / parsed.wpm;
    var rateScore = clamp(100 - Math.abs(Math.log(clamp(rateRatio, 0.05, 20))) * 92, 0, 100);
    var durRatio = metrics.durationSec / parsed.expectedSec;
    var durScore = clamp(100 - Math.abs(Math.log(clamp(durRatio, 0.05, 20))) * 68, 0, 100);
    var stabScore = clamp(100 - metrics.rateCV * 125, 0, 100);
    var rhy = clamp(rateScore * 0.48 + durScore * 0.27 + stabScore * 0.25, 0, 100);

    var srScore = clamp(100 - Math.abs(metrics.speechRatio - 0.78) * 185, 0, 100);
    var lp = metrics.longestPause;
    var longScore = lp <= 0.8 ? 100 : clamp(100 - (lp - 0.8) * 47, 12, 100);
    var expP = parsed.expectPauses;
    var over = Math.max(0, metrics.pauseCount - expP * 1.6);
    var under = Math.max(0, expP * 0.35 - metrics.pauseCount);
    var countScore = clamp(100 - over * 8.5 - under * 7, 0, 100);
    var align = pauseAlignment(parsed, metrics);
    var alignScore = clamp(align * 100, 0, 100);
    var pau = clamp(srScore * 0.30 + longScore * 0.36 + countScore * 0.19 + alignScore * 0.15, 0, 100);

    var db = metrics.dynamicDb;
    var dynScore = db < 4 ? clamp(28 + db * 8, 0, 100) : (db <= 20 ? clamp(100 - Math.abs(db - 12) * 3.4, 0, 100) : clamp(100 - (db - 20) * 2.5, 40, 100));
    var f0 = metrics.f0 || { reliable: false, rangeSemi: 0, finalDropSemi: 0, samples: 0 };
    var rangeScore = f0.rangeSemi < 1.5 ? 35 : clamp(100 - Math.abs(f0.rangeSemi - 6) * 9, 0, 100);
    var drop = f0.finalDropSemi;
    var dropScore = drop <= -1.2 ? 100 : (drop < 0.4 ? clamp(72 + (-drop) * 20, 0, 100) : 42);
    var qualityScore = clamp(100 - metrics.clipping * 600 - (metrics.peak < 0.05 ? 22 : 0), 0, 100);
    var intScore = f0.reliable
      ? clamp(dynScore * 0.34 + rangeScore * 0.28 + dropScore * 0.22 + qualityScore * 0.16, 0, 100)
      : clamp(dynScore * 0.62 + qualityScore * 0.38, 0, 100);

    var txt = null, cmp = null;
    if (opts.transcript && String(opts.transcript).trim()) {
      cmp = compareText(parsed.plain, opts.transcript);
      txt = clamp(cmp.coverage * 100 - cmp.extra.length * 1.2, 0, 100);
    }

    var vals = { RHY: rhy, PAU: pau, INT: intScore, TXT: txt };
    var dims = DIM_META.map(function (meta) {
      var d = {
        key: meta.key, name: meta.name, en: meta.en,
        score: vals[meta.key] == null ? null : Math.round(vals[meta.key]),
        weight: WEIGHTS[meta.key], source: meta.source, reasons: []
      };
      if (meta.key === 'RHY') {
        d.reasons = [
          '有效发声 ' + metrics.speechSec + ' 秒 / ' + wc + ' 词 → ' + Math.round(wpmEff) + ' 词/分，示范 ' + parsed.wpm + ' 词/分（偏差 ' + Math.round((rateRatio - 1) * 100) + '%）',
          '总时长 ' + metrics.durationSec + ' 秒，按示范语速预期 ' + r1(parsed.expectedSec) + ' 秒',
          '检测到 ' + metrics.syllableCount + ' 个音节核，速率 ' + metrics.syllableRate + ' 音节/秒，1.5 秒窗口波动 CV=' + metrics.rateCV
        ];
      } else if (meta.key === 'PAU') {
        d.reasons = [
          '有效发声占比 ' + Math.round(metrics.speechRatio * 100) + '%（参考区间 70–85%），最长停顿 ' + metrics.longestPause + ' 秒 @ ' + metrics.longestPauseAt + 's',
          '检测到 ' + metrics.pauseCount + ' 处 ≥0.18 秒停顿；按标点与意群标记预期约 ' + expP + ' 处',
          '停顿落在标点 / 意群边界附近的比例 ' + Math.round(align * 100) + '%'
        ];
      } else if (meta.key === 'INT') {
        d.reasons = [
          '音量动态范围 ' + db + ' dB（' + (db < 6 ? '偏平，重音不突出' : db > 20 ? '起伏过大' : '起伏自然') + '），峰值 ' + metrics.peak + '，削波 ' + r1(metrics.clipping * 100) + '%',
          f0.reliable
            ? '基频样本 ' + f0.samples + ' 个，音高跨度 ' + f0.rangeSemi + ' 半音（参考 3–9），中位 ' + f0.median + ' Hz'
            : '基频样本不足（' + f0.samples + ' 个），本项不报音高结论，仅按音量动态与录音质量评估',
          f0.reliable ? '句末音高变化 ' + f0.finalDropSemi + ' 半音（负值＝降调收束）' : '如需语调结论，请用更清晰、无伴奏的朗读音频'
        ];
      } else {
        d.reasons = txt == null ? [
          '本次识别转写 0 词，原文共 ' + parsed.wc + ' 词；该维度没有输入数据',
          '记为「未评估」，总分改由其余 3 项（权重合计 ' + r2(1 - WEIGHTS.TXT) + '）折算，不会用猜测补分',
          '补法：录音时允许浏览器语音识别，或在提交前把自己所说的内容粘贴进「跟读文本」框'
        ] : [
          '识别到 ' + cmp.matched.length + ' / ' + parsed.wc + ' 个原词，覆盖率 ' + Math.round(cmp.coverage * 100) + '%',
          cmp.missed.length ? '漏读 / 未识别：' + cmp.missed.slice(0, 8).join(', ') + (cmp.missed.length > 8 ? ' …' : '') : '未发现漏读',
          cmp.extra.length ? '多出 / 疑似替换：' + cmp.extra.slice(0, 6).join(', ') : '未发现明显多读'
        ];
      }
      return d;
    });
    return { dims: dims, align: align, cmp: cmp, wpmEff: Math.round(wpmEff), rateRatio: r2(rateRatio), db: db, f0: f0 };
  }

  function bandOf(score) {
    if (score == null) return null;
    return clamp(Math.round((3.5 + score / 100 * 5) * 2) / 2, 4, 9);
  }

  /* ============================================================
   * 五、证据化跟读建议
   * ============================================================ */
  function buildIssues(parsed, metrics, scored, item) {
    var out = [];
    var quote = function (t0, t1) { return quoteAt(parsed, t0, t1, metrics.speechSec, 2); };
    var add = function (o) {
      out.push({
        id: uid('ISS_SH'), dim: o.dim, level: o.level, title: o.title, evidence: o.evidence,
        quote: o.quote || parsed.tokens.slice(0, 9).join(' '), action: o.action,
        focus: o.focus, audioStart: r2(o.a0), audioEnd: r2(o.a1), drillId: o.drillId
      });
    };

    if (metrics.longestPause > 0.9) {
      add({
        dim: 'PAU', level: 'high',
        title: '有 ' + metrics.longestPause + ' 秒长停顿，意群在这里断开了',
        evidence: '最长停顿 ' + metrics.longestPause + ' 秒（' + metrics.longestPauseAt + '–' + r1(metrics.longestPauseAt + metrics.longestPause) + 's），建议上限 0.8 秒；有效发声占比 ' + Math.round(metrics.speechRatio * 100) + '%',
        quote: quote(metrics.longestPauseAt - 1.4, metrics.longestPauseAt),
        action: '回到这个意群边界，只停 0.4 秒：先不出声地把下一组词在心里过一遍再开口。用「意群停顿」模式按 | 标记重读本条 2 遍，第二次把最长停顿压到 0.8 秒以内。',
        focus: '把最长停顿压到 0.8 秒以内',
        a0: Math.max(0, metrics.longestPauseAt - 0.8), a1: metrics.longestPauseAt + metrics.longestPause + 0.5,
        drillId: 'chunk'
      });
    }
    if (Math.abs(Math.log(scored.rateRatio)) > 0.22) {
      var fast = scored.rateRatio > 1;
      var win = fast ? metrics.fastWindow : metrics.slowWindow;
      add({
        dim: 'RHY', level: 'high',
        title: fast ? '整体语速偏快 ' + Math.round((scored.rateRatio - 1) * 100) + '%，音节被挤掉了' : '整体语速偏慢 ' + Math.round((1 - scored.rateRatio) * 100) + '%，节奏拖沓',
        evidence: '有效语速 ' + scored.wpmEff + ' 词/分，示范 ' + parsed.wpm + ' 词/分；' + (fast ? '最密' : '最疏') + '的 1.5 秒在 ' + win.start + '–' + win.end + 's，检测到 ' + metrics.syllableCount + ' 个音节核',
        quote: quote(win.start, win.end),
        action: fast
          ? '用「慢速拆解」0.75× 听一遍，标出所有 ~ 连读处；再跟着节拍器以每拍一个重音词的速度读，重点不是变慢，而是把 *标记* 的词读完整。'
          : '用「影子跟读」模式，示范结束立刻同步复述，不留准备时间；目标是让词块之间不断线，而不是单纯提高音量。',
        focus: fast ? '把有效语速降到 ' + Math.round(parsed.wpm * 0.95) + ' 词/分左右' : '把有效语速提到 ' + Math.round(parsed.wpm * 0.95) + ' 词/分左右',
        a0: win.start, a1: win.end, drillId: fast ? 'slow' : 'shadow'
      });
    }
    if (scored.f0 && scored.f0.reliable && (scored.f0.rangeSemi < 3 || scored.f0.finalDropSemi > -0.4)) {
      add({
        dim: 'INT', level: 'medium',
        title: scored.f0.rangeSemi < 3 ? '音高跨度只有 ' + scored.f0.rangeSemi + ' 半音，听起来偏平' : '句尾音高没有落下来（' + scored.f0.finalDropSemi + ' 半音）',
        evidence: '基频样本 ' + scored.f0.samples + ' 个，跨度 ' + scored.f0.rangeSemi + ' 半音（参考 3–9），句末变化 ' + scored.f0.finalDropSemi + ' 半音，中位音高 ' + scored.f0.median + ' Hz',
        quote: parsed.clauses[parsed.clauses.length - 1].text,
        action: '用「重音对比」模式重读本条：只把 *' + (parsed.stressPhrases[0] || '焦点词') + '* 这类标记词的音高抬起来，其余部分主动压低；最后一句从倒数第三个词开始把音高稳步降到底，不要上扬。',
        focus: '让句末出现可测的降调（≤ -1.2 半音）',
        a0: Math.max(0, metrics.durationSec * 0.68), a1: metrics.durationSec, drillId: 'stress'
      });
    }
    if (scored.db < 6) {
      add({
        dim: 'INT', level: 'medium',
        title: '音量动态只有 ' + scored.db + ' dB，重音词没被突出',
        evidence: '音量动态范围 ' + scored.db + ' dB（参考 6–18 dB），峰值 ' + metrics.peak + '，各音节核能量接近',
        quote: parsed.stressPhrases.length ? parsed.stressPhrases.slice(0, 4).join(' / ') : quote(0, 2),
        action: '别靠"整体变大声"，靠对比：把 *标记* 的重音词时长拉长约 20%，前后词组压短压轻。用「重音对比」模式读 2 遍并再录一次，看动态范围是否进入 6–18 dB。',
        focus: '把音量动态范围提到 6 dB 以上',
        a0: 0, a1: Math.min(metrics.durationSec, 6), drillId: 'stress'
      });
    }
    if (scored.align < 0.45 && metrics.pauseCount >= 3) {
      add({
        dim: 'PAU', level: 'medium',
        title: '停顿位置偏离标点 / 意群（对齐率 ' + Math.round(scored.align * 100) + '%）',
        evidence: '共 ' + metrics.pauseCount + ' 处停顿，只有 ' + Math.round(scored.align * 100) + '% 落在文本标点或 | 标记附近，预期约 ' + parsed.expectPauses + ' 处',
        quote: quote(metrics.pauses[0].start - 0.8, metrics.pauses[0].end + 0.8),
        action: '打印或直接看着屏幕上的 | 标记，只在标记处换气，词组中间即使想不起下一个词也用延长音拖住，不要停。用「意群停顿」模式练 2 遍。',
        focus: '让 ≥70% 的停顿落在意群边界',
        a0: Math.max(0, metrics.pauses[0].start - 0.6), a1: metrics.pauses[0].end + 1.2, drillId: 'chunk'
      });
    }
    if (scored.cmp && scored.cmp.coverage < 0.94 && scored.cmp.missed.length >= 2) {
      var missed = scored.cmp.missed.slice(0, 6).join(', ');
      add({
        dim: 'TXT', level: 'high',
        title: '文本覆盖率 ' + Math.round(scored.cmp.coverage * 100) + '%，有词被跳过或吞掉',
        evidence: '原文 ' + parsed.wc + ' 词，识别到 ' + scored.cmp.matched.length + ' 词；漏读：' + (missed || '无') + (scored.cmp.extra.length ? '；多出：' + scored.cmp.extra.slice(0, 4).join(', ') : ''),
        quote: missed || quote(0, 2),
        action: '先用「慢速拆解」0.75× 把漏掉的词单独念 3 遍，再整句连回去。特别注意 ~ 连读处的两个词都要在，别合并成一个。',
        focus: '文本覆盖率提到 90% 以上',
        a0: 0, a1: Math.min(metrics.durationSec, 8), drillId: 'slow'
      });
    }
    if (metrics.rateCV > 0.38) {
      add({
        dim: 'RHY', level: 'low',
        title: '节奏忽快忽慢（波动 CV=' + metrics.rateCV + '）',
        evidence: '1.5 秒窗口音节速率波动 CV=' + metrics.rateCV + '（参考 <0.35），最快窗口 ' + metrics.fastWindow.start + '–' + metrics.fastWindow.end + 's',
        quote: quote(metrics.fastWindow.start, metrics.fastWindow.end),
        action: '用「影子跟读」模式跟 3 遍，目标不是每句都快，而是每个意群内部速度稳定；可以在桌上打拍子，一个意群四拍。',
        focus: '把节奏波动 CV 压到 0.35 以下',
        a0: metrics.slowWindow.start, a1: metrics.fastWindow.end, drillId: 'shadow'
      });
    }
    if (metrics.peak < 0.06 || metrics.clipping > 0.008) {
      add({
        dim: 'INT', level: 'low',
        title: metrics.clipping > 0.008 ? '录音有削波（' + r1(metrics.clipping * 100) + '%），影响能量判断' : '录音音量偏低（峰值 ' + metrics.peak + '）',
        evidence: '峰值 ' + metrics.peak + '，削波比例 ' + r1(metrics.clipping * 100) + '%，动态范围 ' + metrics.dynamicDb + ' dB',
        quote: quote(0, 2),
        action: metrics.clipping > 0.008 ? '把麦克风离嘴约一拳远、略偏 45°，或把系统输入音量调低一档后重录。' : '把麦克风靠近到约一拳距离、输入音量调高一档后重录，让峰值落在 0.1–0.6 之间。',
        focus: '获得干净可分析的音频',
        a0: 0, a1: Math.min(metrics.durationSec, 5), drillId: 'normal'
      });
    }
    /* 至少给两条可执行动作：一条改问题，一条验证改动；指标全好时给进阶压力测试，不虚构问题 */
    if (out.length < 2) {
      var scoredDims = scored.dims.filter(function (d) { return d.score != null; })
        .sort(function (a, b) { return a.score - b.score; });
      var weakest = scoredDims[0] || { key: 'RHY', name: '节奏与语速', score: 0 };
      var allGood = out.length === 0;
      add({
        dim: weakest.key, level: 'low',
        title: allGood
          ? '各维指标都在参考区间，可以做进阶压力测试'
          : '复录一次验证：只盯「' + (out[0] ? out[0].focus : weakest.name) + '」',
        evidence: '语速偏差 ' + Math.round((scored.rateRatio - 1) * 100) + '%，最长停顿 ' + metrics.longestPause +
          ' 秒，停顿对齐 ' + Math.round(scored.align * 100) + '%，音高跨度 ' + scored.f0.rangeSemi +
          ' 半音；当前最弱维度「' + weakest.name + '」' + weakest.score + ' 分',
        quote: parsed.clauses[parsed.clauses.length - 1].text,
        action: allGood
          ? '把示范语速调到 1.1×，用「影子跟读」模式连续跟 2 遍不中断，看节奏波动是否仍能保持 CV<0.35。'
          : '按上面那条的动作改完，用同一条语料再录一次；对比两次报告里的「' + weakest.name + '」分数与对应数字，确认改善后再换下一条语料。',
        focus: allGood ? '提速后仍保持稳定节奏' : '留下两次可对比的记录，确认优先问题真的改掉',
        a0: Math.max(0, metrics.durationSec * 0.5), a1: metrics.durationSec,
        drillId: allGood ? 'shadow' : 'normal'
      });
    }
    var rank = { high: 0, medium: 1, low: 2 };
    out.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
    return out.slice(0, 4);
  }

  function buildNextStep(parsed, scored, item, allDoneIds) {
    var usable = scored.dims.filter(function (d) { return d.score != null; });
    var weak = usable.slice().sort(function (a, b) { return a.score - b.score; })[0];
    var modeMap = { RHY: 'slow', PAU: 'chunk', INT: 'stress', TXT: 'slow' };
    var mode = modeMap[weak.key] || 'normal';
    return {
      dim: weak.key, dimName: weak.name, score: weak.score, drillId: mode,
      drillName: (root.SL && root.SL.shadowData ? root.SL.shadowData.drill(mode).name : '慢速拆解'),
      reason: '本轮最弱维度是「' + weak.name + '」（' + weak.score + ' 分），下一步用对应模式重练同一条语料，而不是急着换题。',
      corpusId: item.id, sameCorpus: true
    };
  }

  function buildReport(item, metrics, opts) {
    opts = opts || {};
    var parsed = parseCorpus(item);
    var report = {
      id: uid('R_SHADOW'), sessionId: uid('S_SHADOW'),
      userId: opts.userId || '', corpusId: item.id, day: item.day,
      createdAt: new Date().toISOString(),
      overall: null, band: null, pending: false,
      dims: [], issues: [], keep: '', nextStep: null,
      transcript: opts.transcript || '', audioId: opts.audioId || '',
      drillId: opts.drillId || 'normal',
      disclaimer: '本地可解释的韵律 / 节奏评估，用于跟读反馈链路；不判断音素准确度，不等同官方 IELTS 发音评分。'
    };
    if (!metrics || !metrics.usable) {
      report.pending = true;
      report.dims = DIM_META.map(function (m) {
        return {
          key: m.key, name: m.name, en: m.en, score: null, weight: WEIGHTS[m.key], source: '原始音频缺失',
          reasons: [
            (metrics && metrics.reason) || '未收到原始音频',
            '补录方法：允许麦克风后现场录一遍本条语料，或点顶部「示例音频」查看反馈样式',
            '缺少可分析音频时不计算任何维度与总分，不用文本猜测补分'
          ]
        };
      });
      report.issues = [];
      report.keep = '';
      report.disclaimer += ' 本次因音频缺失，评分暂缓。';
      return report;
    }

    var scored = scoreDims(parsed, metrics, opts);
    var wsum = 0, ssum = 0;
    scored.dims.forEach(function (d) { if (d.score != null) { wsum += d.weight; ssum += d.score * d.weight; } });
    report.overall = Math.round(ssum / Math.max(0.01, wsum));
    report.band = bandOf(report.overall);
    report.dims = scored.dims;
    report.issues = buildIssues(parsed, metrics, scored, item);
    report.nextStep = buildNextStep(parsed, scored, item, opts.doneIds || []);

    var best = scored.dims.filter(function (d) { return d.score != null; })
      .slice().sort(function (a, b) { return b.score - a.score; })[0];
    report.keep = '本轮相对最好：' + best.name + ' ' + best.score + ' 分 —— ' + best.reasons[0] +
      '。这一项先别改，把时间花在下面的优先问题上。';
    report.metricsDigest = {
      wpmEff: scored.wpmEff, rateRatio: scored.rateRatio, align: r2(scored.align),
      dynamicDb: scored.db, f0: scored.f0, longestPause: metrics.longestPause
    };
    return report;
  }

  /* 无音频时用于验收的确定性示例 metrics */
  function demoMetrics(item, quality) {
    var parsed = parseCorpus(item);
    var weak = quality === 'weak';
    var dur = r1(parsed.expectedSec * (weak ? 0.76 : 1.04));
    var speechSec = r1(dur * (weak ? 0.62 : 0.79));
    var ref = referenceEnvelope(parsed, 180);
    var envelope = ref.points.map(function (v, i) {
      var wobble = weak ? (0.22 * Math.sin(i * 0.9) + 0.14 * Math.cos(i * 0.37)) : (0.10 * Math.sin(i * 0.55));
      return r2(clamp(v * (weak ? 0.55 : 0.9) + 0.14 + wobble, 0.02, 1));
    });
    var lpAt = r1(dur * 0.44), lp = weak ? 1.62 : 0.26;
    var pauses = [], step = dur / (weak ? 9 : 6);
    for (var pi = 0; pi < (weak ? 8 : 5); pi++) {
      var isLong = weak && pi === 2;
      var ps = isLong ? lpAt : (weak && pi > 2 ? r1(lpAt + 1.62 + 0.4 + (pi - 3) * step * 0.8) : r1(step * (pi + 1) * 0.75));
      var pd = isLong ? 1.62 : (weak ? r2(0.3 + pi * 0.06) : 0.26);
      pauses.push({ start: ps, end: r1(ps + pd), dur: pd });
    }
    var longestPause = weak ? 1.62 : 0.26;
    return {
      usable: true, demo: true,
      durationSec: dur, speechSec: speechSec, speechRatio: r2(speechSec / dur),
      longestPause: longestPause, longestPauseAt: weak ? lpAt : r1(step * 3 * 0.75),
      pauseCount: pauses.length, pauses: pauses,
      syllableCount: Math.round(parsed.totalSyll * (weak ? 0.82 : 0.97)),
      nuclei: [], syllableRate: r2(parsed.totalSyll / speechSec), rateCV: weak ? 0.44 : 0.24,
      fastWindow: { start: r1(dur * 0.2), end: r1(dur * 0.2 + 1.5) },
      slowWindow: { start: lpAt, end: r1(lpAt + 1.5) },
      f0: weak
        ? { samples: 96, median: 172, rangeSemi: 2.1, finalDropSemi: 0.6, reliable: true }
        : { samples: 138, median: 168, rangeSemi: 6.4, finalDropSemi: -2.3, reliable: true },
      dynamicDb: weak ? 4.3 : 12.6, peak: weak ? 0.21 : 0.34, clipping: 0,
      envelope: envelope, segments: [], frames: 900, sampleRate: 44100
    };
  }

  var api = {
    uid: uid, esc: esc, clamp: clamp, r1: r1, r2: r2,
    parseCorpus: parseCorpus, referenceEnvelope: referenceEnvelope,
    syllables: syllables, timeToWord: timeToWord, quoteAt: quoteAt,
    analyzePCM: analyzePCM, decodeAudio: decodeAudio,
    compareText: compareText, scoreDims: scoreDims, buildIssues: buildIssues,
    buildReport: buildReport, bandOf: bandOf, demoMetrics: demoMetrics,
    WEIGHTS: WEIGHTS, DIM_META: DIM_META
  };

  root.SL = root.SL || {};
  root.SL.shadowEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
