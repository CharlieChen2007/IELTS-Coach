import { createHash } from 'node:crypto';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const countWords = text => (text.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*|\d+(?:[,.]\d+)*(?:%|[A-Za-z]+)?/g) ?? []).length;

/** Intl sentence segmentation preserves decimal values and UTF-16 offsets. */
export function anchorSentences(text, submissionId) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  const result = [];
  let paragraph = 0;
  for (const block of text.matchAll(/[^\r\n]+(?:\r?\n(?!\r?\n)[^\r\n]+)*/g)) {
    if (!block[0].trim()) continue;
    paragraph++;
    let index = 0;
    for (const part of segmenter.segment(block[0])) {
      const content = part.segment.trim(); if (!content) continue;
      const start = block.index + part.index + part.segment.indexOf(content);
      result.push({ id: `${submissionId}:s:${start}`, start, end: start + content.length, paragraph, index: ++index, text: content });
    }
  }
  return result;
}

export function revisionBudget(input) {
  const initialWords = countWords(input.revisionContext?.initialText ?? input.text);
  const currentWords = countWords(input.text);
  // Product coaching budget, not an IELTS marking penalty or official maximum.
  const ceiling = Math.max(initialWords, Math.min(220, Math.max(180, initialWords + Math.ceil(initialWords * .08))));
  return { initialWords, currentWords, ceiling, positiveGrowthBudget: Math.min(20, Math.max(0, ceiling - currentWords)), modelMinWords: 150, modelMaxWords: 220 };
}
