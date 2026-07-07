export function buildPptxVisionPrompt(slideIndex: number, slideCount: number): string {
  return `你是会议幻灯片内容提取助手。请提取第 ${slideIndex} / ${slideCount} 页 PPTX 的内容,并按严格 Markdown 输出。不要输出额外说明。

# 标题
[逐字提取主标题]

# 副标题/标语
[副标题或标语,没有则写"无"]

# 核心要点
- [要点 1]
- [要点 2]
- [要点 3]

# 图表/界面内容
[用文字描述图表、流程、软件界面、表格或图片中的可见信息]

# 适用场景
[这页内容适用的业务场景]

# 核心信息
[一句话总结]

要求:
- 中英文原样保留,不要翻译。
- 看不清的文字标注 [模糊],不要猜。
- 只输出 Markdown。`;
}
