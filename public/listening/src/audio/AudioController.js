/**
 * 音频控制器 —— 可复用的浏览器端类，只依赖一个 HTMLAudioElement，不查 DOM。
 * React / Vue 里把 <audio> 的 ref 传进来即可原样使用，配合事件回调更新自己的 UI。
 *
 * 关键点：片段回放与逐句高亮不用 timeupdate（精度仅约 250ms），
 * 改用 requestAnimationFrame 轮询 currentTime；播放区间 start-1.2s → end+0.9s，播完归位。
 */
const LEAD = 1.2;
const TAIL = 0.9;

export class AudioController {
  constructor({ audio, segments = [], on = {} } = {}) {
    if (!audio) throw new Error("AudioController 需要一个 <audio> 元素");
    this.audio = audio;
    this.segments = segments;
    this.on = on; // { time, state, segment, rangeEnd, replay }
    this.seg = null;
    this.range = null;
    this.raf = null;
    this.replay = {}; // audio_id -> 次数

    audio.addEventListener("play", () => {
      this._emit("state", { playing: true, segment: this.seg });
      this._startTick();
      if (!this.range && this.seg) {
        this.replay[this.seg] = (this.replay[this.seg] || 0) + 1;
        this._emit("replay", { segment: this.seg, count: this.replay[this.seg] });
      }
    });
    audio.addEventListener("pause", () => {
      if (!audio.paused) return;
      this._endRange();
      this._emit("state", { playing: false, segment: this.seg });
    });
    audio.addEventListener("ended", () => {
      this._endRange();
      this._emit("state", { playing: false, segment: this.seg });
    });
    audio.addEventListener("loadedmetadata", () => this._emitTime());
  }

  _emit(name, payload) {
    const fn = this.on[name];
    if (typeof fn === "function") fn(payload);
  }

  _emitTime() {
    const d = this.audio.duration || this._segMeta()?.duration || 1;
    const t = this.audio.currentTime || 0;
    this._emit("time", { current: t, duration: d, ratio: Math.min(1, t / d) });
  }

  _segMeta(id = this.seg) {
    return this.segments.find((s) => s.audio_id === id) || null;
  }

  _endRange() {
    if (!this.range) return;
    const {btn} = this.range;
    this.range = null;
    this._emit("rangeEnd", {btn});
  }

  _startTick() {
    if (this.raf) return;
    const step = () => {
      if (this.audio.paused) {
        this.raf = null;
        return;
      }
      this._emitTime();
      this._emit("tick", { current: this.audio.currentTime, segment: this.seg });
      if (this.range && this.audio.currentTime >= this.range.b) {
        this.audio.pause();
        this.audio.currentTime = this.range.a;
        const btn = this.range.btn;
        this.range = null;
        this._emit("rangeEnd", { btn });
        this._emitTime();
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  setSegments(segments) {
    this.segments = segments;
  }

  /** 切换材料。返回该段元信息，UI 据此更新标题/时长。 */
  setSegment(id) {
    const s = this._segMeta(id);
    if (!s) return null;
    this.seg = id;
    this._endRange();
    this.audio.pause();
    this.audio.src = s.url;
    this.audio.load();
    this._emit("segment", s);
    this._emit("state", { playing: false, segment: id });
    this._emitTime();
    return s;
  }

  async toggle() {
    if (this.audio.paused) {
      try {
        await this.audio.play();
      } catch (e) {
        this._emit("blocked", { error: e });
      }
    } else {
      this.audio.pause();
    }
  }

  async playFrom(seconds) {
    this._endRange();
    this.audio.currentTime = Math.max(0, seconds);
    try {
      await this.audio.play();
    } catch (e) {
      this._emit("blocked", { error: e });
    }
  }

  seekRatio(ratio) {
    this._endRange();
    const d = this.audio.duration || this._segMeta()?.duration || 0;
    this.audio.currentTime = Math.min(1, Math.max(0, ratio)) * d;
    this._emitTime();
  }

  /** 回听答案出处；必要时自动切到对应材料。btn 用于播放中改文案，播完还原。 */
  async playRange(audioId, start, end, btn = null) {
    if (btn && this.range?.btn === btn && !this.audio.paused) {
      this.audio.pause();
      this._endRange();
      return;
    }
    this._endRange();
    const a = Math.max(0, start - LEAD);
    const b = end + TAIL;

    const go = async () => {
      if (this.seg !== audioId) return;
      this.range = { a, b, btn };
      this.audio.currentTime = a;
      this._emit("rangeStart", { btn, start, end });
      try {
        await this.audio.play();
      } catch (e) {
        this._endRange();
        this._emit("blocked", { error: e });
      }
      this._startTick();
      this._emitTime();
    };

    if (this.seg !== audioId || !this.audio.src) {
      this.setSegment(audioId);
      this.audio.addEventListener("loadedmetadata", go, { once: true });
    } else {
      await go();
    }
  }

  replayCount(audioId) {
    return this.replay[audioId] || 0;
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.audio.pause();
    this.audio.removeAttribute("src");
  }
}

export const RANGE_LEAD = LEAD;
export const RANGE_TAIL = TAIL;
