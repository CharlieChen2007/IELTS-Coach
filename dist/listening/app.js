/**
 * UI 装配层（ESM）· v2
 *
 * 4 个 section 各自独立：独立作答、独立交卷、独立结果、独立错题本、独立复练。
 * 本层只渲染 DOM、收集操作、调用 PracticeRepository；判题/计分/错题规则全在服务端。
 */
import { createHttpRepository } from "./src/api/httpRepository.js";
import {prepareChoices,closePicker} from "./controls.js";
import { TAGS, QUESTION_TYPE_LABELS, tipFor, highlightQuote } from "./src/core/text.js";
import { countWords } from "./src/core/normalize.js";
function reviewRates(entries, source) {
  const rows = entries.flatMap(entry => entry.review_history || []).filter(review => review.source_type === source);
  return rows.length ? Math.round(rows.filter(row => row.result === "correct").length * 100 / rows.length) : null;
}
import { AudioController } from "./src/audio/AudioController.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const escapeHTML = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const escapeAttr = (s) => escapeHTML(s).replace(/"/g, "&quot;");
const fmt = (t) => {
  if (!isFinite(t)) return "0:00";
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const S = {
  repo: null,
  catalog: [],          // 4 个 section 的目录
  sections: {},         // practice_id -> { practice, answers, submitted, view, report, transcripts, ... }
  progress: {},         // practice_id -> { submitted, best_correct, latest_correct, ... }
  practiceId: null,     // 当前激活的 section
  wrongbook: [],        // 当前 section 的错题本
  seg: null,            // 当前音频 audio_id
  audio: null,
};

const cur = () => S.sections[S.practiceId];
const englishName = (p) => p.section_name || p.subtitle || p.title || "";
const itemsOf = () => cur().practice.items;
const itemById = (id) => itemsOf().find((i) => i.id === id);
const qno = (it) => it.number ?? itemsOf().findIndex((i) => i.id === it.id) + 1;
const answered = (it) => String(cur().answers[it.id] ?? "").trim() !== "";
const totalAnswered = () => itemsOf().filter(answered).length;
const audioIdOf = () => cur().practice.segments[0].audio_id;
const segmentOwner = (aid) => {
  for (const [pid, st] of Object.entries(S.sections)) {
    if (st.practice.segments.some((s) => s.audio_id === aid)) return pid;
  }
  return null;
};

/* ---------------------------------------------------------------- 导航 / 进度 */
function progressOf(pid) {
  return S.progress[pid] || { submitted: false, attempts: 0, best_correct: 0, latest_correct: null, latest_total: null, wrong_count: 0 };
}

function renderSectionNav() {
  const host = $("#sectionNav");
  if (!host) return;
  host.innerHTML = S.catalog.map((c) => {
    const p = progressOf(c.practice_id);
    const active = c.practice_id === S.practiceId;
    const done = p.submitted;
    const description = [c.label, c.title, c.type_label, done ? "已完成" : ""].filter(Boolean).join(" · ");
    return `<button type="button" class="sec-card ${active?"active":""}" data-sec="${escapeAttr(c.practice_id)}" aria-pressed="${active}" aria-label="${escapeAttr(description)}" title="${escapeAttr(description)}">
      <span class="sec-label">${escapeHTML(c.label)}</span><span class="sec-name">${escapeHTML(c.type_label)}</span>
      ${done?'<span class="sec-done" aria-hidden="true">✓</span>':""}</button>`;
  }).join("");
  $$("[data-sec]", host).forEach((b) => (b.onclick = () => switchSection(b.dataset.sec)));
}

function updateProgress() {
  const done = totalAnswered(), total = itemsOf().length;
  $("#answerHint").textContent = "已答 " + done + " / " + total + " 题";
  $("#answerProgress").max = total;
  $("#answerProgress").value = done;
  $("#submitBtn2").disabled = cur().submitted || cur().busy;
  $("#submitBtn2").textContent = cur().busy ? "提交中" : "提交本段并查看解析";
}

/* ---------------------------------------------------------------- 作答页 */
function cellHTML(cell, list) {
  if (cell && typeof cell === "object" && cell.blank != null) {
    const it = list.find((i) => i.blank === cell.blank);
    if (!it) return escapeHTML(String(cell.blank));
    if (cell.label) {
      return escapeHTML(cell.label).replace("______", `<span class="inline-blank">${blankHTML(it)}</span>`);
    }
    return blankHTML(it);
  }
  return escapeHTML(String(cell ?? ""));
}

function blankHTML(it) {
  const val = cur().answers[it.id] || "";
  return `<span class="blank-wrap">
    <span class="blank-num">${qno(it)}</span>
    <input class="blank-input" aria-label="第 ${qno(it)} 题答案" maxlength="160" data-item="${it.id}" value="${escapeAttr(val)}" placeholder="填写答案" autocomplete="off" spellcheck="false">
  </span>`;
}

function choiceSelectHTML(it, opts) {
  const val = cur().answers[it.id] || "";
  const useText = it.type === "word_bank_completion";
  return `<span class="blank-wrap">
    <span class="blank-num">${qno(it)}</span>
    <select class="choice-select" aria-label="第 ${qno(it)} 题答案" data-item="${it.id}">
      <option value="">选择…</option>
      ${opts.map((o) => {
        const v = useText ? o.text : o.key;
        return `<option value="${escapeAttr(v)}" ${val === v ? "selected" : ""}>${escapeHTML(o.key)} · ${escapeHTML(o.text)}</option>`;
      }).join("")}
    </select>
  </span>`;
}

function renderQuestions() {
  const p = cur().practice;
  const list = itemsOf();
  const first = qno(list[0]);
  const last = qno(list[list.length - 1]);
  $("#sectionTitle").textContent = p.type_label;
  $("#sectionIntro").textContent = p.intro;
  $("#sectionMeta").textContent = `第 ${first}–${last} 题`;

  const host = $("#questionHost");
  host.innerHTML = "";

  if (p.question_type === "table_completion") {
    const [tid, t] = Object.entries(p.tables || {})[0] || [];
    if (t) {
      const th = t.headers.map((h) => `<th>${escapeHTML(h)}</th>`).join("");
      const trs = t.rows.map((row) => `<tr>${row.map((c,i) => `<td data-heading="${escapeAttr(t.headers[i] || "")}">${cellHTML(c, list)}</td>`).join("")}</tr>`).join("");
      const limit = list[0]?.word_limit || { raw: "ONE WORD ONLY" };
      const card = document.createElement("div");
      card.className = "qcard";
      const tableTitle = t.caption.split(" — ")[0];
      card.innerHTML = `
        ${tableTitle === englishName(p) ? "" : '<div class="qcard-head"><div class="qcard-title" lang="en">'+escapeHTML(tableTitle)+'</div></div>'}
        <div class="table-scroll"><table class="fill-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>
        <div class="limit-note">连字符词计一个词。${limit.allow_number ? "本题允许填写数字。" : ""}</div>`;
      host.appendChild(card);
      bindInputs(card);
    }
  }

  if (p.question_type === "match") {
    const opts = p.options || list[0]?.options || [];
    const card = document.createElement("div");
    card.className = "qcard";
    card.innerHTML = `
      <div class="qcard-head">
        <div class="qcard-title">备选职责</div>
      </div>
      <div class="opt-bank">${opts.map((o) => `<span class="bank-chip"><b>${escapeHTML(o.key)}</b> ${escapeHTML(o.text)}</span>`).join("")}</div>
      <div class="match-list">
        ${list.map((it) => `<div class="match-row" data-item="${it.id}">
          <span class="match-q">${qno(it)}</span>
          <span class="match-name">${escapeHTML(it.prompt)}</span>
          ${choiceSelectHTML(it, opts)}
        </div>`).join("")}
      </div>`;
    host.appendChild(card);
    bindInputs(card);
  }

  if (p.question_type === "word_bank_completion") {
    const opts = p.options || [];
    const byBlank = Object.fromEntries(list.map((i) => [i.blank, i]));
    const card = document.createElement("div");
    card.className = "qcard";
    card.innerHTML = `
      <div class="qcard-head">
        <div class="qcard-title" lang="en">${escapeHTML(p.bank_title || "Word bank")}</div>
      </div>
      <div class="opt-bank">${opts.map((o) => `<span class="bank-chip"><b>${escapeHTML(o.key)}</b> ${escapeHTML(o.text)}</span>`).join("")}</div>
      <ol class="flow-list">
        ${(p.flow_steps || []).map((step) => {
          const it = step.blank ? byBlank[step.blank] : null;
          const txt = escapeHTML(step.text);
          return `<li class="flow-step ${it ? "has-blank" : ""}">${it ? txt.replace("______", `<span class="inline-blank">${choiceSelectHTML(it, opts)}</span>`) : txt}</li>`;
        }).join("")}
      </ol>`;
    host.appendChild(card);
    bindInputs(card);
  }

  if (p.question_type === "mcq") {
    const card = document.createElement("div");
    card.className = "qcard";
    card.innerHTML = `<div class="qcard-head"><div class="qcard-title"><span class="badge">单选题</span>选择最符合录音的选项</div></div>` +
      list.map((it) => `<div class="mcq" data-item="${it.id}">
        <div class="mcq-stem"><span class="qno">${qno(it)}</span><span>${escapeHTML(it.prompt)}</span></div>
        <div class="opts">${(it.options || []).map((o) => `
          <label class="opt ${cur().answers[it.id] === o.key ? "selected" : ""}">
            <input type="radio" name="${it.id}" value="${o.key}" ${cur().answers[it.id] === o.key ? "checked" : ""}>
            <span class="key">${o.key}</span><span>${escapeHTML(o.text)}</span></label>`).join("")}</div></div>`).join("");
    host.appendChild(card);
    $$("input[type=radio]", card).forEach((r) => {
      r.onchange = () => {
        cur().answers[r.name] = r.value; saveDraft();
        $$(`.mcq[data-item="${r.name}"] .opt`).forEach((l) => l.classList.toggle("selected", $("input", l).checked));
        updateProgress();
      };
    });
  }
  updateProgress();
}

function bindInputs(root) {
  prepareChoices(root);
  $$(".blank-input", root).forEach((inp) => {
    inp.oninput = () => {
      cur().answers[inp.dataset.item] = inp.value; saveDraft();
      const it = itemById(inp.dataset.item);
      const wl = it.word_limit || { max_words: 1, allow_number: true };
      inp.classList.toggle("over", !!inp.value.trim() && countWords(inp.value, wl.allow_number) > wl.max_words);
      updateProgress();
    };
  });
  $$(".choice-select", root).forEach((sel) => {
    sel.onchange = () => {
      cur().answers[sel.dataset.item] = sel.value; saveDraft();
      updateProgress();
    };
  });
}

/* ---------------------------------------------------------------- 播放器 / 原文 */
const params=new URLSearchParams(location.search);
const scope=params.get("scope")||"";
const send=(type,fields={})=>{
  if(parent!==window)parent.postMessage({source:"ielts-listening",type,...fields},location.origin);
};
const draftKey=pid=>"listening-v2:draft:"+encodeURIComponent(scope)+":"+pid;
function saveDraft(){
  try{localStorage.setItem(draftKey(S.practiceId),JSON.stringify({answers:cur().answers,startedAt:cur().startedAt}));}catch{}
}
function readDraft(pid){
  try{return JSON.parse(localStorage.getItem(draftKey(pid))||"null")||{};}catch{return {};}
}
function dropDraft(pid){try{localStorage.removeItem(draftKey(pid))}catch{}}
function showSection(){
  const st=cur();
  $("#answerView").classList.toggle("hidden",st.submitted);
  $("#resultView").classList.toggle("hidden",!st.submitted);
  $("#redoBtn").hidden=Boolean(st.historical);
  renderSectionNav();
  renderQuestions();
  renderTranscript();
  if(st.submitted) renderResults();
  updateProgress();
}
async function switchSection(pid){
  if(!S.sections[pid] || pid===S.practiceId || cur()?.busy)return;
  const navHadFocus = $("#sectionNav").contains(document.activeElement);
  closePicker();closeModal();closeDrawer();
  if(cur()?.historical){S.sections[S.practiceId]=cur().current;}
  S.practiceId=pid;
  S.wrongbook=[];renderWBButton();
  S.audio.setSegment(audioIdOf());
  showSection();
  if (navHadFocus) $("#sectionNav [aria-pressed=true]")?.focus({preventScroll:true});
  send("section",{section:pid});
  await refreshWrongbook();
  if(S.practiceId===pid && cur().submitted)renderResults();
}

function renderTranscript() {
  const host = $("#transcript");
  const panel = $("#transcriptPanel");
  const lines = cur().submitted ? (cur().transcripts?.[audioIdOf()] || []) : [];
  panel.open = false;
  panel.hidden = !lines.length;
  $("#lockedTranscript").hidden = Boolean(lines.length) || cur().submitted;
  $("#showTranscriptBtn").hidden = !lines.length;
  $("#lockTag").textContent = `共 ${lines.length} 句 · 点击句子回听`;
  host.scrollTop = 0;
  host.innerHTML = lines.map((ln, i) => `
    <button type="button" class="line ${ln.item_ids?.length ? "key" : ""}" data-i="${i}" data-start="${ln.start}">
      <span class="line-meta"><time>${fmt(ln.start)}</time><span class="spk">${escapeHTML(ln.speaker)}</span></span>
      <span class="txt">${escapeHTML(ln.text)}</span>
    </button>`).join("");
  $$(".line", host).forEach((l) => (l.onclick = () => S.audio.playFrom(Number(l.dataset.start))));
}

function highlightLine(current, seg) {
  const st = cur();
  if (!st.submitted || !st.transcripts || !$("#transcriptPanel").open) return;
  const lines = st.transcripts[seg] || [];
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (current >= lines[i].start - 0.15 && current <= lines[i].end + 0.3) { idx = i; break; }
  }
  $$("#transcript .line").forEach((l, i) => l.classList.toggle("active", i === idx));
}

/* ---------------------------------------------------------------- 交卷（按 section 独立） */
function trySubmit() {
  const st = cur();
  if (st.submitted) return;
  const missing = itemsOf().filter((i) => !answered(i));
  if (missing.length) {
    openModal("还有题目未作答",
      `<p class="confirm-text">${escapeHTML(st.practice.section_label)} 还有 <b>${missing.length}</b> 题未作答，交卷后记为「漏答」，只计入本段正确率，不影响其他 section。</p>
       <div class="modal-actions"><button class="ghost" id="mBack">继续作答</button><button class="primary" id="mGo">仍然交卷</button></div>`);
    $("#mBack").onclick = closeModal;
    $("#mGo").onclick = () => { closeModal(); submitSection(); };
    return;
  }
  submitSection();
}

function applyResult(st,res){
  st.view={};
  for (const ci of res.items) {
    const base=st.practice.items.find(item=>item.id===ci.item_id)||{};
    st.view[ci.item_id]={...base,id:ci.item_id,number:ci.number??base.number,
      type:ci.question_type||base.type,correct_answers:ci.correct_answer||[],evidence:ci.evidence||null,
      explanation:ci.explanation||"",trap_type:ci.trap_type,word_limit:ci.word_limit||base.word_limit,
      retry_stem:ci.retry_stem,options:ci.options||base.options,status:ci.status,tag:ci.error_tag||null,user_answer:ci.user_answer||""};
    st.answers[ci.item_id]=ci.user_answer||"";
  }
  st.report=res.report;st.transcripts=res.transcripts;st.submitted=true;st.response=res;
}
async function submitSection(){
  const st=cur(),pid=S.practiceId;
  if(st.busy||st.submitted)return;
  st.busy=true;lockInputs(true);updateProgress();
  try{
    const res=await S.repo.submitAttempt({practiceId:pid,answers:{...st.answers},durationSec:Math.round((Date.now()-st.startedAt)/1000),replayBySegment:{...S.audio.replay}});
    applyResult(st,res);dropDraft(pid);
    S.progress[pid]={...progressOf(pid),submitted:true,attempts:progressOf(pid).attempts+1,best_correct:Math.max(progressOf(pid).best_correct,res.summary.correct),latest_correct:res.summary.correct};
    send("result",{practice:st.practice,result:res});
    if(pid===S.practiceId){
      await refreshWrongbook();showSection();
      $("#resultView").scrollIntoView({block:"start",behavior:"smooth"});
    }
  }catch(e){toast("交卷失败："+e.message);}
  finally{st.busy=false;if(pid===S.practiceId){lockInputs(false);updateProgress();}}
}
function lockInputs(locked){
  for(const el of document.querySelectorAll("#questionHost input,#questionHost select,#questionHost .pick-trigger,#sectionNav button,#redoBtn"))el.disabled=locked;
}


/* ---------------------------------------------------------------- 结果页（本 section） */
function renderResults() {
  const st = cur();
  const vals = Object.values(st.view);
  const correct = vals.filter((r) => r.status === "correct").length;
  const wrong = vals.filter((r) => r.status === "wrong").length;
  const missed = vals.filter((r) => r.status === "missed").length;
  const total = vals.length;
  const pct = total ? Math.round((correct / total) * 100) : 0;

  $("#scoreRing").style.background = `conic-gradient(var(--brand) ${pct * 3.6}deg, #e8eefb ${pct * 3.6}deg)`;
  $("#scoreBig").textContent = correct;
  $("#scoreTotal").textContent = "/" + total;
  $("#resultTitle").textContent = `${st.practice.section_label} · ${st.practice.title} 结果`;

  const topTag = Object.entries(st.report?.error_tag_counts || {}).sort((a, b) => b[1] - a[1])[0];
  $("#resultChips").innerHTML = `
    <span class="chip ok">做对 ${correct}</span>
    <span class="chip bad">答错 ${wrong}</span>
    <span class="chip">漏答 ${missed}</span>
    <span class="chip warn">正确率 ${pct}%</span>

    <span class="chip scope">仅 ${escapeHTML(st.practice.section_label)}</span>`;
  $("#resultLead").textContent = topTag
    ? `本段最需改进：${TAGS[topTag[0]] || topTag[0]} ×${topTag[1]}。结果只统计本段 ${total} 题，其他 section 不受影响。`
    : "本段没有明显集中的错因，可以切换到下一段材料继续练。";
  renderNextActions();

  const host = $("#resultList");
  host.innerHTML = "";
  const title = document.createElement("div");
  title.className = "res-sec-title";
  title.textContent = `${st.practice.section_label} · ${englishName(st.practice)}`;
  host.appendChild(title);
  itemsOf().forEach((it) => host.appendChild(resultCard(st.view[it.id])));
}

function renderNextActions() {
  let box = $("#nextActions");
  if (!box) {
    box = document.createElement("div");
    box.id = "nextActions";
    box.className = "card next-actions";
    $("#resultView").insertBefore(box, $("#resultList"));
  }
  const acts = cur().report?.next_actions || [];
  box.innerHTML = `<div class="card-head"><h4>下一步该练什么</h4><span class="lock-tag">仅基于本段作答</span></div>
    <ol class="na-list">${acts.map((a) => `<li>${escapeHTML(a)}</li>`).join("")}</ol>`;
}

function resultCard(it) {
  if (!it) return document.createElement("div");
  const r = it;
  const label = QUESTION_TYPE_LABELS[it.type] || it.type;
  const userTxt = r.status === "missed" ? "未作答" : r.user_answer;
  const card = document.createElement("div");
  card.className = `rcard ${r.status}`;
  card.id = `rc_${it.id}`;
  const ev = it.evidence || {};
  let correctShow = (it.correct_answers || [])[0] || "";
  // 匹配题：答案是字母，补上对应文字，方便核对
  if (it.options?.length && /^[A-H]$/i.test(correctShow)) {
    const o = it.options.find((x) => x.key === correctShow.toUpperCase());
    if (o) correctShow = `${o.key} · ${o.text}`;
  }
  const isChoice = it.type === "mcq" || it.type === "match";
  const answerRow = `<div class="rc-ans">
      <div><span class="k">你的答案</span><span class="v ${r.status === "correct" ? "good" : "strike"}">${escapeHTML(userTxt)}</span></div>
      <div><span class="k">正确答案</span><span class="v good">${escapeHTML(correctShow)}</span></div>
      ${isChoice ? "" : `<div><span class="k">限词</span><span class="v" style="font-weight:500;color:#64748b">${it.word_limit ? escapeHTML(it.word_limit.raw) : "—"}</span></div>`}
    </div>`;

  card.innerHTML = `
    <div class="rc-head">
      <div class="rc-title"><span class="qno">${qno(it)}</span>${escapeHTML(label)}
        ${it.trap_type === "corrected_date" || it.trap_type === "corrected_number" || it.trap_type === "corrected_info" ? '<span class="badge gray">信息更正</span>' : ""}
      </div>
      <span class="status ${r.status}">${r.status === "correct" ? "答对" : r.status === "wrong" ? "答错" : "漏答"}</span>
    </div>
    ${answerRow}
    <button class="ev-btn" data-ev="${it.id}">▶ 听答案出处 ${(ev.start ?? 0).toFixed(1)}s – ${(ev.end ?? 0).toFixed(1)}s<span class="evidence-context-note">含少量前后文</span></button>
    <div class="quote">${highlightQuote(ev.quote || "", it.type === "table_completion" || it.type === "word_bank_completion" ? (it.correct_answers || [])[0] : null)}</div>
    <div class="explain">${escapeHTML(it.explanation || "")}</div>
    <div class="tag-row" ${r.status==="correct"||cur().historical?"hidden":""}>
      <label>错因</label>
      <select class="tag-select" aria-label="第 ${qno(it)} 题错因" data-tag="${it.id}">
        ${Object.entries(TAGS).map(([k, v]) => `<option value="${k}" ${(r.tag || "OTHER") === k ? "selected" : ""}>${v}</option>`).join("")}
      </select>
      <span class="auto-tag">${r.tag ? `系统预判：${TAGS[r.tag]}` : "系统未预判，请手动选择"}</span>
    </div>
    ${r.status !== "correct" ? `<div class="tip-line">${escapeHTML(tipFor(r.tag, ev))}</div>` : ""}`;

  card.querySelector(".ev-btn").onclick = (e) => S.audio.playRange(ev.audio_id || it.segment, ev.start, ev.end, e.currentTarget);
  const sel = card.querySelector(".tag-select");
  const pid=S.practiceId,entry=S.wrongbook.find(x=>x.item_id===it.id);
  if(entry && !cur().historical){
    sel.value=entry.error_tag||r.tag||"OTHER";
    const tip=card.querySelector(".tip-line");if(tip)tip.textContent=tipFor(sel.value,ev);
    if(sel.value!==r.tag)card.querySelector(".auto-tag").textContent="我的归因："+TAGS[sel.value];
  }
  sel.onchange=async()=>{
    const tag=sel.value;
    if(!entry){toast("请重新打开本段错题本后再试。");return;}
    sel.disabled=true;const trigger=card.querySelector(".pick-trigger");if(trigger)trigger.disabled=true;
    try{
      await S.repo.updateErrorTag(entry.id,tag,pid);
      r.tag=tag;
      if(pid===S.practiceId){await refreshWrongbook();const tip=card.querySelector(".tip-line");if(tip)tip.textContent=tipFor(tag,ev);
        card.querySelector(".auto-tag").textContent="我的归因："+TAGS[tag];}
    }catch(e){sel.value=entry.error_tag||"OTHER";if(trigger)trigger.textContent=sel.selectedOptions[0]?.textContent;toast("错因保存失败："+e.message);}
    finally{sel.disabled=false;if(trigger)trigger.disabled=false;}
  };
  prepareChoices(card);

  return card;
}

/* ---------------------------------------------------------------- 错题本（按 section 独立） */
let wbRevision=0;
async function refreshWrongbook(){
  const pid=S.practiceId,revision=++wbRevision;
  try{
    const entries=await S.repo.getWrongbook(pid);
    if(revision!==wbRevision||pid!==S.practiceId)return;
    S.wrongbook=entries;send("wrongbook",{section:pid,entries});
  }catch(e){
    if(revision!==wbRevision||pid!==S.practiceId)return;
    S.wrongbook=[];toast("暂时无法读取错题："+e.message);
  }
  renderWBButton();renderDrawer();
}

function renderWBButton() {
  $("#wbCount").textContent = S.wrongbook.length;
}

function renderDrawer() {
  const host = $("#wbList");
  $("#drawerSection").textContent = `当前：${cur().practice.section_label} · ${cur().practice.title}（独立错题本）`;
  if (!S.wrongbook.length) {
    host.innerHTML = `<div class="wb-empty">${escapeHTML(cur().practice.section_label)} 还没有错题。<br>本段交卷后，答错和漏答的题只进入这里的错题本，<br>不会与其他 section 混在一起。</div>`;
    $("#wbRedoRate").textContent = "—";
    $("#wbNewRate").textContent = "—";
    return;
  }
  host.innerHTML = S.wrongbook.map((e) => `
    <div class="wb-item" data-id="${e.id}">
      <div class="wb-top">
        <span class="wb-type">Q${escapeHTML(String(e.item_id).split("-").pop())} · ${escapeHTML(QUESTION_TYPE_LABELS[e.question_type] || e.question_type)} · P${e.part}</span>
        <span class="status-pill ${e.status}">${e.status === "mastered" ? "已掌握" : "待复练"}</span>
      </div>
      <div class="wb-ans"><span class="u">${escapeHTML(e.user_answer || "未作答")}</span><span class="c">${escapeHTML(e.correct_answer)}</span></div>
      <div class="wb-tag">${escapeHTML(TAGS[e.error_tag] || e.error_tag)}</div>
      <div class="wb-btns"><button class="main" data-act="redo" data-id="${e.id}">重听原题</button><button data-act="new" data-id="${e.id}">练同类题</button></div>
    </div>`).join("");

  const redo = reviewRates(S.wrongbook, "redo_original");
  const fresh = reviewRates(S.wrongbook, "new_item_same_type");
  $("#wbRedoRate").textContent = redo == null ? "—" : `${redo}%`;
  $("#wbNewRate").textContent = fresh == null ? "—" : `${fresh}%`;
  $$("[data-act]", host).forEach((b) => (b.onclick = () => openRetry(b.dataset.id, b.dataset.act)));
}

/* ---------------------------------------------------------------- 复练（限本 section） */
async function openRetry(entryId, act) {
  const pid=S.practiceId;
  const mode = act === "redo" ? "redo" : "new";
  let prep;
  try {
    prep = await S.repo.getReviewItem(entryId, mode, S.practiceId);
  } catch (e) { toast(`取题失败：${e.message}`); return; }
  if(pid!==S.practiceId||$("#drawer").classList.contains("hidden"))return;
  if (!prep || !prep.item) { toast("本段里暂时没有同题型的新题"); return; }
  const item = prep.item;
  const title = mode === "redo" ? "重听原题 · 本段内" : "同类新题 · 本段内换一题";
  const ev = item.evidence || {};
  const isSelect = item.type === "mcq" || item.type === "match" || item.type === "word_bank_completion";
  let inputHTML;
  if (item.type === "word_bank_completion") {
    inputHTML = `<select class="choice-select" id="retryInput" aria-label="复练答案"><option value="">请选择</option>${(item.options || []).map((o) => `<option value="${escapeAttr(o.text)}">${escapeHTML(o.key)} · ${escapeHTML(o.text)}</option>`).join("")}</select>`;
  } else if (item.type === "mcq" || item.type === "match") {
    inputHTML = `<div class="opts" id="retryOpts">${(item.options || []).map((o) => `<label class="opt"><input type="radio" name="retry" value="${escapeAttr(o.key)}"><span class="key">${o.key}</span><span>${escapeHTML(o.text)}</span></label>`).join("")}</div>`;
  } else {
    inputHTML = `<input class="blank-input" id="retryInput" placeholder="写下答案" autocomplete="off">`;
  }
  const body = `<div class="stem">${escapeHTML(item.retry_stem || item.prompt || "")}</div>
    ${inputHTML}
    <div class="modal-actions"><button class="ghost" id="retryListen">▶ 先听答案出处</button><button class="primary" id="retrySubmit">提交</button></div>
    <div id="retryFb"></div>`;
  openModal(title, body);

  $("#retryListen").onclick = (e) => {
    if (Number.isFinite(ev.start)) S.audio.playRange(ev.audio_id || item.segment, ev.start, ev.end, e.currentTarget);
  };
  if (item.type === "mcq" || item.type === "match") {
    $$("#retryOpts .opt").forEach((l) => l.addEventListener("click", () => {
      $$("#retryOpts .opt").forEach((x) => x.classList.remove("selected"));
      l.classList.add("selected");
    }));
  }
  const requestId=crypto.randomUUID();const submit=$("#retrySubmit"),fb=$("#retryFb");
  submit.onclick = async () => {
    const raw = (item.type === "mcq" || item.type === "match")
      ? $("#retryOpts input:checked")?.value || ""
      : $("#retryInput")?.value || "";
    if(!raw.trim()){toast("请先作答再提交。");return;}
    submit.disabled=true;
    let out;
    try {
      out = await S.repo.submitReview({ entryId, itemId: item.id, mode, answer: raw, practiceId: pid,requestId });
    } catch (e) { submit.disabled=false;toast(`提交失败：${e.message}`); return; }
    if(S.practiceId!==pid)return;
    const ok = out.result === "correct";
    submit.textContent="已提交";
    send("review",{practiceId:pid,entryId,itemId:item.id,mode,answer:raw,result:out});
    fb.className = `fb ${ok ? "ok" : "bad"}`;
    fb.innerHTML = ok
      ? `回答正确。${out.entry?.status==="mastered" ? "这道错题已标记为掌握。" : "这次复练已记入错题本。"}`
      : `这次没对。正确答案是 <b>${escapeHTML(out.correct_answer)}</b>${out.tag ? `，疑似错因：${TAGS[out.tag]}` : ""}。
         ${out.evidence ? `<button class="ev-btn" id="fbEv">▶ 回听 ${out.evidence.start.toFixed(1)}s – ${out.evidence.end.toFixed(1)}s</button>` : ""}`;
    const fbEv = $("#fbEv");
    if (fbEv) fbEv.onclick = () => S.audio.playRange(out.evidence.audio_id, out.evidence.start, out.evidence.end, fbEv);
    cur().reviewed = true;

    await refreshWrongbook();
  };
}

/* ---------------------------------------------------------------- 弹窗 / 提示 */
function openModal(title, html) {
  lastControl=document.activeElement;
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modalMask").classList.remove("hidden");prepareChoices($("#modalBody"));syncOverlay();$("#modalClose").focus({preventScroll:true});
}
function closeModal() { closePicker();$("#modalMask").classList.add("hidden");updateDialogFocus(); }
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2400);
}

/* ---------------------------------------------------------------- 重做（只清本 section） */
function askRedo() {
  const st = cur();
  openModal(`重做 ${st.practice.section_label}`,
    `<p class="confirm-text">会清空 <b>${escapeHTML(st.practice.section_label)}</b> 的本次作答、成绩页与错题本，回到空白答案重新开始。<br>
     其他 3 个 section 的成绩、原文解锁和错题本<b>完全不受影响</b>；历史练习次数会保留。</p>
     <div class="modal-actions"><button class="ghost" id="rBack">先不重做</button><button class="primary" id="rGo">清空并重做本段</button></div>`);
  $("#rBack").onclick = closeModal;
  $("#rGo").onclick = () => { closeModal(); redoSection(); };
}

async function redoSection() {
  const pid = S.practiceId;
  try {
    if(cur().busy)return;cur().busy=true;lockInputs(true);await S.repo.reset(pid);
  } catch (e) {
    cur().busy=false;lockInputs(false);toast(`重做失败：${e.message}`);
    return;
  }
  const st = cur();
  st.busy=false;dropDraft(pid);st.answers = {};
  st.submitted = false;
  st.view = {};
  st.report = null;
  st.transcripts = null;
  st.reviewed = false;
  st.response = null;
  st.startedAt = Date.now();
  S.progress[pid] = { ...progressOf(pid), submitted: false, wrong_count: 0 };
  $("#resultView").classList.add("hidden");
  $("#answerView").classList.remove("hidden");
  renderSectionNav();
  await refreshWrongbook();
  renderQuestions();
  renderTranscript();
  updateProgress();lockInputs(false);
  toast(`${st.practice.section_label} 已清空，可以重新作答`);
}

/* ---------------------------------------------------------------- 初始化 */
function closeDrawer(){
  $("#drawer").classList.add("hidden");$("#drawerMask").classList.add("hidden");updateDialogFocus();
}
function updateDialogFocus(){
  const wasInert=$("main").inert, modalOpen=!$("#modalMask").classList.contains("hidden"),drawerOpen=!$("#drawer").classList.contains("hidden");
  $("main").inert=modalOpen||drawerOpen;$("#drawer").inert=modalOpen;
  if(!modalOpen && drawerOpen && !$("#drawer").contains(document.activeElement))$("#drawerClose").focus({preventScroll:true});
  if(wasInert&&!drawerOpen&&!modalOpen && lastControl?.isConnected)lastControl.focus({preventScroll:true});
}
function openDrawer(){
  lastControl=$("#wrongbookBtn");renderDrawer();$("#drawer").classList.remove("hidden");$("#drawerMask").classList.remove("hidden");
  syncOverlay();$("#drawerClose").focus({preventScroll:true});
}
let lastControl=null;
function syncOverlay(){
  let start=0,height=window.innerHeight;
  if(parent!==window&&window.frameElement){
    const box=frameElement.getBoundingClientRect(),head=parent.document.querySelector(".topbar")?.getBoundingClientRect();
    const bottom=parent.document.querySelector(".tabbar")?.getBoundingClientRect();
    start=Math.max(0,(head?.bottom||0)+5-box.top);
    const end=Math.min(box.height,(bottom?.height?bottom.top:parent.innerHeight)-5-box.top);
    height=Math.max(170,end-start);
  }
  document.documentElement.style.setProperty("--overlay-top",start+"px");
  document.documentElement.style.setProperty("--overlay-height",height+"px");
  updateDialogFocus();
}
function enableSizing(){
  const sizing=()=>window.CoachFrameLayout.observe(height=>{send("size",{height});syncOverlay();});
  if(window.CoachFrameLayout)sizing();else document.addEventListener("coach:frame-layout-ready",sizing,{once:true});
  if(parent!==window){parent.addEventListener("scroll",syncOverlay,true);parent.addEventListener("resize",syncOverlay);
    window.addEventListener("pagehide",()=>{parent.removeEventListener("scroll",syncOverlay,true);parent.removeEventListener("resize",syncOverlay);},{once:true});}
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&!$("#modalMask").classList.contains("hidden"))closeModal();
    else if(e.key==="Escape"&&!$("#drawer").classList.contains("hidden"))closeDrawer();
    if(e.key!=="Tab"||document.querySelector(".pick-list"))return;
    const active=!$("#modalMask").classList.contains("hidden")?$("#modal"):!$("#drawer").classList.contains("hidden")?$("#drawer"):null;
    if(!active)return;
    const controls=[...active.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not([tabindex="-1"])')].filter(n=>n.offsetWidth);
    if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1)?.focus();}
    if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0]?.focus();}
  });
}

async function init(){
  enableSizing();
  if(!scope||parent===window)throw Error("请从总站的听力精练进入。");
  S.repo=createHttpRepository({scope});

  S.catalog = await S.repo.listPractices();
  if (!S.catalog.length) throw new Error("题库目录为空");

  await Promise.all(S.catalog.map(async (c) => {
    const practice = await S.repo.getPractice(c.practice_id);
    S.sections[c.practice_id] = {
      practice, answers: readDraft(c.practice_id).answers||{}, submitted: false, view: {}, report: null,
      transcripts: null, reviewed: false, startedAt: readDraft(c.practice_id).startedAt||Date.now(), response: null,
    };
  }));
  const progress=await S.repo.getProgress();
  for(const row of progress) S.progress[row.practice_id]=row;
  await Promise.all(progress.filter(row=>row.submitted&&S.sections[row.practice_id]).map(async row=>{
    const result=await S.repo.getResult(row.practice_id);
    if(result?.items){const st=S.sections[row.practice_id];applyResult(st,result);dropDraft(row.practice_id);
      send("result",{practice:st.practice,result});}
  }));
  S.practiceId=S.sections[params.get("section")]?params.get("section"):S.catalog[0].practice_id;
  if(params.get("attempt")){
    const result=await S.repo.getAttempt(params.get("attempt"));
    if(!result?.items || !S.sections[result.practice_id])throw Error("找不到这份练习记录。");
    S.practiceId=result.practice_id;
    const st=cur();
    if(st.response?.attempt_id!==result.attempt_id){
      st.current={...st,answers:{...st.answers},view:{...st.view}};
      applyResult(st,result);st.historical=true;
    }
  }

  const allSegments = S.catalog.flatMap((c) => S.sections[c.practice_id].practice.segments);
  S.audio = new AudioController({
    audio: $("#audio"),
    segments: allSegments,
    on: {
      time: ({ current, duration }) => {
        const p = Math.min(1, current / duration);
        const seek = $("#seek");
        seek.value = String(Math.round(p * 1000));
        seek.style.setProperty("--played", (p * 100) + "%");
        seek.setAttribute("aria-valuetext", fmt(current) + " / " + fmt(duration));
        $("#curTime").textContent = fmt(current);
        $("#durTime").textContent = fmt(duration);
      },
      state: ({ playing }) => {
        $("#playBtn").setAttribute("aria-label",playing?"暂停录音":"播放录音");
        $("#playBtn").classList.toggle("playing", playing);
        $("#playIcon").setAttribute("d", playing ? "M6 5h4v14H6zM14 5h4v14h-4z" : "M8 5v14l11-7z");
      },
      segment: (s) => {
        S.seg = s.audio_id;
        const owner = segmentOwner(s.audio_id);
        if (owner && owner !== S.practiceId) S.practiceId = owner;
        const st = cur();
        $("#npLabel").textContent = `${st.practice.section_label} · ${st.practice.title}`;
        $("#npName").textContent = englishName(st.practice);
        $("#replayInfo").textContent = `本段重听 ${S.audio.replayCount(s.audio_id)} 次`;
        // The selected section is rendered after the player is initialized.
      },
      replay: ({ count }) => { $("#replayInfo").textContent = `本段重听 ${count} 次`; },
      tick: ({ current, segment }) => highlightLine(current, segment),
      rangeStart: ({ btn, start, end }) => {
        $$(".ev-btn.playing").forEach((b) => b.classList.remove("playing"));
        if (btn) {
          btn.classList.add("playing");
          btn.dataset.label = btn.innerHTML;
          btn.innerHTML = `⏸ 播放中 ${start.toFixed(1)}s – ${end.toFixed(1)}s`;
        }
      },
      rangeEnd: ({ btn }) => {
        $$(".ev-btn.playing").forEach((b) => b.classList.remove("playing"));
        if (btn && btn.dataset.label) btn.innerHTML = btn.dataset.label;
      },
      blocked: () => toast("浏览器拦截了自动播放，请再点一次"),
    },
  });

  $("#playBtn").onclick = () => S.audio.toggle();
  $("#transcriptPanel").ontoggle = () => highlightLine($("#audio").currentTime, S.seg);
  $("#showTranscriptBtn").onclick = () => {
    $("#transcriptPanel").open = true;
    $("#transcriptToggle").focus({ preventScroll: true });
    $("#transcriptPanel").scrollIntoView({block:"center"});
  };
  $("#seek").oninput=e=>S.audio.seekRatio(Number(e.currentTarget.value)/1000);
  $("#audio").addEventListener("error",()=>toast("录音加载失败，请刷新后重试。"));
  $("#reportBtn").onclick=()=>send("open-report",{attemptId:cur().response?.attempt_id});

  $("#submitBtn2").onclick = trySubmit;
  $("#redoBtn").onclick = askRedo;
  $("#wrongbookBtn").onclick=openDrawer;
  $("#drawerClose").onclick=closeDrawer;$("#drawerMask").onclick=closeDrawer;
  $("#modalClose").onclick=closeModal;
  $("#modalMask").onclick=e=>{if(e.target.id==="modalMask")closeModal();};
  await refreshWrongbook();S.audio.setSegment(audioIdOf());showSection();
  $("#workspace").hidden=false;$("#status").hidden=true;$("#wrongbookBtn").disabled=false;
  send("ready",{section:S.practiceId});
  const target=params.get("item"), view=params.get("view");
  if(view==="wrongbook" || view==="retry"){
    $("#wrongbookBtn").scrollIntoView({block:"center"});openDrawer();
    const entry=S.wrongbook.find(x=>x.item_id===target);
    if(entry){const row=document.querySelector('.wb-item[data-id="'+CSS.escape(entry.id)+'"]');
      if(row)$("#wbList").scrollTop=Math.max(0,row.offsetTop-$("#wbList").offsetTop);
      if(view==="retry")await openRetry(entry.id,"redo");
    }
  }else if(view==="redo"&&cur().submitted){$("#redoBtn").scrollIntoView({block:"center"});askRedo();}
  else if(target){const el=document.getElementById("rc_"+target)||document.querySelector('[data-item="'+CSS.escape(target)+'"]');el?.scrollIntoView({block:"center"});}
}

init().catch((e) => {
  console.error("[init]", e);
  const status=$("#status");status.textContent="听力材料未能载入。"+e.message+" ";
  const retry=document.createElement("button");retry.className="ghost";retry.textContent="重新载入";retry.onclick=()=>location.reload();status.append(retry);
});
