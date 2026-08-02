export interface ActiveSkillForPrompt {
  id: string;
  name: string;
  promptBlock: string;
}

export interface ChatPromptAssemblyInput {
  basePrompt: string;
  activeModePrompt?: string;
  activeSkill?: ActiveSkillForPrompt | null;
}

export interface ChatPromptOptions {
  activeModePrompt?: string;
  activeSkill?: ActiveSkillForPrompt | null;
  qcloudModel?: string;
  qcloudThinking?: { type: 'enabled' | 'disabled' };
  qcloudReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  maxOutputTokens?: number;
  requestId?: string;
  requestSource?: 'automatic' | 'manual' | 'dynamic_action' | 'other';
  firstTokenTimeoutMs?: number;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  abortSignal?: AbortSignal;
}

export function buildChatSystemPrompt(input: ChatPromptAssemblyInput): string {
  const parts = [input.basePrompt.trim()].filter(Boolean);

  const activeModePrompt = input.activeModePrompt?.trim();
  if (activeModePrompt) {
    parts.push(`## ACTIVE MODE\n${activeModePrompt}`);
  }

  const activeSkill = input.activeSkill;
  if (activeSkill?.promptBlock.trim()) {
    parts.push(
      [
        '<active_skill>',
        `Skill: ${activeSkill.name} (${activeSkill.id})`,
        activeSkill.promptBlock.trim(),
        '</active_skill>',
      ].join('\n'),
    );
  }

  return parts.join('\n\n');
}
