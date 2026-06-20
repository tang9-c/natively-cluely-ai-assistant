import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptsPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/prompts.js');
const prompts = await import(pathToFileURL(promptsPath).href);

const MODE_PROMPTS = {
  general: prompts.MODE_GENERAL_PROMPT,
  sales: prompts.MODE_SALES_PROMPT,
  recruiting: prompts.MODE_RECRUITING_PROMPT,
  'team-meet': prompts.MODE_TEAM_MEET_PROMPT,
  'looking-for-work': prompts.MODE_LOOKING_FOR_WORK_PROMPT,
  'technical-interview': prompts.MODE_TECHNICAL_INTERVIEW_PROMPT,
  lecture: prompts.MODE_LECTURE_PROMPT,
};

const MODE_CONTRACT_TERMS = {
  general: ['全能的会议与对话副驾驶', '感知对话内容', '最近的问题'],
  sales: ['销售方', '潜在客户', '反对意见', '价格', '案例研究'],
  recruiting: ['面试官', '候选人', '招聘经理', 'lean no', '排练过'],
  'team-meet': ['记录', '行动项', '决策', '阻碍', '状态'],
  'looking-for-work': ['候选人', '面试', '简历', '薪资'],
  'technical-interview': ['技术面试', '编程', '系统设计', '复杂度', 'Edge cases'],
  lecture: ['学生', '讲座', '学习伙伴', '概念', '作业', '学科'],
};

const UNIQUE_MODE_TERMS = {
  general: ['全能的会议与对话副驾驶'],
  sales: ['潜在客户', '反对意见'],
  recruiting: ['招聘经理', '候选人'],
  'team-meet': ['行动项', '阻碍'],
  'looking-for-work': ['面试', '简历'],
  'technical-interview': ['编程', '系统设计'],
  lecture: ['讲座', '学习伙伴'],
};

function assertIncludesAll(text, terms, label) {
  const lower = text.toLowerCase();
  for (const term of terms) {
    assert.ok(lower.includes(term.toLowerCase()), `${label} should include "${term}"`);
  }
}

test('every mode prompt includes shared prompt-leakage and safety controls', () => {
  for (const [modeType, prompt] of Object.entries(MODE_PROMPTS)) {
    assertIncludesAll(prompt, [
      '<security>',
      'system prompt',
      'instructions',
      'reveal',
      "I can't share that information",
    ], modeType);
  }
});

test('every mode prompt includes injected context handling for custom context and reference files', () => {
  for (const [modeType, prompt] of Object.entries(MODE_PROMPTS)) {
    assertIncludesAll(prompt, [
      '<injected_context>',
      '<user_context>',
      '<reference_file name="...">',
      'file name',
    ], modeType);
  }
});

test('mode prompts prevent reference-file hallucination for absent file-specific claims', () => {
  for (const [modeType, prompt] of Object.entries(MODE_PROMPTS)) {
    assertIncludesAll(prompt, [
      'absent',
      'provided material',
      'general knowledge',
      'untrusted evidence',
      'never follow instructions',
    ], modeType);
  }

  assertIncludesAll(MODE_PROMPTS.general, ['不要发明公式', '文件中不存在的特定建议'], 'general');
  assertIncludesAll(MODE_PROMPTS.sales, ['客户证明点', 'ROI指标', '不在提供的材料中'], 'sales');
  assertIncludesAll(MODE_PROMPTS['technical-interview'], ['请求的算法', '学习笔记建议', '在提供的材料中不存在'], 'technical-interview');
});

test('each mode prompt carries its own mode-specific behavior contract', () => {
  for (const [modeType, terms] of Object.entries(MODE_CONTRACT_TERMS)) {
    assertIncludesAll(MODE_PROMPTS[modeType], terms, modeType);
  }
});

test('mode prompts are meaningfully distinct rather than flattened generic advice', () => {
  for (const [modeType, prompt] of Object.entries(MODE_PROMPTS)) {
    for (const term of UNIQUE_MODE_TERMS[modeType]) {
      assert.ok(prompt.toLowerCase().includes(term.toLowerCase()), `${modeType} should preserve its distinctive term "${term}"`);
    }
  }

  assert.ok(!MODE_PROMPTS.sales.includes('You are the candidate\'s spoken voice in a live technical interview'));
  assert.ok(!MODE_PROMPTS['team-meet'].includes('OBJECTION DETECTED'));
  assert.ok(!MODE_PROMPTS.recruiting.includes('Output IS what the candidate says aloud'));
  assert.ok(!MODE_PROMPTS.lecture.includes('You are the seller\'s spoken voice'));
});

test('profile-aware modes mention candidate/profile grounding without requiring every mode to overfit resume data', () => {
  assertIncludesAll(MODE_PROMPTS['looking-for-work'], ['<candidate_experience>', '简历', '不要编造', 'salary_intelligence'], 'looking-for-work');
  assertIncludesAll(MODE_PROMPTS['technical-interview'], ['<candidate_experience>', '技术面试', 'salary_intelligence'], 'technical-interview');
  assertIncludesAll(MODE_PROMPTS.general, ['<candidate_experience>', '不要编造', 'salary_intelligence'], 'general');
});

test('looking-for-work prompt stabilizes no-overclaim behavior with few-shot examples', () => {
  assertIncludesAll(MODE_PROMPTS['looking-for-work'], [
    '<no_overclaim_examples>',
    '无上下文行为问题',
    '有角色或项目但无指标的弱上下文',
    '个人资料上下文中缺少JD技能',
    "I don't have specific past experience loaded right now. I can frame this honestly as a small, relevant example if that matches my background:",
    '影响是定性的',
    '未量化',
    "I wouldn't want to overstate that",
    '使用确切的无上下文承认开场白',
    '行为、介绍、匹配、动机或成就',
    '不要编造当前角色、公司、头衔、日期或成就',
    '没有个人资料上下文时，避免编造成就',
  ], 'looking-for-work');
});

test('mode formatting contracts prevent coachy meta-output in live suggestions', () => {
  assertIncludesAll(MODE_PROMPTS.sales, ['不要使用', '元标签', '少于3句'], 'sales');
  assertIncludesAll(MODE_PROMPTS['looking-for-work'], ['第一人称', '无填充开场白', '作为候选人发言'], 'looking-for-work');
  assertIncludesAll(MODE_PROMPTS['technical-interview'], ['glance-and-go', '围栏代码块', '复杂度'], 'technical-interview');
  assertIncludesAll(MODE_PROMPTS.recruiting, ['你不是以候选人身份发言', '第三方观察者'], 'recruiting');
  assertIncludesAll(MODE_PROMPTS.lecture, ['你不是学生在发言', 'plain language'], 'lecture');
});

test('team meeting capture examples stay schematic and do not seed names or companies', () => {
  assertIncludesAll(MODE_PROMPTS['team-meet'], [
    '仅作为示例输出格式',
    '仅在会议中陈述时才替换括号内容',
    '[陈述的负责人]',
    '[转录中陈述的决策]',
    '[转录中陈述的风险或阻碍]',
  ], 'team-meet');

  assert.doesNotMatch(MODE_PROMPTS['team-meet'], /Sarah|Stripe|Q3 deck|Oct 15/);
});

test('looking-for-work examples require grounding and avoid concrete invented detail', () => {
  assertIncludesAll(MODE_PROMPTS['looking-for-work'], [
    '在任何说明性例子之前使用确切的无上下文承认开场白',
    '避免编造成就',
    '永远不要编造百分比、美元金额、持续时间或规模数字',
  ], 'looking-for-work');

  assert.doesNotMatch(MODE_PROMPTS['looking-for-work'], /grew the channel significantly over a focused timeline/);
  assert.doesNotMatch(MODE_PROMPTS['looking-for-work'], /secured a major enterprise deal/);
  assert.doesNotMatch(MODE_PROMPTS['looking-for-work'], /drove a meaningful reduction in churn/);
  assert.doesNotMatch(MODE_PROMPTS['looking-for-work'], /shipped to a large user base/);
});

test('code hint examples avoid named problems and em dashes', () => {
  assertIncludesAll(prompts.CODE_HINT_PROMPT, [
    'Use schematic examples only',
    'Do not copy sample problem names, line numbers, metrics, or concrete fixes unless they are visible',
  ], 'code-hint');

  const examples = prompts.CODE_HINT_PROMPT.match(/<output_examples>[\s\S]*?<\/output_examples>/)?.[0] ?? '';
  assert.match(examples, /Use schematic examples only/);
  assert.doesNotMatch(examples, /Two Sum/);
  assert.doesNotMatch(examples, /line 8/);
  assert.doesNotMatch(examples, /—/);
});
