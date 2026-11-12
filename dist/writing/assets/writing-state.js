export const WORKSPACE_KEY = 'tcamp-guest-workspace:v1';
export const STATE_VERSION = 'coach-writing-workspace-v2';
export function decodeWorkspace(value) {
  const data = JSON.parse(value);
  if (data?.schema === STATE_VERSION && data.keys && typeof data.keys === 'object' && !Array.isArray(data.keys)) return data;
  if (data?.schemaVersion === 1 && Array.isArray(data.entries)) return {schema: STATE_VERSION, keys: {[WORKSPACE_KEY]: value}, topics: {}};
  throw Error('写作工作区结构无效。');
}
export function extractSubmissions(snapshot) {
  const result = [];
  const topic = snapshot.topics || {};
  const parse = value => {try {return JSON.parse(value || '{}')} catch {return {}}};
  const task2 = parse(snapshot.keys[WORKSPACE_KEY]);
  for (const entry of Array.isArray(task2.entries)?task2.entries:[]) {
    if (!entry || entry.status !== 'done' || entry.isExample || !entry.report || !entry.text?.trim()) continue;
    if(typeof entry.text !== 'string')continue;
    result.push({...entry, task: 'task2', topic: topic[entry.topicId] || {id:entry.topicId, prompt:''}});
  }
  for (const [key,value] of Object.entries(snapshot.keys)) {
    if (!key.startsWith('tcamp-task1:v2:')) continue;
    const store = parse(value);
    for (const [id,item] of Object.entries(store.items || {})) {
      for (const prior of [...(Array.isArray(item.history)?item.history:[]), item]) {
        const report = prior.report;
        if (!report || report.isExample || !prior.baseline?.trim()) continue;
        const submissionId = report.submissionId || report.feedback?.submissionId;
        if (!submissionId) continue;
        result.push({id:submissionId, task:'task1', topicId:id, topic:topic[id] || {id,prompt:''}, text:prior.baseline,
          status:'done', isExample:false, mode:'essay', version:1, report, createdAt:report.createdAt || report.generation?.generatedAt || new Date().toISOString()});
      }
    }
  }
  return result;
}
