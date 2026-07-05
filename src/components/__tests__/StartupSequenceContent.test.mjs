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

test('StartupSequence presents the Chinese CueUp onboarding copy', () => {
  const source = read('src/components/StartupSequence.tsx');

  assert.match(source, /欢迎使用 CueUp/);
  assert.match(source, /实时转写、屏幕理解和会议辅助/);
  assert.match(source, /点击继续即表示你同意 CueUp 的/);
  assert.match(source, /本地优先转写/);
  assert.match(source, /屏幕与上下文理解/);
  assert.match(source, /会议后记录与检索/);
});

test('StartupSequence no longer uses press logos or network font imports', () => {
  const source = read('src/components/StartupSequence.tsx');

  assert.doesNotMatch(source, /Hacker News/);
  assert.doesNotMatch(source, /AlternativeTo/);
  assert.doesNotMatch(source, /Product Hunt/);
  assert.doesNotMatch(source, /reddit/);
  assert.doesNotMatch(source, /@import url\('https:\/\/fonts\.googleapis\.com/);
});

test('StartupSequence links legal docs to the current GitHub branch', () => {
  const source = read('src/components/StartupSequence.tsx');

  assert.match(source, /blob\/ci\/intel-mac-workflow\/termsandcondition\.md/);
  assert.match(source, /blob\/ci\/intel-mac-workflow\/PRIVACY\.md/);
  assert.doesNotMatch(source, /blob\/main\//);
  assert.doesNotMatch(source, /cueup\.feigenbaum\.ai\/termsandconditions/);
  assert.doesNotMatch(source, /cueup\.feigenbaum\.ai\/privacy/);
});

test('NativelyInterfaceCard user-visible sample copy is localized', () => {
  const source = read('src/components/NativelyInterfaceCard.tsx');

  assert.match(source, /怎么回答？/);
  assert.match(source, /澄清/);
  assert.match(source, /跟进问题/);
  assert.match(source, /回顾/);
  assert.match(source, /这段我应该怎么回答？/);
  assert.match(source, /根据当前会议转写、屏幕内容和参考资料/);
  assert.match(source, /询问屏幕、会议或参考资料中的任何问题/);
  assert.match(source, /获取辅助/);

  assert.doesNotMatch(source, /What should I answer\?/);
  assert.doesNotMatch(source, /Follow up questions/);
  assert.doesNotMatch(source, /Ask anything/);
});
