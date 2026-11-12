import { apiFetch, embedded, nickname, scope } from './host-bridge.js';
import { releaseSessionScores } from './score-queue.js';
// The Worker opts hosted pages into authenticated cloud sync. Local HTML and
// the legacy /local workspace keep their original browser-only storage.
class AccountCloud {
    enabled = embedded || !!document.querySelector('meta[name="speaking-cloud"][content="enabled"]');
    userId = '';
    records = new Map();

    async request(path, options = {}) {
        const headers = new Headers(options.headers);
        if (this.userId) headers.set('X-Speaking-Account', this.userId);
        let response;
        try {
            response = await apiFetch(path, {
                ...options, headers, credentials: 'same-origin', redirect: 'manual',
                cache: 'no-store',
                signal: AbortSignal.timeout(options.method === 'POST' ? 200000 : 20000)
            });
        } catch {
            throw new Error('连接云端失败，请检查网络后重试。');
        }
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            if (response.status === 401 || response.status === 403 || response.type === 'opaqueredirect' ||
                error.code === 'ACCOUNT_CHANGED') {
                window.dispatchEvent(new Event('speaking-account-lost'));
                throw Object.assign(new Error('登录状态已改变，请重新打开账号工作区。'),{accountChanged:true,status:response.status});
            }
            const failure = new Error(typeof error.error === 'string' ? error.error : '云端暂时不可用，请稍后重试。');
            failure.status = response.status;
            throw failure;
        }
        return response;
    }

    async verify() {
        if(embedded){
            const state=await apiFetch('/api/campus/me',{credentials:'same-origin',cache:'no-store'}).then(response=>response.json());
            if(!state.active){
                const joined=await apiFetch('/api/campus/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:nickname||'同学'})});
                if(!joined.ok)throw Error('无法连接当前账号的口语学习空间，请重新进入。');
            }
        }
        const response = await this.request('/api/me');
        const { userId } = await response.json();
        if (typeof userId !== 'string' || !userId || (this.userId && this.userId !== userId)) {
            window.dispatchEvent(new Event('speaking-account-lost'));
            throw Object.assign(new Error('请重新登录后打开账号工作区。'),{accountChanged:true});
        }
        this.userId = userId;
        return userId;
    }

    async refresh() {
        const found = new Map();
        const visited = new Set();
        let cursor = '';
        do {
            const suffix = cursor ? '?cursor=' + encodeURIComponent(cursor) : '';
            const response = await this.request('/api/sessions' + suffix);
            const data = await response.json();
            if (!Array.isArray(data.sessions)) throw new Error('暂时无法读取云端历史。');
            for (const session of data.sessions) found.set(session.id, session);
            cursor = data.nextCursor;
            if (cursor && visited.has(cursor)) throw new Error('暂时无法读取完整的云端历史。');
            visited.add(cursor);
        } while (cursor);
        this.records = found;
        if(found.size)await releaseSessionScores(embedded?'host:'+scope:'standalone:'+this.userId,[...found.keys()]).catch(()=>{});
    }

    async getSession(id) {
        const response = await this.request('/api/sessions/' + encodeURIComponent(id));
        return (await response.json()).session;
    }

    async getAudio(id, questionId) {
        const url = '/api/sessions/' + encodeURIComponent(id) + '/audio/' + encodeURIComponent(questionId);
        return (await this.request(url)).blob();
    }

    async save(file) {
        const response = await this.request('/api/sessions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: file
        });
        const { session } = await response.json();
        if (!session || session.status !== 'submitted' || !Array.isArray(session.turns)) {
            throw new Error('尚未收到云端保存确认，请重试。');
        }
        this.records.set(session.id, session);
        await releaseSessionScores(embedded?'host:'+scope:'standalone:'+this.userId,session.id).catch(()=>{});
        return session;
    }
}

export const cloud = new AccountCloud();
