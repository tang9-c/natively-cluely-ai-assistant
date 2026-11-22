import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron');
const { DynamicActionDetector } = await import(pathToFileURL(path.join(distRoot, 'services/dynamic-actions/DynamicActionDetector.js')).href);
const { detectIntentByPattern } = await import(pathToFileURL(path.join(distRoot, 'llm/IntentClassifier.js')).href);
const { defaultKeywordMapForTemplate, matchIntentKeywords } = await import(pathToFileURL(path.join(distRoot, 'llm/IntentKeywordDefaults.js')).href);

// One real customer question per product line we sell and support.
const PRODUCT_QUESTIONS = [
  ['Creo', '客户说 Creo 打开大装配特别慢，有什么办法？'],
  ['CATIA', 'CATIA 复杂曲面建模效率怎么提升？'],
  ['SolidWorks', 'SolidWorks 钣金展开经常报错。'],
  ['Abaqus', 'Abaqus 接触分析一直不收敛，怎么处理？'],
  ['CST', 'CST 天线仿真的 S 参数和实测对不上。'],
  ['Windchill', 'Windchill 的图文档怎么和设计变更关联？'],
  ['Feigenbaum QMS', '来料检验和客诉处理现在有什么痛点？'],
  ['Abaqus (en)', 'How does Abaqus handle convergence for nonlinear contact?'],
];

// Product names mentioned in passing, with no question or pain.
const PRODUCT_MENTIONS = [
  'Creo 我们以前也用过。',
  'Abaqus 是达索的产品。',
  'CST 的同事今天请假。',
  'SolidWorks 那台电脑在三楼。',
];

const detector = new DynamicActionDetector();
const types = (transcript, mode) => detector.detectTriggers({ transcript, modeTemplateType: mode }).map(({ trigger }) => trigger.type);

for (const [product, transcript] of PRODUCT_QUESTIONS) {
  test(`${product}: product question surfaces an FDE and a Sales card`, () => {
    assert.ok(types(transcript, 'fde').length > 0, `fde detector: ${transcript}`);
    assert.ok(
      types(transcript, 'sales').some((type) => type === 'discovery_question' || type === 'capability_fit_answer'),
      `sales detector: ${transcript}`,
    );
    assert.equal(detectIntentByPattern(transcript, 'fde')?.intent, 'fde_discovery', `fde intent: ${transcript}`);
    assert.match(detectIntentByPattern(transcript, 'sales')?.intent ?? '', /^sales_(pain_discovery|capability_fit)$/, `sales intent: ${transcript}`);
  });
}

test('product comparison routes to Sales capability fit', () => {
  assert.equal(detectIntentByPattern('Creo 和 SolidWorks 在大装配上有什么区别？', 'sales')?.intent, 'sales_capability_fit');
});

test('product names mentioned in passing stay silent', () => {
  for (const transcript of PRODUCT_MENTIONS) {
    for (const mode of ['fde', 'sales']) {
      assert.deepEqual(types(transcript, mode), [], `${mode} detector: ${transcript}`);
      assert.equal(detectIntentByPattern(transcript, mode), null, `${mode} intent: ${transcript}`);
      assert.equal(matchIntentKeywords(transcript, mode, defaultKeywordMapForTemplate(mode)), null, `${mode} keywords: ${transcript}`);
    }
  }
});

test('CAE pain phrases are default FDE and Sales keywords', () => {
  assert.equal(matchIntentKeywords('网格一直不收敛', 'fde', defaultKeywordMapForTemplate('fde'))?.intent, 'fde_discovery');
  assert.equal(matchIntentKeywords('网格一直不收敛', 'sales', defaultKeywordMapForTemplate('sales'))?.intent, 'sales_pain_discovery');
});
