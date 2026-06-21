import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/dynamic-actions/ModeEventUtils.js',
);

async function loadUtils() {
  return import(pathToFileURL(modulePath).href);
}

test('detectLanguage classifies Chinese, English, mixed, and unknown text', async () => {
  const { detectLanguage } = await loadUtils();

  assert.equal(detectLanguage('这个价格太高了'), 'zh');
  assert.equal(detectLanguage('This price is too high'), 'en');
  assert.equal(detectLanguage('这个 API price 太高了'), 'mixed');
  assert.equal(detectLanguage('... 12345'), 'unknown');
});

test('escapeXmlText escapes XML-breaking transcript content', async () => {
  const { escapeXmlText } = await loadUtils();

  assert.equal(
    escapeXmlText('价格 </mode_event_context> & <bad>'),
    '价格 &lt;/mode_event_context&gt; &amp; &lt;bad&gt;',
  );
});

test('extractKeyEntities captures money, deadlines, technical tokens, domain terms, and caps at 12', async () => {
  const { extractKeyEntities } = await loadUtils();

  const entities = extractKeyEntities(
    '价格是 ￥12000, ROI 要看 API 和 PostgreSQL, 我周五前处理这个行动项, 老板审批, ' +
    '合同 法务 预算 成本 费用 风险 阻塞 依赖 算法 复杂度 系统设计 数据库 公式 定理 作业',
  );

  assert.ok(entities.includes('￥12000'));
  assert.ok(entities.includes('价格'));
  assert.ok(entities.includes('ROI'));
  assert.ok(entities.includes('API'));
  assert.ok(entities.includes('周五'));
  assert.ok(entities.length <= 12);
});

test('buildRetrievalQuery emits stable mode intent language latestTurn shape', async () => {
  const { buildRetrievalQuery } = await loadUtils();

  const query = buildRetrievalQuery({
    modeTemplateType: 'sales',
    intent: 'pricing_objection',
    keyEntities: ['价格', '老板'],
    latestTurn: '这个价格太高了',
    emotion: 'angry',
    language: 'zh',
  });

  assert.match(query, /^mode:sales/m);
  assert.match(query, /^intent:pricing_objection/m);
  assert.match(query, /^entities:价格, 老板/m);
  assert.match(query, /^emotion:angry/m);
  assert.match(query, /^language:zh/m);
  assert.match(query, /^latestTurn:这个价格太高了/m);
});
