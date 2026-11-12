import {handleApi} from '../modules/speaking/server/api.mjs';
import {handleSocial} from '../modules/campus-social/api.mjs';
import {handleClinic} from '../modules/campus-clinic/api.mjs';
import {handleListening} from '../modules/listening/api.mjs';
import {isWritingApi, handleWritingApi} from './writing-api.mjs';
import {isReadingApi, handleReadingApi} from './reading-api.mjs';
import {isStudyCoachApi, handleStudyCoach} from '../modules/study-coach/api.mjs';

// Only claim endpoints belonging to this module, so the host can mount other subjects here.
export function isSpeakingApi(pathname) {
  return isWritingApi(pathname)
    || isReadingApi(pathname)
    || isStudyCoachApi(pathname)
    || /^\/api\/(?:campus|coach|soe|social|clinic|listening|daily)(?:\/|$)/.test(pathname)
    || /^\/api\/(?:sessions(?:\/|$)|(?:health|me|practice)$)/.test(pathname);
}

export function speakingApi(request, bindings) {
  // WorkBuddy account IDs from the browser cannot authenticate the legacy account-only endpoints.
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith('oai-')) headers.delete(name);
  }
  const safe = new Request(request, {headers});
  const url = new URL(safe.url);
  /* 写作 / 阅读模块是独立交接包，各有自己的账号隔离表，不走口语 api.mjs 的分发。 */
  if (isWritingApi(url.pathname)) return handleWritingApi(safe, bindings);
  if (isReadingApi(url.pathname)) return handleReadingApi(safe, bindings);
  if (isStudyCoachApi(url.pathname)) return handleStudyCoach(safe, bindings);
  if (/^\/api\/(?:social|clinic|listening)\//.test(url.pathname)) {
    if (!['GET','HEAD'].includes(safe.method) && (safe.headers.get('Origin') !== url.origin || safe.headers.get('Sec-Fetch-Site') === 'cross-site')) {
      return Response.json({error:'请从本站提交。'}, {status:403});
    }
    if (url.pathname.startsWith('/api/listening/')) return handleListening(safe, bindings);
    return url.pathname.startsWith('/api/social/') ? handleSocial(safe, bindings) : handleClinic(safe, bindings);
  }
  return handleApi(safe, bindings);
}
