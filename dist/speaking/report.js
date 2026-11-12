import { assessSession } from './coach-engine.js';

const escaped = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const fmtBand = value => Number.isFinite(value) ? value.toFixed(1) : '待评';

export function textReport(session) {
    return assessSession({ session, turns: session.turns });
}

function dimensions(items) {
    return '<div class="dimension-grid">' + items.map(item => `<article class="dimension">
        <div><h3>${escaped(item.title)}</h3><strong>${Number.isFinite(item.metric?.value)?escaped(item.metric.value)+' / 100':item.key==='pronunciation'&&item.band==null?'见发音成绩':fmtBand(item.band)}</strong></div>
        ${item.metric?'<small>'+escaped(item.metric.label)+' · 腾讯百分制</small>':item.source==='deepseek_transcript'?'<small>文本练习参考</small>':''}
        <p>${escaped(item.evidence)}</p><p class="dimension-advice">${escaped(item.advice)}</p>
        ${item.questionId ? `<button class="text-link" data-action="evidence" data-q="${escaped(item.questionId)}">回听这一题</button>` : ''}
    </article>`).join('') + '</div>';
}

export function reportOverview(report) {
    const { metrics } = report;
    return `<section class="panel coach-report" aria-labelledby="report-title"><div class="report-summary">
        <div><h2 id="report-title">本场口语报告</h2><p>${escaped(report.summary)}</p>
        <div class="report-meta"><span>${metrics.analyzedTurns} / ${metrics.turnCount} 段含可分析文本</span><span>${metrics.wordCount} 个英语词</span>
        ${metrics.manualTurns ? `<span>${metrics.manualTurns} 段含手动转写</span>` : ''}</div></div>
        <div class="report-grade"><span>${escaped(report.bandLabel)}</span><strong>${fmtBand(report.band)}</strong></div>
    </div>${dimensions(report.dimensions)}
    ${report.limitations.length ? `<details class="report-method"><summary>估分依据与限制</summary><ul>${report.limitations.map(x => '<li>' + escaped(x) + '</li>').join('')}</ul></details>` : ''}
    </section>`;
}

export function renderExercises(items) {
    if (!items.length) return '';
    return `<section class="panel coach-exercises"><h2>下一次怎么练</h2><div class="exercise-grid">${items.map((item, i) => `<article><h3>${escaped(item.title)}</h3><p>${escaped(item.instruction)}</p><button class="text-link" type="button" data-action="drill" data-exercise="${i}">开始针对练习 →</button></article>`).join('')}</div></section>`;
}

export function turnFeedback(item, questionId) {
    if (!item) return '';
    return `<div class="turn-feedback"><dl><dt>表现</dt><dd>${escaped(item.strength)}</dd><dt>下一步</dt><dd>${escaped(item.advice)}</dd>
        ${item.example ? `<dt>参考句式</dt><dd lang="en">${escaped(item.example)}</dd>` : ''}</dl>
        <button class="text-link" type="button" data-action="drill" data-q="${escaped(questionId)}">再练这道题 →</button></div>`;
}

export function acousticResult(result, questionId) {
    if (!result.usable) return '<p>有效声音太少，建议检查麦克风后重新作答。</p>';
    const seconds = n => Number(n).toFixed(1) + ' 秒';
    return `<dl class="sound-metrics"><div><dt>录音长度</dt><dd>${seconds(result.duration)}</dd></div><div><dt>有声区间</dt><dd>${seconds(result.activeSeconds)}</dd></div>
    <div><dt>较长停顿</dt><dd>${result.pauseCount} 处</dd></div><div><dt>最长停顿</dt><dd>${seconds(result.longestPause)}</dd></div></dl>
    ${result.windows.length ? `<div class="pause-points">${result.windows.slice(0, 5).map(w => `<button type="button" class="btn btn-secondary btn-small" data-action="seek" data-q="${escaped(questionId)}" data-start="${Number(w.start)}">回听 ${seconds(w.start)} – ${seconds(w.end)}</button>`).join('')}</div>` : ''}<p class="note">按录音音量估计有声与停顿区间，环境噪声会影响检测。</p>`;
}

export function modelResult(report) {
    const source=report.source?.kind==='deepseek_text_tencent_soe'?'DeepSeek 文本分析 + 腾讯 SOE / PCM 指标':'历史练习报告';
    return `<div class="report-summary"><div><h2>组合式口语练习报告</h2><p>${escaped(report.summary)}</p><small>${escaped(source)} · 录音不发送给 DeepSeek</small></div><div class="report-grade"><span>不同口径分项呈现</span><strong>—</strong></div></div>
        ${dimensions(report.dimensions)}<details class="report-method"><summary>来源与练习换算说明</summary><p>${escaped(report.source?.conversion||'历史报告请结合原始来源查看。')}</p><ul>${(report.limitations||['练习参考，不是正式雅思成绩。']).map(note=>'<li>'+escaped(note)+'</li>').join('')}</ul></details>`;
}

export function progressChart(points) {
    if (!points.length) return '<p class="note">还没有可绘制的腾讯准确度记录。完成模考的自动评测并生成组合式练习反馈后，可在这里查看百分制趋势。</p>';
    const coordinates = points.map((p, i) => [points.length === 1 ? 155 : 20 + i * 270 / (points.length - 1), 101 - p.value * .9]);
    const labels = points.map(p => `<li><span>${escaped(new Date(p.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }))}</span> <strong>${Number(p.value).toFixed(1)} / 100</strong></li>`).join('');
    return `<svg viewBox="0 0 310 116" class="progress-chart" aria-hidden="true">${[0,50,100].map(n => `<line x1="18" x2="303" y1="${101 - n * .9}" y2="${101 - n * .9}" stroke="#e4e2ef"/><text x="3" y="${105 - n * .9}" font-size="9" fill="#6c6d78">${n}</text>`).join('')}
        <polyline points="${coordinates.map(p => p.join(',')).join(' ')}" fill="none" stroke="#5147c9" stroke-width="2"/>
        ${coordinates.map(([x,y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#5147c9"/>`).join('')}</svg><ol class="progress-legend">${labels}</ol>`;
}
