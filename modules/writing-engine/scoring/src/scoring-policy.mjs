// Versioned product policy. IELTS weights are separate from product display/recency rules.
export const SCORING_VERSION = 'writing-composite-v1';
export const SCORING_ALGORITHM_VERSION = '1.1.0';
export const SCORING_POLICY = Object.freeze({
  id: 'first-draft-pair-2026-11-v1.1',
  maxAgeDays: 90,
  maxPairGapDays: 7,
  rounding: 'nearest_half_ties_up_product_display',
  task1: Object.freeze({ reportSchema: 'task1-ai-v1', rubric: 'ielts-task1-2023-product-v1', prompt: 'a246f4143fcb3e0e', requestedModel: 'deepseek-flash' }),
  task2: Object.freeze({ reportSchema: 'task2-ai-v2', rubric: 'ielts-task2-2023-product-v2', prompt: '091a6e0c1b785535', requestedModel: 'deepseek-flash', compatibleReleases: Object.freeze([
    Object.freeze({reportSchema:'task2-ai-v2',rubric:'ielts-task2-2023-product-v2',prompt:'091a6e0c1b785535',requestedModel:'deepseek-flash'}),
    Object.freeze({reportSchema:'task2-ai-v2.1',rubric:'ielts-task2-2023-product-v2',prompt:'654884cc1701851f',requestedModel:'deepseek-flash'}),
    // WorkBuddy's once-success delivery prompt; scores/rubric and report schema
    // are unchanged. Keep exact tuples so unrelated prompt versions stay out.
    Object.freeze({reportSchema:'task2-ai-v2.1',rubric:'ielts-task2-2023-product-v2',prompt:'27ab5729b2fe3aa9',requestedModel:'deepseek-flash'}),
  ]) }),
});
