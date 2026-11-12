// Derive timing from the waveform. Activity includes non-speech sounds, so
// these measurements cannot identify pronunciation errors or rate an accent.
const modelRate = 16000;
const maxClipSeconds = 20;
const frameSeconds = .02;
const minPauseSeconds = .6;

async function decodeMono(blob) {
  if (!blob?.size || typeof blob.arrayBuffer !== 'function') throw new Error('这段录音没有可读取的数据。');
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) throw new Error('此浏览器不支持本地音频解码。');
  // decodeAudioData resamples to this context's sample rate. Downmix the
  // decoded channels explicitly because it retains the original channel count.
  const context = new Offline(1, 1, modelRate);
  let buffer;
  try {
    buffer = await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error('此浏览器无法解码这段录音。');
  }
  if (!buffer.length || buffer.sampleRate !== modelRate) throw new Error('音频解码结果不完整。');
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channel = buffer.getChannelData(ch);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / buffer.numberOfChannels;
  }
  return mono;
}

function measure(samples) {
  const duration = samples.length / modelRate;
  const frame = Math.round(modelRate * frameSeconds);
  const levels = [];
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(samples.length, start + frame);
    let sum = 0, squares = 0;
    for (let n = start; n < end; n++) {
      sum += samples[n];
      squares += samples[n] * samples[n];
    }
    const size = end - start;
    levels.push(Math.sqrt(Math.max(0, squares / size - (sum / size) ** 2)));
  }
  const sorted = [...levels].sort((a,b) => a - b);
  const low = sorted[Math.floor(sorted.length * .15)] || 0;
  const high = sorted[Math.floor(sorted.length * .98)] || 0;
  const threshold = Math.max(.004, high * .075, Math.min(low * 2.3, high * .45));
  const windows = [];
  // Drop isolated clicks, then bridge brief gaps between syllables.
  for (let i = 0; i < levels.length;) {
    if (levels[i] < threshold) { i++; continue; }
    const first = i;
    while (i < levels.length && levels[i] >= threshold) i++;
    if (i - first < 3) continue;
    const start = first * frameSeconds, end = Math.min(duration, i * frameSeconds);
    const previous = windows.at(-1);
    if (previous && start - previous.end <= .181) previous.end = end;
    else windows.push({ start, end });
  }
  const activeSeconds = windows.reduce((total, w) => total + w.end - w.start, 0);
  const usable = activeSeconds >= .35;
  let pauseCount = 0, longestPause = 0;
  if (usable) for (let i = 1; i < windows.length; i++) {
    const gap = windows[i].start - windows[i - 1].end;
    if (gap + .001 >= minPauseSeconds) {
      pauseCount++;
      longestPause = Math.max(longestPause, gap);
    }
  }
  return {duration, activeSeconds, longestPause, pauseCount, windows, usable};
}

export async function inspectRecording(blob) {
  return measure(await decodeMono(blob));
}

function representativeClip(samples, stats) {
  const {duration, windows} = stats;
  const first = Math.max(0, windows[0].start - .12);
  const last = Math.min(duration, windows.at(-1).end + .12);
  const length = Math.min(maxClipSeconds, last - first);
  let bestStart = first, bestCoverage = -1;
  // Coverage of a sliding interval only changes slope at these boundaries.
  // A two-pointer scan avoids repeatedly walking every active window.
  const boundaries = [first, last - length];
  for (const w of windows) boundaries.push(w.start, w.end - length);
  boundaries.sort((a,b) => a - b);
  let left = 0, right = 0, cumulative = 0;
  for (const start of boundaries) {
    if (start < first || start > last - length) continue;
    const end = start + length;
    while (right < windows.length && windows[right].start < end) {
      cumulative += windows[right].end - windows[right].start;
      right++;
    }
    while (left < right && windows[left].end <= start) {
      cumulative -= windows[left].end - windows[left].start;
      left++;
    }
    if (right <= left) continue;
    const coverage = cumulative - Math.max(0, start - windows[left].start)
      - Math.max(0, windows[right - 1].end - end);
    if (coverage > bestCoverage + .01) { bestStart = start; bestCoverage = coverage; }
  }
  const offset = Math.round(bestStart * modelRate);
  return samples.subarray(offset, offset + Math.round(length * modelRate));
}

function encodeSamples(samples, wave = false) {
  const offset = wave ? 44 : 0;
  const bytes = new Uint8Array(offset + samples.length * 2);
  const view = new DataView(bytes.buffer);
  function ascii(offset, text) {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  }
  if (wave) {
    ascii(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, modelRate, true);
    view.setUint32(28, modelRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, samples.length * 2, true);
  }
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset + i * 2, Math.round(x * (x < 0 ? 32768 : 32767)), true);
  }
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 16384) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  }
  return btoa(chunks.join(''));
}

// The evaluation endpoints accept headerless little-endian PCM. Decoding
// first also handles recordings from browsers that produce WebM, Ogg or MP4.
export async function prepareSoeAudio(blob, seconds) {
  const mono = await decodeMono(blob);
  const excerpt = mono.subarray(0, modelRate * seconds);
  if (measure(excerpt).activeSeconds < .08) throw new Error('这段录音中未检测到足够的有效声音。请先回听或重新录音。');
  return encodeSamples(excerpt);
}

// The provider accepts at most 60 s per request. Prefer a quiet boundary and
// absorb very short tails into the previous segment where possible.
export async function prepareSoeSegments(blob) {
  const samples = await decodeMono(blob), clips=[];
  const width = 60*modelRate, step=Math.round(modelRate*.04);
  let start=0;
  while(start<samples.length) {
    let end=Math.min(start+width,samples.length);
    if(end<samples.length){
      const latest=Math.min(end,samples.length-Math.round(.25*modelRate));
      let lowest=Infinity;
      for(let offset=start+50*modelRate;offset+step<=latest;offset+=step) {
        let energy=0;
        for(let i=offset;i<offset+step;i++)energy+=samples[i]*samples[i];
        if(energy<=lowest){lowest=energy;end=offset+Math.floor(step/2);}
      }
    }
    const slice=samples.subarray(start,end), active=measure(slice).activeSeconds;
    if(slice.length>=modelRate*.2 && active>=.08) clips.push({audio:encodeSamples(slice),weight:active});
    start=end;
  }
  if(!clips.length) throw Error('这段录音中未检测到足够的有效声音，请回听或重录。');
  return {durationMs:Math.round(samples.length/modelRate*1000),clips};
}

export async function prepareModelSamples(session, loadBlob) {
  const results = [];
  const turns = Array.isArray(session?.turns) ? session.turns : [];
  for (const part of [1, 2, 3]) {
    const candidates = turns.filter(turn => Number(turn.part) === part &&
      turn.questionId && (part !== 2 || turn.phase === 'talk' || turn.questionId === 'p2-talk'));
    // Prefer a substantial turn. Fall back to another turn in the same part
    // if the selected recording is silent, missing, or cannot be decoded.
    candidates.sort((a,b) => (b.durationMs || 0) - (a.durationMs || 0));
    for (const turn of candidates) {
      let samples;
      try { samples = await decodeMono(await loadBlob(turn)); }
      catch { continue; }
      const stats = measure(samples);
      if (!stats.usable) continue;
      const clip = representativeClip(samples, stats);
      if (clip.length < modelRate) continue; // The model endpoint requires at least one second.
      results.push({questionId: turn.questionId, data: encodeSamples(clip, true)});
      break;
    }
  }
  return results;
}
