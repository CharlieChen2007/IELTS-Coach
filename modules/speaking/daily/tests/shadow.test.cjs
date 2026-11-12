/* 每日跟读模块 · 引擎自测（Node，无需浏览器）
 * 运行：node tests/shadow.test.js
 */
const path = require('path');
/* 模块 dist/ 内的资产按浏览器脚本编写，test 以 vm 独立上下文加载，避免 ESM 作用域把 module 判空 */
const loadAsset = require('./asset-loader.cjs');
const ROOT = path.join(__dirname, '..');
const D = loadAsset(path.join(ROOT, '../dist', 'shadow-data.js'));
const E = loadAsset(path.join(ROOT, '../dist', 'shadow-engine.js'));
/* 两个脚本共用同一 SL 命名空间：用数据模块的上下文把引擎装进去，模拟浏览器里的共享全局 */
const SL = loadAsset.SL();

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + label + (extra !== undefined ? '  → ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

/* 合成一段「类语音」信号：音节包络 + 基频轨迹 + 周期性停顿 */
function synth(opts) {
  opts = opts || {};
  const sr = 16000, dur = opts.duration || 12, base = opts.f0 || 168;
  const n = Math.floor(sr * dur), buf = new Float32Array(n);
  let t = 0, syl = 0, guard = 0;
  while (t < dur - 0.25 && guard++ < 500) {
    if (syl > 0 && syl % 8 === 0) { t += (opts.longPause || 0.46); syl = 0; }
    const on = 0.155, sylDur = 0.20, start = Math.floor(t * sr);
    for (let k = 0; k < Math.floor(on * sr) && start + k < n; k++) {
      const tt = k / sr, env = Math.sin(Math.PI * tt / on);
      const prog = (t + tt) / dur;
      const f0 = base * (1 + 0.10 * Math.sin(prog * Math.PI * 6)) * (opts.flat ? 1 : (prog > 0.88 ? 0.80 : 1));
      const ph = 2 * Math.PI * f0 * (t + tt);
      buf[start + k] = 0.34 * env * (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph))
        + (Math.random() - 0.5) * 0.003;
    }
    t += sylDur; syl++;
  }
  return { samples: buf, sr };
}

console.log('=== 一、语料库与文本解析 ===');
ok('7 天计划', D.DAYS.length === 7);
ok('21 条语料', D.CORPUS.length === 21, D.CORPUS.length);
ok('每天 3 条', D.DAYS.every(d => D.byDay(d.day).length === 3));
ok('语料 id 唯一', new Set(D.CORPUS.map(c => c.id)).size === 21);
ok('契约已挂到 SL.contract', !!(SL.contract && SL.contract.shadowModule));
ok('契约样例字段完整', !!(SL.contract.shadowModule.sample.report.issues[0].audioStart < SL.contract.shadowModule.sample.report.issues[0].audioEnd));

const it = D.find('C_D1_S1');
const p = E.parseCorpus(it);
ok('解析出词数', p.wc >= 30 && p.wc <= 45, p.wc);
ok('解析出音节数', p.totalSyll > p.wc, p.totalSyll);
ok('纯文本无标记残留', !/[*|~]/.test(p.plain), p.plain.slice(0, 60));
ok('识别出意群停顿点', p.pauseWords.length >= 3, p.pauseWords.join(','));
ok('识别出重音词', p.stressIdx.length >= 2, p.stressIdx.join(','));
ok('识别出连读块', p.links.length >= 1, p.links.join(','));
ok('预期时长按示范语速换算', Math.abs(p.expectedSec - p.wc / it.wpm * 60) < 0.2, E.r1(p.expectedSec));
const ref = E.referenceEnvelope(p, 180);
ok('节奏参考包络 180 点', ref.points.length === 180 && ref.points.every(v => v >= 0 && v <= 1));
ok('参考包络含停顿窗 / 重音时刻', ref.pauseWindows.length >= 3 && ref.stressTimes.length >= 2);

console.log('\n=== 二、真实 PCM 声学分析 ===');
const s = synth({ duration: 13, longPause: 0.46 });
const m = E.analyzePCM(s.samples, s.sr);
ok('合成音频可评估', m.usable === true, m.reason || '');
ok('时长正确', Math.abs(m.durationSec - 13) < 0.1, m.durationSec);
ok('检测到有效发声', m.speechSec > 7 && m.speechRatio > 0.5, m.speechSec + 's / ' + m.speechRatio);
ok('检测到音节核', m.syllableCount >= 35, m.syllableCount);
ok('检测到多处停顿', m.pauseCount >= 3, m.pauseCount);
ok('最长停顿量级合理', m.longestPause > 0.3 && m.longestPause < 1.0, m.longestPause);
ok('包络 180 点可用于绘图', m.envelope.length === 180);
ok('基频轨迹可用', m.f0.reliable === true && m.f0.samples > 20, JSON.stringify(m.f0));
ok('识别到句末降调', m.f0.finalDropSemi < -0.5, m.f0.finalDropSemi + ' 半音');
ok('音量动态落在可判定区间', m.dynamicDb > 3 && m.dynamicDb < 40, m.dynamicDb + ' dB');
ok('停顿有可回听定位', m.pauses.every(x => x.start >= 0 && x.end > x.start));

const silent = E.analyzePCM(new Float32Array(16000 * 2), 16000);
ok('纯静音 → 不可评估且给原因', silent.usable === false && /静音|音量|短/.test(silent.reason), silent.reason);
const tooShort = E.analyzePCM(s.samples.subarray(0, 16000), 16000);
ok('过短音频 → 不可评估', tooShort.usable === false, tooShort.reason);

console.log('\n=== 三、文本比对 ===');
const cmp = E.compareText('I usually get up at six even at weekends', 'I usually get up six even weekends');
ok('覆盖率随漏词下降', cmp.coverage > 0.7 && cmp.coverage < 1, cmp.coverage);
ok('列出漏读词', cmp.missed.indexOf('at') >= 0, cmp.missed.join(','));
ok('完全一致时覆盖率 100%', E.compareText(p.plain, p.plain).coverage === 1);

console.log('\n=== 四、评分报告 ===');
const missing = E.buildReport(it, { usable: false, reason: '未收到原始音频' }, { userId: 'U_TEST' });
ok('音频缺失 → 评分暂缓', missing.pending === true && missing.overall === null);
ok('音频缺失 → 四维全为 null', missing.dims.length === 4 && missing.dims.every(d => d.score === null));
ok('音频缺失 → 写明补录方法', missing.dims[0].reasons.some(r => r.indexOf('补录方法') >= 0));

const rep = E.buildReport(it, m, { userId: 'U_TEST', transcript: '', audioId: 'A_SAMPLE_TEST' });
ok('四维固定顺序', rep.dims.map(d => d.key).join(',') === 'RHY,PAU,INT,TXT');
ok('文本维度未评估', rep.dims[3].score === null && rep.dims[3].reasons[1].indexOf('折算') >= 0);
ok('总分按三维权重折算', (() => {
  const ws = rep.dims.filter(d => d.score !== null);
  const w = ws.reduce((a, d) => a + d.weight, 0);
  const calc = Math.round(ws.reduce((a, d) => a + d.score * d.weight, 0) / w);
  return calc === rep.overall;
})(), rep.overall);
ok('band 为 0.5 步进', rep.band * 2 === Math.round(rep.band * 2), rep.band);
ok('每条维度都有 3 条数字依据', rep.dims.every(d => d.reasons.length === 3 && d.reasons.some(r => /\d/.test(r))));
ok('生成 >= 2 条建议', rep.issues.length >= 2, rep.issues.length);
ok('建议字段完整（依据/原话/动作/定位/训练模式）', rep.issues.every(x =>
  x.id && x.evidence && x.quote && x.action && x.focus && x.drillId &&
  x.audioStart >= 0 && x.audioEnd > x.audioStart && x.audioEnd <= m.durationSec + 0.01));
ok('保留项不自相矛盾', rep.keep.indexOf('本轮相对最好') === 0, rep.keep.slice(0, 60));
ok('给出下一步训练模式', !!(rep.nextStep && rep.nextStep.drillId && rep.nextStep.reason), rep.nextStep && rep.nextStep.drillId);
ok('常驻非官方评分声明', rep.disclaimer.indexOf('不等同官方 IELTS') >= 0);
console.log('   首条建议:', rep.issues[0].title);
console.log('   依据:', rep.issues[0].evidence.slice(0, 100));

/* 动态漏掉约 1/6 的词，模拟漏读，不依赖具体语料用词 */
const thinned = p.plain.split(/\s+/).filter((_, i) => i % 6 !== 0).join(' ');
const withTxt = E.buildReport(it, m, { userId: 'U_TEST', transcript: thinned });
ok('提供转写后文本维度参与评分', withTxt.dims[3].score !== null, withTxt.dims[3].score);
ok('漏词会降低文本分', withTxt.dims[3].score < 90, withTxt.dims[3].score);
ok('文本问题生成对应建议', withTxt.issues.some(x => x.dim === 'TXT'));

console.log('\n=== 五、示例数据与全量语料回归 ===');
const good = E.demoMetrics(it, 'good'), weak = E.demoMetrics(it, 'weak');
const rg = E.buildReport(it, good, { userId: 'U_TEST' }), rw = E.buildReport(it, weak, { userId: 'U_TEST' });
ok('示例：好样本分高于弱样本', rg.overall > rw.overall, rg.overall + ' vs ' + rw.overall);
ok('示例：弱样本至少 2 条建议', rw.issues.length >= 2, rw.issues.length);
let allOk = true, err = '';
D.CORPUS.forEach(c => {
  try {
    const pp = E.parseCorpus(c);
    if (pp.wc < 15 || pp.totalSyll < pp.wc || pp.expectedSec < 5) throw new Error('解析异常');
    const rr = E.buildReport(c, E.demoMetrics(c, 'good'), { userId: 'U_TEST' });
    if (rr.overall == null || !rr.issues.length) throw new Error('报告异常');
  } catch (e) { allOk = false; err = c.id + ': ' + e.message; }
});
ok('21 条语料全部可解析并生成报告', allOk, err || '21/21');

console.log('\n=== 结果：' + pass + ' PASS / ' + fail + ' FAIL ===');
if (fail) process.exit(1);
