// 内容适配器：Step 2 读取静态 JSON；Step 3/4 换成 API 或版本库时只替换本文件
const BASE = 'content/passages/';
const GLOSSARY = 'content/glossary.json';
const GLOSSARY_DETAIL = 'content/glossary-detail.json';

let cache = null;
let glossary = null;
let glossaryDetail = null;

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`加载失败 ${url} (${res.status})`);
  return res.json();
}

export async function loadAll() {
  if (cache) return cache;
  const [ids, words, detail] = await Promise.all([
    getJSON(`${BASE}index.json`),
    getJSON(GLOSSARY).catch(() => ({ words: {} })),
    getJSON(GLOSSARY_DETAIL).catch(() => ({ detail: {} })),
  ]);
  const list = await Promise.all(ids.map((id) => getJSON(`${BASE}${id}.json`)));
  glossary = words;
  glossaryDetail = detail;
  cache = list;
  return list;
}

/** 离线词库：{ words: { surface: [词性, 释义, 原形?] } } */
export function getGlossary() {
  return glossary || { words: {} };
}

/** 词条补充信息：{ detail: { 词头: { ipa:{uk,us}, forms:[], coll:[] } } }（可选文件） */
export function getGlossaryDetail() {
  return glossaryDetail?.detail || {};
}

export function allPassages() {
  return cache || [];
}

export function getPassage(id) {
  return (cache || []).find((p) => p.id === id) || null;
}

export function questionCount(passage) {
  return passage.sections.reduce((n, s) => n + s.questions.length, 0);
}
