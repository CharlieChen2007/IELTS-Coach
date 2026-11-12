/** A single, account-scoped write queue survives iframe navigation. */
type Job = { path: string; field: string; scope: string; value: string; revision?: number }
type Ack = { source: Window; revision?: number; requestId?: string; module: string }
const modules = {
  'ielts-reading': { path: '/api/reading/state', field: 'state', module: 'reading', frame: '/reading/' },
  'ielts-writing': { path: '/api/writing/workspace', field: 'workspace', module: 'writing', frame: '/writing/' },
  'ielts-daily': { path: '/api/daily/shadow', field: 'state', module: 'daily', frame: '/speaking/shadow.html' },
  'ielts-vocab': { path: '/api/daily/vocab', field: 'state', module: 'vocab', frame: '/vocab/' },
} as const
const pending = new Map<string, { job: Job; acks: Ack[] }>()
const running = new Set<string>()
const blocked = new Set<string>()
/** key → 已经成功落库的最大版本号，用来丢弃同版本的重复上传。 */
const saved = new Map<string, number>()
const cachePrefix = 'coach-backup-pending:'
/** keepalive 的 64KB 是「所有并发 keepalive 请求」的全局配额，单请求放太大就会把
 *  同批的另一个请求挤到挂起（交卷瞬间会连发两次 29KB 状态）。这里只给小块用
 *  keepalive，大块走普通请求——主站 window 不销毁，本来也不需要 keepalive。 */
const KEEPALIVE_LIMIT = 16000
let currentScope = ''
let timer = 0
function canonical(scope: string) {
  try { return decodeURIComponent(scope) } catch { return scope }
}
function queueKey(job: Job) { return job.path + '|' + canonical(job.scope) }
function savePending(key: string, job?: Job) {
  try {
    if (job) localStorage.setItem(cachePrefix + key, JSON.stringify(job))
    else localStorage.removeItem(cachePrefix + key)
  } catch { /* The originating module still retains its local draft. */ }
}
export function setPersistenceScope(scope: string) {
  currentScope = scope
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      if (!key.startsWith(cachePrefix)) continue
      const job = JSON.parse(localStorage.getItem(key) || 'null') as Job | null
      if (job && canonical(job.scope) === scope && Object.values(modules).some(m => m.path === job.path && m.field === job.field)) {
        const id = queueKey(job)
        if (!pending.has(id) && !running.has(id)) pending.set(id, { job, acks: [] })
      }
    }
  } catch { /* Storage can be disabled. */ }
  schedule()
}
function schedule(delay = 100) {
  if (timer) return
  timer = window.setTimeout(() => { timer = 0; flush() }, delay)
}
function acknowledge(acks: Ack[], error?: string) {
  for (const ack of acks) {
    try { ack.source.postMessage({ source: 'ielts-coach', type: error ? 'persist-error' : 'persisted', module: ack.module,
      revision: ack.revision, requestId: ack.requestId, ...(error ? { message: error } : {}) }, location.origin) } catch { /* The frame may have closed. */ }
  }
}
async function send(key: string) {
  if (running.has(key) || blocked.has(key)) return
  const entry = pending.get(key)
  if (!entry) return
  running.add(key)
  pending.delete(key)
  const revision = typeof entry.job.revision === 'number' ? entry.job.revision : 0
  /* 同一版本已经落库：直接确认，不再重复上传。交卷时 iframe 会连发多次状态，
     重复的大请求只会挤占 keepalive 配额并把后一个挤到超时。 */
  if (revision && revision <= (saved.get(key) || 0)) {
    acknowledge(entry.acks)
    savePending(key)
    running.delete(key)
    return
  }
  let failed = false
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20000)
  try {
    const body = JSON.stringify({ [entry.job.field]: entry.job.value })
    const response = await fetch(entry.job.path + '?scope=' + encodeURIComponent(entry.job.scope), {
      method: 'PUT', credentials: 'same-origin', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Speaking-Scope': entry.job.scope },
      keepalive: new Blob([body]).size < KEEPALIVE_LIMIT, body,
    })
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 429) blocked.add(key)
      throw new Error('同步暂未完成，练习已保存在此浏览器。')
    }
    if (revision) saved.set(key, Math.max(revision, saved.get(key) || 0))
    acknowledge(entry.acks)
    if (entry.job.path === '/api/writing/workspace' && canonical(entry.job.scope) === currentScope) window.dispatchEvent(new Event('ielts:writing-saved'))
    if (!pending.has(key)) savePending(key)
  } catch {
    failed = true
    /* 该版本可能已经由前一次请求写成功（重复消息），这种情况不再回报失败，
       否则界面会留下一条与事实不符的「未保存」提示。 */
    const done = saved.get(key) || 0
    const stale = entry.acks.filter((ack) => !(Number(ack.revision) && Number(ack.revision) <= done))
    if (stale.length) acknowledge(stale, '同步暂未完成，练习已保存在此浏览器。')
    if (!pending.has(key)) pending.set(key, entry)
  } finally {
    clearTimeout(timeout)
    running.delete(key)
    if (pending.has(key) && !blocked.has(key)) schedule(failed ? 15000 : 100)
  }
}
function flush() {
  for (const [key, entry] of pending) {
    if (canonical(entry.job.scope) === currentScope) void send(key)
  }
}
window.addEventListener('message', (event: MessageEvent) => {
  if (event.origin !== location.origin || !event.source) return
  const data = event.data
  if (!data || typeof data !== 'object' || !Object.hasOwn(modules, data.source)) return
  const config = modules[data.source as keyof typeof modules]
  if (data.type !== (config.module === 'writing' ? 'workspace' : 'state')) return
  if (typeof data.scope !== 'string' || canonical(data.scope) !== currentScope || typeof data[config.field] !== 'string') return
  const frame = Array.from(document.querySelectorAll('iframe')).find(frame => frame.contentWindow === event.source)
  if (!frame) return
  const url = new URL(frame.src, location.href)
  if (url.origin !== location.origin || !url.pathname.startsWith(config.frame) || canonical(url.searchParams.get('scope') || '') !== currentScope) return
  const job = { path: config.path, field: config.field, scope: data.scope, value: data[config.field],
    revision: typeof data.revision === 'number' ? data.revision : undefined }
  const key = queueKey(job)
  const old = pending.get(key)
  const ack = { source: event.source as Window, revision: data.revision, requestId: data.requestId, module: config.module }
  blocked.delete(key)
  pending.set(key, { job, acks: [...(old?.acks || []), ack].slice(-50) })
  savePending(key, job)
  schedule()
})
window.addEventListener('online', () => schedule())
window.addEventListener('focus', () => schedule())
window.addEventListener('pagehide', () => {
  for (const { job } of pending.values()) {
    if (canonical(job.scope) !== currentScope) continue
    const body = JSON.stringify({ [job.field]: job.value })
    if (new Blob([body]).size < 60000) navigator.sendBeacon?.(job.path + '?scope=' + encodeURIComponent(job.scope), new Blob([body], { type: 'application/json' }))
  }
})
