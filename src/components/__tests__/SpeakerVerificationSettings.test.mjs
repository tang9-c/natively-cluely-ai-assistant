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

test('SpeakerVerificationSettings exposes register, re-record, and delete states', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /我的声音/);
  assert.match(source, /开始注册/);
  assert.match(source, /重新注册/);
  assert.match(source, /删除声音注册/);
  assert.match(source, /speakerVerificationDeleteProfile/);
  assert.match(source, /speakerVerificationEnroll/);
  assert.match(source, /localModelsGetList/);
  assert.match(source, /localModelsStartDownload/);
  assert.match(source, /onLocalModelsDownloadProgress/);
  assert.match(source, /安装声纹模型/);
  assert.doesNotMatch(source, /speakerVerificationStartModelDownload/);
  assert.doesNotMatch(source, /speakerVerificationGetModelStatus/);
});

test('SettingsOverlay renders speaker verification near speaker separation', () => {
  const settings = read('src/components/SettingsOverlay.tsx');
  assert.match(settings, /SpeakerVerificationSettings/);
  const verificationIndex = settings.indexOf('<SpeakerVerificationSettings');
  const separationIndex = settings.indexOf('>Speaker separation</label>');
  const languageIndex = settings.indexOf('Recognition Language Family');
  assert.ok(verificationIndex > 0, 'SpeakerVerificationSettings should render');
  assert.ok(verificationIndex < languageIndex, '我的声音设置应放在语言控制之前');
  assert.ok(Math.abs(verificationIndex - separationIndex) < 4000, '我的声音设置应靠近说话人分离设置');
});

test('UI copy states the only purpose and deletion behavior', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /只会在会议中识别你的发言为 ME/);
  assert.match(source, /仅保存在本机/);
  assert.match(source, /删除后，Natively 将不再识别你的发言为 ME/);
  assert.match(source, /不会默认改写历史会议/);
  assert.doesNotMatch(source, /authentication/i);
  assert.doesNotMatch(source, /login/i);
});

test('UI contains a separate privacy notice and does not hide it in a tooltip', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /隐私说明/);
  assert.match(source, /不会保存注册录音/);
  assert.match(source, /不会用于登录、认证、安全审核、广告或跨设备身份/);
  assert.match(source, /会硬删除本地声纹向量和统计信息/);
  assert.doesNotMatch(source, /title="隐私说明"/);
});

test('recording stop path actively stops microphone tracks and closes audio context', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /mediaRef/);
  assert.match(source, /tracks\.forEach\(track => track\.stop\(\)\)/);
  assert.match(source, /audioContext\.close\(\)/);
  assert.match(source, /stopActiveRecording/);
});
