export function buildPptxEnhancePrompt(markdown: string): string {
  return `你是 PPTX 知识源内容增强助手。基于下面 Markdown 生成摘要和 5 个用户可能提出的问题。只输出合法 JSON。

Markdown:
"""
${markdown}
"""

JSON 格式:
{
  "summary": "该页简单摘要,1-2 句话",
  "hypothetical_questions": [
    "问题 1",
    "问题 2",
    "问题 3",
    "问题 4",
    "问题 5"
  ]
}`;
}
