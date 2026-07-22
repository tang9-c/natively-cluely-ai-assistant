export interface PostCallTranscriptSegment {
  speaker?: string;
  text: string;
  timestamp?: number;
}

export interface PostCallSummaryData {
  overview?: string;
  actionItems: string[];
  keyPoints: string[];
  decisions?: string[];
  openQuestions?: string[];
  sections?: Array<{ title: string; bullets: string[] }>;
}

export interface GenerateFullTranscriptSummaryParams {
  llmHelper: {
    generateMeetingSummary: (systemPrompt: string, context: string, groqSystemPrompt?: string) => Promise<string>;
  };
  transcript: PostCallTranscriptSegment[];
  context: string;
  modeTemplateType?: string | null;
  modeNoteSections: Array<{ title: string; description: string }>;
  modeContextBlock: string;
  baseRules: string;
  groqSummaryPrompt: string;
  maxChunkChars?: number;
}

const DEFAULT_MAX_CHUNK_CHARS = 24000;
const CHUNK_OVERLAP_CHARS = 1200;

export function chunkTranscriptForSummary(context: string, maxChunkChars = DEFAULT_MAX_CHUNK_CHARS): string[] {
  const cleaned = String(context || '').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChunkChars) return [cleaned];

  const chunks: string[] = [];
  let start = 0;
  const overlap = Math.min(CHUNK_OVERLAP_CHARS, Math.max(0, Math.floor(maxChunkChars / 4)));
  while (start < cleaned.length) {
    const hardEnd = Math.min(start + maxChunkChars, cleaned.length);
    let end = hardEnd;
    if (hardEnd < cleaned.length) {
      const newline = cleaned.lastIndexOf('\n', hardEnd);
      if (newline > start + Math.floor(maxChunkChars * 0.6)) end = newline;
    }
    chunks.push(cleaned.slice(start, end).trim());
    if (end >= cleaned.length) break;
    const nextStart = Math.max(0, end - overlap);
    if (nextStart <= start) start = end;
    else start = nextStart;
    if (chunks.length > 200) break;
  }
  return chunks.filter(Boolean);
}

function stripJsonFences(value: string): string {
  const match = value.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  return (match?.[1] || value).trim();
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function emptySummary(modeNoteSections: Array<{ title: string; description: string }>): PostCallSummaryData {
  return {
    overview: undefined,
    actionItems: [],
    keyPoints: [],
    decisions: [],
    openQuestions: [],
    ...(modeNoteSections.length > 0
      ? { sections: modeNoteSections.map((section) => ({ title: section.title, bullets: [] })) }
      : {}),
  };
}

function parseSummaryJson(raw: string, modeNoteSections: Array<{ title: string; description: string }>): PostCallSummaryData | null {
  try {
    const parsed = JSON.parse(stripJsonFences(raw));
    const result: PostCallSummaryData = {
      overview: typeof parsed.overview === 'string'
        ? parsed.overview
        : typeof parsed.summary === 'string'
          ? parsed.summary
          : undefined,
      keyPoints: safeStringArray(parsed.keyPoints),
      actionItems: safeStringArray(parsed.actionItems),
      decisions: safeStringArray(parsed.decisions),
      openQuestions: safeStringArray(parsed.openQuestions),
    };

    if (modeNoteSections.length > 0) {
      const rawSections = parsed.sections && typeof parsed.sections === 'object' ? parsed.sections : {};
      result.sections = modeNoteSections.map((section) => ({
        title: section.title,
        bullets: safeStringArray((rawSections as Record<string, unknown>)[section.title]),
      }));
    }
    return result;
  } catch {
    return null;
  }
}

function buildSectionList(modeNoteSections: Array<{ title: string; description: string }>): string {
  return modeNoteSections
    .map((section) => section.description?.trim()
      ? `- "${section.title}": ${section.description}`
      : `- "${section.title}"`)
    .join('\n');
}

function buildSectionKeys(modeNoteSections: Array<{ title: string; description: string }>): string {
  return modeNoteSections.map((section) => `    "${section.title}": []`).join(',\n');
}

function buildChunkPrompt(params: GenerateFullTranscriptSummaryParams, chunkIndex: number, totalChunks: number): string {
  if (params.modeNoteSections.length > 0) {
    return `你是一位静默的会议记录员。下面是完整会议的第 ${chunkIndex + 1}/${totalChunks} 个片段，请只总结本片段中实际出现的信息。
${params.modeContextBlock}
${params.baseRules}

需要填充的分区：
${buildSectionList(params.modeNoteSections)}

FDE 模式必须区分行动项、决策项和待确认事项。不要把泛泛的“下一步”自动归为行动项。

只返回合法 JSON，不要 markdown 围栏、不要注释、不要额外 key。
{
  "overview": "本片段 1 句话概括",
  "sections": {
${buildSectionKeys(params.modeNoteSections)}
  },
  "actionItems": [],
  "decisions": [],
  "openQuestions": []
}`;
  }

  return `你是一位静默的会议总结员。下面是完整会议的第 ${chunkIndex + 1}/${totalChunks} 个片段，请只总结本片段中实际出现的信息。

${params.baseRules}

只返回合法 JSON，不要 markdown 代码块：
{
  "overview": "本片段 1 句话概括",
  "keyPoints": ["具体话题或观点"],
  "actionItems": ["明确可执行的后续事项"],
  "decisions": ["明确决策"],
  "openQuestions": ["待确认事项或开放问题"]
}`;
}

function buildMergePrompt(params: GenerateFullTranscriptSummaryParams, chunkSummaries: PostCallSummaryData[]): string {
  const serialized = JSON.stringify(chunkSummaries);
  if (params.modeNoteSections.length > 0) {
    return `你是一位资深产品经理。请将下面这些局部会议摘要归并为一份完整会议摘要。
${params.modeContextBlock}
${params.baseRules}

归并规则：
- 覆盖所有局部摘要中的重要信息，不要只保留前半段。
- 去重相同事项。
- FDE 模式必须区分行动项、决策项和待确认事项。
- 行动项必须是可执行动作；泛泛的下一步放入 openQuestions。

需要填充的分区：
${buildSectionList(params.modeNoteSections)}

局部摘要 JSON：
${serialized}

只返回合法 JSON，不要 markdown 围栏：
{
  "overview": "1-2 句话概括完整会议",
  "sections": {
${buildSectionKeys(params.modeNoteSections)}
  },
  "actionItems": [],
  "decisions": [],
  "openQuestions": []
}`;
  }

  return `你是一位资深产品经理。请将下面这些局部会议摘要归并为一份完整会议摘要。

${params.baseRules}

归并规则：
- 覆盖所有局部摘要中的重要信息，不要只保留前半段。
- 去重相同事项。
- 行动项必须是可执行动作；泛泛的下一步放入 openQuestions。

局部摘要 JSON：
${serialized}

只返回合法 JSON，不要 markdown 代码块：
{
  "overview": "1-2 句话描述完整会议",
  "keyPoints": ["3-6 个具体 bullet"],
  "actionItems": ["明确可执行的后续事项"],
  "decisions": ["明确决策"],
  "openQuestions": ["待确认事项或开放问题"]
}`;
}

export async function generateFullTranscriptSummary(params: GenerateFullTranscriptSummaryParams): Promise<PostCallSummaryData> {
  const chunks = chunkTranscriptForSummary(params.context, params.maxChunkChars);
  if (chunks.length === 0) return emptySummary(params.modeNoteSections);

  const partials: PostCallSummaryData[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    try {
      const raw = await params.llmHelper.generateMeetingSummary(
        buildChunkPrompt(params, i, chunks.length),
        chunks[i],
        params.groqSummaryPrompt,
      );
      const parsed = raw ? parseSummaryJson(raw, params.modeNoteSections) : null;
      if (parsed) partials.push(parsed);
    } catch (err) {
      console.warn('[PostCallSummaryGenerator] chunk summary failed', {
        errorName: err instanceof Error ? err.name : 'UnknownError',
        chunkIndex: i,
        chunkCount: chunks.length,
        modeTemplateType: params.modeTemplateType,
        inputLength: chunks[i]?.length ?? 0,
      });
    }
  }

  if (partials.length === 0) return emptySummary(params.modeNoteSections);
  if (partials.length === 1 && chunks.length === 1) return partials[0];

  try {
    const raw = await params.llmHelper.generateMeetingSummary(
      buildMergePrompt(params, partials),
      JSON.stringify(partials),
      params.groqSummaryPrompt,
    );
    return parseSummaryJson(raw, params.modeNoteSections) ?? emptySummary(params.modeNoteSections);
  } catch (err) {
    console.warn('[PostCallSummaryGenerator] final summary merge failed', {
      errorName: err instanceof Error ? err.name : 'UnknownError',
      partialCount: partials.length,
      modeTemplateType: params.modeTemplateType,
    });
    return partials[0] ?? emptySummary(params.modeNoteSections);
  }
}
