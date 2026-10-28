import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const file = path.resolve(import.meta.dirname, '../../test/onboardingFixtures.ts');
test('onboarding fixture cannot be enabled in packaged/non-E2E/unknown-scenario environments', async () => {
  assert.equal(fs.existsSync(file), true, 'fixed onboarding adapter is missing');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('require', 'module', 'exports', code)(require, module, module.exports);
  const create = module.exports.createOnboardingFixture;
  for (const environment of [{ e2e: true, enabled: true, packaged: true }, { e2e: false, enabled: true, packaged: false }, { e2e: true, enabled: false, packaged: false }]) {
    assert.equal(create('ready', environment), null);
  }
  assert.throws(() => create('arbitrary-json', { e2e: true, enabled: true, packaged: false }), /scenario/);
  const fixture = create('ready', { e2e: true, enabled: true, packaged: false });
  assert.equal(fixture.readConfiguration('ai').configIdentity, 'fixture-ai');
  assert.equal(fixture.now(), 1000);
  fixture.advanceTime(500); assert.equal(fixture.now(), 1500);
  assert.throws(() => fixture.advanceTime(-1), /time/);
  assert.doesNotMatch(JSON.stringify(await fixture.readChecks()), /ApiKey|secret|prompt|transcriptText/);
});
