/* SpeakLoop Demo - 音频层：录音 / 语音识别 / 英文朗读 / 声学分析 / 示例原声生成 / 片段回听 */
window.SL = window.SL || {};

SL.audio = (function () {
  'use strict';

  var rec = {
    stream: null, recorder: null, chunks: [], startedAt: 0, mime: '',
    asr: null, finalText: '', interimText: '', onText: null, running: false
  };

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }
  function asrSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
  function pickMime() {
    var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < list.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(list[i])) return list[i];
    }
    return '';
  }

  function start(opts) {
    opts = opts || {};
    rec.onText = opts.onText || null;
    rec.finalText = '';
    rec.interimText = '';
    if (!supported()) return Promise.reject(new Error('MIC_UNAVAILABLE'));
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(function (stream) {
        rec.stream = stream;
        rec.chunks = [];
        rec.mime = pickMime();
        rec.recorder = new MediaRecorder(stream, rec.mime ? { mimeType: rec.mime } : undefined);
        rec.recorder.ondataavailable = function (e) { if (e.data && e.data.size) rec.chunks.push(e.data); };
        rec.recorder.start(200);
        rec.startedAt = Date.now();
        rec.running = true;

        // 同步开启语音识别（若浏览器支持）
        if (opts.wantASR !== false && asrSupported()) {
          try {
            var R = window.SpeechRecognition || window.webkitSpeechRecognition;
            var a = new R();
            a.lang = 'en-US';
            a.continuous = true;
            a.interimResults = true;
            a.onresult = function (ev) {
              var interim = '';
              for (var i = ev.resultIndex; i < ev.results.length; i++) {
                var t = ev.results[i][0].transcript;
                if (ev.results[i].isFinal) rec.finalText += (rec.finalText ? ' ' : '') + t.trim();
                else interim += t;
              }
              rec.interimText = interim;
              if (rec.onText) rec.onText((rec.finalText + ' ' + rec.interimText).trim());
            };
            a.onerror = function () {};
            a.start();
            rec.asr = a;
          } catch (e) { rec.asr = null; }
        }
        return true;
      });
  }

  function stop() {
    if (!rec.running) return Promise.resolve({ blob: null, url: '', durationMs: 0, text: '' });
    rec.running = false;
    var elapsed = Date.now() - rec.startedAt;
    if (rec.asr) { try { rec.asr.stop(); } catch (e) {} rec.asr = null; }
    return new Promise(function (resolve) {
      var done = function () {
        if (rec.stream) { rec.stream.getTracks().forEach(function (t) { t.stop(); }); rec.stream = null; }
        var blob = rec.chunks.length ? new Blob(rec.chunks, { type: rec.mime || 'audio/webm' }) : null;
        resolve({
          blob: blob, url: blob ? URL.createObjectURL(blob) : '',
          durationMs: elapsed, text: (rec.finalText + ' ' + rec.interimText).trim(),
          mime: rec.mime
        });
      };
      try {
        rec.recorder.onstop = done;
        rec.recorder.stop();
      } catch (e) { done(); }
    });
  }

  function textOf() { return (rec.finalText + ' ' + rec.interimText).trim(); }

  /* ---------- 英文朗读（AI 用英语发问） ---------- */
  function speak(text, opt) {
    opt = opt || {};
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(String(text).replace(/["“”]/g, ''));
    u.lang = 'en-US';
    u.rate = opt.rate || 0.92;
    u.pitch = opt.pitch || 1.0;
    var voices = window.speechSynthesis.getVoices() || [];
    var en = voices.filter(function (v) { return /en(-|_)(US|GB)/i.test(v.lang); })[0];
    if (en) u.voice = en;
    if (opt.onend) u.onend = opt.onend;
    window.speechSynthesis.speak(u);
  }
  function stopSpeak() { if (window.speechSynthesis) window.speechSynthesis.cancel(); }

  /* ---------- 声学分析：发音维度只认「原始音频」 ---------- */
  function analyze(blob) {
    if (!blob) return Promise.resolve({ usable: false, reason: '没有原始音频文件' });
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.resolve({ usable: false, reason: '当前浏览器不支持音频解码' });
    var ctx = new AC();
    return blob.arrayBuffer().then(function (arr) {
      return ctx.decodeAudioData(arr.slice(0));
    }).then(function (buf) {
      var ch = buf.getChannelData(0);
      var sr = buf.sampleRate;
      var frame = Math.max(256, Math.floor(sr * 0.02)); // 20ms
      var frames = Math.floor(ch.length / frame);
      var rms = [], peak = 0, clipped = 0;
      for (var f = 0; f < frames; f++) {
        var sum = 0, p = 0;
        for (var i = 0; i < frame; i++) {
          var v = ch[f * frame + i];
          sum += v * v;
          var av = Math.abs(v);
          if (av > p) p = av;
          if (av > 0.98) clipped++;
        }
        var r = Math.sqrt(sum / frame);
        rms.push(r);
        if (p > peak) peak = p;
      }
      var thr = Math.max(0.006, peak * 0.13);
      var speechFrames = 0, run = 0, maxRun = 0;
      rms.forEach(function (r) {
        if (r > thr) { speechFrames++; run = 0; } else { run++; if (run > maxRun) maxRun = run; }
      });
      var durationSec = buf.duration;
      var speechRatio = frames ? speechFrames / frames : 0;
      var speechSec = durationSec * speechRatio;
      var longestPause = maxRun * (frame / sr);
      var clipping = ch.length ? clipped / ch.length : 0;
      var usable = durationSec >= 6 && speechRatio >= 0.12 && peak >= 0.02;
      var reason = '';
      if (!usable) {
        if (durationSec < 6) reason = '录音仅 ' + durationSec.toFixed(1) + ' 秒，短于可判定下限（6 秒）';
        else if (peak < 0.02) reason = '录音音量过低（峰值 ' + peak.toFixed(3) + '），无法判断发音';
        else reason = '有效发声占比仅 ' + Math.round(speechRatio * 100) + '%，几乎全是静音';
      }
      try { ctx.close(); } catch (e) {}
      return {
        usable: usable, reason: reason, durationSec: durationSec, speechRatio: speechRatio,
        speechSec: speechSec, longestPause: longestPause, peak: peak, clipping: clipping,
        frames: frames
      };
    }).catch(function (e) {
      return { usable: false, reason: '音频解码失败：' + (e && e.message ? e.message : '格式不支持') };
    });
  }

  /* ---------- 示例原声：本地生成类语音波形，用于无麦克风时演示「点击建议听到对应原声」 ---------- */
  function estimateSec(text, wpm) {
    var n = String(text || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(6, n / (wpm || 115) * 60);
  }
  function syllableCount(w) {
    var m = String(w).toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]+/g);
    return Math.max(1, Math.min(5, m ? m.length : 1));
  }
  function encodeWav(samples, sr) {
    var len = samples.length;
    var buf = new ArrayBuffer(44 + len * 2);
    var v = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, len * 2, true);
    for (var i = 0; i < len; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }
  function makeDemoWav(text, wpm) {
    var w = String(text || '').trim().split(/\s+/).filter(Boolean);
    var dur = estimateSec(text, wpm);
    var sr = 16000;
    var out = new Float32Array(Math.floor(dur * sr));
    var per = (dur - 0.5) / Math.max(1, w.length);
    var cursor = 0.25;
    for (var i = 0; i < w.length; i++) {
      var word = w[i];
      var syll = syllableCount(word);
      var seg = per / syll;
      for (var s = 0; s < syll; s++) {
        var sd = seg * 0.82;
        var f0 = 108 + 42 * Math.sin(i * 0.53 + s * 0.9) + 16 * Math.sin(i * 0.17);
        var start = Math.floor(cursor * sr);
        var count = Math.floor(sd * sr);
        for (var k = 0; k < count && start + k < out.length; k++) {
          var p = k / Math.max(1, count);
          var env = Math.pow(Math.sin(Math.PI * p), 0.75) * (0.55 + 0.45 * Math.sin(p * Math.PI * 7 + s));
          var t = k / sr;
          var vib = 1 + 0.012 * Math.sin(2 * Math.PI * 5 * t);
          var val = 0.46 * Math.sin(2 * Math.PI * f0 * vib * t) +
                    0.22 * Math.sin(2 * Math.PI * f0 * 2 * t) +
                    0.09 * Math.sin(2 * Math.PI * f0 * 3 * t) +
                    0.06 * (Math.random() * 2 - 1);
          out[start + k] += val * env * 0.5;
        }
        cursor += seg;
      }
      if (/[,.!?;:]$/.test(word)) cursor += per * 0.55; else cursor += per * 0.06;
    }
    var blob = encodeWav(out, sr);
    return { blob: blob, url: URL.createObjectURL(blob), durationSec: dur, demo: true };
  }

  /* ---------- 片段回听：点击改进建议 -> 从报告里定位并播放对应原声 ---------- */
  var player = null;
  function playSegment(url, start, end, onState) {
    stopPlay();
    if (!url) { if (onState) onState({ error: '该片段没有可用原声' }); return null; }
    var a = new Audio(url);
    player = a;
    a.currentTime = Math.max(0, start || 0);
    if (onState) onState({ playing: true, start: start || 0, end: end || 0 });
    a.ontimeupdate = function () { if (end && a.currentTime >= end) { a.pause(); if (onState) onState({ playing: false }); } };
    a.onended = function () { if (onState) onState({ playing: false }); };
    a.play().catch(function (e) { if (onState) onState({ error: '播放失败：' + e.message }); });
    return a;
  }
  function stopPlay() { if (player) { try { player.pause(); } catch (e) {} player = null; } if (window.speechSynthesis) window.speechSynthesis.cancel(); }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }

  return {
    supported: supported, asrSupported: asrSupported, start: start, stop: stop, textOf: textOf,
    speak: speak, stopSpeak: stopSpeak, analyze: analyze, makeDemoWav: makeDemoWav,
    estimateSec: estimateSec, playSegment: playSegment, stopPlay: stopPlay, fmt: fmt
  };
})();
