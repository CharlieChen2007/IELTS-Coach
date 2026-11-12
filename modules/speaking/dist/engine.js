// On-device IELTS Speaking A session engine. All mutations re-read the session
// inside one IndexedDB transaction so double clicks and overlapping tabs agree.
export const phaseLabels = {
  part1: 'Part 1 · 日常问答',
  prep: 'Part 2 · 题卡准备',
  talk: 'Part 2 · 个人陈述',
  followup: 'Part 2 · 收尾提问',
  part3: 'Part 3 · 延伸讨论',
  review: '模考回顾'
};

export const cueCard = {
  id: 'p2-talk',
  part: 2,
  prompt: 'Describe a place in your town or city where you enjoy spending time.',
  cues: [
    'where it is',
    'how you first discovered it',
    'what you usually do there',
    'and explain why you enjoy spending time there.'
  ]
};

function questions(part, prompts) {
  return prompts.map((prompt, index) => ({ id: 'p' + part + '-' + (index + 1), part, prompt }));
}

const part1 = questions(1, [
  'Hello, and welcome to your speaking practice. First, let’s talk about your everyday life. Do you work or are you a student?',
  'What do you enjoy most about your work or studies?',
  'What is a typical weekday morning like for you?',
  'Is there anything you would like to change about your daily routine?',
  'What do you usually do when you have an hour to yourself?',
  'Do you prefer making plans in advance or deciding things on the day?',
  'What kind of place do you live in?',
  'What can you see from a window in your home?',
  'Is there a room at home where you find it easy to concentrate?',
  'How do you usually travel around your neighbourhood?',
  'Has your neighbourhood changed since you first lived there?',
  'What would you show a friend visiting your area for the first time?'
]);
const wrapUp = {
  part: 2, id: 'p2-followup', prompt: 'When do you think you will next visit this place?'
};
const part3 = questions(3, [
  'What makes a public space attractive to people of different ages?',
  'Why do some public spaces stay empty even when they are well designed?',
  'How could a city find out what local people want from a new park?',
  'Should access to public leisure spaces always be free? Why or why not?',
  'How might the needs of residents differ from those of visitors?',
  'If a city has limited funds, should it improve one large park or several small spaces?',
  'How does public transport influence who can benefit from these places?',
  'What can be lost when a popular local place becomes a tourist attraction?',
  'Who should decide how historic public spaces can be changed?',
  'How could a city judge whether improvements to a public space have worked?',
  'How do climate and seasons affect the way people use shared spaces?',
  'What kinds of public spaces might people need twenty years from now?'
]);

const timings = {
  full: { part1: 270000, prep: 60000, talk: 120000, followup: 30000, part3: 270000 },
  quick: { part1: 40000, prep: 10000, talk: 25000, followup: 15000, part3: 45000 }
};
const phases = ['part1', 'prep', 'talk', 'followup', 'part3', 'review'];
const minimumLongTurnMs = 60000;

export function hasFullLongTurn(row) {
  return Array.isArray(row?.turns) && row.turns.some(turn => (turn.questionId === cueCard.id || turn.phase === 'talk') &&
    turn.part === 2 && turn.durationMs >= minimumLongTurnMs);
}

export function currentQuestion(session) {
  switch (session.phase) {
    case 'part1': return part1[session.questionIndex];
    case 'prep':
    case 'talk': return cueCard;
    case 'followup': return wrapUp;
    case 'part3': return part3[session.questionIndex];
    default: return null;
  }
}

let databaseName = 'ielts-speaking-a-v1';
let connection;

export function useAccountDatabase(userId) {
  if (connection || typeof userId !== 'string' || !userId) {
    throw new Error('无法切换账号工作区，请刷新后重试。');
  }
  databaseName = 'ielts-speaking-a-account-v1:' + userId;
}

function openStore() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('sessions', { keyPath: 'id' });
        db.createObjectStore('audio', { keyPath: ['sessionId', 'questionId'] });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
      request.onerror = () => { connection = null; reject(request.error); };
    });
  }
  return connection;
}

async function read(storeName, key) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const store = db.transaction(storeName).objectStore(storeName);
    const request = key === undefined ? store.getAll() : store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listSessions() {
  const rows = await read('sessions');
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSession(id) {
  return (await read('sessions', id)) || null;
}

export async function getAudio(sessionId, questionId) {
  const audio = await read('audio', [sessionId, questionId]);
  return audio?.blob ?? null;
}

export async function createSession(mode = 'full') {
  if (!Object.hasOwn(timings, mode)) throw new Error('无法识别练习模式');
  const db = await openStore();
  const now = Date.now();
  const session = {
    id: crypto.randomUUID(), mode, status: 'active', phase: 'part1', questionIndex: 0,
    createdAt: now, updatedAt: now, phaseStartedAt: now, deadline: now + timings[mode].part1,
    endedAt: null, submittedAt: null, interrupted: false, assessmentEligible: false,
    qualityNotes: [], interruptions: [], skipped: [], stageDurationsMs: {},
    turns: [], durationMs: 0, notes: ''
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').add(session);
    tx.oncomplete = () => resolve(session);
    tx.onabort = () => reject(tx.error || new Error('保存新场次失败'));
  });
}

async function update(id, mutate, withAudio = false) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(withAudio ? ['sessions', 'audio'] : ['sessions'], 'readwrite');
    const sessions = tx.objectStore('sessions');
    const request = sessions.get(id);
    let row, failure;
    request.onsuccess = () => {
      row = request.result;
      try {
        if (!row) throw new Error('此设备上找不到这场练习');
        const now = Date.now();
        if (mutate(row, now, tx) !== false) {
          row.updatedAt = now;
          sessions.put(row);
        }
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(row);
    tx.onabort = () => reject(failure || tx.error || new Error('练习保存失败，请检查浏览器存储空间'));
  });
}

function moveToNextPhase(row, now) {
  const previous = row.phase;
  const duration = Math.max(0, Math.min(now, row.deadline) - row.phaseStartedAt);
  row.stageDurationsMs[previous] = (row.stageDurationsMs[previous] || 0) + duration;
  row.phase = phases[phases.indexOf(previous) + 1];
  row.phaseStartedAt = now;
  row.questionIndex = 0;
  if (row.phase === 'review') {
    row.endedAt = now;
    row.deadline = null;
    row.durationMs = Object.values(row.stageDurationsMs).reduce((total, value) => total + value, 0);
    const notes = [];
    if (row.mode === 'quick') notes.push('短时演练');
    if (row.interrupted) notes.push('考试曾中断');
    if (row.skipped.length) notes.push('存在到时未保存的回答');
    const recorded = new Set(row.turns.map(turn => turn.part));
    if ([1, 2, 3].some(part => !recorded.has(part)) || !row.turns.some(turn => turn.questionId === cueCard.id)) {
      notes.push('三部分录音证据不完整');
    }
    if (row.mode === 'full' && !hasFullLongTurn(row)) notes.push('Part 2 独白录音不足 60 秒');
    if (row.mode === 'full' && (row.durationMs < 660000 ||
        row.stageDurationsMs.part1 < 240000 || row.stageDurationsMs.part3 < 240000)) {
      notes.push('未达到完整模考时长');
    }
    row.qualityNotes = notes;
    row.assessmentEligible = notes.length === 0;
  } else {
    row.deadline = now + timings[row.mode][row.phase];
  }
}

// An active turn is transient until its media and metadata are committed.
// Expired clocks on reopening should never jump a learner to the final report.
export function resumeSession(id, { lostTurn = false } = {}) {
  return update(id, (row, now) => {
    if (row.status !== 'active' || !row.deadline || (now < row.deadline && !lostTurn)) return false;
    row.interrupted = true;
    row.interruptions.push({ phase: row.phase, questionId: currentQuestion(row)?.id, resumedAt: now });
    if (now < row.deadline) return;
    row.stageDurationsMs[row.phase] = (row.stageDurationsMs[row.phase] || 0) +
      Math.max(0, row.deadline - row.phaseStartedAt);
    row.phaseStartedAt = now;
    row.deadline = now + timings[row.mode][row.phase];
  });
}

export function saveNotes(id, text) {
  return update(id, row => {
    if (row.status !== 'active' || row.phase !== 'prep') return false;
    row.notes = String(text || '').slice(0, 4000);
  });
}

export function beginPart2(id) {
  return update(id, (row, now) => {
    if (row.status !== 'active' || row.phase !== 'prep' || now < row.deadline) return false;
    moveToNextPhase(row, now);
  });
}

export function advanceExpired(id, expectedPhase, {attempted = false} = {}) {
  return update(id, (row, now) => {
    if (row.status !== 'active' || !row.deadline || now < row.deadline ||
        (expectedPhase && expectedPhase !== row.phase)) return false;
    const timedInterview = row.phase === 'part1' || row.phase === 'part3';
    const finishedTurn = timedInterview && row.turns.some(turn => turn.phase === row.phase);
    if (row.phase !== 'prep' && (!finishedTurn || attempted)) {
      row.skipped.push({ questionId: currentQuestion(row).id, phase: row.phase, reason: 'timeout', at: now });
    }
    moveToNextPhase(row, now);
  });
}

export function saveAnswer(id, questionId, answer) {
  return update(id, (row, now, tx) => {
    if (row.turns.some(turn => turn.questionId === questionId)) return false;
    if (row.status !== 'active' || row.phase === 'review') throw new Error('答卷已锁定');
    const question = currentQuestion(row);
    if (row.phase === 'prep' || question?.id !== questionId) throw new Error('此问题已结束，请刷新当前场次');
    const blob = answer?.blob;
    if (!(blob instanceof Blob) || !blob.size || !(answer.durationMs > 0) ||
        !Number.isFinite(answer.durationMs) || answer.hasSpeech === false || answer.silent === true) {
      throw new Error('没有可保存的有效录音，请重录本题');
    }
    const transcript = String(answer.transcript || '').trim();
    const durationMs = Math.round(answer.durationMs);
    const turn = {
      id: question.id, questionId: question.id, turnIndex: row.turns.length + 1,
      part: question.part, phase: row.phase, prompt: question.prompt,
      durationMs, recordedAt: now - durationMs, savedAt: now, byteLength: blob.size,
      mimeType: blob.type || 'application/octet-stream', transcript,
      transcriptStatus: String(answer.transcriptStatus || (transcript ? 'available' : 'unavailable')),
      transcriptSource: transcript ? String(answer.transcriptSource ||
        (answer.transcriptStatus ? 'browser-recognition' : 'unspecified')) : 'unavailable'
    };
    if (question.cues) turn.cues = [...question.cues];
    tx.objectStore('audio').add({ sessionId: id, questionId, blob });
    row.turns.push(turn);
    if (row.phase === 'part1' || row.phase === 'part3') {
      const bank = row.phase === 'part1' ? part1 : part3;
      const size = row.mode === 'quick' ? 1 : bank.length;
      if (now < row.deadline && row.questionIndex + 1 < size) {
        row.questionIndex += 1;
        return;
      }
    }
    moveToNextPhase(row, now);
  }, true);
}

export function submitSession(id) {
  return update(id, (row, now) => {
    if (row.status === 'submitted') return false;
    if (row.phase !== 'review') throw new Error('请先完成三个部分');
    // A local review can predate the stricter monologue requirement. Once
    // submitted, the handoff must stay immutable for cloud upload retries.
    if (row.assessmentEligible && row.mode === 'full' && !hasFullLongTurn(row)) {
      row.assessmentEligible = false;
      row.qualityNotes.push('Part 2 独白录音不足 60 秒');
    }
    row.status = 'submitted';
    row.submittedAt = now;
  });
}

export function markCloudSynced(id) {
  return update(id, (row, now) => {
    if (row.status !== 'submitted' || row.cloudSyncedAt) return false;
    row.cloudSyncedAt = now;
  });
}

export function updateTranscript(id, questionId, text) {
  return update(id, row => {
    if (row.status === 'submitted') throw new Error('答卷已提交，无法修改转写');
    const turn = row.turns.find(item => item.questionId === questionId);
    if (!turn) throw new Error('没有找到这段回答');
    turn.transcript = String(text ?? '').trim();
    turn.transcriptSource = 'manual';
    turn.transcriptStatus = turn.transcript ? 'available' : 'unavailable';
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function exportSession(id) {
  const row = await getSession(id);
  return buildHandoff(row, getAudio);
}

export async function buildHandoff(row, readAudio) {
  if (!row || row.status !== 'submitted') throw new Error('请先交卷再导出');
  const turns = [];
  for (const turn of row.turns) {
    const blob = await readAudio(row.id, turn.questionId);
    if (!blob || blob.size !== turn.byteLength) throw new Error('录音数据缺失，交接包暂时无法导出');
    turns.push({ ...turn, audio: {
      mimeType: turn.mimeType, byteLength: blob.size, encoding: 'base64',
      data: await blobToBase64(blob)
    }});
  }
  const session = {
    id: row.id, mode: row.mode, status: row.status,
    createdAt: row.createdAt, endedAt: row.endedAt, submittedAt: row.submittedAt,
    durationMs: row.durationMs, interrupted: row.interrupted, assessmentEligible: row.assessmentEligible,
    qualityNotes: row.qualityNotes, stageDurationsMs: row.stageDurationsMs,
    interruptions: row.interruptions, skipped: row.skipped
  };
  const payload = { schemaVersion: 'speaking-a.handoff.v1', exportedAt: Date.now(), session, turns };
  return new Blob([JSON.stringify(payload)], { type: 'application/json;charset=utf-8' });
}
