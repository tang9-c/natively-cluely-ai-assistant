import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// 1. Help header + speech provider paths (stable triples).
// ---------------------------------------------------------------------------

test('HelpSettings header covers permissions, speech, AI, screen, preparation, notes, modes, hotkeys', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /帮助与设置指南/);
  assert.match(source, /权限、语音转写、AI 提供商、屏幕理解、会前准备、会议记录、模式和快捷键/);
});

// ---------------------------------------------------------------------------
// 2. Quick-start: 4 steps with a ready continuation (5th visual node is NOT a step).
// ---------------------------------------------------------------------------

test('HelpSettings quick-start keeps 4 setup steps with a separate ready continuation', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  // The 4 named setup entries (stable titles).
  assert.match(source, /title: '授予权限'/);
  assert.match(source, /title: '设置音频'/);
  assert.match(source, /title: '连接 AI 模型'/);
  assert.match(source, /title: '个性化（可选）'/);

  // Subtitle correctly labels the 4 steps, not 5.
  assert.match(source, /四个步骤即可上手 CueUp/);

  // The 5th visual node is a separate "ready" continuation, not another step.
  assert.match(source, /readyTitle = '一切就绪'/);
  assert.match(source, /完成上面四个步骤即可开会/);
  assert.match(source, /Done state — visually a continuation of the timeline, not a 5th step/);

  // The step array must still have exactly 4 entries (not 5).
  const stepsMatch = source.match(/const steps = \[([\s\S]*?)\];/);
  assert.ok(stepsMatch, '应保留 steps 数组');
  const stepTitles = stepsMatch[1].match(/title: '([^']+)'/g) || [];
  assert.strictEqual(stepTitles.length, 4, '应只声明 4 个 setup 步骤，第 5 个视觉节点是 ready 续接');
});

// ---------------------------------------------------------------------------
// 3. Privacy framing: local-first, NOT "完全在本地运行".
// ---------------------------------------------------------------------------

test('HelpSettings privacy framing is local-first, not fully-on-device', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /CueUp 优先在本地运行/);
  assert.match(source, /本地 SenseVoice 转录、本地模型与本地存储默认启用/);
  assert.match(source, /数据范围允许时由 CueUp 按需走云端路径/);

  // The over-broad "完全在本地运行" framing must not return.
  assert.doesNotMatch(source, /CueUp 完全在本地运行/);
});

// ---------------------------------------------------------------------------
// 4. Speech: three STT paths and SenseVoice / Whisper / Speaker-verification details.
// ---------------------------------------------------------------------------

test('HelpSettings documents Local SenseVoice, QCLOUD API and Doubao AUC equally', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /以三条主路径为核心：本地 SenseVoice、QCLOUD API 和 Doubao AUC/);
  // 设置音频 step pushes the user toward Local SenseVoice first.
  assert.match(source, /title: '设置音频'[\s\S]*?desc: '打开设置 → 音频，优先选择 Local SenseVoice/);
  assert.match(source, /Local SenseVoice/);
  assert.match(source, /QCLOUD API/);
  assert.match(source, /Doubao AUC/);

  // Configuring QCLOUD does not override a healthy local embedding provider.
  assert.match(source, /Embedding 保持本地优先；本地向量模型不可用时/);
});

test('HelpSettings documents SenseVoice term correction and Whisper per-channel model', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  // SenseVoice term correction block.
  assert.match(source, /Local SenseVoice · 术语\/热词纠错/);
  assert.match(source, /规范词 \+ 变体/);

  // Whisper per-channel model selection.
  assert.match(source, /Local Whisper · 麦克风与系统音频/);
  assert.match(source, /分别为麦克风通道和系统音频通道选择模型/);
  assert.match(source, /将自动调整/);
});

test('HelpSettings distinguishes speaker separation from speaker verification', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /说话人验证 vs\. 通用说话人分离/);
  assert.match(source, /Speaker separation/);
  assert.match(source, /我的声音/);
  assert.match(source, /说话人验证/);
  assert.match(source, /ME 标签/);
});

// ---------------------------------------------------------------------------
// 5. AI providers + default chat model.
// ---------------------------------------------------------------------------

test('HelpSettings lists only currently supported chat providers', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /默认聊天模型是 Doubao Seed 2\.0 Lite/);
  assert.match(source, /切换到 QCLOUD API 或自定义端点/);
  assert.doesNotMatch(source, /OpenAI|Claude|Anthropic|Gemini|Groq|Ollama/);

  // Vision / data-scope awareness in the model engine card.
  assert.match(source, /屏幕截图只会发送给具备视觉能力且数据范围允许的提供商/);
});

// ---------------------------------------------------------------------------
// 6. UI / shortcut placeholder + 8 expert modes + intent keywords.
// ---------------------------------------------------------------------------

test('HelpSettings quick-actions show a "未设置" placeholder when a shortcut is unbound', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /const hasShortcut = Array\.isArray\(rawKbd\) && rawKbd\.length > 0/);
  assert.match(source, /未设置/);
});

test('HelpSettings quick-action descriptions match actual manual voice and recap behavior', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /录制你的语音问题/);
  assert.match(source, /已附带截图时会一起发送/);
  assert.match(source, /最近一段对话/);
  assert.doesNotMatch(source, /录制麦克风和屏幕内容/);
  assert.doesNotMatch(source, /过去 5 分钟/);
});

test('HelpSettings advertises 8 expert modes and is section-number neutral', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  // Stable count + stable list (number itself, not ordinal).
  assert.match(source, /CueUp 提供 8 种专家模式/);
  assert.match(source, /General、Sales、FDE、Recruiting、Team Meet、Looking for work、Technical Interview 和 Lecture/);

  // The skills AccordionSection exists regardless of its current ordinal prefix.
  const skillSectionMatch = source.match(/<AccordionSection title="[\d.]*\s*技能"/);
  assert.ok(skillSectionMatch, '技能章节应存在（按稳定标题而非序号断言）');

  // The skills body talks about SKILL.md, not specific position number.
  assert.match(source, /SKILL\.md/);
  assert.match(source, /客户谈判复盘/);
  assert.match(source, /周例会\/月度经营会/);
  assert.match(source, /招聘面试评估/);
  assert.match(source, /文本去 AI 味/);
});

test('HelpSettings describes intent keywords as user-editable classifier inputs', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /意图词（按模式编辑）/);
  assert.match(source, /作为该模式下关键词意图识别的输入信号之一/);
  assert.match(source, /意图到动作映射以及其它分类规则仍由应用代码统一维护/);
  assert.match(source, /不会自动改写上面这些代码侧规则/);

  // Stable intent seed examples.
  assert.match(source, /澄清/);
  assert.match(source, /跟进/);
  assert.match(source, /行动项/);
  assert.match(source, /决策/);
  assert.match(source, /风险阻塞/);
});

// ---------------------------------------------------------------------------
// 7. Profile / research entry points + 会后增强 + dynamic actions + data scopes.
// ---------------------------------------------------------------------------

test('HelpSettings exposes Profile Intelligence and Company Research entry points', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /档案智能系统/);
  assert.match(source, /Profile Intelligence/);
  assert.match(source, /档案智能/);
  assert.match(source, /公司调研/);
  assert.match(source, /立即调研/);
  assert.match(source, /强制刷新/);
});

test('HelpSettings splits meeting details post-call enhancements from internal structured data', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /会后增强字段/);
  assert.match(source, /schemaVersion: 2/);

  // Visible-in-MeetingDetails (stable field-name labels).
  assert.match(source, /会议详情页可见/);
  assert.match(source, /结构化行动项/);
  assert.match(source, /会议决策/);
  assert.match(source, /会议中的开放问题/);
  assert.match(source, /会议辅导洞察/);
  assert.match(source, /跟进邮件\/消息草稿/);

  // Internal-only fields.
  assert.match(source, /后端保存的内部结构化数据/);
  assert.match(source, /FDE（现场发现\/集成\/安全\/风险\/成功标准\/下一步）/);
  assert.match(source, /Recruiting（候选人证据\/追问\/顾虑\/岗位兴趣匹配）/);

  // Removed promise phrases.
  assert.doesNotMatch(source, /把这些字段当作直接结论/);
});

test('HelpSettings describes dynamic action cards and high-confidence auto-run behavior', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /动态动作卡片/);
  assert.match(source, /直接说出口的回答片段/);
  assert.match(source, /决策记录/);
  assert.match(source, /高置信度自动动作/);
  assert.match(source, /达到当前置信度阈值/);
  assert.match(source, /Tab/);

  // Removed "后端策略"/"滚动淘汰" framing should not return.
  assert.doesNotMatch(source, /滚动淘汰/);
  assert.doesNotMatch(source, /由后端策略决定，不在帮助页提供修改入口/);
});

test('HelpSettings lists six cloud data scopes with their Chinese names', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /当前共 6 项/);
  assert.match(source, /转写内容/);
  assert.match(source, /截图/);
  assert.match(source, /参考文件/);
  assert.match(source, /画像历史/);
  assert.match(source, /云端向量/);
  assert.match(source, /会后总结/);
});

// ---------------------------------------------------------------------------
// 8. Section 11: materials + business-system knowledge sources.
// ---------------------------------------------------------------------------

test('HelpSettings section 11 covers materials library and business-system knowledge sources', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  // Stable, section-number-agnostic title.
  const materialsSection = source.match(/<AccordionSection title="[^"]*资料库与业务系统知识源[^"]*"/);
  assert.ok(materialsSection, '第 11 节应存在并以"资料库与业务系统知识源"为稳定标题');

  // Materials library (local files).
  assert.match(source, /资料库（本地文件）/);
  assert.match(source, /PDF、DOCX、Markdown、TXT、PPTX/);
  assert.match(source, /旧版[\s\S]*\.ppt[\s\S]*不支持/);
  assert.match(source, /加入索引队列/);
  assert.match(source, /已索引/);
  assert.match(source, /关键词匹配/);
  assert.match(source, /重新索引/);

  // Business-system knowledge sources.
  assert.match(source, /业务系统知识源/);
  assert.match(source, /Windchill 知识源（PLM）/);
  assert.match(source, /QMS 知识源/);
  assert.match(source, /API Key[\s\S]*账号密码/);
  assert.match(source, /只读查询/);

  // Boundary / fallback wording.
  assert.match(source, /引用边界/);
});

// ---------------------------------------------------------------------------
// 9. From-transcript skill Markdown export.
// ---------------------------------------------------------------------------

test('HelpSettings documents Markdown export flow from transcript via skills', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /从转录生成 Markdown/);
  assert.match(source, /会议详情.*转录.*用技能处理/s);
  assert.match(source, /生成 Markdown 文件后.*打开文件.*打开文件夹/s);
});

test('HelpSettings documents the AI meeting preparation flow and current boundaries', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  const preparationSection = source.match(/<AccordionSection title="[^"]*AI 会前准备[^"]*"/);
  assert.ok(preparationSection, '应存在独立的 AI 会前准备帮助章节');
  assert.match(source, /开始准备.*新的空白会议准备/s);
  assert.match(source, /最近准备/);
  assert.match(source, /描述会议.*确认信息与模式.*查看准备结果/s);
  assert.match(source, /Sales 或 FDE/);
  assert.match(source, /客户可能问我们的问题/);
  assert.match(source, /资料充分.*部分准备.*资料缺失.*无需内部资料.*检查失败/s);
  assert.match(source, /补充资料.*重新检查/s);
  assert.match(source, /公司调研只是跳转入口/);
  assert.match(source, /准备结果不会注入会议回答/);
  assert.match(source, /只应用已确认的推荐模式/);
});

// ---------------------------------------------------------------------------
// 10. QCLOUD side panel documents optional STT and local-first embeddings.
// ---------------------------------------------------------------------------

test('QCLOUD settings guide explains local-first embeddings and cloud fallback order', () => {
  const source = read('src/components/settings/NativelyApiSettings.tsx');
  const help = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /可在“语音”标签选择 QCLOUD API/);
  assert.match(source, /Embedding 保持本地优先；本地向量模型不可用时，可使用同一把 QCLOUD key 调用 embedding-vision。/);
  assert.match(source, /云端回退顺序：QCLOUD、豆包 Embedding、OpenAI、Gemini。/);
  assert.match(help, /Embedding 保持本地优先；本地向量模型不可用时，可使用 QCLOUD 或豆包 Embedding 云端回退。/);
  assert.doesNotMatch(help, /OpenAI|Claude|Anthropic|Gemini|Groq|Ollama/);
  assert.doesNotMatch(source, /Embedding 不使用 QCLOUD/);
  assert.doesNotMatch(source, /实时转录和向量模型不使用 QCLOUD/);
});

// ---------------------------------------------------------------------------
// 11. SenseVoice term canonicalization: PTC (canonical), not PDC.
// ---------------------------------------------------------------------------

test('SenseVoice term canonical form is PTC, with PDC as a legacy variant', () => {
  const source = read('electron/audio/sensevoice/defaultTermCorrections.ts');

  assert.match(source, /canonical: 'PTC'/);
  assert.match(source, /canonical: 'PTC Creo'/);
  assert.match(source, /canonical: 'PTC Windchill'/);

  // Confirm PDC only appears as a legacy variant, not as a canonical form.
  assert.ok(!/canonical: 'PDC/.test(source), 'PDC 不应再作为 canonical 词');
});

test('HelpSettings accurately describes business system credential storage', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /业务系统知识源/);
  assert.match(source, /凭据保存在本机凭据文件中/);
  assert.match(source, /不会回显已保存的 Key 或密码原文/);

  // safeStorage is the project-wide default for credential at-rest encryption
  // in user-visible docs, but the current implementation does not actually use
  // safeStorage for this on-disk file. Don't surface that internal mismatch in
  // user-facing help. The bare /safeStorage/ guard covers every mention,
  // including the "凭据通过 Electron safeStorage 加密保存" wording.
  assert.doesNotMatch(source, /safeStorage/);
});

test('HelpSettings describes intent keywords as usage examples, not a fixed set', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /意图词（按模式编辑）/);
  assert.match(source, /常见用途示例/);
  assert.match(source, /并不是固定的五个意图类型/);
  assert.match(source, /capture_action/);
  assert.match(source, /capture_decision/);
  assert.match(source, /capture_risk/);
});

test('HelpSettings describes retrieval gating in user-facing terms', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /当前检索门槛/);
  assert.match(source, /相似度门槛/);
  assert.match(source, /退回通用上下文/);
});
