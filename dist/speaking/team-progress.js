import { apiFetch, embedded, scope } from './host-bridge.js';
const teamSkills = {listening:'听力',speaking:'口语',reading:'阅读',writing:'写作'};
const teamTasks = {listening:'完成听力训练',speaking:'完成一次口语模考或自由对话',reading:'完成阅读训练',writing:'提交写作训练'};
const weekdays = ['一','二','三','四','五','六','日'];
const periods = ['上午','午间','下午','晚间'];
const escapeTeam = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function defaultMonth() {
  const date = new Date(Date.now() + 8 * 3600000);
  return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1)).toISOString().slice(0,7);
}

function weekTable(members,skill,period) {
  const head = Object.entries(teamSkills).map(([s,label]) =>
    '<th scope="col"' + (s === skill ? ' class="tp-focus"' : '') + '>' + label + '</th>').join('');
  const rows = members.map(member => {
    const values = Object.keys(teamSkills).map(s => {
      const count = member.counts[s] || 0;
      return '<td class="' + [count ? 'tp-done' : 'tp-zero', s === skill ? 'tp-focus' : ''].join(' ') +
        '" title="' + teamSkills[s] + '本周完成 ' + count + ' 次">' + (count ? count + ' 次' : '0') + '</td>';
    }).join('');
    return '<tr><th scope="row">' + escapeTeam(member.nickname) + (member.self ? ' <small>我</small>' : '') +
      '</th>' + values + '</tr>';
  }).join('');
  return '<table><caption>队员本周进度 <span>' + escapeTeam(period) + '</span></caption><thead><tr><th scope="col">队员</th>' +
    head + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function sampleTeam(skill) {
  const members = [
    {nickname:'阿澄',counts:{listening:1,speaking:2,reading:0,writing:1}},
    {nickname:'小棠',counts:{listening:0,speaking:1,reading:2,writing:0}},
    {nickname:'阿舟',counts:{listening:1,speaking:0,reading:1,writing:1}},
  ];
  return '<div class="tp-sample"><div class="tp-sample-head"><b>小组本周进度</b><span>示例数据</span></div>' +
    '<p class="tp-note">加入小组后，这里显示每位队友本周四科的完成情况。</p>' +
    weekTable(members,skill,'示例周') + '</div>';
}

function roster(state, skill, confirming) {
  const {team,goals,week} = state;
  const completed = team.members.filter(member => member.counts[skill] >= goals[skill]).length;
  const mine = team.members.find(member => member.self);
  return '<div class="tp-teamhead"><div><h3>' + escapeTeam(team.name) + '</h3><p>' +
    escapeTeam(team.month) + ' 考试 · 目标 ' + team.target + ' 分 · ' + team.size + '/4 人</p></div>' +
    (team.size < 4 && !scope.startsWith('showcase_') ? '<button type="button" data-team-action="invite">邀请队友</button>' : '') + '</div>' +
    '<div class="tp-slots">' + team.slots.map(s => '<span>' + escapeTeam(s) + '</span>').join('') + '</div>' +
    '<div class="tp-goal"><div><b>本周' + teamSkills[skill] + '任务</b><span>' + teamTasks[skill] +
    '</span></div><strong>' + completed + ' / ' + team.size + ' 人完成</strong></div>' +
    '<progress aria-label="本周' + teamSkills[skill] + '达标人数" max="' + team.size + '" value="' + completed + '"></progress>' +
    (skill === 'speaking' && mine ? (mine.counts[skill] >= goals[skill] ? '<p class="tp-note">✓ 你已完成本周口语任务</p>' :
      '<button type="button" class="tp-primary" data-action="practice">开始本周口语练习</button>') : '') +
    weekTable(team.members,skill,week.start + ' 至 ' + week.end) +
    '<p class="tp-note">每科每人每周目标 1 次，按周一至周日（北京时间）统计。0 表示本周尚无该科完成记录。</p>' +
    (confirming ? '' : '<button class="tp-text" type="button" data-team-action="leave">退出小组</button>');
}

function matchCard(team) {
  return '<article class="tp-match"><div><h4>' + escapeTeam(team.name) + '</h4><p>' + escapeTeam(team.month) +
    ' · 目标 ' + team.target + ' 分 · ' + escapeTeam(team.slots.join('、')) + '</p></div><div><small>' +
    team.size + '/4 人</small> <button type="button" data-team-action="join" data-team-id="' + escapeTeam(team.id) +
    '"' + (team.size >= 4 ? ' disabled' : '') + '>加入小组</button></div></article>';
}

function picker(form, matches, invitation) {
  const exists = form.slots.includes('周' + form.day + form.period);
  const targets = Array.from({length:17},(_,i) => i / 2 + 1).map(value =>
    '<option' + (form.target === value ? ' selected' : '') + '>' + value + '</option>').join('');
  const selected = form.slots.map(slot =>
    '<button class="tp-chip" data-team-action="remove-slot" type="button" data-team-slot="' + escapeTeam(slot) +
    '" aria-label="删除' + escapeTeam(slot) + '">' + escapeTeam(slot) + ' ×</button>').join('');
  const results = matches === null ? '' : matches.length ? matches.map(matchCard).join('') :
    '<p class="tp-note">未找到考试月份、目标分和空闲时段相符的小组。可以调整条件，或创建小组邀请同学。</p>';
  return (invitation ? '<h4>收到的小组邀请</h4>' + matchCard(invitation) : '') +
    '<p class="tp-note">同一考试月份、目标分相同且至少一个时段有空的同学，可以一起完成每周任务。</p>' +
    '<div class="tp-fields"><label>考试月份<input type="month" data-team-field="month" value="' + escapeTeam(form.month) + '"></label>' +
    '<label>目标总分<select data-team-field="target">' + targets + '</select></label></div>' +
    '<fieldset><legend>共同空闲时间</legend><div class="tp-slot-picker"><select data-team-field="day" aria-label="星期">' +
    weekdays.map(day => '<option' + (day === form.day ? ' selected' : '') + '>周' + day + '</option>').join('') +
    '</select><select data-team-field="period" aria-label="时段">' +
    periods.map(period => '<option' + (period === form.period ? ' selected' : '') + '>' + period + '</option>').join('') +
    '</select><button data-team-action="add-slot" type="button"' + (exists ? ' disabled>已添加' : '>添加时段') + '</button></div>' +
    '<div class="tp-slots">' + selected + '</div></fieldset>' +
    '<div class="tp-actions"><button type="button" class="tp-primary" data-team-action="find">查找匹配小组</button>' +
    '<button type="button" data-team-action="show-create" aria-expanded="' + form.creating + '">自己建组</button></div>' +
    (form.creating ? '<div class="tp-create"><label>小组名称<input type="text" maxlength="32" placeholder="例如：周三晚间备考组" data-team-field="name" value="' +
      escapeTeam(form.name) + '"></label><button type="button" data-team-action="create">按所选条件创建</button></div>' : '') +
    '<div class="tp-results">' + results + '</div>';
}

export function mountTeamProgress(root, options = {}) {
  const skill = Object.hasOwn(teamSkills,options.skill) ? options.skill : 'speaking';
  const controls = new AbortController();
  const signal = controls.signal;
  const form = {month:defaultMonth(), target:6.5, slots:['周三晚间'], day:'三', period:'晚间', creating:false, name:''};
  let current = null, matches = null, invitation = null, confirmation = false, inviteLink = '';
  let busy = false, revision = 0, pollTimer;
  root.innerHTML = '<section class="tp-panel" aria-label="小组周进度"><h2>备考小组</h2>' +
    '<div data-team-content></div><p class="tp-message" role="status" aria-live="polite"></p></section>';
  const content = root.querySelector('[data-team-content]');
  const notice = root.querySelector('.tp-message');
  function message(value) { if (!signal.aborted) notice.textContent = value; }
  function render() {
    if (signal.aborted) return;
    if (!current) {
      content.innerHTML = '<button type="button" data-team-action="refresh">刷新小组</button>';
      return;
    }
    if (options.summaryOnly) {
      content.innerHTML = current.team ? weekTable(current.team.members,skill,current.week.start + ' 至 ' + current.week.end) : '<p>加入小组后可以查看本周进度。</p>';
      return;
    }
    content.innerHTML = current.team ? roster(current,skill,confirmation) +
      (confirmation ? '<div class="tp-confirm">确定退出这个备考小组？ <button type="button" data-team-action="confirm-leave">确认退出</button> ' +
        '<button type="button" data-team-action="stay">留在小组</button></div>' : '') +
      (inviteLink ? '<label class="tp-link">本组邀请链接<input readonly value="' + escapeTeam(inviteLink) + '"></label>' : '') :
      picker(form,matches,invitation) + sampleTeam(skill);
    if (busy) content.querySelectorAll('button,input,select').forEach(control => control.disabled = true);
  }
  async function api(path, body) {
    const response = await apiFetch('/api/campus/teams/' + path, {
      method:body === undefined ? 'GET' : 'POST', credentials:'same-origin', cache:'no-store', signal,
      ...(body === undefined ? {} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      throw Error(data.error || '暂时无法连接小组，请稍后刷新。');
    }
    return data;
  }
  async function refresh() {
    if (signal.aborted || busy) return;
    const version = ++revision;
    try {
      const next = await api('me');
      if (version !== revision || signal.aborted) return;
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        current = next;
        if (!next.team) { inviteLink = ''; confirmation = false; }
        render();
        message('');
      }
    } catch (error) {
      if (version === revision && !signal.aborted) { if (!current) render(); message(error.message); }
    }
  }
  function onInput(event) {
    const key = event.target.dataset.teamField;
    if (!key) return;
    if (key === 'day') form.day = event.target.value.slice(1);
    else form[key] = key === 'target' ? Number(event.target.value) : event.target.value;
    if (key === 'day' || key === 'period') {
      const add = content.querySelector('[data-team-action="add-slot"]');
      add.disabled = form.slots.includes('周' + form.day + form.period);
      add.textContent = add.disabled ? '已添加' : '添加时段';
    }
    if (key === 'month' || key === 'target') {
      matches = null;
      content.querySelector('.tp-results')?.replaceChildren();
    }
  }
  async function onClick(event) {
    const button = event.target.closest('[data-team-action]');
    if (!button || busy) return;
    const action = button.dataset.teamAction;
    message('');
    if (action === 'refresh') { await refresh(); return; }
    if (action === 'invite') {
      const url = new URL(embedded ? parent.location.href : location.href);
      if (embedded) {
        url.hash = '/subject/speaking?view=campus-team&team=' + encodeURIComponent(current.team.id);
      } else {
        url.searchParams.set('team',current.team.id);
        url.hash = 'campus-team';
      }
      inviteLink = url.href;
      render();
      try { await navigator.clipboard.writeText(inviteLink); message('邀请链接已复制。'); }
      catch { message('可复制上方邀请链接发给队友。'); }
      return;
    }
    if (action === 'leave' || action === 'stay') {
      confirmation = action === 'leave';
      render();
      content.querySelector(confirmation ? '[data-team-action="stay"]' : '[data-team-action="leave"]')?.focus();
      return;
    }
    if (action === 'show-create') { form.creating = !form.creating; render(); if (form.creating) content.querySelector('[data-team-field="name"]')?.focus(); return; }
    if (action === 'add-slot' || action === 'remove-slot') {
      const slot = '周' + form.day + form.period;
      if (action === 'add-slot' && !form.slots.includes(slot)) form.slots.push(slot);
      if (action === 'remove-slot') form.slots = form.slots.filter(value => value !== button.dataset.teamSlot);
      matches = null;
      render();
      content.querySelector('[data-team-field="day"]')?.focus();
      return;
    }
    if ((action === 'find' || action === 'create') && (!form.month || !form.slots.length)) {
      message('请选择考试月份并添加至少一个空闲时段。'); return;
    }
    const groupId = button.dataset.teamId;
    busy = true;
    revision++;
    render();
    try {
      if (action === 'find') {
        const params = new URLSearchParams({month:form.month,target:String(form.target)});
        for (const slot of form.slots) params.append('slot',slot);
        matches = (await api('find?' + params)).teams;
      }
      if (action === 'create') current = await api('create', {name:form.name,month:form.month,target:form.target,slots:form.slots});
      if (action === 'join') current = await api('join',{id:groupId});
      if (action === 'confirm-leave') {
        current = await api('leave',{id:current.team.id});
        confirmation = false; inviteLink = ''; matches = null; invitation = null;
      }
      if (action !== 'find') window.dispatchEvent(new Event('campus:progress'));
    } catch (error) { message(error.message); }
    finally { busy = false; render(); }
  }
  async function start() {
    message('');
    await refresh();
    const id = new URL(location.href).searchParams.get('team');
    if (id && current && !current.team && !signal.aborted) {
      try { invitation = (await api('invite?id=' + encodeURIComponent(id))).team; render(); }
      catch (error) { message(error.message); }
    }
  }
  root.addEventListener('click',onClick,{signal});
  root.addEventListener('input',onInput,{signal});
  window.addEventListener('campus:progress',refresh,{signal});
  document.addEventListener('visibilitychange',() => { if (!document.hidden) void refresh(); },{signal});
  pollTimer = setInterval(() => { if (!document.hidden) void refresh(); },12000);
  void start();
  return () => { controls.abort(); clearInterval(pollTimer); root.replaceChildren(); };
}
