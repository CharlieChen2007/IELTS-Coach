// Tencent SOE-N WebSocket protocol: https://cloud.tencent.com/document/product/1774/107497
async function tencentEvaluationUrl(env, word) {
  const appId = String(env.TENCENT_APP_ID ?? '').trim();
  const secretId = env.TENCENT_SECRET_ID?.trim();
  const secretKey = env.TENCENT_SECRET_KEY?.trim();
  if (!/^\d+$/.test(appId) || !secretId || !secretKey) {
    throw new Error('腾讯云口语评测凭证尚未配置完整。');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const parameters = {
    eval_mode: word ? 4 : 3,
    expired: timestamp + 300,
    nonce: crypto.getRandomValues(new Uint32Array(1))[0] || 1,
    rec_mode: 1,
    score_coeff: '4.0',
    secretid: secretId,
    sentence_info_enabled: 0,
    server_engine_type: '16k_en',
    timestamp,
    voice_format: 0,
    voice_id: crypto.randomUUID()
  };
  if (word) parameters.ref_text = word;
  const pairs = Object.keys(parameters).sort().map(key => [key, String(parameters[key])]);
  const endpoint = 'soe.cloud.tencent.com/soe/api/' + appId;
  const unsignedQuery = pairs.map(([key, value]) => key + '=' + value).join('&');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secretKey), {name: 'HMAC', hash: 'SHA-1'}, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(endpoint + '?' + unsignedQuery));
  const query = new URLSearchParams(pairs);
  query.set('signature', btoa(String.fromCharCode(...new Uint8Array(signature))));
  return 'https://' + endpoint + '?' + query;
}

function tencentPercentage(value, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) return null;
  return Math.round(value / maximum * 1000) / 10;
}

function tencentText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function tencentScores(result, wordMode) {
  const words = [];
  for (const row of Array.isArray(result.Words) ? result.Words : []) {
    if (!row || row.MatchTag === 5) continue;
    const word = tencentText(row.Word) || tencentText(row.ReferenceWord);
    if (!word) continue;
    const phones = [];
    for (const phone of Array.isArray(row.PhoneInfos) ? row.PhoneInfos : []) {
      if (!phone) continue;
      const target = tencentText(phone.ReferencePhone);
      const actual = tencentText(phone.Phone);
      if (!target && !actual) continue;
      phones.push({
        target, actual,
        accuracy: tencentPercentage(phone.PronAccuracy, 1),
        stress: typeof phone.Stress === 'boolean' ? phone.Stress : null,
        detectedStress: typeof phone.DetectedStress === 'boolean' ? phone.DetectedStress : null
      });
    }
    words.push({
      word, accuracy: tencentPercentage(row.PronAccuracy, 100),
      fluency: tencentPercentage(row.PronFluency, 1), phones
    });
  }
  const accuracy = tencentPercentage(result.PronAccuracy, wordMode ? 1 : 100);
  const fluency = tencentPercentage(result.PronFluency, 1);
  if (accuracy === null && fluency === null && !words.some(row =>
    row.accuracy !== null || row.fluency !== null || row.phones.some(phone => phone.accuracy !== null)
  )) throw new Error('腾讯云未返回可用的语音评分，请重新录一段清晰的英语。');
  return {accuracy, fluency, words};
}

function tencentFailure(code) {
  if ([4105, 4108].includes(code)) return new Error('腾讯云未识别到有效语音，请检查麦克风并重录。');
  if ([4102, 4103, 4114].includes(code)) return new Error('腾讯云无法评测这个参考词，请选择其他英文单词。');
  if (code === 4006) return new Error('当前口语评测繁忙，请稍后再试。');
  if ([4002, 4003, 4004, 4005].includes(code)) return new Error('腾讯云口语评测暂不可用，请联系网站管理员（' + code + '）。');
  return new Error('腾讯云无法完成本次评测（' + (Number.isInteger(code) ? code : '响应异常') + '）。');
}

async function runTencentEvaluation(socket, pcm, wordMode) {
  let timeout;
  let uploaded = false;
  let active = true;
  let lastResult = null;
  try {
    const result = await new Promise((resolve, reject) => {
      const resetTimeout = ms => {
        clearTimeout(timeout);
        timeout = setTimeout(() => reject(new Error('等待腾讯云口语评测超时，请稍后再试。')), ms);
      };
      socket.addEventListener('error', () => reject(new Error('腾讯云口语评测连接异常。')));
      socket.addEventListener('close', () => reject(new Error('腾讯云在评测完成前关闭了连接。')));
      socket.addEventListener('message', ({data}) => {
        if (!active) return;
        try {
          const message = JSON.parse(data);
          if (!message || typeof message !== 'object') throw new Error('腾讯云返回了无法读取的评测结果。');
          if (message.code !== 0) throw tencentFailure(message.code);
          if (!uploaded) {
            if (message.result || message.final) throw new Error('腾讯云口语评测握手异常。');
            uploaded = true;
            // Recording mode takes exactly one binary frame, then a separate text end marker.
            resetTimeout(60000);
            socket.send(pcm);
            socket.send('{"type":"end"}');
            return;
          }
          let result = message.result;
          if (typeof result === 'string') {
            // Some SDK versions deliver the result as nested JSON.
            try { result = JSON.parse(result); } catch { result = null; }
          }
          // SentenceId -1 identifies the complete utterance. Do not use an interim
          // sentence as the score for an entire answer when final is only a marker.
          if (result && typeof result === 'object' &&
              ('PronAccuracy' in result || 'PronFluency' in result || Array.isArray(result.Words)) &&
              (message.final === 1 || result.SentenceId === -1 || result.SentenceId == null)) {
            lastResult = {...lastResult, ...result};
          }
          if (message.final === 1) {
            if (!lastResult) throw new Error('腾讯云未返回完整的语音评测结果。');
            resolve(lastResult);
          }
        } catch (error) {
          reject(error instanceof SyntaxError ? new Error('腾讯云返回了无法读取的评测结果。') : error);
        }
      });
      resetTimeout(10000);
      socket.accept?.();
    });
    return tencentScores(result, wordMode);
  } finally {
    active = false;
    clearTimeout(timeout);
    try { socket.close(1000); } catch { /* The peer may have already closed. */ }
  }
}

export async function evaluateTencent(env, {pcm, word = null}) {
  if (!(pcm instanceof Uint8Array) || !pcm.byteLength || pcm.byteLength % 2 || pcm.byteLength > 60 * 32000) {
    throw new Error('评测需要 60 秒以内的 16 kHz 单声道 16 位 PCM 录音。');
  }
  if (word !== null && (typeof word !== 'string' || word.length > 64 || !/^[a-z]+(?:['-][a-z]+)*$/i.test(word))) {
    throw new Error('请提供一个英文单词用于跟读。');
  }
  const url = await tencentEvaluationUrl(env, word);
  if (env.openTencentSocket) return runTencentEvaluation(env.openTencentSocket(url), pcm, word !== null);
  // Cloudflare Workers can open a WebSocket through fetch({Upgrade}); Node's
  // fetch rejects that header outright (UND_ERR_INVALID_ARG), so the Node
  // deployment must use the platform WebSocket client on the signed wss URL.
  if (typeof WebSocket === 'function' && url.startsWith('https://')) {
    let socket;
    try {
      socket = new WebSocket(url.replace(/^https:/, 'wss:'));
    } catch {
      throw new Error('无法连接腾讯云口语评测服务。');
    }
    return runTencentEvaluation(socket, pcm, word !== null);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(url, {
      headers: {Upgrade: 'websocket'}, redirect: 'manual', signal: controller.signal
    });
  } catch {
    throw new Error('无法连接腾讯云口语评测服务。');
  } finally {
    clearTimeout(timeout);
  }
  if (response.status !== 101 || !response.webSocket) {
    throw new Error('腾讯云未建立口语评测连接。');
  }
  return runTencentEvaluation(response.webSocket, pcm, word !== null);
}
