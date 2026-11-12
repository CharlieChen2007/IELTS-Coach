import { apiFetch, embedded, nickname } from './host-bridge.js';
import { mountSpeakingPair } from './pair-speaking.js';
import { mountPairDemo } from './demo-pair.js';
import { mountTeamProgress } from './team-progress.js';
import { currentParticipant, rememberParticipant, drainSpeakingEvents } from './campus-events.js';

const offline = location.protocol === 'file:';
async function profileRequest(nickname) {
  const enrolling = nickname !== undefined;
  const response = await apiFetch(enrolling ? '/api/campus/session' : '/api/campus/me', enrolling ? {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nickname})
  } : {cache:'no-store'});
  if (!response.headers.get('content-type')?.includes('application/json')) throw Error('此预览没有连接小组服务，请使用本地启动脚本或已接入的总网站。');
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '暂时不能打开校园搭子。');
  rememberParticipant(data.participant || '');
  if (data.active) void drainSpeakingEvents();
  return data;
}

export function mountCampus(root, page) {
  const team = page === 'campus-team';
  let live = true, disposeRoom, disposeDemo;
  root.innerHTML = team ? '<section data-campus-body></section>' :
    '<section class="panel pair-demo" aria-label="模拟搭子"></section><div data-campus-body></div>';
  const body = root.querySelector('[data-campus-body]');
  const demo = root.querySelector('.pair-demo');
  let demoRunning = false;
  if (demo) disposeDemo = mountPairDemo(demo, active => { demoRunning = active; body.hidden = active; });
  function ready() {
    if (!live) return;
    if (team) disposeRoom = mountTeamProgress(body, {skill:'speaking'});
    else disposeRoom = mountSpeakingPair(body, occupied => { demo.hidden = occupied && !demoRunning; });
  }
  function register() {
    body.innerHTML = '<section class="panel campus-register"><h2>设置校园昵称</h2><p>同校学伴会看到这个名字。</p><form><label>昵称 <input name="nickname" required maxlength="24" autocomplete="nickname" placeholder="同学们怎么称呼你？"></label><button class="btn btn-primary" type="submit">' + (team ? '进入备考小组' : '和同学实练') + '</button></form><p role="status"></p></section>';
    const form = body.querySelector('form'), status = body.querySelector('[role=status]');
    if (nickname) form.elements.nickname.value = nickname;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      form.querySelector('button').disabled = true;
      try { ready(await profileRequest(form.elements.nickname.value.trim())); }
      catch (error) { if (live) status.textContent = error.message; }
      finally { if (live) form.querySelector('button').disabled = false; }
    });
  }
  async function open() {
    if (offline) {
      body.innerHTML = '<p class="note">用整合版启动器打开网站后，即可连接校园服务。</p>';
      return;
    }
    body.innerHTML = '<p class="note" role="status">正在连接校园服务…</p>';
    try {
      const info = await profileRequest();
      if (live) info.active ? ready(info) : register();
    } catch (error) {
      if (!live) return;
      body.textContent = error.message + ' ';
      const retry = document.createElement('button');
      retry.type='button'; retry.className='btn btn-secondary'; retry.textContent='重试'; retry.onclick=open;
      body.append(retry);
    }
  }
  void open();
  return () => { live=false; disposeRoom?.(); disposeDemo?.(); };
}

/*
 * 小组本周进度：只保留一个位置 —— 备考小组页顶部。
 * 其他页面不再插折叠小卡，避免「有的在画面上、有的在最下面」。
 */
export function showTeamShelf() {
  const box = document.getElementById('campus-shelf');
  if (box) { box.hidden = true; box.replaceChildren(); }
}
