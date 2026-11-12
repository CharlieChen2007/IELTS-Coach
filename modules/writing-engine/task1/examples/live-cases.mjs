// Author-written test essays. Not user submissions and not examiner-rated.
const mixed = `The pie chart shows the regional distribution of Coca-Cola's unit case sales in 2000, while the line graph presents its share price between 1996 and 2001.

Overall, North America accounted for the largest share of sales, whereas Africa and the Middle East had the smallest proportion. The share price fluctuated considerably, reaching a peak around 1998 before declining.

Total sales amounted to 17.1 billion unit cases in 2000. North America represented 30.4% of this volume, followed by Latin America at 25.7%. Together, these two regions accounted for just over half of the total. Europe contributed a further 20.5%, while Asia's share stood at 16.4%. The remaining 7% came from Africa and the Middle East.

Turning to the share price, it began at approximately $35 and rose, with some fluctuations, to a high of roughly $80 in 1998. It then generally fell, dropping below $50 around 2000 before recovering to about $60. At the end of the period, the price was approximately $55, higher than at the beginning but well below its peak.`;
export const cases = [
  { name: 'mixed-accurate', questionId: 'T1-001', text: mixed, intent: '混合图；正确概述、区域比例与近似读数' },
  { name: 'mixed-errors', questionId: 'T1-001', text: mixed.replace(/Overall,[\s\S]*?declining\./, 'The pie chart includes five regions and presents their shares as percentages of the total. The line graph uses dollars to indicate the share price.').replace('North America represented 30.4%', 'North America represented 70%'), intent: '故意删除全貌概述，并把30.4%写成70%；应该指出矛盾并降低TA' },
  { name: 'process', questionId: 'T1-006', text: `The diagram illustrates the manufacture of consumer goods and the feedback links that allow earlier stages to be adjusted.

Overall, the main production sequence runs from the storage of materials and components to the sale of finished goods. Alongside this sequence, research and design guide production, while information from later stages returns to earlier activities.

Initially, raw materials and manufactured components are placed in storage. They then pass through production planning and assembly before the assembled products are inspected and tested. Following testing, the goods are packaged and despatched, with sales forming the final stage of the main manufacturing flow. In a separate branch, product research leads to design, which feeds into production planning.

The information routes connect several of these activities. Testing provides feedback to design, and sales supply information to both production planning and market research. Production planning also sends information back to storage. Market research is linked with design, packaging and advertising, showing that customer information influences several different parts of the process rather than only the final sale.`, intent: '流程图；主生产顺序与反馈支线分开' },
  { name: 'map', questionId: 'T1-072', text: `The map shows two proposed sites for a new school in Canterbury, together with the town's main land uses and road connections.

Overall, S1 is located in the countryside on the eastern edge of the town, whereas S2 lies within the town centre. The two sites therefore differ in their surroundings and their relationship with the town's road network.

S1 is beside the main road leading northeast towards Sturry, which is five kilometres away and has a population of 7,000. The site is outside the housing area and to the east of the town centre. A university occupies a separate area in the northern part of Canterbury, to the northwest of S1.

By contrast, S2 is situated in the southern part of the town centre, which is marked as a no-traffic zone. Housing surrounds most of this central area. Another main road runs southwest from the centre towards Chartham, a settlement seven kilometres away with a population of 4,500. Countryside forms the outer area around the town, separating the built-up sections from the surrounding region.`, intent: '地图；拟建位置、道路、禁行区、方向与距离' },
];
