import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { AlgorithmError } from './errors.mjs';
import { sha256 } from './text.mjs';

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\r' || c === '\n') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(x => x.length)) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new AlgorithmError('BANK_INVALID', '题库 CSV 引号未闭合。');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export async function loadCatalog(bankRoot) {
  const root = await realpath(bankRoot);
  const items = JSON.parse((await readFile(path.join(root, 'items.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const [header, ...rows] = parseCsv((await readFile(path.join(root, '题目清单.csv'), 'utf8')).replace(/^\uFEFF/, ''));
  const csv = new Map(rows.map(row => [Number(row[0]), Object.fromEntries(header.map((key, i) => [key, row[i]]))]));
  if (!Array.isArray(items) || !items.length || items.length !== csv.size) throw new AlgorithmError('BANK_INVALID', '题库索引和 CSV 数量不一致。');
  const seen = new Set();
  return items.map(item => {
    const questionId = `T1-${String(item.no).padStart(3, '0')}`;
    if (!Number.isInteger(item.no) || item.no < 1 || !/^T1-\d{3}$/.test(questionId) || item.file !== `${questionId}.png` || seen.has(questionId) || typeof item.prompt !== 'string' || !item.prompt.trim()) throw new AlgorithmError('BANK_INVALID', '题库编号、文件或题干异常。');
    seen.add(questionId);
    const record = csv.get(item.no);
    if (!record || record['图片文件'] !== item.file) throw new AlgorithmError('BANK_INVALID', '题图对应关系不一致。');
    return { questionId, task: 'task1', prompt: item.prompt, imageFile: item.file, source: item.source, sourceTypeHint: record['图表类型'], topicHint: record['主题'], provenance: 'user_supplied_third_party_collection', examAuthenticityVerified: false, metadataVerifiedAgainstImage: false };
  });
}

export async function loadQuestion(bankRoot, questionId, catalog) {
  if (!/^T1-\d{3}$/.test(questionId)) throw new AlgorithmError('UNKNOWN_QUESTION', 'Task 1 题号无效。');
  const entry = (catalog ?? await loadCatalog(bankRoot)).find(q => q.questionId === questionId);
  if (!entry) throw new AlgorithmError('UNKNOWN_QUESTION', '题库中不存在该题。');
  const imageRoot = await realpath(path.join(bankRoot, '图片'));
  const file = await realpath(path.join(imageRoot, entry.imageFile));
  const relative = path.relative(imageRoot, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new AlgorithmError('BANK_INVALID', '图像必须位于题库图片目录。');
  const info = await stat(file);
  if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new AlgorithmError('IMAGE_INVALID', '图像过大或不是文件。');
  const bytes = await readFile(file);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new AlgorithmError('IMAGE_INVALID', '题库需要真实 PNG 图像。');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192) throw new AlgorithmError('IMAGE_INVALID', '图像尺寸不受支持。');
  const image = { imageId: 'image-1', mimeType: 'image/png', width, height, sha256: sha256(bytes), dataUrl: 'data:image/png;base64,' + bytes.toString('base64') };
  return { ...entry, images: [image], fingerprint: sha256(JSON.stringify([entry.questionId, entry.prompt, image.sha256])) };
}

export async function auditBank(bankRoot) {
  const catalog = await loadCatalog(bankRoot); const hashes = new Map(); const tiny = []; const records = [];
  for (const item of catalog) {
    const question = await loadQuestion(bankRoot, item.questionId, catalog); const image = question.images[0];
    hashes.set(image.sha256, [...(hashes.get(image.sha256) ?? []), item.questionId]);
    if (image.width < 250 || image.height < 180) tiny.push(item.questionId);
    records.push({ ...item, fingerprint: question.fingerprint, imageSha256: image.sha256, width: image.width, height: image.height });
  }
  return { schemaVersion: 'task1-catalog-v1', count: records.length, imagePairsVerified: true, visualSemanticsVerified: false, smallImages: tiny, duplicateImageGroups: [...hashes.values()].filter(ids => ids.length > 1), sourceTypeCounts: Object.fromEntries([...new Set(catalog.map(x => x.sourceTypeHint))].map(type => [type, catalog.filter(x => x.sourceTypeHint === type).length])), items: records };
}
