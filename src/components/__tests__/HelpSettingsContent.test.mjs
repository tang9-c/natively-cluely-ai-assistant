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
// Setup, privacy, provider guidance and model compatibility are verified through
// the rendered help page in tests/e2e/onboarding-consistency.spec.ts.
// The old four-step/source-literal assertions were replaced, not frozen here.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// 4. Speech: three STT paths and SenseVoice / Whisper / Speaker-verification details.
// ---------------------------------------------------------------------------


test('HelpSettings distinguishes speaker separation from speaker verification', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /说话人验证 vs\. 通用说话人分离/);
  assert.match(source, /Speaker separation/);
  assert.match(source, /我的声音/);
  assert.match(source, /说话人验证/);
  assert.match(source, /ME 标签/);
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

test('FDE user-facing descriptions state the PLM QMS and enterprise AI Agent scope', () => {
  const help = read('src/components/settings/HelpSettings.tsx');
  const modes = read('electron/services/ModesManager.ts');

  assert.match(modes, /type: 'fde',[^\n]+description: '[^']*PLM、QMS 和企业 AI Agent 部署[^']*'/);
  assert.match(help, /name: 'FDE', desc: '[^']*PLM、QMS 和企业 AI Agent 部署[^']*'/);
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
  assert.match(source, /Sales、FDE、招聘或团队会议/);
  assert.match(source, /对方参会者可能问我们的问题/);
  assert.doesNotMatch(source, /Sales 或 FDE/);
  assert.match(source, /资料充分.*部分准备.*资料缺失.*无需内部资料.*检查失败/s);
  assert.match(source, /补充资料.*重新检查/s);
  assert.match(source, /公司调研只是跳转入口/);
  assert.match(source, /准备结果不会注入会议回答/);
  assert.match(source, /只应用已确认的推荐模式/);
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

  // The help uses user-facing plaintext/file-permission wording rather than
  // a storage-library name. Rendered plaintext-storage guidance is also
  // verified in the production help-page scenario.
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
