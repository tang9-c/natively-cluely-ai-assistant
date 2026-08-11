import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('DynamicActionCard renders product contract copy instead of diagnostic internals', () => {
  const source = read('src/components/dynamic-actions/DynamicActionCard.tsx');

  assert.match(source, /productContract\.userAction/);
  assert.match(source, /productContract\.whyNow/);
  assert.match(source, /productContract\.outputPromise/);
  assert.match(source, /productContract\.evidenceSummary/);
  assert.match(source, /ctaLabelForOutputType/);
  assert.doesNotMatch(source, /confidencePct/);
  assert.doesNotMatch(source, /explainDynamicAction\(/);
  assert.doesNotMatch(source, /语义证据不足，已暂缓高风险动作|相似的低置信候选已被拦截/);
  assert.doesNotMatch(source, /semantic gate|provider|Triggered by|triggered by/);
});

test('DynamicActionBar clearly surfaces privacy-safe cloud degradation status', () => {
  const source = read('src/components/dynamic-actions/DynamicActionBar.tsx');
  const preload = read('electron/preload.ts');
  const main = read('electron/main.ts');
  const engine = read('electron/IntelligenceEngine.ts');
  const manager = read('electron/IntelligenceManager.ts');

  assert.match(source, /onIntelligenceDynamicActionAvailability/);
  assert.match(source, /云端服务繁忙，智能卡片暂不可用/);
  assert.match(source, /会议与转录继续正常，服务恢复后将自动重试/);
  assert.match(source, /云端服务繁忙，部分明确提示已切换为受限本地判断/);
  assert.match(source, /当前所选模型暂不可用，智能卡片无法判断/);
  assert.match(source, /请在 AI 提供商中配置并选择可用模型/);
  assert.match(source, /当前所选模型不允许使用转录内容/);
  assert.match(source, /30_000/);
  assert.match(preload, /intelligence-dynamic-action-availability/);
  assert.match(main, /dynamicActionAvailabilityFromArbitrations/);
  assert.match(main, /dynamic_action_gate_availability/);
  assert.match(engine, /emit\('dynamic_action_gate_availability'/);
  assert.match(manager, /'dynamic_action_gate_availability'/);
  assert.doesNotMatch(
    main,
    /\.on\('dynamic_action_gate_trace'[\s\S]{0,300}intelligence-dynamic-action-availability/,
  );
  assert.doesNotMatch(
    main,
    /intelligence-dynamic-action-availability'[\s\S]{0,300}(?:transcript|regexCandidates|providerError)/,
  );
});

test('DynamicActionBar removes actions dismissed by backend speaker correction', () => {
  const source = read('src/components/dynamic-actions/DynamicActionBar.tsx');
  const engine = read('electron/IntelligenceEngine.ts');

  assert.match(source, /action\.status === 'dismissed'/);
  assert.match(source, /setActions\(\(prev\) => prev\.filter\(\(item\) => item\.id !== action\.id\)\)/);
  assert.match(engine, /handleSpeakerVerificationSessionOverride/);
  assert.match(engine, /this\.emit\('dynamic_action_emitted', \{ \.\.\.activeAction, status: 'dismissed' \}\)/);
});

test('speaker-uncertain dynamic actions require bidirectional confirmation before execution', () => {
  const bar = read('src/components/dynamic-actions/DynamicActionBar.tsx');
  const card = read('src/components/dynamic-actions/DynamicActionCard.tsx');

  assert.match(bar, /speakerConfirmation/);
  assert.match(bar, /speakerVerificationSetSessionOverride/);
  assert.match(bar, /if \(action\.speakerConfirmation\) return/);
  assert.match(bar, /!action\.speakerConfirmation/);
  assert.match(bar, /filter\(\(action\) => !action\.speakerConfirmation\)/);
  assert.match(card, /可能是对方说的/);
  assert.match(card, /可能是你说的/);
  assert.match(card, /确认/);
  assert.match(card, /这是我/);
  assert.match(card, /这不是我/);
  assert.match(card, /onConfirmSpeaker/);
});
