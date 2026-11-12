/* =============================================================
 * SpeakLoop · 每日语料跟读模块（口语负责人扩展模块）
 * 数据层：7 天学习计划 × 3 条语料 / 训练模式 / 对接契约
 *
 * 语料定位：学术类 IELTS Speaking Band 7–8 示范作答
 *   P1 短答（40–50 词，含延展与限定）· P2 长答（约 170–190 词，接近 2 分钟）
 *   P3 抽象论述（130–150 词，含让步、限定、分类框架与证据意识）
 *   全部为可迁移的考场表达，不堆砌生僻词；中文释义供理解，不作逐字对照。
 *
 * 文本标记语法（解析见 shadow-engine.parseCorpus）：
 *   *word*        重音 / 逻辑强调（可跨多词）
 *   word~word     连读或浊化连接（仅用纯字母组合，页面才能高亮）
 *   |             意群停顿（预期停顿位置）
 *   , . ? ! ; :   句读停顿（自动计入预期停顿）
 * ============================================================= */
(function (root) {
  'use strict';
  root.SL = root.SL || {};

  var DAYS = [
    { day: 1, theme: '时间与注意力', en: 'Time & attention', goal: '密集信息下的意群切分与抽象名词重音', color: '#5b5bf0' },
    { day: 2, theme: '城市与地方', en: 'Cities & place', goal: '长叙事的气息分配与句末降调', color: '#12b8a6' },
    { day: 3, theme: '技术与认知', en: 'Technology & cognition', goal: '术语列举与对比焦点', color: '#f5a524' },
    { day: 4, theme: '影响与社会连接', en: 'Influence & social ties', goal: '让步结构与情感层次', color: '#ff7a59' },
    { day: 5, theme: '工作与教育', en: 'Work & education', goal: '限定立场、三项列举与反讽语调', color: '#8a7cf8' },
    { day: 6, theme: '健康与公共政策', en: 'Health & public policy', goal: '长段落连贯与政策论述节奏', color: '#16a34a' },
    { day: 7, theme: '综合复盘', en: 'Integrated review', goal: '高抽象论述、接近考场语速', color: '#e5484d' }
  ];

  /* 每条语料：
   * id / day / part / theme / title / en(带标记) / zh / wpm(示范语速)
   * focus[] 本条训练目标 · tips[] 具体发音提示 · vocab[] 可迁移表达
   * level 2-3 难度（对应 Band 7 / Band 8 语言密度）
   */
  var CORPUS = [
    /* ---------------- Day 1 · 时间与注意力 ---------------- */
    {
      id: 'C_D1_S1', day: 1, part: 'P1', level: 2, theme: '高效时段',
      title: '你如何安排一天中最有效率的时段', wpm: 142,
      en: "*Broadly speaking*, | I reserve the first two hours for *analytical* work, | because that's when my capacity for sustained concentration tends to *peak*. | Once the inbox takes~over, | that window is effectively *gone*, | so I'd rather protect it than add another meeting.",
      zh: '大体上，我会把每天头两个小时留给分析性工作，因为持续专注的能力往往在这个时段达到峰值。一旦收件箱开始占据注意力，这个窗口基本就消失了，所以我宁可守住它，也不愿再多塞一个会。',
      focus: ['限定式开场', '抽象名词重音', '对比收束'],
      tips: [
        { k: 'takes~over', v: '/s/ 直接滑入后面的元音，两词连成一个音块；中间不要补停顿，也不要额外加 /h/。' },
        { k: '*analytical* / *peak*', v: '抽象名词与动词是信息焦点，靠音高和时长突出；把整句都读重反而会抹掉层次。' },
        { k: 'I’d rather ... than ...', v: '偏好结构的落点在 than 之后：前半轻、后半稳稳降调，句尾绝不上扬。' }
      ],
      vocab: ['Broadly speaking', 'capacity for sustained concentration', 'protect that window', 'I’d rather ... than ...']
    },
    {
      id: 'C_D1_S2', day: 1, part: 'P2', level: 3, theme: '一个被重新设计过的习惯',
      title: 'Describe a routine you deliberately redesigned', wpm: 148,
      en: "I'd like to describe how I *rebuilt* my morning routine, | which I'd originally designed around sheer volume of hours. | For most of my second year at university | I believed that starting at five and working until noon was inherently *productive*, | even though I spent the last two hours going~over the same paragraph. | The turning point came when I started logging not the hours I sat at my desk | but the number of problems I actually solved. | The data was quietly *embarrassing*: | almost everything of value happened in the first ninety minutes, | and the rest was largely the appearance of effort. | So I made three changes. | I shortened the session to two hours, | moved anything administrative to the afternoon, | and introduced a hard rule that I stop while I still want to continue. | *Counterintuitively*, | my output went~up rather than down, | largely because I arrived at the next session with something still unresolved. | What I took from it was a distinction I now apply well beyond studying: | *time invested* and *attention invested* are not the same variable, | and only one of them responds to discipline.",
      zh: '我想讲讲我是怎么重建晨间习惯的——最初它是纯粹按小时数设计的。大二那年大部分时间，我都相信五点起床、一直工作到中午天然就算高效，尽管最后两小时我一直在反复读同一段。转折点出现在我开始记录"解决了多少问题"、而不是"在桌前坐了多少小时"的时候。数据有点让人难堪：几乎所有有价值的东西都发生在头九十分钟里，剩下的基本只是努力的样子。于是我改了三件事：把时段缩到两小时，把行政类事务挪到下午，还定下一条硬规矩——在还想继续的时候停下来。反直觉的是，产出不降反升，主要因为我进入下一次时会带着一个尚未解决的问题。我从中得到一个现在早已不局限于学习的区分：投入的时间和投入的注意力不是同一个变量，而只有后者会回应自律。',
      focus: ['长段落气息分配', '三项列举', '反讽与对比重音'],
      tips: [
        { k: 'going~over / went~up', v: '两处短语动词都要连成一个音块，/ŋ/ 与 /t/ 后直接接元音，不要拆词。' },
        { k: '三项改动', v: 'shortened / moved / introduced 节奏等长，前两项略升，第三项明显降调收束，再进入结论。' },
        { k: '*time invested* / *attention invested*', v: '全篇核心对比，两个短语重音要错开音高、中间留半拍，别一口气滑过去。' }
      ],
      vocab: ['sheer volume of hours', 'the appearance of effort', 'Counterintuitively', 'time invested vs attention invested']
    },
    {
      id: 'C_D1_S3', day: 1, part: 'P3', level: 3, theme: '自律与动机',
      title: 'Is discipline more important than motivation for maintaining habits?', wpm: 152,
      en: "I'd *reframe* the question slightly, | because the two operate on quite different timescales. | Motivation is extremely good at getting a habit *started*, | but it's a volatile resource — | it collapses the moment the outcome stops~feeling close. | Discipline, by contrast, is less a personality trait | than a piece of *infrastructure*: | fixed cues, | a reduced number of decisions, | and an environment where the default action is the right one. | *That said*, | I'd be wary of routines sustained purely by obligation, | because they tend to survive until the first disruption and then disappear entirely. | The durable version seems to be one where the habit is *intrinsically* rewarding enough | that discipline only has to carry the first few weeks. | So I wouldn't rank one above the other; | I'd say motivation supplies the *direction* | and discipline supplies the *continuity*.",
      zh: '我想把这个问法稍微改写一下，因为两者作用的时间尺度很不一样。动机极擅长让一个习惯启动，但它是种不稳定的资源——一旦结果不再显得触手可及，它立刻就塌了。相比之下，自律与其说是性格特质，不如说是一套基础设施：固定的触发线索、更少的决策次数，以及一个默认动作恰好就是正确动作的环境。话虽如此，我也警惕纯粹靠义务维系的惯例，因为它们往往撑到第一次打断就整个消失。更耐久的版本，似乎是习惯本身自带足够的内部回报，让自律只需要扛过最初几周。所以我不会把其中一个排在另一个之上；我会说动机提供方向，自律提供连续性。',
      focus: ['修正提问前提', '三项列举', '成对概念收束'],
      tips: [
        { k: 'stops~feeling', v: '/s/ 与 /f/ 之间不要加元音，连读后紧接着 collapsed 的语义落点。' },
        { k: 'not ... but ... 结构', v: 'less a trait / than infrastructure 是隐性对比，重音必须落在 infrastructure 上，前半主动压低。' },
        { k: 'direction / continuity', v: '结尾两个抽象名词构成对仗：等高起句、第二项更重，句末稳稳降到最低。' }
      ],
      vocab: ['I’d reframe the question', 'a volatile resource', 'a piece of infrastructure', 'supplies the continuity']
    },

    /* ---------------- Day 2 · 城市与地方 ---------------- */
    {
      id: 'C_D2_S1', day: 2, part: 'P1', level: 2, theme: '地方感',
      title: '一个改变了你看城市方式的城市', wpm: 144,
      en: "*Lisbon*, | partly because it refuses to be a museum. | You'll find a sixteenth~century doorway | opening onto a design studio, | and nobody treats that as a contradiction. | What stayed with me was the *assumption* that a city can absorb change | without erasing the layers that produced it.",
      zh: '里斯本，部分原因在于它拒绝把自己变成一座博物馆。你会看到一扇十六世纪的门洞通向一间设计工作室，而没人觉得这有什么矛盾。真正留在我心里的是那个预设：一座城市可以吸收变化，却不必抹掉造就它的那些层次。',
      focus: ['名词短语重音', '让步式开场', '长主语分组'],
      tips: [
        { k: 'sixteenth~century', v: '复合形容词连成一个音块，重音只落在 sixteenth 上，century 要明显压低。' },
        { k: 'What stayed with me was ...', v: ' cleft 句的信息焦点在 assumption 上，前面部分语速略快、音高放平。' },
        { k: 'absorb change / erasing the layers', v: '一组对立动词短语，前者轻、后者略沉，句尾降调收束。' }
      ],
      vocab: ['refuses to be a museum', 'treat that as a contradiction', 'What stayed with me was', 'absorb change without erasing']
    },
    {
      id: 'C_D2_S2', day: 2, part: 'P2', level: 3, theme: '一次没能按计划进行的旅行',
      title: 'Describe a journey that changed how you think about a place', wpm: 148,
      en: "The journey I'd pick is a research trip to *Bologna* | that I'd planned down to the hour — | archives in the morning, | interviews in the afternoon, | and a carefully compiled list of buildings to photograph. | On the second day the archive closed unexpectedly for a staff training day, | and I found myself with six unplanned hours and no itinerary. | I ended~up sitting in a covered market | talking to a stallholder whose family had sold the same pasta shape for four generations. | She explained, with some impatience, | why the shape mattered more than the recipe, | and how a regional regulation protected it. | None of that was in any of the guidebooks I'd brought. | *What shifted* was my whole idea of what counts as evidence. | I'd arrived assuming a place reveals itself through its monuments, | whereas the more durable knowledge was held in an ordinary commercial routine | that nobody had thought worth~writing down. | I still took the photographs, | but I now treat an unplanned conversation as the more reliable source. | In a way, | the closed archive was the most *productive* thing that happened.",
      zh: '我想讲的是一次去博洛尼亚的调研，我原本把行程精确到小时：上午查档案，下午做访谈，还有一份认真整理过的建筑拍摄清单。第二天档案馆因员工培训临时闭馆，我忽然多出六个小时、却没有任何备选安排。最后我坐在有顶棚的市场里，和一位摊主聊了起来——她家四代人都在卖同一种形状的意面。她带着点不耐烦地解释，为什么形状比配方更重要，以及当地法规怎么写着要保护它。这些没有一条出现在我带去的任何一本指南里。被改变的是我对"什么算证据"的整个理解。我来时默认一个地方会通过它的纪念建筑显形，而更耐久的知识其实藏在一套寻常的商业惯例里，没人觉得值得写下来。照片我照旧拍了，但现在我把一场没计划过的对话看作更可靠的来源。某种意义上，那次闭馆是整趟里最有产出的一件事。',
      focus: ['叙事时态切换', '三项列举', '反讽式收束'],
      tips: [
        { k: 'ended~up / worth~writing', v: '两处连读都不要断开；/d/ 与 /θ/ 之后的元音直接相接，保持故事不断线。' },
        { k: 'archives / interviews / and a ... list', v: '开场三项列举节奏等长，第三项最长，降调收住再进入 On the second day。' },
        { k: 'the most *productive* thing', v: '全篇反讽落点，productive 音高抬起、时长拉长，随后整句降到句尾。' }
      ],
      vocab: ['planned down to the hour', 'found myself with six unplanned hours', 'what counts as evidence', 'an unplanned conversation']
    },
    {
      id: 'C_D2_S3', day: 2, part: 'P3', level: 3, theme: '旅游与城市肌理',
      title: 'To what extent does tourism erode the character of historic cities?', wpm: 154,
      en: "*Considerably*, | but I think the mechanism is often misdiagnosed. | The damage is rarely the visitors themselves; | it's the *monoculture* that follows them, | when residential rents rise to the point where bakeries and repair shops | are replaced by businesses selling essentially the same experience to outsiders. | Once the people who made a neighbourhood function can no longer afford to live there, | what's left is a set rather than a *community*. | *Having said that*, | I wouldn't frame tourism as the villain, | because the same cities often depend on it for the tax base that funds conservation. | The more useful question is one of *capture*: | whether revenue circulates locally or leaks to external operators. | Policies that cap short~term lets and protect ground~floor retail | seem to matter far more than any attempt to limit visitor numbers.",
      zh: '相当程度上是，但我认为成因常被误判。损害很少来自游客本身，而是随之而来的单一化：住宅租金涨到面包店和修理铺被取代，换成向外来者出售几乎同一种体验的生意。一旦让一个街区得以运转的人再也住不起这里，剩下的就是布景，而不是社区。话虽如此，我不会把旅游说成反派，因为恰恰是这些城市常常靠它提供的税基来供养文物保护。更有用的问题关乎"钱被谁拿走"：收入是在本地循环，还是流向外地运营商。限制短租、保护底层商铺这类政策，看起来远比任何限制游客人数的尝试更重要。',
      focus: ['限定式立场', '因果链分组', '政策术语重音'],
      tips: [
        { k: 'short~term / ground~floor', v: '两个复合形容词都只重读前半，后半压低并连读，不要读成四个等重的词。' },
        { k: 'a set rather than a community', v: 'rather than 之后才是落点，前半轻带、后半加重并降调。' },
        { k: '*capture*', v: '单抽象名词作段中结论，前面停半拍、词本身放慢，给听者一个框架切换的信号。' }
      ],
      vocab: ['the mechanism is often misdiagnosed', 'what’s left is a set rather than a community', 'a question of capture', 'revenue circulates locally']
    },

    /* ---------------- Day 3 · 技术与认知 ---------------- */
    {
      id: 'C_D3_S1', day: 3, part: 'P1', level: 2, theme: '检验理解',
      title: '你怎么判断自己真的懂了', wpm: 144,
      en: "I use a fairly unforgiving test: | I try to *reconstruct* the argument from memory, | without notes, | and then explain it to someone who'll interrupt with questions. | If I can only recognise it when I see it again, | I've probably confused *familiarity* with *understanding* — | which, incidentally, rereading makes~worse.",
      zh: '我用的检验相当不留情面：试着凭记忆把论证重新搭出来，不看笔记，再讲给一个会随时打断提问的人听。如果我只有在重新看到它时才认得出来，那多半是把"熟悉"误当成了"理解"——顺带一提，反复重读只会让这事更糟。',
      focus: ['术语重音', '插入语语调', '句末反转'],
      tips: [
        { k: 'makes~worse', v: '/s/ 直接接 /w/，两词连读；这是全句的反转落点，别在前面拖长。' },
        { k: '*familiarity* / *understanding*', v: '一对抽象名词，音高要一高一低，只重读其中一个会丢掉对比。' },
        { k: 'which, incidentally, ...', v: '插入评论整体音高压低、语速略快，说完立刻回到主句节奏。' }
      ],
      vocab: ['a fairly unforgiving test', 'reconstruct the argument from memory', 'confuse familiarity with understanding', 'incidentally']
    },
    {
      id: 'C_D3_S2', day: 3, part: 'P2', level: 3, theme: '一个改变学习方式的方法',
      title: 'Describe a tool or method that changed the way you learn', wpm: 150,
      en: "I'd talk about a *retrieval practice* system I built during my final year, | which began as a spreadsheet and ended~up replacing almost all of my note~taking. | The premise is slightly counterintuitive: | instead of putting information *in* repeatedly, | you force yourself to pull it back *out* at increasing intervals, | usually just before you'd expect to forget it. | Each attempt is uncomfortable by design, | and that discomfort is the signal that learning is actually happening. | What changed for me was not my memory so much as my *judgement*. | Before, I'd measure a study session by how fluent the material felt while I was reading it, | which is a notoriously unreliable indicator — | fluency is produced by the text being in front of you. | Once the system started scoring what I could produce with the text *removed*, | I discovered entire topics I'd have sworn I'd mastered. | The practical consequence was that I studied less, | but far more precisely. | The one drawback is maintenance: | writing good prompts takes~time, | and a badly phrased prompt quietly tests the wrong thing.",
      zh: '我想讲的是大四时搭的一套"提取练习"系统，它起初只是一张表格，后来几乎取代了我全部的笔记。它的前提有点反直觉：不是反复把信息塞进去，而是逼自己按逐渐拉长的间隔把它取回来，通常恰好安排在快要忘掉之前。每一次尝试都被设计得不舒服，而那种不舒服正是学习真的在发生的信号。被改变的与其说是我的记忆力，不如说是我的判断力。以前我用"读的时候有多顺"来衡量一次学习，而这是个出了名不可靠的指标——流畅感是文字摆在眼前制造出来的。当系统开始只给"把材料拿走后我还能产出什么"打分时，我发现了整块整块我本会发誓已经掌握的内容。实际后果是我学得更少，却精确得多。唯一的代价是维护：写出好提示词很花时间，而措辞糟糕的提示词会悄无声息地测错东西。',
      focus: ['机制解释的节奏', '成对介词重音', '长段对比'],
      tips: [
        { k: 'ended~up / note~taking / takes~time', v: '三处连读都要成块；note~taking 是复合词，重音只在 note 上。' },
        { k: 'putting information *in* / pull it back *out*', v: '两个介词是全篇机制对比的支点，必须一轻一重、音高错开。' },
        { k: 'less / far more precisely', v: '结尾的克制对比，第二项放慢并降调，不要读成夸张的惊喜。' }
      ],
      vocab: ['retrieval practice', 'at increasing intervals', 'a notoriously unreliable indicator', 'with the text removed']
    },
    {
      id: 'C_D3_S3', day: 3, part: 'P3', level: 3, theme: '信息与深度学习',
      title: 'Does instant access to information make deep learning less likely?', wpm: 156,
      en: "*Not inherently*, | but it changes which mental operations get practised. | Understanding is built through the effort of reconstructing an argument, | whereas search rewards the far cheaper skill of *locating* one. | If every gap in knowledge can be filled~in within seconds, | there's very little pressure to build the internal structure that would have prevented the gap. | Researchers sometimes call this *cognitive offloading*, | and the interesting finding is that we offload not just facts | but the *memory of where to look*, | so we become dependent on the tool even for navigation. | *That said*, | I'd resist the nostalgic conclusion. | Access frees up the attention needed for evaluation and synthesis, | provided the learner has already been taught to interrogate a source. | So the dividing line isn't access versus no access; | it's whether the education system deliberately trains the *struggle* that search engines remove.",
      zh: '本质上未必，但它改变了被反复练习的是哪种心智操作。理解是靠重建一个论证的那种费力建立起来的，而搜索奖励的是便宜得多的"找到"这一技能。如果每一处知识缺口都能在几秒内被填上，就几乎没有什么压力去搭建那个本可避免缺口的内部结构。研究者有时称之为认知外包，有意思的发现在于：我们外包的不只是事实，还有"该去哪儿找"的记忆，于是连导航本身都得依赖工具。话虽如此，我不接受那个怀旧式的结论。获取的便利释放出了评估与综合所需的注意力——前提是学习者已经被教过如何质询一个来源。所以分界线不是"能不能随手查"，而是教育系统是否有意去训练搜索引擎替我们省掉的那份挣扎。',
      focus: ['修正前提', '术语与概念重音', '条件从句收束'],
      tips: [
        { k: 'filled~in', v: '短语动词连成一个音块，/d/ 直接接元音，不要把 in 单独读成一个重音。' },
        { k: '*locating* / *cognitive offloading*', v: '术语第一次出现时放慢、音高抬起，后面再提到同类概念时压低，形成信息层级。' },
        { k: 'provided the learner has ...', v: '条件从句整体语速略快、音量略低，主句结论才落得下来。' }
      ],
      vocab: ['which mental operations get practised', 'cognitive offloading', 'interrogate a source', 'the dividing line isn’t ... it’s whether']
    },

    /* ---------------- Day 4 · 影响与社会连接 ---------------- */
    {
      id: 'C_D4_S1', day: 4, part: 'P1', level: 2, theme: '改变判断的人',
      title: '谁改变过你的一个判断', wpm: 144,
      en: "*My former supervisor*, | though not by persuading me. | She had a habit of asking which *observation* would change my mind, | and I gradually realised I couldn't name one. | That question has stayed with me far longer than any advice she actually gave, | because it~exposes whether you're *enquiring* or merely *defending*.",
      zh: '我以前的导师，不过并不是靠说服我。她有个习惯，总问"哪一个观察结果会让你改主意"，而我慢慢发现自己一个都答不上来。这个问题留在我心里的时间，远比她实际给过的任何建议都长，因为它揭穿了一件事：你到底是在探究，还是只是在防守。',
      focus: ['让步式开场', '抽象名词重音', '成对动词收束'],
      tips: [
        { k: 'it~exposes', v: '/t/ 夹在元音之间浊化，两词连成一个音块，别读成 "it ... exposes"。' },
        { k: 'though not by persuading me', v: '让步插入语前后各留微停、音高压低，为后面的反转留出空间。' },
        { k: '*enquiring* / merely *defending*', v: '结尾对比：第一个重、merely 轻带、第二个更沉，句末稳稳降调。' }
      ],
      vocab: ['not by persuading me', 'which observation would change my mind', 'far longer than any advice', 'enquiring or merely defending']
    },
    {
      id: 'C_D4_S2', day: 4, part: 'P2', level: 3, theme: '一开始抗拒的建议',
      title: 'Describe a piece of advice you initially resisted', wpm: 148,
      en: "The advice came from a *colleague* during my first internship, | and I remember dismissing it almost immediately. | She told me to stop polishing the analysis | and instead spend an hour each week writing down what I expected to happen | before the results came~in. | It sounded like bureaucracy, | and privately I thought it was a way of manufacturing evidence of my own mistakes. | I ignored it for about two months, | until a project I was confident about failed in a way that was, in hindsight, entirely *predictable*. | When I finally tried her method, | the uncomfortable part wasn't being wrong — | it was discovering how often I'd quietly rewritten my expectations after the fact | to make the outcome look foreseen. | Psychologists call that *hindsight bias*, | but knowing the label is much easier than catching it in real time. | What she'd actually given me was a small piece of *infrastructure* against self~deception, | and I've used some version of it ever since. | I did tell her eventually, | though I suspect she'd forgotten saying it.",
      zh: '这条建议来自我第一段实习时的一位同事，我记得自己几乎是当场就否掉了。她让我别再打磨分析，改成每周花一小时，在结果出来之前先写下我预期会发生什么。听起来像官僚流程，我私下觉得那不过是制造"我犯过错"的证据。我搁了大概两个月，直到一个我很有把握的项目以一种事后看完全可预测的方式失败了。等我终于试了她的方法，真正让人不舒服的并不是"我错了"，而是发现我有多频繁地在事后悄悄改写自己的预期，好让结果看起来早已预见。心理学家管这叫后见之明偏误，但知道这个名字，比在当下抓住它容易得多。她其实给了我一小件用来对抗自我欺骗的基础设施，此后我一直用着某个版本。后来我确实告诉了她，不过我猜她早忘了自己说过这话。',
      focus: ['叙事时态', '破折号后的递进', '自嘲式收束'],
      tips: [
        { k: 'came~in / self~deception', v: '前者是短语动词连读，后者是复合名词，重音只落在 self 上。' },
        { k: 'wasn’t being wrong — it was ...', v: '破折号前否定要读足、后面停半拍，递进内容音高重新抬起。' },
        { k: 'though I suspect she’d forgotten', v: '尾句自嘲，语速放慢、音高整体下移，最后 saying it 轻轻收掉，不要上扬。' }
      ],
      vocab: ['dismissing it almost immediately', 'in a way that was entirely predictable', 'rewritten my expectations after the fact', 'hindsight bias']
    },
    {
      id: 'C_D4_S3', day: 4, part: 'P3', level: 3, theme: '社会连接',
      title: 'Are close social ties becoming harder to maintain?', wpm: 154,
      en: "*Structurally*, yes, | though I wouldn't call it a decline in the desire for them. | Strong ties are maintained through repeated, low~stakes contact — | the conversation you didn't plan, | the favour that costs almost nothing. | Modern work and housing patterns don't remove friendship, | but they do remove that *incidental* layer, | because people move more often and their days are less synchronised. | What replaces it is scheduled contact, | which is more intentional but also more fragile: | if a catch~up needs a calendar invitation, | it's the first thing to go in a busy month. | *That said*, | I think we underestimate how much of this is a design problem rather than a cultural one. | Cities that provide shared, uncommercial spaces | and employers that don't require constant relocation | see much the same levels of closeness as earlier generations. | So the capacity is intact; | the *conditions* have become less generous.",
      zh: '从结构上看是，但我不认为这是人们对亲密关系的意愿在下降。强连接靠的是反复发生的、低代价的接触——一场没计划过的对话，一个几乎不花成本的忙。现代的工作和居住模式并没有消灭友谊，却确实抽掉了那一层偶发性，因为人们搬家更频繁，日程也更难同步。取而代之的是被排进日程的联系，它更有意识，却也更脆弱：如果一次叙旧需要日历邀请，那它一定是忙碌月份里最先被砍掉的事。话虽如此，我觉得我们低估了这件事在多大程度上是设计问题、而非文化问题。那些提供共享、非商业空间的城市，以及不要求员工不断搬迁的雇主，看到的亲密程度与上一代其实相差无几。所以能力还在，只是条件变得不那么宽厚了。',
      focus: ['限定立场', '举例三项节奏', '首尾呼应收束'],
      tips: [
        { k: 'low~stakes / catch~up', v: '两处都是复合表达，重音在前半，后半连读压低，不要逐词等重。' },
        { k: 'the conversation ... / the favour ...', v: '两个短例结构对齐、节奏等长，第二项略沉，随后停半拍再给主句。' },
        { k: 'the *conditions* have become less generous', v: '全篇结论，conditions 抬起、后面整句逐步降到最低，尾音绝不上扬。' }
      ],
      vocab: ['repeated, low-stakes contact', 'that incidental layer', 'scheduled contact', 'the capacity is intact']
    },

    /* ---------------- Day 5 · 工作与教育 ---------------- */
    {
      id: 'C_D5_S1', day: 5, part: 'P1', level: 2, theme: '工作环境',
      title: '你理想的工作环境', wpm: 146,
      en: "Somewhere with a high tolerance for *dissent*, | frankly more than a quiet desk. | In my last placement the team had an unwritten rule | that the most junior person spoke first, | because otherwise everyone just anchored on whoever sounded most *certain*. | It made~me realise that psychological safety is an operational design choice, | not a personality trait.",
      zh: '一个对异议容忍度高的地方，坦白说这比一张安静的桌子更重要。上一段实习里，团队有条不成文的规矩：让资历最浅的人先开口，否则所有人都会锚定在听起来最笃定的那个人身上。这让我意识到，心理安全是一项运作层面的设计选择，而不是一种性格特质。',
      focus: ['抽象名词重音', '因果从句分组', '定义式收束'],
      tips: [
        { k: 'made~me', v: '/d/ 与 /m/ 之间不停顿，直接连过去，保持句子往前走。' },
        { k: '*dissent* / *certain*', v: '两个抽象焦点一前一后，第一个抬起、第二个略沉，避免全句都读重。' },
        { k: 'an operational design choice, not a personality trait', v: '定义式结尾，not 之前停半拍，后半降调收束。' }
      ],
      vocab: ['a high tolerance for dissent', 'an unwritten rule', 'anchored on whoever sounded most certain', 'psychological safety']
    },
    {
      id: 'C_D5_S2', day: 5, part: 'P2', level: 3, theme: '被重新定义的目标',
      title: 'Describe a goal that forced you to redefine success', wpm: 150,
      en: "The goal I'd describe is wanting to lead a research group, | which I pursued for several years with a fairly narrow definition of success: | a permanent post, | a larger budget, | and a team of my own. | Two things happened~at once. | I was offered a role that looked exactly like that on paper, | and I found myself far less interested in it than I'd expected. | At the same time, | the work I was doing voluntarily — | mentoring two junior colleagues through their first publication — | was the part of the week I genuinely looked forward to. | It took an embarrassingly long time to notice the pattern. | I'd been treating *progression* as a ladder, | when what actually motivated me was a particular kind of *conversation*: | helping someone untangle an argument they'd almost given~up on. | So I redefined the goal around that, | which in practice meant turning down the management track | and building a portfolio of supervision instead. | I wouldn't call it a compromise, | because the external markers were never what I was defending. | *If anything*, | the harder part was admitting how much of the original ambition had been borrowed from other people's expectations.",
      zh: '我想讲的目标是"带一个研究组"，我追了好几年，而且对成功的定义相当窄：一个长期职位、更大的预算、一支自己的团队。后来两件事同时发生。我拿到了一个纸面上完全符合的岗位，却发现自己远没有预想中那么感兴趣；与此同时，我自愿在做的事——带两位年轻同事走完他们第一次发表——反而是那一周里我真正期待的部分。我花了久到有点难堪的时间才看出这个模式。我一直把"晋升"当成一架梯子，而真正驱动我的其实是一种特定的对话：帮别人把一段几乎要放弃的论证重新解开。于是我围绕它重新定义了目标，实际操作上就是推掉管理序列，转而去积累一份指导工作。我不认为这是妥协，因为那些外部标志从来就不是我要守的东西。真要说的话，更难的是承认：最初那份野心里有相当一部分，是从别人的期待里借来的。',
      focus: ['三项列举', '破折号插入', '自我修正语调'],
      tips: [
        { k: 'happened~at / given~up', v: '两处连读成块；given~up 是短语动词，up 不要单独重读。' },
        { k: 'a permanent post / a larger budget / and a team', v: '三项列举节奏等长、逐项略降，第三项明显收住，再进入 Two things。' },
        { k: '*progression* / *conversation*', v: '一对抽象名词构成全篇转折，音高错开、中间留半拍，别连读成一片。' }
      ],
      vocab: ['a narrow definition of success', 'looked exactly like that on paper', 'untangle an argument', 'borrowed from other people’s expectations']
    },
    {
      id: 'C_D5_S3', day: 5, part: 'P3', level: 3, theme: '高等教育的取向',
      title: 'Should universities prioritise employability over intellectual breadth?', wpm: 156,
      en: "*I'd resist that framing*, | because it assumes the two compete for the same hours. | The vocational argument is strongest for skills with a long shelf life — | structured writing, | statistical reasoning, | the ability to read an unfamiliar document quickly — | and those are, almost by definition, what a broad education supplies. | Narrow, tool~specific training has a much shorter half~life, | which is precisely why it ages badly in a labour market shaped by automation. | *That said*, | universities are often genuinely poor at making those transferable capacities *visible*, | both to students and to employers, | and that's a communication failure rather than a curricular one. | So I'd argue for keeping breadth | while changing how its outcomes are articulated. | The risk of doing the opposite is that a graduate becomes highly employable for about four years | and then has nothing left to retrain *with*.",
      zh: '我会抗拒这个提法，因为它预设两者在争抢同样的课时。职业导向的论据，在那些保质期长的能力上才最站得住——结构化写作、统计推理、快速读懂一份陌生文件——而这些几乎按定义正由通识教育提供。狭窄的、绑定具体工具的训练半衰期短得多，这恰恰是它在被自动化重塑的劳动力市场里老化得很快的原因。话虽如此，大学往往确实不擅长把这些可迁移能力"显形"，无论对学生还是对雇主，而这是沟通上的失败，不是课程上的失败。所以我会主张保留广度，同时改变成果被表述的方式。反着做的风险在于：一个毕业生大约有四年很好找工作，然后就再没有什么可以用来再培训了。',
      focus: ['修正提问前提', '三项列举', '介词收束重音'],
      tips: [
        { k: 'tool~specific / half~life', v: '两个复合词只重读前半，后半连读压低，别把连字符两侧读成等重。' },
        { k: 'structured writing / statistical reasoning / the ability to ...', v: '三项长度递增，节奏要保持等距感，第三项降调后再破折号收束。' },
        { k: 'nothing left to retrain *with*', v: '句末介词是落点，不能吞掉；放慢、音高下降，句尾绝不上扬。' }
      ],
      vocab: ['I’d resist that framing', 'skills with a long shelf life', 'a much shorter half-life', 'transferable capacities']
    },

    /* ---------------- Day 6 · 健康与公共政策 ---------------- */
    {
      id: 'C_D6_S1', day: 6, part: 'P1', level: 2, theme: '恢复',
      title: '你怎么真正放松', wpm: 146,
      en: "I've stopped treating relaxation as an *activity*. | What actually restores me is a long walk without headphones, | not because it's restful in itself, | but because it removes the constant low~level obligation to be *reachable*. | About twenty minutes in, | I notice the rehearsing stops~altogether, | which is the only reliable signal I've found.",
      zh: '我已经不再把放松当成一项活动了。真正让我恢复的是不戴耳机长时间走路，不是因为走路本身多安逸，而是它撤掉了那种持续存在的、必须随时被联系上的低强度义务。大概二十分钟后，我会发现脑子里那些排练停干净了——这是我找到的唯一可靠信号。',
      focus: ['名词化表达重音', '否定对比', '从句收束'],
      tips: [
        { k: 'low~level / stops~altogether', v: '前者重音只在 low，后者 /s/ 直接接元音，两处都不要拆成等重的词。' },
        { k: 'not because ... but because ...', v: '对比结构，but because 之后的信息明显重于前半句。' },
        { k: 'the only reliable signal I’ve found', v: '结尾定语从句整体压低、语速略快，把落点留给 only reliable。' }
      ],
      vocab: ['stop treating X as an activity', 'what actually restores me is', 'a low-level obligation to be reachable', 'the only reliable signal']
    },
    {
      id: 'C_D6_S2', day: 6, part: 'P2', level: 3, theme: '一次关于健康的认知改变',
      title: 'Describe an experience that changed how you think about wellbeing', wpm: 150,
      en: "A few years ago I was training for a half marathon | and did what most *inexperienced* runners do — | I increased the distance too aggressively | and picked~up a knee injury that persisted for the better part of five months. | Initially I was simply irritated, | because I'd followed every visible rule: | the shoes, | the schedule, | the stretching protocol. | My physiotherapist was considerably less sympathetic. | She pointed~out that adaptation occurs during recovery, | not during the session itself, | and that I'd treated rest as an absence of training | rather than as its most important *component*. | That reframing travelled well beyond exercise. | I'd been applying the same logic to my working life — | assuming that any unproductive hour was an hour *lost* — | and I was, predictably, making slower progress than when I'd worked shorter weeks. | So I now build deliberate slack into the week | and, slightly to my embarrassment, | produce more than I did during the six~day regime. | The lesson wasn't about discipline at all; | it was that recovery is a *skill*, | and a rather unintuitive one.",
      zh: '几年前我备战半马，犯了多数新手会犯的错——加量太猛，落下一个持续了将近五个月的膝伤。起初我只是烦躁，因为我自认每一条看得见的规矩都照做了：跑鞋、计划表、拉伸流程。我的理疗师就远没有那么体谅了。她直说：适应发生在恢复期，而不是训练本身；我一直把休息当成"训练的缺席"，而不是它最重要的组成部分。这个重新框定远远超出了运动的范围。我在工作上套用的是同一套逻辑——假定任何一个没有产出的小时都是被浪费的小时——于是毫不意外地，比我一周工作天数更短时进展还慢。所以现在我会有意往一周里留余量，而且有点不好意思的是，产出反而比六天制时更多。这堂课根本无关自律；它讲的是：恢复也是一种能力，而且是一种相当反直觉的能力。',
      focus: ['长段落连贯', '三项短列举', '术语重音与收束'],
      tips: [
        { k: 'picked~up / pointed~out / six~day', v: '三处连读都要成块；six~day 是复合形容词，重音只在 six 上。' },
        { k: 'the shoes / the schedule / the stretching protocol', v: '三项短列举节奏等长、逐项略降，第三项明显收住，再进入下一句。' },
        { k: 'recovery is a *skill*', v: '全篇结论，skill 音高抬起、时长拉长，后面补充句压低并降调收尾。' }
      ],
      vocab: ['increased the distance too aggressively', 'followed every visible rule', 'rest as an absence of training', 'build deliberate slack into the week']
    },
    {
      id: 'C_D6_S3', day: 6, part: 'P3', level: 3, theme: '公共健康的责任',
      title: 'Who should bear responsibility for public health — individuals or governments?', wpm: 156,
      en: "*Predominantly* the state, | though I'd qualify that immediately. | Individual choice is a genuinely weak lever | when the *default* environment is engineered against it — | when a cheap, calorie~dense option is available on every corner | and safe places to exercise are not. | Framing that as a failure of personal responsibility | conveniently relieves policymakers of the decisions they actually control: | zoning, | labelling, | procurement standards for school meals. | *Having said that*, | I'd stop short of heavy~handed prohibition, | partly because it tends to be regressive, | and partly because measures that reshape defaults quietly | usually outperform measures that lecture people. | The most defensible position seems to be an *asymmetry*: | make the healthy choice the easy one, | keep the unhealthy choice legal, | and be honest that the former requires *collective* investment | rather than individual willpower.",
      zh: '主要责任在政府，不过我得马上加个限定。当默认环境是被反向设计出来的时候，个人选择实在是个很弱的杠杆——每个街角都能买到便宜的高热量选项，而安全的运动场所却没有。把这件事说成个人责任缺失，恰好方便地免除了政策制定者对他们真正掌控的决策的担子：分区规划、标签制度、学校餐食的采购标准。话虽如此，我也不会走到强硬禁令那一步，一来它往往是累退的，二来悄悄重塑默认选项的措施，通常比教训人的措施更有效。最站得住的立场似乎是一种不对称：让健康选项成为容易的那个，同时保留不健康选项的合法性，并且坦承前者需要的是集体投入，而不是个人意志力。',
      focus: ['立场限定', '三项政策列举', '排比式收束'],
      tips: [
        { k: 'calorie~dense / heavy~handed', v: '两个复合形容词重音都在前半，后半连读压低，别读成四个等重的词。' },
        { k: 'zoning / labelling / procurement standards', v: '三项政策术语长度递增，保持等距节奏，第三项降调后再进入让步。' },
        { k: 'make ... / keep ... / and be honest that ...', v: '结尾三重排比，前两项略升，第三项最重并稳稳降到句尾。' }
      ],
      vocab: ['a genuinely weak lever', 'the default environment is engineered against it', 'stop short of heavy-handed prohibition', 'collective investment rather than willpower']
    },

    /* ---------------- Day 7 · 综合复盘 ---------------- */
    {
      id: 'C_D7_S1', day: 7, part: 'P1', level: 3, theme: '综合：快速延展',
      title: '最近在忙什么', wpm: 150,
      en: "*Mostly* my dissertation, | which has reached the stage where every additional source | creates two new objections rather than one fewer. | I've promised myself I'll stop~revisiting the theoretical chapter | and simply write the analysis, | though, *to be honest*, | I've made that same promise every morning this week.",
      zh: '主要在写学位论文，已经到了这样一个阶段：每多读一份文献，带来的不是少一个疑问，而是多两个反驳。我向自己保证过不再回头折腾理论章，直接写分析——不过老实说，这周我每天早上都许过同一个诺。',
      focus: ['长句分组', '平行对比', '自嘲语调'],
      tips: [
        { k: 'stop~revisiting', v: '/p/ 后直接接 /r/，两词连成一个音块，中间不要补停顿。' },
        { k: 'two new objections / one fewer', v: '平行对比，two 抬起、one 更沉，句尾降调，别一路往上飘。' },
        { k: 'though, *to be honest*,', v: '插入语前后各留微停、音高压低，制造自嘲感后立刻接回主句。' }
      ],
      vocab: ['reached the stage where', 'creates two new objections', 'stop revisiting', 'I’ve made that same promise']
    },
    {
      id: 'C_D7_S2', day: 7, part: 'P2', level: 3, theme: '综合：两分钟长答',
      title: 'Describe a decision you deliberately postponed', wpm: 152,
      en: "The decision I'd talk about was whether to accept a place on a graduate programme abroad, | and I sat with it for the better part of *four months*. | On paper the case was almost tedious: | better funding, | a supervisor whose work I'd cited repeatedly, | and access to data I couldn't otherwise obtain. | What made it difficult was that I wasn't comparing two *programmes* — | I was comparing two quite different *trajectories*, | and only one of them included the people and the language I'd built my life around. | Friends kept asking for a list of pros and cons, | but the list was never the obstacle. | I already knew which option I'd be relieved to choose; | I was waiting for a feeling of certainty that wasn't going~to arrive. | *Eventually* I stopped trying to eliminate the risk | and instead asked a narrower question: | which outcome would I be more willing to explain in five years' time? | I *declined* the place. | I should say it wasn't a brave rejection of opportunity — | it was a fairly quiet acknowledgement that some costs don't show~up in any comparison, | and that postponement had been a way of avoiding that fact. | What stayed with me is that a slow decision is rarely an information problem. | More often it's an *unwillingness* to own a preference you've already formed.",
      zh: '我想讲的是要不要接受一个海外研究生项目的录取，我把它搁了将近四个月。纸面上的理由几乎平淡无趣：更充足的资助、一位我反复引用过其成果的导师，以及别处拿不到的数据。真正难的是，我比较的并不是两个项目，而是两条相当不同的人生轨迹，而其中只有一条包含着我这些年建立生活所围绕的人和语言。朋友们一直让我列利弊清单，但清单从来不是障碍。我其实早已知道选哪一个会让我松一口气；我在等的是一种根本不会到来的确定感。最终我不再试图消除风险，而是换了一个更窄的问题：五年后，哪一个结果我更愿意去解释？我拒了那个名额。得说这不是什么勇敢地对机会说不，只是相当安静地承认：有些成本不会出现在任何比较表里，而拖延一直是绕开这个事实的方式。留在我心里的是——一个慢决定很少是信息问题，更多时候是不愿承认自己其实早已形成偏好。',
      focus: ['两分钟气息分配', '三项列举', '长段对比与收束'],
      tips: [
        { k: 'going~to / show~up', v: '两处连读成块；长答里连读是省气息的关键，别逐词重起音。' },
        { k: 'better funding / a supervisor ... / and access to data', v: '三项列举等距、第三项最长，降调收住后再进入 What made it difficult。' },
        { k: 'two *programmes* / two *trajectories*', v: '全篇核心对比，两处重音明显错开音高，破折号后停足半拍。' },
        { k: '最后两句', v: '连续说理，只在 | 处偷气；unwillingness 放慢、句尾稳稳降到最低。' }
      ],
      vocab: ['sat with it for the better part of four months', 'the list was never the obstacle', 'a feeling of certainty that wasn’t going to arrive', 'own a preference you’ve already formed']
    },
    {
      id: 'C_D7_S3', day: 7, part: 'P3', level: 3, theme: '综合：高抽象论述',
      title: 'Is society becoming less tolerant of uncertainty?', wpm: 158,
      en: "*Arguably*, yes, | and I think the mechanism is largely institutional rather than temperamental. | Modern systems are extremely good at converting uncertainty into a *metric*: | a forecast, | a risk score, | a five~year projection. | That's genuinely useful, | but it quietly changes our expectations — | once a number is available, | not having one starts to feel like negligence rather than an honest description of the world. | You can see it in how organisations respond to anything they can't model: | they either commission another report | or treat the gap as somebody's *failure*. | *That said*, | I wouldn't romanticise uncertainty either, | because ambiguity distributed upwards is often just risk pushed onto people with the least capacity to absorb it. | The more useful distinction is between uncertainty you can *insure* against | and uncertainty you simply have to *inhabit*. | Mature institutions, | and arguably mature individuals, | are those that can tell the difference | without pretending the second category is really the first.",
      zh: '可以说是对的，而且我认为机制主要是制度性的，而非气质上的。现代系统极擅长把不确定性换算成一个指标：一份预测、一个风险分值、一份五年推演。这确实有用，却悄悄改变了我们的预期——一旦存在某个数字，没有数字就开始显得像失职，而不是对世界的一句诚实描述。这一点在组织面对任何无法建模之物时看得很清楚：它们要么再委托一份报告，要么把那处空白当成某个人的失败。话虽如此，我也不想把不确定性浪漫化，因为向上分布的模糊性，常常只是把风险推给了最没有能力承受它的人。更有用的区分是：有些不确定性可以投保对冲，有些则只能身处其中。成熟的制度，或许也包括成熟的人，是能分清这两者、却不假装第二类其实就是第一类的那些。',
      focus: ['分类框架', '三项列举', '成对动词重音', '结尾收束'],
      tips: [
        { k: 'five~year', v: '复合形容词连读成块，重音只在 five 上，year 明显压低。' },
        { k: 'a forecast / a risk score / a five-year projection', v: '三个短例节奏一致、逐项略降，第三项后停半拍再给评论。' },
        { k: '*insure* / *inhabit*', v: '结尾一对动词是全篇框架支点，音高一高一低，中间留出分组停顿。' },
        { k: 'without pretending ...', v: '最后一句放慢、整体音高下移，句尾稳稳落到最低，绝不上扬。' }
      ],
      vocab: ['institutional rather than temperamental', 'converting uncertainty into a metric', 'ambiguity distributed upwards', 'uncertainty you simply have to inhabit']
    }
  ];

  /* 训练模式：影响示范语速、界面提示与下一步推荐 */
  var DRILLS = [
    { id: 'normal', name: '常规跟读', desc: '正常语速听 1 遍 → 跟读 1 遍 → 录音提交', rate: 1.0, gap: 0, icon: '▶' },
    { id: 'slow', name: '慢速拆解', desc: '0.75× 逐句听，专攻连读与词重音', rate: 0.75, gap: 0, icon: '🐢' },
    { id: 'shadow', name: '影子跟读', desc: '示范播放后留同等时长空白，逼自己同步复述', rate: 0.9, gap: 1, icon: '👥' },
    { id: 'chunk', name: '意群停顿', desc: '在每个 | 处停顿跟读，练断句与气息', rate: 0.85, gap: 0.6, icon: '⏸' },
    { id: 'stress', name: '重音对比', desc: '只重读 *标记* 的词，其余主动压低', rate: 0.85, gap: 0, icon: '🔊' }
  ];

  /* ---------- 本模块对接契约（第 1 天约定的补充，字段与 module-contract.js 对齐） ---------- */
  var CONTRACT = {
    version: '1.0',
    module: 'speaking-shadow',
    moduleName: '每日语料 / 跟读练习 / 录音评分与建议',
    corpusLevel: '学术类 IELTS Speaking Band 7–8 示范作答；21 条实测词数 P1 41–56 / P2 171–219 / P3 130–153，示范语速 142–158 词/分',
    idRules: {
      corpusId: 'C_D<day>_S<1-3>            （每日语料唯一编号，团队统一）',
      sessionId: 'S_SHADOW_<...>           （一次跟读提交，练习唯一编号）',
      reportId: 'R_SHADOW_<...>            （一份跟读评分报告，与 sessionId 一一对应）',
      audioId: 'A_REC_<...> / A_SAMPLE_<...>  （现场录音 / 示例音频，本体不落 localStorage）',
      issueId: 'ISS_SH_<...>               （一条跟读建议的唯一编号）',
      task: 'T_SHADOW_<YYYY-MM-DD>        （每日任务，按 userId + 日期唯一）'
    },
    fields: {
      corpus: '{ id, day, part, level, theme, title, en(带 *重音* / |停顿| / ~连读 标记), zh, wpm, focus[], tips[{k,v}], vocab[] }',
      metrics: '{ usable, reason?, durationSec, speechSec, speechRatio, longestPause, longestPauseAt, pauseCount, pauses[{start,end,dur}], syllableCount, syllableRate, rateCV, f0:{samples,median,rangeSemi,finalDropSemi,reliable}, dynamicDb, peak, clipping, envelope[], segments[] }',
      report: '{ id, sessionId, userId, corpusId, createdAt, overall, band, dims[4], issues[], keep, nextStep, transcript?, disclaimer }',
      dim: '{ key:"RHY"|"PAU"|"INT"|"TXT", name, en, score|null, weight, source, reasons[3] }',
      issue: '{ id, dim, level, title, evidence, quote, action, focus, audioStart, audioEnd, drillId }',
      session: '{ id, userId, corpusId, day, createdAt, overall, band, dims, issues, metrics, audioId, transcript?, drillId, nextStep }',
      task: '{ "YYYY-MM-DD": { done:[corpusId], target:3 } }',
      storage: 'localStorage: speakloop.shadow.<userId>（沿用 speakloop.users.v1 / speakloop.lastUser.v1 账号体系）'
    },
    reportRules: [
      '四维固定顺序：RHY 节奏语速 / PAU 连贯停顿 / INT 重音语调 / TXT 文本完整度；每项都给数字依据，不用模糊形容词',
      'RHY / PAU / INT 只使用「原始音频」的声学指标；TXT 仅在有识别转写或用户自填文本时计算',
      'TXT 缺失时该维度记 null、总分按其余三项权重折算，并在页面明示缺项，不得假造文本分',
      '基频样本不足（f0.reliable=false）时 INT 维度只报能量动态与录音质量，不得虚报音高结论',
      '每条 issue 必须同时具备：数字依据、对应文本片段 quote、可回听定位 audioStart/audioEnd、一个具体动作 action、对应训练模式 drillId',
      '评分是本地可解释的韵律/节奏评估，不判断音素准确度，不等同官方 IELTS 发音评分；页面常驻声明',
      '音频本体只存内存（blob URL），刷新后回听按钮置灰并说明录音不保留；metrics / report / 建议全部持久化'
    ],
    sample: {
      corpusId: 'C_D1_S1',
      metrics: {
        usable: true, durationSec: 17.4, speechSec: 13.2, speechRatio: 0.76,
        longestPause: 1.42, longestPauseAt: 8.6, pauseCount: 6, syllableCount: 72,
        syllableRate: 4.15, rateCV: 0.31, f0: { samples: 112, median: 168, rangeSemi: 5.2, finalDropSemi: -2.4, reliable: true },
        dynamicDb: 11.4, peak: 0.36, clipping: 0
      },
      report: {
        id: 'R_SHADOW_MW63Q200_ABCD', sessionId: 'S_SHADOW_MW63Q201_EFGH',
        userId: 'U_MW63QYI8_SOV9', corpusId: 'C_D1_S1',
        createdAt: '2026-11-08T07:20:00.000Z', overall: 71, band: 7.0,
        disclaimer: '本地可解释韵律评估，非官方 IELTS 评分',
        issues: [
          {
            id: 'ISS_SH_MW63Q202_IJKL', dim: 'PAU', level: 'high',
            title: '第 2 个意群后有 1.42 秒长停顿',
            evidence: '最长停顿 1.42 秒（08.6–10.0s），超过建议上限 0.8 秒；有效发声占比 76%',
            quote: 'because that’s when my capacity for sustained concentration tends to peak',
            action: '在 because 之前只停 0.4 秒：先不出声地把下一个意群在心里过一遍，再开口。用「意群停顿」模式重读本条 2 遍。',
            focus: '把最长停顿压到 0.8 秒以内',
            audioStart: 8.6, audioEnd: 10.0, drillId: 'chunk'
          }
        ]
      }
    },
    acceptance: [
      '第 7 天新账号 → 打开每日跟读 → 当天 3 条语料可见、进度条 0/3',
      '选语料 → 听示范（可变速）→ 现场录一段（或点顶部「示例音频」）→ 得到四维评分与 ≥2 条带数字依据的建议',
      '点击建议里的「听这段」→ 从用户音频的对应时间片段回放；点击「按此模式再练」→ 自动切换训练模式与语料',
      '完成 3 条后今日任务打勾、连续打卡 +1、分数曲线新增 3 个点；刷新后报告与建议仍在，仅音频回听在本次会话外不可用'
    ]
  };

  var api = {
    DAYS: DAYS,
    CORPUS: CORPUS,
    DRILLS: DRILLS,
    contract: CONTRACT,
    dayInfo: function (d) { return DAYS.filter(function (x) { return x.day === d; })[0] || DAYS[0]; },
    byDay: function (d) { return CORPUS.filter(function (c) { return c.day === d; }); },
    find: function (id) { return CORPUS.filter(function (c) { return c.id === id; })[0] || null; },
    drill: function (id) { return DRILLS.filter(function (x) { return x.id === id; })[0] || DRILLS[0]; }
  };

  root.SL.shadowData = api;
  root.SL.contract = root.SL.contract || {};
  root.SL.contract.shadowModule = CONTRACT;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
