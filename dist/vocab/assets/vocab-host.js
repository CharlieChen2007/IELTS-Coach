/* IELTS Coach host integration · SpeakLoop 词汇模块
 *
 * 与每日语料（daily-host.js）同一套基础设施：
 *   - 账号由宿主 URL 的 scope 决定，X-Speaking-Scope 隔离到站点 SQLite；
 *   - 进度同时写 localStorage（离线可用）与 /api/daily/vocab（跨设备持久）；
 *   - postMessage 向宿主报 ready / size，宿主据此淡入 iframe 并撑好高度；
 *   - host-embedded class 由 vocab.html 的 head 内联脚本在首帧前打上，
 *     这里在 ready() 里再兜底一次，保证独立站打开时不会残留。
 */
(function () {
  'use strict';
  var root = window.SL = window.SL || {};
  var params = new URLSearchParams(location.search);
  var framed = window.parent !== window && params.get('embedded') === '1';
  var rawScope = framed ? String(params.get('scope') || '').slice(0, 160) : '';
  var embedded = framed && /^[A-Za-z0-9_-]{1,160}$/.test(rawScope);
  var scope = embedded ? encodeURIComponent(rawScope) : '';
  var nickname = embedded ? String(params.get('nickname') || '学员').slice(0, 24) : '';
  var MODULE = 'vocab';
  var queue = Promise.resolve();

  function post(type, data) {
    if (embedded) {
      window.parent.postMessage(Object.assign({ source: 'ielts-vocab', type: type }, data || {}), location.origin);
    }
  }
  function request(options) {
    var headers = new Headers(options && options.headers);
    headers.set('X-Speaking-Scope', scope);
    return fetch('/api/daily/' + MODULE, Object.assign({}, options, {
      headers: headers, credentials: 'same-origin', cache: 'no-store'
    })).then(async function (response) {
      var body = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(body.error || '学习记录暂时无法同步。');
      return body;
    });
  }
  function load() {
    if (!embedded) return Promise.resolve(null);
    var key = 'speakloop.vocab.' + root.vocabHost.user.id;
    var unsaved;
    try { unsaved = localStorage.getItem(key + ':pending'); } catch (_) {}
    if (unsaved) {
      try {
        var local = JSON.parse(unsaved);
        persist(local, key);
        return Promise.resolve(local);
      } catch (_) {}
    }
    return Promise.race([
      request({ method: 'GET' }),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('同步连接超时')); }, 6000);
      })
    ]).then(function (result) { return result && result.data ? result.data : null; })
      .catch(function () { return null; });
  }
  function persist(db, key) {
    var module = MODULE;
    var data = db;
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
  function ready() {
    document.documentElement.classList.toggle('host-embedded', embedded);
    document.body.classList.toggle('host-embedded', embedded);
    post('ready', {});
    if (!embedded) return;
    var sizing=function(){window.CoachFrameLayout.observe(function(height){post('size',{height:height});});};
    if(window.CoachFrameLayout)sizing();else document.addEventListener('coach:frame-layout-ready',sizing,{once:true});
  }
  root.vocabHost = {
    embedded: embedded,
    user: embedded ? { id: 'host:' + scope, name: nickname || '学员' } : null,
    load: load,
    persist: persist,
    ready: ready
  };
})();
