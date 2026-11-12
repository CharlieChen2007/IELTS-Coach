export type ListeningType = { id: string; label: string; section?: number; reportLabel?: string }
export const listeningTypes: {name: string; types: ListeningType[]}[] = [
  { name: '选择题', types: [{id:'single',label:'单选题'},{id:'multiple',label:'多选题'}] },
  { name: '匹配题', types: [{id:'matching',label:'信息匹配',section:2,reportLabel:'匹配题'}] },
  { name: '图示标注', types: [{id:'plan',label:'平面图标注'},{id:'map',label:'地图标注'},{id:'diagram',label:'示意图标注'}] },
  { name: '信息填空', types: [
    {id:'form',label:'表单填空'},{id:'notes',label:'笔记填空',section:1,reportLabel:'笔记填空'},
    {id:'table',label:'表格填空',section:4,reportLabel:'表格填空'},
    {id:'flow',label:'流程图填空',section:3,reportLabel:'流程图选词填空'},{id:'summary',label:'摘要填空'},
  ] },
  { name: '句子填空', types: [{id:'sentence',label:'句子补全'}] },
  { name: '简答题', types: [{id:'short',label:'简短作答'}] },
]

export type TypeScore = {correct:number; total:number}
export type DrillFeedback = TypeScore & {revision:number;answer:string[];accepted:string[];script:string;reason:string}
export type DrillQuestion = {id:string;title:string;prompt:string;context?:string[];options?:string[];visual?:'plan'|'map'|'diagram';total:number;result:DrillFeedback|null}
