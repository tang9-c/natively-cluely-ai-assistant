import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('meeting transcript tab exposes a one-shot skill export menu without activating skills', () => {
  const source = read('src/components/MeetingDetails.tsx');

  assert.match(source, /用技能处理/);
  assert.match(source, /还没有可用技能/);
  assert.match(source, /skillsRefresh\(\)/);
  assert.match(source, /transcriptSkillRun\(/);
  assert.doesNotMatch(source, /skillsActivate\(/);
  assert.match(source, /activeTab\s*===\s*['"]transcript['"]/);
  assert.match(source, /复制完整转录/);
});

test('transcript skill export success actions use styled icon buttons', () => {
  const source = read('src/components/MeetingDetails.tsx');
  const statusStart = source.indexOf('{skillExportStatus && (');
  const statusEnd = source.indexOf('{/* Tab Content */}', statusStart);
  const statusBlock = source.slice(statusStart, statusEnd);

  assert.ok(statusStart >= 0 && statusEnd > statusStart, 'skill export status block should exist');
  assert.match(statusBlock, /FileText\s+size=\{12\}/);
  assert.match(statusBlock, /FolderOpen\s+size=\{12\}/);
  assert.match(statusBlock, /inline-flex\s+items-center\s+gap-1\.5/);
  assert.match(statusBlock, /rounded-md\s+border\s+border-border-subtle/);
  assert.match(statusBlock, /hover:bg-bg-item-active/);
});

test('transcript skill export IPC and preload bridge are wired', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.ok(findSafeHandle(ipc, 'transcript-skills:run') >= 0, 'transcript-skills:run must be registered');
  assert.ok(findSafeHandle(ipc, 'shell:open-path') >= 0, 'shell:open-path must be registered');
  assert.match(preload, /transcriptSkillRun:\s*\(input\)\s*=>\s*ipcRenderer\.invoke\(['"]transcript-skills:run['"],\s*input\)/);
  assert.match(preload, /openPath:\s*\(targetPath\)\s*=>\s*ipcRenderer\.invoke\(['"]shell:open-path['"],\s*targetPath\)/);
  assert.match(types, /transcriptSkillRun:\s*\(input:\s*TranscriptSkillRunInput\)\s*=>\s*Promise<TranscriptSkillRunResult>/);
  assert.match(types, /openPath:\s*\(targetPath:\s*string\)\s*=>\s*Promise<\{\s*success:\s*boolean;\s*error\?:\s*string\s*\}>/);
});

test('transcript skill export service enforces bounded direct and map-reduce boundaries', () => {
  const source = read('electron/services/TranscriptSkillExportService.ts');

  assert.match(source, /SkillsManager\.getInstance\(\)\.getSkill\(input\.skillId\)/);
  assert.match(source, /buildPromptBlock\(skill/);
  assert.match(source, /getDeniedDataScopes\(\['transcript'\]/);
  assert.match(source, /QCLOUD_TRANSCRIPT_SKILL_DIRECT_INPUT_TOKENS/);
  assert.match(source, /QCLOUD_TRANSCRIPT_SKILL_CHUNK_INPUT_TOKENS/);
  assert.match(source, /QCLOUD_TRANSCRIPT_SKILL_MAP_OUTPUT_TOKENS/);
  assert.match(source, /QCLOUD_TRANSCRIPT_SKILL_OUTPUT_TOKENS/);
  assert.match(source, /QCLOUD_TRANSCRIPT_SKILL_MAP_CONCURRENCY/);
  assert.match(source, /QCLOUD_TRANSCRIPT_SKILL_TIMEOUT_MS/);
  assert.match(source, /estimateTranscriptSkillTokens/);
  assert.match(source, /splitTranscriptForSkill/);
  assert.match(source, /generateTranscriptSkillContent/);
  assert.match(source, /mapWithConcurrency/);
  assert.match(source, /maxOutputTokens:\s*QCLOUD_TRANSCRIPT_SKILL_OUTPUT_TOKENS/);
  assert.match(source, /maxOutputTokens:\s*QCLOUD_TRANSCRIPT_SKILL_MAP_OUTPUT_TOKENS/);
  assert.match(source, /totalTimeoutMs:\s*QCLOUD_TRANSCRIPT_SKILL_TIMEOUT_MS/);
  assert.match(source, /qcloudThinking:\s*\{\s*type:\s*['"]disabled['"]\s*\}/);
  assert.match(source, /qcloudReasoningEffort:\s*['"]minimal['"]/);
  assert.match(source, /当前 AI 提供商不允许使用转录内容/);
  assert.doesNotMatch(source, /转录过长，当前版本暂不支持用技能处理完整内容/);
  assert.match(source, /isLlmFailureFallback\(generatedMarkdown\)/);
  assert.match(source, /AI 服务未返回有效内容，请稍后重试/);
  assert.match(source, /withTranscriptSkillTimeout/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /I apologize, but I couldn't generate a response\. Please try again\./);
  assert.match(source, /No AI providers configured/);
  assert.match(source, /Authentication failed/);
  assert.match(source, /The AI service is currently overloaded/);
  assert.match(source, /I encountered an error:/);
  assert.match(source, /AI 服务未返回有效内容，请稍后重试/);
  assert.match(source, /未明确指定需使用的具体处理技能/);
  assert.match(source, /缺少对应处理规则依据/);
  assert.match(source, /无法对该转录内容执行相关操作/);
  assert.match(source, /app\.getPath\(['"]downloads['"]\)/);
  assert.match(source, /cueup-transcript-\$\{safeSkillId\}-/);
  assert.match(source, /\.md/);
  assert.doesNotMatch(source, /activateSkill\(/);
  assert.doesNotMatch(source, /MAX_TRANSCRIPT_SKILL_INPUT_TOKENS\s*=\s*24_000/);
  assert.doesNotMatch(source, /Promise\.all\(chunks\.map/);
});

test('transcript skill export handler delegates to service and openPath is downloads-scoped', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const runBlock = sliceSafeHandleBlock(ipc, 'transcript-skills:run');
  const openBlock = sliceSafeHandleBlock(ipc, 'shell:open-path');

  assert.match(runBlock, /runTranscriptSkillExport/);
  assert.match(runBlock, /appState\.processingHelper\?\.getLLMHelper\?\.\(\)/);
  assert.match(openBlock, /app\.getPath\(['"]downloads['"]\)/);
  assert.match(openBlock, /path\.relative\(downloadsDir,\s*targetPath\)/);
  assert.match(openBlock, /shell\.openPath\(targetPath\)/);
});

test('transcript skill IPC returns classified user messages and logs only safe fields', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const runBlock = sliceSafeHandleBlock(ipc, 'transcript-skills:run');

  assert.match(runBlock, /e instanceof QCloudSkillError/);
  assert.match(runBlock, /error:\s*e\.userMessage/);
  assert.match(runBlock, /e\.toSafeLogFields\(\)/);
  assert.match(runBlock, /redactForLog/);
  assert.doesNotMatch(runBlock, /error:\s*e\?\.message/);
});
