import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  analyzeMaterialQuery,
  termsForCandidateFiltering,
} = require('../../../dist-electron/electron/services/knowledge/MaterialQueryAnalysis.js');

test('analyzeMaterialQuery extracts strong force-simulation terms from structured Chinese query', () => {
  const analysis = analyzeMaterialQuery(`mode:sales
intent:case_study_request
entities:今天, 价格, 案例
language:zh
latestTurn:我们今天先不谈价格，先搞清楚力学仿真模块的功能是否适合我们的产品，你能不能介绍一下功能和案例`);

  assert.equal(analysis.mode, 'sales');
  assert.equal(analysis.intent, 'case_study_request');
  assert.equal(analysis.language, 'zh');
  assert.deepEqual(analysis.strongTerms.slice(0, 4), ['力学仿真模块', '力学仿真', '仿真模块', '仿真']);
  assert.ok(analysis.optionalTerms.includes('功能'));
  assert.ok(analysis.optionalTerms.includes('案例'));
  assert.ok(analysis.downrankTerms.includes('价格'));
  assert.equal(analysis.weightedTerms.some((term) => term.term === 'mode'), false);
  assert.equal(analysis.weightedTerms.some((term) => term.term === 'sales'), false);
});

test('termsForCandidateFiltering keeps strong terms before weak n-grams under the term cap', () => {
  const analysis = analyzeMaterialQuery(`mode:sales
intent:case_study_request
entities:今天, 价格, 案例
language:zh
latestTurn:我们今天先不谈价格，先搞清楚力学仿真模块的功能是否适合我们的产品，你能不能介绍一下功能和案例`);

  const terms = termsForCandidateFiltering(analysis, 5);

  assert.deepEqual(terms.slice(0, 4), ['力学仿真模块', '力学仿真', '仿真模块', '仿真']);
  assert.equal(terms.includes('今天'), false);
  assert.equal(terms.includes('mode'), false);
});

test('analyzeMaterialQuery handles English acronyms and technical tokens', () => {
  const analysis = analyzeMaterialQuery(`mode:fde
intent:fde_integration
entities:Windchill, BOM, QMS, SSO
language:en
latestTurn:Can we connect Windchill BOM change notices to QMS CAPA records through SSO?`);

  assert.ok(analysis.strongTerms.includes('Windchill'));
  assert.ok(analysis.strongTerms.includes('BOM'));
  assert.ok(analysis.strongTerms.includes('QMS'));
  assert.ok(analysis.strongTerms.includes('SSO'));
  assert.equal(analysis.weightedTerms.find((term) => term.term === 'Windchill')?.weight, 2.5);
});

test('generic material words are downweighted but still available as optional terms', () => {
  const analysis = analyzeMaterialQuery('请根据资料介绍这个产品的功能和案例');

  assert.ok(analysis.optionalTerms.includes('资料'));
  assert.ok(analysis.optionalTerms.includes('产品'));
  assert.ok(analysis.optionalTerms.includes('功能'));
  assert.ok(analysis.optionalTerms.includes('案例'));
  assert.equal(analysis.weightedTerms.find((term) => term.term === '案例')?.weight, 0.45);
});
