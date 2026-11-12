// Visual review by Codex against the supplied images, not human or examiner sign-off.
// Keep statements auditable and conservative; changing image/prompt invalidates the fingerprint.
const fact = (id, panelId, kind, statement, location, approximate = false) => ({ id, panelId, kind, statement, location, approximate, confidence: approximate ? 'medium' : 'high' });
const feature = (id, description, factIds) => ({ id, description, factIds });
const base = (chartTypes, panels, facts, keyFeatures, uncertainties = []) => ({ readability: 'clear', chartTypes, questionQuality: { alignment: 'aligned', instructions: 'standard', issues: [] }, panels, facts, keyFeatures, uncertainties });
export const references = {
  'T1-001': base(['pie', 'line'], [{ id: 'p1', kind: 'pie', description: '2000年地区销量占比' }, { id: 'p2', kind: 'line', description: '1996–2001年股价折线' }], [
    fact('f1','p1','unit','The pie chart shows regional unit case volume in 2000, as percentages of a total of 17.1 billion unit cases.','左图标题、中心总量'),
    fact('f2','p1','value','North America: 30.4%; Latin America: 25.7%.','左图左侧两个标签'),
    fact('f3','p1','value','Europe: 20.5%; Asia: 16.4%; Africa and the Middle East: 7.0%.','左图右侧三个标签'),
    fact('f4','p1','comparison','North America has the largest share; Africa and the Middle East have the smallest. The two American regions together account for 56.1%.','左图五个标签相比较；30.4+25.7'),
    fact('f5','p2','unit','The share-price chart uses dollars, with labelled vertical ticks at 30, 50, 70 and 90 and years 1996 to 2001 on the horizontal axis.','右图纵轴与横轴'),
    fact('f6','p2','trend','The share price rises from roughly $35–40 at the start to a peak of about $80 around 1998, with fluctuations.','右图起点在30与50之间靠下；峰值在70与90之间',true),
    fact('f7','p2','trend','After the peak, the price generally declines, falls below $50 around 2000, recovers to about $60, and ends around $55–60.','右图1998年后折线及末端',true),
    fact('f8','p2','comparison','The ending price is higher than the starting price but below the peak.','右图起点、终点、最高点比较'),
  ], [feature('k1','北美最多，非洲和中东最少；区域份额有关键比较',['f2','f3','f4']),feature('k2','2000年总量与地区份额的单位正确',['f1']),feature('k3','股价上升到约1998年的峰值，之后回落并有反弹',['f5','f6','f7']),feature('k4','股价末端高于起点但低于峰值',['f8'])], ['折线数据点无数值标签；估读为近似范围，不能据此纠正合理约数。']),
  'T1-006': base(['process'], [{ id:'p1',kind:'process',description:'黑色制造流程和蓝色反馈线'}], [
    fact('f1','p1','structure','Black arrows indicate the manufacturing flow; blue arrows indicate information feedback.','右上图例'),
    fact('f2','p1','transition','Raw materials and manufactured components both enter storage.','上方两个框的黑色箭头指向storage'),
    fact('f3','p1','transition','The main sequence is storage, production planning, assembly, inspection, testing, packaging, despatch and sales.','左列自上而下黑色箭头'),
    fact('f4','p1','transition','Product research leads to design, which leads to production planning.','右上product research向下至design，再向左至production planning'),
    fact('f5','p1','transition','Production planning sends information feedback to storage.','production planning左边蓝线从约y249向左上至storage箭头；与下方sales长线分离'),
    fact('f6','p1','transition','Testing sends information feedback to design.','testing右端蓝线沿约y426向右再向上至design底边'),
    fact('f7','p1','transition','Sales sends feedback to production planning and to market research.','sales底部左侧长蓝线指向planning；右侧长蓝线指向market research'),
    fact('f8','p1','transition','Market research sends feedback to design, packaging and advertising.','market research顶边蓝线向design；左边沿约y445后向下左至packaging；下边箭头向advertising'),
  ], [feature('k1','主生产链从储存到销售',['f2','f3']),feature('k2','产品研究与设计接入生产计划',['f4']),feature('k3','生产主链之外有多个反馈支路',['f1','f5','f6','f7','f8'])], ['交叉折线不表示连接；不得额外补出testing→packaging、sales→storage或advertising→market research。']),
  'T1-072': base(['map'], [{id:'p1',kind:'map',description:'Canterbury两处拟建学校选址'}], [
    fact('f1','p1','structure','The map shows two proposed school sites, S1 and S2, in Canterbury. North is toward the top.','题干与图顶指北针'),
    fact('f2','p1','location','S1 is in the countryside east of the town centre, near the road leading northeast to Sturry.','右侧S1在绿色区域、东北道路旁'),
    fact('f3','p1','location','S2 is in the southern part of the town centre, which is marked as a no-traffic zone.','橙色区域下部S2与图例'),
    fact('f4','p1','location','Housing surrounds most of the town centre; countryside lies around the outside.','浅灰与绿色区域及图例'),
    fact('f5','p1','location','The university is in the north of the town and northwest of S1.','蓝色区域相对S1位置、指北针'),
    fact('f6','p1','location','The northeast road leads toward Sturry, labelled 5 km away with a population of 7,000.','右上文字5km to Sturry (Population: 7,000)'),
    fact('f7','p1','location','The southwest road leads toward Chartham, labelled 7 km away with a population of 4,500.','左下文字7km to Chartham (Population: 4,500)'),
  ], [feature('k1','S1在郊外靠近道路，S2位于无交通区内',['f2','f3']),feature('k2','住宅、市中心、大学与乡村的布局',['f4','f5']),feature('k3','两条方向上的连接道路、标注距离及人口',['f6','f7'])], ['未标比例尺；不能精确估算两选址到大学距离，也不能给出选址优劣或交通影响。']),
};
