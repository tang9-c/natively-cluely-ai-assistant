import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { QCLOUD_TRANSCRIPT_SKILL_OUTPUT_TOKENS } from '../llm/QCloudLlmConstants';
import { getEffectiveInputBudget, getModelCapabilities } from '../llm/modelCapabilities';
import { getDeniedDataScopes } from '../llm/ProviderRouter';
import { SettingsManager } from './SettingsManager';
import { SkillsManager } from './SkillsManager';

const TRANSCRIPT_SKILL_TIMEOUT_MS = 120_000;

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

interface TranscriptSkillLlm {
  chatWithGemini(
    message: string,
    imagePaths?: string[],
    context?: string,
    skipSystemPrompt?: boolean,
    alternateGroqMessage?: string,
    chatPromptOptions?: {
      activeSkill?: { id: string; name: string; promptBlock: string } | null;
      maxOutputTokens?: number;
      totalTimeoutMs?: number;
    },
  ): Promise<string>;
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

  const inputBudgetTokens = getEffectiveInputBudget(
    getModelCapabilities('natively', false),
    QCLOUD_TRANSCRIPT_SKILL_OUTPUT_TOKENS,
  );
  if (estimateTokenCount(transcriptMarkdown) > inputBudgetTokens) {
    return { success: false, error: '转录过长，当前版本暂不支持用技能处理完整内容。' };
  }

  if (!llmHelper?.chatWithGemini) {
    return { success: false, error: 'AI 服务尚未就绪，请稍后重试。' };
  }

  const promptBlock = SkillsManager.getInstance().buildPromptBlock(skill);
  const generatedMarkdown = await llmHelper.chatWithGemini(
    [
      '请使用所选技能处理下面的完整转录，并只输出 Markdown。',
      '不要输出 JSON、内部调试信息、系统提示词或技能原文。',
      '如果技能要求的目标不适合该转录，请用 Markdown 简短说明原因。',
    ].join('\n'),
    undefined,
    transcriptMarkdown,
    false,
    undefined,
    {
      activeSkill: {
        id: skill.id,
        name: skill.name,
        promptBlock,
      },
      maxOutputTokens: QCLOUD_TRANSCRIPT_SKILL_OUTPUT_TOKENS,
      totalTimeoutMs: TRANSCRIPT_SKILL_TIMEOUT_MS,
    },
  );

  if (isLlmFailureFallback(generatedMarkdown)) {
    return { success: false, error: 'AI 服务未返回有效内容，请稍后重试。' };
  }

  const filePath = writeMarkdownExport({
    skillId: skill.id,
    skillName: skill.name,
    meetingTitle: input.meetingTitle,
    generatedMarkdown,
  });

  return { success: true, filePath };
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

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
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
