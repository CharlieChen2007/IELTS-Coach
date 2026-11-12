export const TASK2_QUESTION_POLICY_VERSION='explicit-requests-v1';

/** Conservative terminal-instruction patterns. Ambiguous/multi-question prompts fall back to model analysis. */
export function parseExplicitTask2Question(question) {
  const prompt=question.prompt;
  const opinion=/(?:To what extent do you agree or disagree|Do you agree or disagree)\s*\?\s*$/i.exec(prompt);
  const discussion=/Discuss both(?: these)? views and give your(?: own)? opinion(?:s)?\.?\s*$/i.exec(prompt);
  const match=opinion??discussion;if(!match)return null;
  const background=prompt.slice(0,match.index).trim();
  // Do not flatten a preceding question, an imperative or a second evaluation requirement.
  if(!background||/\?/.test(background)||/(?:^|[.!]\s+)(?:explain|discuss|suggest|describe|give|state|evaluate|compare|assess|what|why|how)\b/i.test(background)||/\b(?:give reasons|what measures|what solutions|advantages.{0,30}disadvantages|outweigh)\b/i.test(background))return null;
  const promptQuote=match[0].trim();
  const requirement=(id,kind,description)=>({id,kind,description,promptQuote});
  return {
    policyVersion:TASK2_QUESTION_POLICY_VERSION,
    analysis:{promptQuality:'clear',questionType:opinion?'opinion':'discussion',stanceRequired:true,
      requirements:opinion?[requirement('r1','position','直接回答是否及多大程度同意题干主张，保留对象和限定词。理由展开由TR另评，不额外强制反方段、利弊权衡或新措施。')]:[
        requirement('r1','view_a','准确讨论题干第一方的主张及理由，保留其对象、范围和限定词。'),
        requirement('r2','view_b','准确讨论题干第二方的主张及理由，保留其对象、范围和限定词。'),
        requirement('r3','position','清楚表达并支持作者自己的意见，可以有条件地支持或综合两者。'),
      ],cautions:[]},
  };
}
