/** Display names only; persisted provider, model and language IDs stay unchanged. */
const speechProviders: Record<string, string> = {
  none: '未配置', natively: 'QCLOUD API', 'qcloud-stt': 'QCLOUD API', doubao: 'Doubao AUC', 'doubao-auc': 'Doubao AUC',
  'local-sensevoice': '本地 SenseVoice', 'local-whisper': '本地 Whisper', google: 'Google', groq: 'Groq', openai: 'OpenAI STT',
  deepgram: 'Deepgram', elevenlabs: 'ElevenLabs', azure: 'Azure', ibmwatson: 'IBM Watson', soniox: 'Soniox',
};
const aiProviders: Record<string, string> = {
  natively: 'QCLOUD API', doubao: '豆包（火山引擎）', codex: 'Codex CLI', 'codex-cli': 'Codex CLI',
  claude: 'Anthropic', gemini: 'Google Gemini', openai: 'OpenAI', groq: 'Groq', custom: '自定义提供商',
};
export const getSpeechProviderLabel = (id: string) => speechProviders[id] ?? `其他语音提供商（${id}）`;
export const getAiProviderLabel = (id: string) => aiProviders[id] ?? `其他 AI 提供商（${id}）`;
export const getAiSettingsTab = (provider: string) => provider === 'natively' ? 'natively-api' : 'ai-providers';
export const getSpeechSettingsTab = (provider: string) => ['natively', 'qcloud-stt'].includes(provider) ? 'natively-api' : 'audio';
const languageLabels: Record<string, string> = {
  Auto: '自动', English: '英语', Chinese: '中文', 'Chinese (Simplified)': '中文（简体）', French: '法语', German: '德语',
  Italian: '意大利语', Portuguese: '葡萄牙语', Japanese: '日语', Korean: '韩语', Spanish: '西班牙语',
  Russian: '俄语', Turkish: '土耳其语', Ukrainian: '乌克兰语',
};
export const formatLanguageLabel = (label?: string) => label ? languageLabels[label] ?? label : '';
export function getRecognitionLanguageLabel(language: { label?: string; name?: string; group?: string }, id: string): string {
  const label = formatLanguageLabel(language.label ?? language.name ?? id), group = formatLanguageLabel(language.group);
  return group && group !== label && !label.startsWith(group) ? `${group} · ${label}` : label;
}
export const TRANSCRIPT_SCOPE_LABEL = '允许 AI 使用转写内容';
export const TRANSCRIPT_SCOPE_DESCRIPTION = '保存全局转写内容策略，不影响云端语音识别的原始音频上传选择。关闭后无法完成首次 AI 设置，可稍后继续；实际处理仍按数据范围策略及可用服务执行。';
export function getMeetingRetentionLabel(value: string): string {
  return ({ forever: '永久保存', never: '不保存会议', '7d': '7 天（自动清理未启用）', '30d': '30 天（自动清理未启用）' } as Record<string, string>)[value] ?? '未知保留策略';
}
export function getAudioDeviceOptions(devices: { id: string; name: string }[], selected = 'default') {
  return [{ id: 'default', name: '系统默认' },
    ...(selected !== 'default' && !devices.some(device => device.id === selected) ? [{ id: selected, name: '已保存设备（不可用）' }] : []),
    ...devices.filter(device => device.id !== 'default')];
}
