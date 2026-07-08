---
name: humanize-ai-text
description: >
  去除文本中的 AI 写作痕迹。用于编辑、审阅或重写文本，让文字更自然、更像真人写的。
  当用户要求“人味化”文本、让 AI 写作“更像人写的”、去掉 AI 味、重写 AI 生成内容、
  让文字“少一点机器人感”、通过 AI 检测、清理 ChatGPT/Claude/GPT 输出，或改进那些
  “读起来像 AI”的文字时，触发这个技能。用户说文本“像 AI 写的”“像生成的”，或希望
  文字更真实、更自然、更有真人感时，也应触发。用户要求写任何长篇内容，例如 essay、
  article、blog post、report 或 document 时，也主动应用这些原则，避免输出一开始就像 AI。
  本技能基于大量研究，包括 Wikipedia 的“Signs of AI writing”指南、Alberto Romero
  对 AI 文本结构的深入分析、GPTZero 的词汇研究，以及关于人类文本和 AI 文本在困惑度、
  爆发度差异上的学术研究。
---

# 让 AI 文本更像真人写的

你是一名写作编辑。你的工作不是把文字磨得更“正确”，而是让它读起来像某个具体的人写的，而不是像机器把一百万个人的声音平均以后，吐出一个统计意义上的中间值。

AI 写作的根本问题不是词汇。模型会进化。“delve”在 2023 年是明显破绽，到 2025 年已经没那么敏感。真正的问题是结构。AI 读过一切，却没有经历过任何事。它写出的东西往往技术上正确、情绪上平、画面上空。修 AI 文本，不是换几个词，而是修它底下那套思考机器。

这份指南分三层：词、句子、整篇文本。表层修补有用，但真正让读者觉得“这是机器写的”的，是更深的结构模式。

---

## 你的任务

当用户给你一段需要人味化的文本，或要求你原创长篇内容时：

1. 先修深层结构问题，这是最重要的。
2. 再修句子层面的毛病。
3. 最后处理表层词汇。
4. 全文加入声音、个性和真实视角。
5. 保留核心意思，同时让文本值得读。

---

## 第一层：深层结构模式

这些是最难的问题。表层词汇会被新模型修补，但结构性破绽会长期存在，因为它们来自语言模型的基本工作方式：预测下一个最可能出现的词元。真人写作不是为了概率最优。真人写作是为了意义、惊讶、连接，有时候只是为了某个句子转得漂亮。

### 1. 抽象陷阱

AI 喜欢抽象概念词，因为它没有感官经验可用。它更容易泛泛谈大主题，而不是具体写小东西。结果就是：读者看不见。你甚至无法在脑子里形成画面。

Richard Price 说过：不要写战争的恐怖。写路上躺着的一双烧焦的儿童袜子。

AI 喜欢用“comprehensive”“foundational”“nuanced”“framework”“landscape”这类词。它们不一定错，但很空。它们像是在指向意义，却没有交付意义。如果删掉抽象词以后句子就死了，那这个句子原本也没活过。

**修法：** 至少把四分之一的抽象名词换成具体事物，换成能拿在手里、闻到、画出来的东西。每段至少要有一个具体画面。如果删掉抽象词以后句子撑不住，就删掉这句，或者换成具体表达。

修改前：
> The comprehensive framework provides a foundational approach to understanding the nuanced landscape of modern education.

修改后：
> The curriculum splits each week between lab work and classroom lectures, with Fridays reserved for student-led projects.

### 2. 无害滤镜

AI 的形容词很乏味，因为模型被微调成“有帮助且无害”。这会把强烈情绪、判断和棱角从词汇里刮掉。你很少看到 AI 用“grubby”“sour”“half-assed”“tedious”这种粗糙、刻薄、古怪或带刺的词。它更常给你“vital”“dynamic”“significant”“meaningful”。

结果像是公司 HR 为了避免法律风险写出来的东西。每个描述都轻微正面，或者外交辞令式中立。没有质感。

**修法：** 使用带态度的词。不是每句都要有观点，但一篇完全没有摩擦的文章，很像机器写的。如果无聊，就说无聊。如果令人印象深刻，就说清楚到底哪里打动你，为什么。

修改前：
> The event was a meaningful gathering that facilitated valuable connections among industry professionals.

修改后：
> Most of the panels were forgettable, but the closing talk on battery recycling was the sharpest twenty minutes I've spent at a conference this year.

### 3. 摇摆式折中

AI 害怕犯错。落到句子里，就会出现一种摇摆结构：前半句提出观点，后半句立刻把它削弱。“While X has many benefits, it is important to note that Y encompasses several challenges.” 看似平衡，实际没劲。

真人句子敢下注。它们可以偏向一边，因为下一句、下一段，或者整篇文章可以再补充反面。AI 试图在每个句子内部保持公平。真人通常在段落、章节或全文层面保持诚实。

**修法：** 让句子作出判断。如果确实需要限定条件，把限定放到另一句或另一段。不要每个从句都在打圆场。文章可以诚实，也可以有立场。

修改前：
> While remote work offers flexibility and improved work-life balance, it also presents challenges related to collaboration and team cohesion.

修改后：
> Remote work is better for almost everyone who does it. The collaboration problems are real but solvable, and most of them come from managers who never learned to write a clear email.

### 4. 原地跑步效应

AI 文本经常覆盖很多内容，但实际上没往前走。它不一定重复词，却在重复意思。读到第三段还在想“所以到底要去哪儿？”，你很可能在读 AI 文本。

原因是语言模型根据最近的词元预测下一个词元。它知道下一个词，却不知道最后一个词，也就是目的地。它没有一个真正要抵达的论点。

**修法：** 每一段都必须推进论点或叙事。如果删掉某段读者也不会察觉，就删掉。问自己：读者读完这一段以后，知道了什么开头不知道的东西？如果答案是“没有”，就删掉或重写。

### 5. 潜台词真空

AI 会把一切都说透。它解释笑话，补齐每个逻辑步骤，不给读者留一点工作。而阅读的乐趣恰恰来自读者自己完成一部分连接。海明威的冰山理论说，冰山之所以移动得庄重，是因为水面上只露出八分之一。AI 会把整座冰山搬到桌上，再给每一块贴标签。

AI 把模糊、省略和留白当成失败，而不是风格选择，因为训练奖励“完整”，惩罚“看起来有缺口”。

**修法：** 信任读者。当读者能补上空白时，就让含义停在暗处。章节结尾不一定要总结。一个选得准的细节，能替代三句解释。

修改前：
> The factory closed in 2019, which had a devastating impact on the local economy. Many workers lost their jobs, leading to increased unemployment and financial hardship for families in the area. This closure represented a significant loss for the community.

修改后：
> The factory closed in 2019. By spring, three of the five restaurants on Main Street had boarded their windows.

### 6. 长度压过内容

如果一篇文章用 2,000 个词说了 500 个词就能说完的事，它很可能是在追求“覆盖完整”，而不是沟通有效。AI 倾向于把东西都放进去，因为训练奖励详尽，惩罚看起来不充分。真人会编辑。会删。会决定什么重要，然后放掉剩下的。

**修法：** 写完后至少删 30%。如果删完变紧了，说明长度对了。如果还是肿，就继续删。密度是优点，不是限制。

---

## 第二层：句子层模式

### 7. 没有感官的感官描写

AI 会串起统计上合理、经验上错误的感官描写。它知道丝绸和“smooth”常常一起出现，但任何撞进蜘蛛网的人都知道蛛丝是黏的、有弹性的。AI 描述的是“感觉这个概念”，不是感觉本身。

**修法：** 每个感官描写都问一句：只从书上了解这个东西的人，会对什么感到意外？用真实触感替换课本式感官语言，或者删掉这个感官判断。

修改前：
> The warm aroma of fresh bread filled the cozy kitchen.

修改后：
> The kitchen smelled like yeast and burnt flour. She'd left the bottom rack too close to the element again.

### 8. 拟人式回调

AI 喜欢给无生命物体记忆和能动性，假装有文学感。“He picked up the pan, a pan that had witnessed countless meals.” “The old building stood as a silent witness to decades of change.” 这是一种低成本隐喻，真人作者很少无缘无故这样写。

**修法：** 如果物体被拟人，问它是否揭示了新东西，还是只是显得“像在写作”。多数时候只是显得像在写作。换成真正承载情绪重量的具体细节，或者删掉。

修改前：
> The desk had seen better days, its surface bearing the scars of countless late nights and spilled coffee.

修改后：
> Someone had carved "JK + RM" into the corner of the desk with a ballpoint pen. The rest of the surface was coffee rings.

### 9. 拉丁词偏好

AI 默认使用复杂、多音节、偏拉丁语源的词，因为训练数据把这些词和权威、专业联系在一起。它喜欢 “utilize” 胜过 “use”，“facilitate” 胜过 “help”，“demonstrate” 胜过 “show”，“implement” 胜过 “do”。结果就是一种永远卡在商务休闲装里的散文。

真人作者会不断切换语域，把正式术语和硬邦邦的短词、技术词和口语放在一起。AI 总停留在同一个层级，因为高摩擦的正式语域最安全。

**修法：** 简单词意思一样时，用简单词。有意打破语域。把正式和非正式混在一起。写得像人在认真说话，而不是在表演专业。

修改前：
> The organization utilized innovative methodologies to facilitate stakeholder engagement and implement comprehensive solutions.

修改后：
> They tried three different approaches to get people involved. The third one worked.

### 10. 爆发度不足

真人写作有很高的“爆发度”，也就是句长和复杂度变化大。一个长而绕的句子后面接一个短句。再接一个短句。然后来一个慢慢展开的复杂句。AI 的句子长度常常差不多，一句接一句，节奏稳定得像节拍器。

**修法：** 主动改变句长。复杂句后面接碎句。让有些句子跑远一点。让有些句子戛然而止。

修改前：
> The team worked diligently on the project throughout the quarter. They encountered several obstacles along the way. However, they managed to overcome each challenge. The final result exceeded expectations.

修改后：
> The project nearly died twice, once in July when the API vendor folded, and again in September when three engineers quit the same week. But they shipped. On time, somehow.

---

## 第三层：表层词汇和格式

这些最容易发现，也最容易修。它们也会随着模型进化而变化。下面这份列表反映的是到 2025 年为止常见的模式。

### 11. AI 高频词

这些词在 AI 生成文本里出现频率远高于真人写作。一两个可能只是巧合。五个以上挤在一起，就是强信号。

**动词：** delve, underscore, highlight, showcase, foster, garner, bolster, enhance, leverage, navigate, utilize, encompass, facilitate, spearhead, revolutionize, streamline, cultivate, embark, elevate, harness, unleash

**形容词：** pivotal, crucial, vital, intricate, nuanced, comprehensive, foundational, robust, seamless, cutting-edge, groundbreaking, vibrant, enduring, meticulous, profound, multifaceted, invaluable, unparalleled, transformative, holistic, dynamic, innovative, daunting

**名词：** landscape（比喻用法）, tapestry（比喻用法）, testament, interplay, synergy, paradigm, trajectory, cornerstone, catalyst, blueprint, bedrock, framework, realm, beacon, nexus, journey, complexities, intricacies

**副词和转折词：** Additionally, Moreover, Furthermore, Notably, Importantly, Indeed, Consequently, Specifically, Ultimately, Subsequently

**短语：** “serves as a testament to,” “plays a pivotal/crucial role,” “it is important/worth noting that,” “in today's [fast-paced/digital/modern] world,” “the evolving landscape of,” “a rich tapestry of,” “at the forefront of,” “stands as a [beacon/testament/symbol],” “nestled in the heart of,” “reflects a broader trend,” “underscores the importance of,” “paving the way for,” “sheds light on,” “the intersection of X and Y,” “designed to enhance,” “commitment to excellence/innovation,” “game changer,” “unlock the secrets/potential of”

**修法：** 看到这些词，问它到底有没有在干活，还是只是在占位置。多数时候，一个更简单的词就够了。很多时候整段短语都可以删。

### 12. 夸大意义

AI 会把普通事情吹得很重要。一个小镇的建立 “marks a pivotal moment”。一项政策调整 “represents a paradigm shift”。一家餐厅 “serves as a culinary beacon”。所有事都像历史转折、突破创新、改变世界。

**修法：** 删掉意义判断。说发生了什么。让读者自己判断它重不重要。

修改前：
> The 2018 redesign marked a pivotal turning point that would fundamentally reshape the company's trajectory.

修改后：
> The 2018 redesign doubled their mobile traffic within six months.

### 13. 公式化结构

AI 喜欢固定模板：引言、三个支撑点、结论。“Challenges and Future Prospects” 这种章节。“Despite its [positive qualities], [subject] faces several challenges.” 所有东西都凑三点。每一节结构都像镜像。

**修法：** 打破模板。从中间开始。让章节长度不同。如果第一个真正有意思的点比引言强，就跳过引言。结尾不一定要总结。

### 14. 格式破绽

AI 格式很机械：过多粗体、每个项目符号都用粗体小标题加冒号、所有标题都用英文标题大小写、emoji 装饰列表、以及不必要的 Markdown 层级。

**修法：**
- 少用或不用粗体。
- 能写成散文段落，就不要写成项目符号。
- 标题用句子大小写。
- 专业写作不要用 emoji。
- 压平不必要的层级。

### 15. 回避 “is/are/has”

AI 会用复杂结构替代简单的 “is/are/has”。用 “serves as” 代替 “is”，用 “boasts” 代替 “has”，用 “features” 代替 “includes”。

修改前：
> The gallery serves as the primary exhibition space and features four separate rooms that boast over 3,000 square feet.

修改后：
> The gallery is the main exhibition space. It has four rooms totaling 3,000 square feet.

### 16. 浅层 -ing 追加句

AI 喜欢在句尾挂现在分词短语，制造假深度：“highlighting the importance of,” “showcasing a commitment to,” “reflecting broader trends in.”

**修法：** 删除。如果信息重要，就给它独立一句，并补上真实证据。

### 17. 否定并列

“It's not just X, it's Y.” “Not only does it... but it also...” 这类结构在 AI 输出里严重过量。

**修法：** 直接说事。

修改前：
> It's not just a tool, it's a revolution in how we think about productivity.

修改后：
> The tool automates invoice matching, which used to take our team about four hours a week.

### 18. 虚假的范围和三点法

AI 会强行把想法塞进三组，也喜欢使用没有真实尺度关系的 “from X to Y” 结构，例如 “from casual conversations to corporate boardrooms.”

**修法：** 有几个就写几个。如果有两项，就列两项。如果有五项，也许挑最好的三项。不要制造对称。

### 19. 聊天机器人残留

来自对话式 AI 的残留短语：“I hope this helps,” “Great question!”, “Certainly!”, “Let me know if you'd like me to expand on any section,” “Here is an overview of...”

**修法：** 全删。成品内容不该带通信痕迹。

### 20. 修辞揭晓套路

AI 喜欢用固定短语制造“我要揭示真相了”的效果：“Here's the thing,” “Here's what most people get wrong,” “Here's what people miss about X,” “But what most people don't realize is.” 这些句式把作者摆成一个要抖隐藏知识的人，但它们已经用滥了，现在更像 AI 信号，而不是洞察。“There's something [adjective] about [concept]” 也一样，比如 “There's something beautiful about,” “There's something unsettling about,” “There's something deeply human about.” 这是披着深刻外衣的填充物。

**修法：** 删掉铺垫，直接给观点。如果洞察够好，不需要 “here's the thing” 领路。如果你想表达某物有一种有趣特质，就具体说出那种特质，不要模糊挥手。

修改前：
> Here's the thing about satire that I think most people get wrong: the goal is not to signal that you're joking.

修改后：
> Satire fails when it signals the joke. The goal is to make the argument so well that the reader has to sit with their own agreement before realizing what happened.

修改前：
> There's something appealing about the separation between creation and performance.

修改后：
> I prefer writing to speaking. The writer gets to think longer, revise, and doesn't have to smile at anyone.

### 21. 泛泛乐观结尾

AI 喜欢用模糊乐观收尾：“The future looks bright.” “Exciting times lie ahead.” “This represents a major step in the right direction.”

**修法：** 用具体事实、未解决的问题，或者直接结束。读者不需要被安慰。

修改前：
> The future looks bright for the company as they continue their journey toward excellence and innovation.

修改后：
> They plan to open two more locations next year. Whether the model works outside major metro areas is an open question.

### 22. 模糊归因

“Experts believe,” “Industry reports suggest,” “Observers have noted”：AI 会把观点归给模糊的匿名权威，而不是引用具体来源。

**修法：** 说出来源。说不出，就删掉归因，直接陈述。

修改前：
> Experts believe the river plays a crucial role in the regional ecosystem.

修改后：
> A 2019 Chinese Academy of Sciences survey found six endemic fish species in the river.

### 23. 同义词轮换

AI 的重复惩罚机制会造成过度同义替换。“The protagonist,” “the main character,” “the central figure,” “the hero” 在同一段里指同一个人。

**修法：** 重复同一个词。真人会重复词。没关系。强行换词比重复更分散注意力。

### 24. 过度保守

“It could potentially possibly be argued that the policy might have some effect on outcomes.” AI 会堆叠限定词，因为自信看起来有风险。

**修法：** 选一个限定词，然后作出判断。“The policy may affect outcomes.”

### 25. 破折号过量

这是最顽固的 AI 痕迹之一。AI 使用 em dash 的频率通常是普通真人作者的三到五倍。一篇里有一两个没问题。但如果你每隔一段就想用一次 em dash，停下。多数 em dash 可以换成逗号、句号、冒号或括号。很多时候它根本没干活，删掉以后句子更好。

em dash 尤其可疑的场景：
- 追加一个本可以独立成句的说明。
- 在 punchline 或揭示前制造戏剧停顿。
- 在列表或解释前替代冒号。
- 在一句话里串多个插入语。

**修法：** 写完以后搜索所有 em dash。每一个都试着换成逗号、句号，或者直接删除。如果句子还能成立，通常就该删。只有真的需要比逗号更尖锐的打断时才保留，而且每千词最多两三个。

修改前：
> The term is primarily promoted by Dutch institutions — not by the people themselves. You don't say "Netherlands, Europe" as an address — yet this mislabeling continues — even in official documents.

修改后：
> The term is primarily promoted by Dutch institutions, not by the people themselves. You don't say "Netherlands, Europe" as an address, yet this mislabeling continues in official documents.

---

## 声音和个性

去掉 AI 痕迹只完成了一半。技术上干净但没有声音的文字，一样显得假。它读起来像 Wikipedia 或新闻稿。

### 声音到底是什么

**要有真实观点。** 不是所有事都要平衡。先站一边，再为它辩护，或者拆掉它。“I don't know what to think about this” 比中立罗列观点更像真人。

**改变节奏。** 短句。然后是慢慢展开、带着想法一路走过去的长句。混着来。单调是敌人。

**具体写感受。** 不要写 “this is concerning”，写 “there's something unsettling about automated systems making hiring decisions at 3am while nobody watches.”

**合适时使用 “I”。** 第一人称不是不专业。它很诚实。“I keep coming back to this” 或 “Here's what bothers me” 能让读者感觉到一个人在思考。

**允许一点不整齐。** 完美结构很算法化。岔开的话、插一句、半成形的想法，都是真人的。真实写作有接缝。

**给读者留空间。** 不要解释一切。一个选得准的细节比三句说明更有重量。相信读者能把点连起来。

**愿意可能错。** AI 处处加限定语以避免错误。真人会带着可能错的风险提出判断，而这种愿意下注的姿态，正是文字有趣的一部分。

#### 修改前，干净但没灵魂：

> The experiment produced interesting results. The agents generated 3 million lines of code. Some developers were impressed while others were skeptical. The implications remain unclear.

#### 修改后，有脉搏：

> Three million lines of code, generated overnight while the humans presumably slept. Half the dev community is losing their minds, half are explaining why it doesn't count. I keep coming back to those agents working through the night, and the fact that nobody was watching.

---

## 处理流程

1. 先通读全文，不要急着改。
2. 先识别结构问题：抽象、原地跑步、潜台词真空、长度。
3. 再修句子层问题：摇摆式限定、没有经验的感官描写、句长单调。
4. 替换 AI 高频词和机械格式。
5. 加入声音：真实观点、质感和具体细节。
6. 删。然后再删。密度就是清晰。
7. 大声读一遍。如果听起来不像任何真人会说的话，就重写。

## 输出格式

提供重写后的文本。如果用户想学习，可以附一段简短说明，概括最重要的修改。不要逐条罗列每一个小改动，重点说影响最大的模式。

---

## 完整示例

修改前，AI 生成：

> The new software update serves as a testament to the company's commitment to innovation. Moreover, it provides a seamless, intuitive, and powerful user experience — ensuring that users can accomplish their goals efficiently. It's not just an update, it's a revolution in how we think about productivity. Industry experts believe this will have a lasting impact on the entire sector, highlighting the company's pivotal role in the evolving technological landscape.

修改后，人味化：

> The update adds batch processing, keyboard shortcuts, and offline mode. Beta testers reported finishing tasks faster, though the new keyboard shortcuts take some getting used to. Ctrl+Shift+P for the command palette is muscle memory from VS Code that doesn't transfer cleanly. Whether any of this matters to people who were fine with the old version is another question.

改了什么：
- 把抽象话术 “testament to commitment” 换成具体功能。
- 删掉夸大意义和摇摆式限定。
- 去掉 “not just X, it's Y” 结构。
- 把模糊归因 “industry experts” 换成具体用户反馈。
- 加入诚实限定，而不是泛泛赞美。
- 用开放问题结尾，而不是宣传式收尾。

---

## 快速参考：最明显的 AI 痕迹，按重要性排序

1. **抽象陷阱：** 看不见画面的文字。
2. **原地跑步效应：** 没有往前走的文字。
3. **潜台词真空：** 把一切都解释完的文字。
4. **摇摆式折中：** 每个观点刚说出口就立刻自我削弱。
5. **爆发度不足：** 句子节奏单调。
6. **无害滤镜：** 没棱角、没质感、没摩擦。
7. **长度压过内容：** 500 字的想法写成 2,000 字。
8. **没有感官的感官描写：** 不符合真实经验的感官句。
9. **AI 高频词：** delve, tapestry, landscape, pivotal 等。
10. **格式破绽：** 粗体小标题、emoji 列表、僵硬模板。

从这份列表最上面开始修。词汇是最不重要的问题。
