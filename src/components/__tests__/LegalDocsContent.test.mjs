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

test('legal documents use the current CueUp owner and contact information', () => {
  const privacy = read('PRIVACY.md');
  const terms = read('termsandcondition.md');
  const combined = `${privacy}\n${terms}`;

  assert.match(privacy, /CueUp 项目团队/);
  assert.match(terms, /CueUp 项目团队/);
  assert.match(combined, /tangdu@feigenbaum\.ai/);

  assert.doesNotMatch(combined, /natively\.contact@gmail\.com/);
  assert.doesNotMatch(combined, /Evin John/);
  assert.doesNotMatch(combined, /Kochi/);
  assert.doesNotMatch(combined, /Kerala/);
  assert.doesNotMatch(combined, /evinjohnn\/natively-cluely-ai-assistant/);
});

test('fork provenance and public copy keep Natively as attribution only', () => {
  const readme = read('README.md');
  const provenance = read('FORK_PROVENANCE.md');
  const about = read('src/components/AboutSection.tsx');

  assert.match(readme, /Natively` 名称仅用于说明上游来源和许可证背景/);
  assert.match(readme, /CueUp 是独立 fork，不隶属、不受 Natively 或 Natively AI Private Limited 授权、赞助或背书/);
  assert.match(provenance, /Trademark\/Branding Policy/);
  assert.match(provenance, /The external product brand for this fork is CueUp/);
  assert.match(provenance, /must not be used as this fork's application name, package name/);
  assert.match(provenance, /simple C-shaped sound wave/);
  assert.match(about, /CueUp 是独立 fork,不隶属、不受 Natively 或 Natively AI Private Limited 授权、赞助或背书/);
});

test('privacy policy describes current local and speech provider data flows', () => {
  const privacy = read('PRIVACY.md');

  assert.match(privacy, /Local SenseVoice/);
  assert.match(privacy, /本地 SQLite/);
  assert.match(privacy, /Doubao AUC/);
  assert.match(privacy, /QCLOUD API/);
  assert.match(privacy, /Ollama/);
  assert.match(privacy, /GitHub 更新检查/);
  assert.match(privacy, /不使用你的会议内容、提示词、截图、音频或输出结果训练模型/);
});

test('terms link to the GitHub privacy policy and avoid unsupported legal claims', () => {
  const terms = read('termsandcondition.md');

  assert.match(terms, /blob\/ci\/intel-mac-workflow\/PRIVACY\.md/);
  assert.match(terms, /不声明任何未在项目中明确公布的公司注册号、税务身份、律师审核结论或退款承诺/);
  assert.doesNotMatch(terms, /cueup\.feigenbaum\.ai\/privacy/);
  assert.doesNotMatch(terms, /cueup\.feigenbaum\.ai\/refundpolicy/);
});
