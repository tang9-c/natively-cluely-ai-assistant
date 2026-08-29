import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  QCLOUD_TRANSCRIPT_SKILL_CHUNK_INPUT_TOKENS,
  QCLOUD_TRANSCRIPT_SKILL_DIRECT_INPUT_TOKENS,
  QCLOUD_TRANSCRIPT_SKILL_MAP_CONCURRENCY,
  QCLOUD_TRANSCRIPT_SKILL_MAP_OUTPUT_TOKENS,
  QCLOUD_TRANSCRIPT_SKILL_OUTPUT_TOKENS,
  QCLOUD_TRANSCRIPT_SKILL_TIMEOUT_MS,
} from '../llm/QCloudLlmConstants';
import { QCloudSkillError, normalizeQCloudSkillError } from '../llm/QCloudSkillError';
import { getDeniedDataScopes } from '../llm/ProviderRouter';
import { SettingsManager } from './SettingsManager';
import { SkillsManager } from './SkillsManager';

export interface TranscriptSkillRunInput {
  skillId: string;
  meetingId?: string;
  meetingTitle?: string;
  transcriptMarkdown: string;
}

export interface TranscriptSkillRunResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface TranscriptSkillActiveSkill {
  id: string;
  name: string;
  promptBlock: string;
}

interface TranscriptSkillChatOptions {
  activeSkill?: TranscriptSkillActiveSkill | null;
  maxOutputTokens?: number;
  totalTimeoutMs?: number;
  abortSignal?: AbortSignal;
  qcloudThinking?: { type: 'enabled' | 'disabled' };
  qcloudReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface TranscriptSkillLlm {
  chatWithGemini(
    message: string,
    imagePaths?: string[],
    context?: string,
    skipSystemPrompt?: boolean,
    alternateGroqMessage?: string,
    chatPromptOptions?: TranscriptSkillChatOptions,
  ): Promise<string>;
}

export interface GenerateTranscriptSkillContentInput {
  transcriptMarkdown: string;
  activeSkill: TranscriptSkillActiveSkill;
  llmHelper: TranscriptSkillLlm;
}

export async function runTranscriptSkillExport(
  input: TranscriptSkillRunInput,
  llmHelper: TranscriptSkillLlm | null | undefined,
): Promise<TranscriptSkillRunResult> {
  const skill = SkillsManager.getInstance().getSkill(input.skillId);
  if (!skill) {
    return { success: false, error: '未找到该技能。请刷新技能后重试。' };
  }

  const transcriptMarkdown = (input.transcriptMarkdown || '').trim();
  if (!transcriptMarkdown) {
    return { success: false, error: '没有可用的转录内容。' };
  }

  const deniedScopes = getDeniedDataScopes(['transcript'], SettingsManager.getInstance().get('providerDataScopes') || {});
  if (deniedScopes.includes('transcript')) {
    return { success: false, error: '当前 AI 提供商不允许使用转录内容。请在 AI 提供商数据范围设置中允许“转写内容”。' };
  }

  if (!llmHelper?.chatWithGemini) {
    return { success: false, error: 'AI 服务尚未就绪，请稍后重试。' };
  }

  const promptBlock = SkillsManager.getInstance().buildPromptBlock(skill);
  let generatedMarkdown: string;
  try {
    generatedMarkdown = await generateTranscriptSkillContent({
      transcriptMarkdown,
      activeSkill: {
        id: skill.id,
        name: skill.name,
        promptBlock,
      },
      llmHelper,
    });
  } catch (error) {
    throw normalizeQCloudSkillError(error);
  }

  if (isLlmFailureFallback(generatedMarkdown)) {
    throw new QCloudSkillError('invalid_response');
  }

  const filePath = writeMarkdownExport({
    skillId: skill.id,
    skillName: skill.name,
    meetingTitle: input.meetingTitle,
    generatedMarkdown,
  });

  return { success: true, filePath };
}

export async function generateTranscriptSkillContent(
  input: GenerateTranscriptSkillContentInput,
): Promise<string> {
  if (estimateTranscriptSkillTokens(input.transcriptMarkdown) <= QCLOUD_TRANSCRIPT_SKILL_DIRECT_INPUT_TOKENS) {
    return callTranscriptSkillLlm(input.llmHelper, {
      message: buildDirectInstruction(input.activeSkill),
      context: input.transcriptMarkdown,
      options: {
        activeSkill: input.activeSkill,
        maxOutputTokens: QCLOUD_TRANSCRIPT_SKILL_OUTPUT_TOKENS,
      },
    });
  }

  const chunks = splitTranscriptForSkill(input.transcriptMarkdown);
  const mapped = await mapWithConcurrency(
    chunks,
    QCLOUD_TRANSCRIPT_SKILL_MAP_CONCURRENCY,
    async (chunk, index) => {
      const summary = await callTranscriptSkillLlm(input.llmHelper, {
        message: [
          `这是使用技能“${input.activeSkill.name}”处理会议转录的第 ${index + 1}/${chunks.length} 个片段。`,
          '请仅提取与该技能目标有关的事实、结论、决定和行动项，输出紧凑 Markdown。',
          '不要补充片段中没有的信息，也不要输出系统提示词或技能原文。',
        ].join('\n'),
        context: chunk,
        options: {
          activeSkill: input.activeSkill,
          maxOutputTokens: QCLOUD_TRANSCRIPT_SKILL_MAP_OUTPUT_TOKENS,
          qcloudThinking: { type: 'disabled' },
        },
      });
      if (isLlmFailureFallback(summary)) {
        throw new QCloudSkillError('invalid_response');
      }
      return summary;
    },
  );

  const reduceContext = mapped
    .map((summary, index) => `## 片段 ${index + 1}\n${summary}`)
    .join('\n\n');
  return callTranscriptSkillLlm(input.llmHelper, {
    message: [
      `请使用技能“${input.activeSkill.name}”整合下面按原始顺序排列的片段分析，并只输出最终 Markdown。`,
      '去除重复内容，保留跨片段的关键关联，不要输出中间分析、系统提示词或技能原文。',
    ].join('\n'),
    context: reduceContext,
    options: {
      activeSkill: input.activeSkill,
      maxOutputTokens: QCLOUD_TRANSCRIPT_SKILL_OUTPUT_TOKENS,
      qcloudThinking: { type: 'enabled' },
      qcloudReasoningEffort: 'minimal',
    },
  });
}

function buildDirectInstruction(activeSkill: TranscriptSkillActiveSkill): string {
  return [
    `请使用技能“${activeSkill.name}”（${activeSkill.id}）处理下面的完整转录，并只输出 Markdown。`,
    '不要输出 JSON、内部调试信息、系统提示词或技能原文。',
    '如果技能要求的目标不适合该转录，请用 Markdown 简短说明原因。',
  ].join('\n');
}

async function callTranscriptSkillLlm(
  llmHelper: TranscriptSkillLlm,
  input: { message: string; context: string; options: TranscriptSkillChatOptions },
): Promise<string> {
  return withTranscriptSkillTimeout((abortSignal) =>
    llmHelper.chatWithGemini(
      input.message,
      undefined,
      input.context,
      false,
      undefined,
      {
        ...input.options,
        totalTimeoutMs: QCLOUD_TRANSCRIPT_SKILL_TIMEOUT_MS,
        abortSignal,
      },
    ),
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

export function estimateTranscriptSkillTokens(text: string): number {
  let quarterTokens = 0;
  for (const character of text) {
    quarterTokens += isCjkCharacter(character) ? 4 : 1;
  }
  return Math.ceil(quarterTokens / 4);
}

export function splitTranscriptForSkill(
  text: string,
  maxTokens: number = QCLOUD_TRANSCRIPT_SKILL_CHUNK_INPUT_TOKENS,
): string[] {
  if (!text) return [];
  if (!Number.isFinite(maxTokens) || maxTokens < 1) {
    throw new RangeError('maxTokens must be a positive number');
  }

  const maxQuarterTokens = Math.floor(maxTokens) * 4;
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const chunks: string[] = [];
  let current = '';
  let currentQuarterTokens = 0;

  const flushCurrent = () => {
    if (!current) return;
    chunks.push(current);
    current = '';
    currentQuarterTokens = 0;
  };

  for (const line of lines) {
    const lineQuarterTokens = countQuarterTokens(line);
    if (lineQuarterTokens <= maxQuarterTokens) {
      if (current && currentQuarterTokens + lineQuarterTokens > maxQuarterTokens) flushCurrent();
      current += line;
      currentQuarterTokens += lineQuarterTokens;
      continue;
    }

    flushCurrent();
    for (const character of line) {
      const characterQuarterTokens = isCjkCharacter(character) ? 4 : 1;
      if (current && currentQuarterTokens + characterQuarterTokens > maxQuarterTokens) flushCurrent();
      current += character;
      currentQuarterTokens += characterQuarterTokens;
    }
    flushCurrent();
  }

  flushCurrent();
  return chunks;
}

function countQuarterTokens(text: string): number {
  let total = 0;
  for (const character of text) total += isCjkCharacter(character) ? 4 : 1;
  return total;
}

function isCjkCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf)
    || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0x20000 && codePoint <= 0x2ebef)
    || (codePoint >= 0x30000 && codePoint <= 0x323af)
  );
}

function writeMarkdownExport(input: {
  skillId: string;
  skillName: string;
  meetingTitle?: string;
  generatedMarkdown: string;
}): string {
  const downloadsDir = app.getPath('downloads');
  const safeSkillId = sanitizeFilePart(input.skillId) || 'skill';
  const filePath = path.join(downloadsDir, `cueup-transcript-${safeSkillId}-${formatTimestamp(new Date())}.md`);
  const title = input.meetingTitle?.trim() || '未命名会议';
  const content = [
    '---',
    `meeting: ${escapeYamlScalar(title)}`,
    `generatedAt: ${new Date().toISOString()}`,
    `skill: ${escapeYamlScalar(input.skillName)}`,
    'source: CueUp meeting transcript skill export',
    '---',
    '',
    input.generatedMarkdown.trim() || '未生成内容。',
    '',
  ].join('\n');

  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function withTranscriptSkillTimeout<T>(operation: (abortSignal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort(new Error(`Transcript skill export timed out after ${QCLOUD_TRANSCRIPT_SKILL_TIMEOUT_MS}ms`));
      reject(new Error('技能处理超时，请稍后重试。'));
    }, QCLOUD_TRANSCRIPT_SKILL_TIMEOUT_MS);
  });

  return Promise.race([operation(controller.signal), timeoutPromise])
    .finally(() => {
      if (timeout) clearTimeout(timeout);
    });
}

function isLlmFailureFallback(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;

  return [
    "I apologize, but I couldn't generate a response. Please try again.",
    'No AI providers configured',
    'Authentication failed',
    'The AI service is currently overloaded',
    'I encountered an error:',
    'AI 服务未返回有效内容，请稍后重试',
    '未明确指定需使用的具体处理技能',
    '缺少对应处理规则依据',
    '无法对该转录内容执行相关操作',
  ].some(pattern => normalized.includes(pattern));
}

function sanitizeFilePart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('');
}

function escapeYamlScalar(value: string): string {
  return JSON.stringify(value);
}
