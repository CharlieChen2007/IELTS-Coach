/* IELTS Coach host integration: account-scoped local mirror + SQLite sync. */
(function () {
  'use strict';
  var root = window.SL = window.SL || {};
  var params = new URLSearchParams(location.search);
  var framed = window.parent !== window && params.get('embedded') === '1';
  var rawScope = framed ? String(params.get('scope') || '').slice(0, 160) : '';
  var embedded = framed && /^[A-Za-z0-9_-]{1,160}$/.test(rawScope);
  var scope = embedded ? encodeURIComponent(rawScope) : '';
  var nickname = embedded ? String(params.get('nickname') || '学员').slice(0, 24) : '';
  var queues = Object.create(null);
  var dirty = Object.create(null);

  function post(type, data) {
    if (embedded) window.parent.postMessage(Object.assign({ source: 'ielts-speaking', type: type }, data || {}), location.origin);
  }
  function syncLabel(text, error) {
    var el = document.getElementById('dailySync');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', !!error);
    el.hidden = !text;
  }
  function request(module, options) {
    var headers = new Headers(options && options.headers);
    headers.set('X-Speaking-Scope', scope);
    return fetch('/api/daily/' + module, Object.assign({}, options, {
      headers: headers, credentials: 'same-origin', cache: 'no-store'
    })).then(async function (response) {
      var body = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(body.error || '学习记录暂时无法同步。');
      return body;
    });
  }
  function load(module) {
    if (!embedded) return Promise.resolve(null);
    var key = 'speakloop.shadow.' + root.dailyHost.user.id;
    var unsaved;
    try { unsaved = localStorage.getItem(key + ':pending'); } catch (_) {}
    if (unsaved) {
      try {
        var local = JSON.parse(unsaved);
        persist(module, key, local);
        return Promise.resolve(local);
      } catch (_) {}
    }
    return Promise.race([
      request(module, { method: 'GET' }),
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error('同步连接超时')); }, 6000); })
    ]).then(function (result) { return result && result.data ? result.data : null; });
  }
  function persist(module, key, data) {
    var serialized = JSON.stringify(data);
    try { localStorage.setItem(key, serialized); } catch (_) {}
    if (!embedded) return Promise.resolve();
    var id = crypto.randomUUID();
    pendingSaves[module] = { key: key, state: serialized, requestId: id };
    try { localStorage.setItem(key + ':pending', serialized); } catch (_) {}
    if (typeof syncLabel === 'function') syncLabel('已存本机 · 同步中', false);
    postState(module, pendingSaves[module]);
    return Promise.resolve();
  }
  function postState(module, entry) {
    window.parent.postMessage({
      source: module === 'shadow' ? 'ielts-daily' : 'ielts-vocab',
      type: 'state', scope: scope, state: entry.state, requestId: entry.requestId
    }, location.origin);
  }
  var pendingSaves = Object.create(null);
  window.addEventListener('message', function (event) {
    if (!embedded || event.origin !== location.origin || event.source !== window.parent ||
        event.data?.source !== 'ielts-coach') return;
    Object.keys(pendingSaves).forEach(function (module) {
      var pending = pendingSaves[module];
      if (pending.requestId !== event.data.requestId) return;
      if (event.data.type === 'persisted') {
        try { if (localStorage.getItem(pending.key + ':pending') === pending.state) localStorage.removeItem(pending.key + ':pending'); } catch (_) {}
        delete pendingSaves[module];
        if (typeof syncLabel === 'function') syncLabel('已保存到账号', false);
      } else if (event.data.type === 'persist-error') {
        if (typeof syncLabel === 'function') syncLabel('已存本机 · 待同步', true);
      }
    });
  });
  function flush() { Object.keys(pendingSaves).forEach(function (module) { postState(module, pendingSaves[module]); }); }
  window.addEventListener('pagehide', flush);
  window.addEventListener('online', flush);
  function ready(route) {
    document.documentElement.classList.toggle('host-embedded', embedded);
    document.body.classList.toggle('host-embedded', embedded);
    /* 首屏初始视图（practice / library / history）由宿主按地址栏里的 hash 决定：
       顶部二级页签切到「语料库」时，打开的就是语料库，而不是先闪一下今日跟读。 */
    if (embedded) {
      var want = String(params.get('dailyView') || (location.hash || '').replace(/^#/, ''));
      if (['practice', 'library', 'history'].indexOf(want) >= 0) {
        root.dailyHost.initialView = want;
        /* shadow-app 在它自己的 script 标签执行时才把切页接口挂到 SL.shadowApp 上；
           登记在这里，等它挂好之后由它自己取用，不受脚本执行顺序影响。 */
        root.dailyHost.wantedView = want;
      }
    }
    post('ready', { initialRoute: route, route: route });
    if (!embedded) return;
    var sizing=function(){window.CoachFrameLayout.observe(function(height){post('size',{height:height});});};
    if(window.CoachFrameLayout)sizing();else document.addEventListener('coach:frame-layout-ready',sizing,{once:true});
  }
  function retry(module, key, data) {
    if (embedded && pendingSaves[module]) persist(module, key, data);
  }
  root.dailyHost = {
    initialView: ['practice','library','history'].indexOf(params.get('dailyView')) >= 0 ? params.get('dailyView') : 'practice',
    wantedView: ['practice','library','history'].indexOf(params.get('dailyView')) >= 0 ? params.get('dailyView') : 'practice',
    embedded: embedded,
    user: embedded ? { id: 'host:' + scope, name: nickname || '学员' } : null,
    load: load,
    persist: persist,
    ready: ready,
    retry: retry
  };
})();
