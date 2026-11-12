// Browser-only audio services. A take owns its stream, encoder, meter and recognizer.
// Audio stays in the browser. Optional browser speech recognition may use the
// browser vendor's online speech service; ask the learner before enabling it.

const INPUT_ERRORS = {
  NotAllowedError: '麦克风权限被拒绝，请在浏览器地址栏允许使用麦克风后重试。',
  NotFoundError: '没有找到麦克风，请连接设备后重新检测。',
  NotReadableError: '无法读取麦克风，请检查系统输入设置或关闭占用麦克风的应用。',
  OverconstrainedError: '当前麦克风无法使用此录音设置，请切换输入设备后重试。',
  SecurityError: '浏览器限制了麦克风访问，请使用 HTTPS 或 localhost 打开本站。',
  AbortError: '录音已中止，请重新开始。',
};

function userError(error, fallback) {
  return new Error(INPUT_ERRORS[error?.name] || fallback, { cause: error });
}

function stopTracks(stream) {
  for (const track of stream?.getTracks() || []) track.stop();
}

function openEncoder(stream) {
  const formats = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const mimeType of formats) {
    if (!MediaRecorder.isTypeSupported?.(mimeType)) continue;
    try {
      return new MediaRecorder(stream, { mimeType });
    } catch {
      // An advertised encoder can still be unavailable for this input.
    }
  }
  return new MediaRecorder(stream);
}

function startMeter(take) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) return;
  try {
    const context = new Context();
    take.context = context;
    const source = context.createMediaStreamSource(take.stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser); // No destination connection: avoid microphone feedback.
    const buffer = new Float32Array(analyser.fftSize);
    void context.resume().catch(() => {});
    take.meter = setInterval(() => {
      if (context.state !== 'running' || !take.running) return;
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      const rms = Math.sqrt(sum / buffer.length);
      take.samples += 1;
      if (rms > 0.006) take.audibleSamples += 1;
      take.onLevel(Math.min(1, rms * 6));
    }, 60);
  } catch {
    // Recording can continue even when the browser cannot measure levels.
  }
}

function releaseMedia(take) {
  clearInterval(take.meter);
  stopTracks(take.stream);
  take.stream = null;
  if (take.context && take.context.state !== 'closed') {
    void take.context.close().catch(() => {});
  }
  take.context = null;
}

function combinedTranscript(take) {
  return [take.previousText, take.currentText].filter(Boolean).join(' ').trim();
}
function recognitionUnavailable(take) {
  if (take.recognitionError) return;
  take.recognitionError = true;
  clearTimeout(take.restart);
  // Recognition is optional; never stop or discard the independent recording.
  try { take.onError(new Error('浏览器转写暂不可用，录音仍在继续；可回听并使用腾讯发音评测。')); } catch {}
}

function startRecognition(take) {
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Recognition) return;
  try {
    const recognizer = new Recognition();
    take.recognizer = recognizer;
    recognizer.lang = 'en-GB';
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.onstart = () => { take.recognizerStarted = true; };
    recognizer.onresult = (event) => {
      if (take.discarded || take.finished) return;
      const results = Array.from(event.results);
      take.currentText = results.map(result => result[0]?.transcript?.trim()).filter(Boolean).join(' ');
      if (take.currentText) take.emptyRecognitionEnds = 0;
      take.hasInterim = results.some(result => !result.isFinal && result[0]?.transcript?.trim());
      take.onTranscript(combinedTranscript(take));
    };
    recognizer.onerror = (event) => {
      if (event.error === 'no-speech') return;
      recognitionUnavailable(take);
    };
    recognizer.onend = () => {
      take.emptyRecognitionEnds = take.currentText ? 0 : (take.emptyRecognitionEnds || 0) + 1;
      take.previousText = combinedTranscript(take);
      take.currentText = '';
      if (take.hasInterim) take.keptInterim = true;
      take.hasInterim = false;
      take.recognizerActive = false;
      if (take.finishRecognition) take.finishRecognition();
      if (!take.running || take.recognitionError || take.discarded || take.finished) return;
      if (take.emptyRecognitionEnds >= 3) { recognitionUnavailable(take); return; }
      // Some browsers stop the service after a pause even in continuous mode.
      take.restart = setTimeout(() => {
        if (!take.running) return;
        try {
          recognizer.start();
          take.recognizerActive = true;
        } catch {
          recognitionUnavailable(take);
        }
      }, Math.min(1500, 240 + take.emptyRecognitionEnds * 350));
    };
    recognizer.start();
    take.recognizerActive = true;
  } catch {
    recognitionUnavailable(take);
  }
}

function shutdownRecognition(take) {
  clearTimeout(take.restart);
  if (!take.recognizer) return;
  take.recognizer.onend = null;
  take.recognizer.onresult = null;
  take.recognizer.onerror = null;
  take.recognizer.onstart = null;
  try { take.recognizer.abort(); } catch { /* already stopped */ }
  take.recognizer = null;
}

function finishRecognition(take) {
  clearTimeout(take.restart);
  if (!take.recognizerActive || !take.recognizer) return Promise.resolve();
  return new Promise(resolve => {
    // A disconnected recognition service must never block delivery of the audio.
    const deadline = setTimeout(() => {
      take.recognitionError = true;
      resolve();
    }, 650);
    take.finishRecognition = () => { clearTimeout(deadline); resolve(); };
    try { take.recognizer.stop(); } catch { take.finishRecognition(); }
  });
}

function transcriptStatus(take, text) {
  if (!take.transcribe) return 'disabled';
  if (text) return take.recognitionError || take.keptInterim || take.hasInterim ? 'partial' : 'available';
  return take.recognizerStarted && !take.recognitionError ? 'empty' : 'unavailable';
}

export class ExamAudio {
  constructor() { this.take = null; }

  get recording() { return this.take?.running === true; }

  async start({ transcribe = false, onLevel = () => {}, onTranscript = () => {}, onError = () => {} } = {}) {
    if (this.take && !this.take.finished) throw new Error('录音设备正在使用中。');
    if (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      throw new Error('当前页面无法录音，请在支持录音的浏览器中通过 HTTPS 或 localhost 打开。');
    }
    cancelSpeech();
    const take = {
      running: false, finished: false, discarded: false,
      transcribe, onLevel, onTranscript, onError, chunks: [],
      samples: 0, audibleSamples: 0, previousText: '', currentText: '',
    };
    this.take = take;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (this.take !== take || take.discarded) {
        stopTracks(stream);
        throw new DOMException('Canceled', 'AbortError');
      }
      take.stream = stream;
      const recorder = openEncoder(stream);
      take.recorder = recorder;
      take.done = new Promise((resolve, reject) => { take.resolve = resolve; take.reject = reject; });
      // An input can disconnect before the caller has issued stop().
      void take.done.catch(() => {});
      recorder.ondataavailable = event => {
        if (!take.discarded && event.data.size) take.chunks.push(event.data);
      };
      recorder.onerror = event => this.fail(take, userError(event.error, '录音编码失败，请重新检测设备。'));
      recorder.onstop = async () => {
        clearTimeout(take.stopTimer);
        if (take.discarded || take.finished) return;
        take.running = false;
        const endedAt = take.stoppedAt ?? performance.now();
        releaseMedia(take);
        await (take.asrDone || finishRecognition(take));
        if (take.discarded || take.finished) return;
        shutdownRecognition(take);
        const mimeType = recorder.mimeType || take.chunks[0]?.type || 'application/octet-stream';
        const blob = new Blob(take.chunks, { type: mimeType });
        take.chunks.length = 0;
        if (!blob.size) {
          this.fail(take, new Error('没有收到录音数据，请重新录制。'));
          return;
        }
        const transcript = combinedTranscript(take);
        take.finished = true;
        take.resolve({
          blob, mimeType, durationMs: Math.max(1, Math.round(endedAt - take.startedAt)),
          transcript, transcriptStatus: transcriptStatus(take, transcript),
          silent: take.samples >= 5 ? take.audibleSamples < 2 : null,
        });
      };
      for (const track of stream.getAudioTracks()) {
        track.addEventListener('ended', () => {
          if (take.running) this.fail(take, new Error('麦克风连接中断，本轮请重新录制。'));
        }, { once: true });
      }
      recorder.start(250);
      take.startedAt = performance.now();
      take.running = true;
      startMeter(take);
      if (transcribe) startRecognition(take);
    } catch (error) {
      releaseMedia(take);
      shutdownRecognition(take);
      take.finished = true;
      if (this.take === take) this.take = null;
      throw userError(error, '无法启动录音，请重新选择或连接麦克风。');
    }
  }

  stop() {
    const take = this.take;
    if (!take?.done) return Promise.reject(new Error('尚未开始录音。'));
    if (take.running) {
      take.running = false;
      take.stoppedAt = performance.now();
      take.asrDone = finishRecognition(take);
      if (take.recorder.state !== 'inactive') {
        try {
          take.recorder.stop();
          take.stopTimer = setTimeout(() => this.fail(take, new Error('保存录音超时，请重新录制。')), 5000);
        } catch (error) {
          this.fail(take, userError(error, '保存录音失败，请重新录制。'));
        }
      }
    }
    return take.done;
  }

  fail(take, error) {
    if (take.finished || take.discarded) return;
    this.discard(take, error);
    take.onError(error);
  }

  discard(take, error) {
    take.running = false;
    take.discarded = true;
    take.finished = true;
    clearTimeout(take.stopTimer);
    if (take.recorder && take.recorder.state !== 'inactive') {
      try { take.recorder.stop(); } catch { /* encoder already closed */ }
    }
    shutdownRecognition(take);
    take.finishRecognition?.();
    releaseMedia(take);
    take.chunks.length = 0;
    take.reject?.(error);
  }

  cancel() {
    const take = this.take;
    this.take = null;
    if (take && !take.finished) this.discard(take, new Error('录音已取消。'));
  }
}

let activeSpeech = null;

export function cancelSpeech() {
  if (!activeSpeech) return;
  const finish = activeSpeech;
  finish(false);
  globalThis.speechSynthesis?.cancel();
}

export function speakPrompt(text) {
  cancelSpeech();
  const synthesis = globalThis.speechSynthesis;
  if (!text?.trim() || !synthesis || !globalThis.SpeechSynthesisUtterance) return Promise.resolve(false);
  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(text);
    let timer;
    const finish = played => {
      if (activeSpeech !== finish) return;
      activeSpeech = null;
      clearTimeout(timer);
      utterance.onstart = utterance.onend = utterance.onerror = null;
      resolve(played);
    };
    const timeout = () => { finish(false); synthesis.cancel(); };
    activeSpeech = finish;
    try {
      const voices = synthesis.getVoices();
      utterance.voice = voices.find(v => /^en[-_]GB/i.test(v.lang))
        || voices.find(v => /^en(?:[-_]|$)/i.test(v.lang)) || null;
      utterance.lang = utterance.voice?.lang || 'en-GB';
      utterance.rate = 0.95;
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      utterance.onstart = () => {
        clearTimeout(timer);
        timer = setTimeout(timeout, Math.max(12000, text.length * 150));
      };
      timer = setTimeout(timeout, 4000);
      synthesis.speak(utterance);
    } catch {
      finish(false);
    }
  });
}
