import type { PostCallSummaryData, PostCallTranscriptSegment } from './PostCallSummaryGenerator';

type Severity = 'info' | 'opportunity' | 'warning';

export interface LlmCoachingInsight {
  id: string;
  type: string;
  title: string;
  detail: string;
  severity: Severity;
  evidence?: string;
}

export interface LlmPostCallEnhancements {
  coachingInsights: LlmCoachingInsight[];
  followUpDraft: string;
}

export interface GeneratePostCallLlmEnhancementsParams {
  llmHelper: {
    generateMeetingSummary: (systemPrompt: string, context: string, groqSystemPrompt?: string) => Promise<string>;
  };
  transcript: PostCallTranscriptSegment[];
  modeTemplateType?: string | null;
  summaryData: PostCallSummaryData;
  deterministicEnhancements: unknown;
}

const EMPTY_ENHANCEMENTS: LlmPostCallEnhancements = {
  coachingInsights: [],
  followUpDraft: '',
};

function stripJsonFences(value: string): string {
  const match = value.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  return (match?.[1] || value).trim();
}

function transcriptEvidenceWindow(transcript: PostCallTranscriptSegment[]): string {
  const lines = transcript
    .filter((segment) => segment?.text?.trim())
    .map((segment) => `${segment.speaker || 'speaker'}: ${segment.text.trim()}`);
  if (lines.length <= 80) return lines.join('\n');
  const middle = Math.floor(lines.length / 2);
  return [
    ...lines.slice(0, 25),
    '……',
    ...lines.slice(Math.max(25, middle - 15), middle + 15),
    '……',
    ...lines.slice(-25),
  ].join('\n');
}

function normalizeSeverity(value: unknown): Severity {
  return value === 'warning' || value === 'opportunity' || value === 'info' ? value : 'info';
}

function parseEnhancements(raw: string): LlmPostCallEnhancements {
  const parsed = JSON.parse(stripJsonFences(raw));
  const coachingInsights = Array.isArray(parsed.coachingInsights)
    ? parsed.coachingInsights
      .map((item: any, index: number): LlmCoachingInsight | null => {
        const title = typeof item.title === 'string' ? item.title.trim() : '';
        const detail = typeof item.detail === 'string' ? item.detail.trim() : '';
        const evidence = typeof item.evidence === 'string' ? item.evidence.trim() : '';
        if (!title || !detail || !evidence) return null;
        return {
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `llm_insight_${index + 1}`,
          type: typeof item.type === 'string' && item.type.trim() ? item.type.trim() : 'post_call_insight',
          title,
          detail,
          severity: normalizeSeverity(item.severity),
          evidence,
        };
      })
      .filter((item: LlmCoachingInsight | null): item is LlmCoachingInsight => Boolean(item))
    : [];

  return {
    coachingInsights,
    followUpDraft: typeof parsed.followUpDraft === 'string' ? parsed.followUpDraft.trim() : '',
  };
}

function buildPrompt(params: GeneratePostCallLlmEnhancementsParams): string {
  return `你是一位资深中文会议复盘助手。请基于会议正文摘要、已确认记录和必要证据窗口，生成摘要页增强模块。

输出契约：
- 所有用户可见内容使用简体中文。
- 每条 coachingInsight 必须有明确 evidence；没有证据就不要生成。
- 不要把关键词命中当结论。
- 不要生成英文标题或英文模板句。
- FDE 模式必须区分行动项、决策项和待确认事项；不要把泛泛的下一步自动归为行动项。
- followUpDraft 必须基于明确下一步、待确认事项或交付计划。
- 如果没有明确跟进事项，followUpDraft 返回空字符串。
- 只返回合法 JSON，不要 markdown。

模式：${params.modeTemplateType || 'general'}

正文摘要 JSON：
${JSON.stringify(params.summaryData)}

确定性记录 JSON：
${JSON.stringify(params.deterministicEnhancements)}

证据窗口：
${transcriptEvidenceWindow(params.transcript)}

响应格式：
{
  "coachingInsights": [
    {
      "type": "fde_validation_gap",
      "title": "中文标题",
      "detail": "中文说明",
      "severity": "info",
      "evidence": "会议中的明确证据句"
    }
  ],
  "followUpDraft": "中文跟进草稿或空字符串"
}`;
}

export async function generatePostCallLlmEnhancements(params: GeneratePostCallLlmEnhancementsParams): Promise<LlmPostCallEnhancements> {
  try {
    const raw = await params.llmHelper.generateMeetingSummary(
      buildPrompt(params),
      JSON.stringify({
        summaryData: params.summaryData,
        deterministicEnhancements: params.deterministicEnhancements,
        evidenceWindow: transcriptEvidenceWindow(params.transcript),
      }),
    );
    return raw ? parseEnhancements(raw) : EMPTY_ENHANCEMENTS;
  } catch (err) {
    console.warn('[PostCallLlmEnhancements] generation failed', {
      errorName: err instanceof Error ? err.name : 'UnknownError',
      modeTemplateType: params.modeTemplateType,
      transcriptSegmentCount: params.transcript.length,
    });
    return EMPTY_ENHANCEMENTS;
  }
}
