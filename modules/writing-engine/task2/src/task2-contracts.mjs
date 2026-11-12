import {requestSchema,scoreRecordSchema} from './contracts.mjs';
export const TASK2_VERSION='task2-ai-v2.1';
export const TASK2_RUBRIC='ielts-task2-2023-product-v2';
export const TASK2_CRITERIA=['taskResponse','coherenceCohesion','lexicalResource','grammaticalRangeAccuracy'];
const str=(max=1500,min=1)=>({type:'string',minLength:min,maxLength:max});
const choice=values=>({type:'string',enum:values});
const array=(items,max=100,min=0)=>({type:'array',items,minItems:min,maxItems:max});
const object=(properties,optional=[])=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties).filter(k=>!optional.includes(k))});
const id={...str(120),pattern:'^[a-zA-Z0-9][a-zA-Z0-9:._-]*$'};
const ids=(min=0)=>array(id,100,min);
const band={type:['number','null'],minimum:0,maximum:9,multipleOf:0.5};
export const task2RequestSchema=structuredClone(requestSchema);
task2RequestSchema.properties.questionId.pattern='^T2-[0-9]{3}$';
task2RequestSchema.properties.text.maxLength=20000;
for(const field of ['initialText','previousText'])task2RequestSchema.properties.revisionContext.properties[field].maxLength=20000;

export const task2AnalysisSchema=object({
  promptQuality:choice(['clear','ambiguous','invalid']),
  questionType:choice(['opinion','discussion','advantages_disadvantages','two_part','mixed','other']),
  stanceRequired:{type:'boolean'},
  requirements:array(object({id,kind:choice(['position','view_a','view_b','causes','effects','solutions','advantages','disadvantages','comparison','judgement','other']),description:str(800),promptQuote:str(2000)}),8,1),
  cautions:array(str(800),10),
});
const score=object({band,reason:str(),evidenceSentenceIds:ids(),nextStep:str(800)});
export const task2EvaluationSchema=object({
  assessmentMode:choice(['full','language_only','insufficient_response','insufficient_question']),assessmentNote:str(),
  taskCoverage:array(object({requirementId:id,status:choice(['covered','partial','missing','uncertain']),reason:str(1000),evidenceSentenceIds:ids()}),8,1),
  stance:object({status:choice(['clear','unclear','contradictory','not_required']),summary:str(1000),evidenceSentenceIds:ids()}),
  scores:object(Object.fromEntries(TASK2_CRITERIA.map(k=>[k,score]))),
  sentences:array(object({id,status:choice(['keep','fix','improve']),editType:choice(['none','grammar','precision','logic','redundancy']),action:choice(['keep','replace','delete','manual']),reason:str(1000),suggestion:str(4000,0),contextSentenceIds:ids(),redundantWithSentenceId:{type:['string','null'],maxLength:120}}),100,1),
  review:object({decision:choice(['revise','ready']),summary:str(),remainingIssues:array(object({sentenceId:id,reason:str(800),action:str(1000)}),3)}),
  modelEssay:object({kind:choice(['upgraded','unavailable']),text:str(9000,0),preservesStance:{type:'boolean'},note:str(),upgrades:array(str(800),3)},['upgrades']),
  nextPractice:object({skill:choice(['task_response','development','cohesion','lexis','grammar','conciseness','transfer']),instruction:str(),successCriteria:array(str(500),4,1),evidenceSentenceIds:ids()}),
});
export const task2ScoreRecordSchema=structuredClone(scoreRecordSchema);
task2ScoreRecordSchema.properties.task.enum=['task2'];
task2ScoreRecordSchema.properties.sourceOrigin.enum=['rule','model'];
task2ScoreRecordSchema.properties.criteria=object(Object.fromEntries(TASK2_CRITERIA.map(k=>[k,band])));

export const task2DeliverySchema=object({
  version:choice(['task2-delivery-v1']),applied:{type:'boolean'},
  modelEssayStatus:choice(['available','unavailable']),
  adjustments:array(object({
    path:str(200),rule:choice(['sentence_growth','total_growth','non_grammar_edits','model_min_words','model_max_words','model_paragraphs','unknown_score_field']),
    sentenceId:{type:['string','null'],maxLength:120},observed:{type:['integer','string'],minimum:0},limit:{type:['integer','null'],minimum:0},remaining:{type:['integer','null'],minimum:0},
    resolution:choice(['manual','unavailable','retain_original','trim_tail','dropped']),instruction:str(500),
  }),110),
});

/* 参考范文单独生成时复用同一契约，避免两处定义漂移。 */
export const task2ModelEssaySchema=task2EvaluationSchema.properties.modelEssay;
