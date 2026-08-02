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
  assert.match(source, /Array\.from\(item\.samples\)/);
  assert.match(source, /localModelsGetList/);
  assert.match(source, /localModelsStartDownload/);
  assert.match(source, /onLocalModelsDownloadProgress/);
  assert.match(source, /安装声纹模型/);
  assert.doesNotMatch(source, /speakerVerificationStartModelDownload/);
  assert.doesNotMatch(source, /speakerVerificationGetModelStatus/);
});

test('SettingsOverlay exposes My Voice as an independent settings tab above Audio', () => {
  const settings = read('src/components/SettingsOverlay.tsx');
  assert.match(settings, /setActiveTab\('speaker-verification'\)/);
  assert.match(settings, /activeTab === 'speaker-verification'/);
  assert.match(settings, /> 我的声音/);

  const voiceNavIndex = settings.indexOf("setActiveTab('speaker-verification')");
  const audioNavIndex = settings.indexOf("setActiveTab('audio')");
  assert.ok(voiceNavIndex > 0, '我的声音导航入口应存在');
  assert.ok(voiceNavIndex < audioNavIndex, '我的声音导航入口应放在 Audio 之上');

  const voiceTabIndex = settings.indexOf("{activeTab === 'speaker-verification' && (");
  const audioTabIndex = settings.indexOf("{activeTab === 'audio' && (");
  const verificationIndex = settings.indexOf('<SpeakerVerificationSettings', voiceTabIndex);
  assert.ok(verificationIndex > voiceTabIndex, 'SpeakerVerificationSettings should render in speaker-verification tab');
  assert.ok(verificationIndex < audioTabIndex, 'SpeakerVerificationSettings should render before the Audio tab block');

  const audioBlockEnd = settings.indexOf("{activeTab === 'help'", audioTabIndex);
  const audioBlock = settings.slice(audioTabIndex, audioBlockEnd);
  assert.doesNotMatch(audioBlock, /<SpeakerVerificationSettings/);
  assert.doesNotMatch(audioBlock, /我的声音/);
  assert.doesNotMatch(audioBlock, /speaker-verification/);
});

test('UI copy states the only purpose and deletion behavior', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /只会在会议中识别你的发言为 ME/);
  assert.match(source, /仅保存在本机/);
  assert.match(source, /删除后，CueUp 将不再识别你的发言为 ME/);
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

test('three collected enrollment samples switch to re-record instead of a fourth recording', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /samples\.length >= PROMPTS\.length/);
  assert.match(source, /hasCompleteSampleSet \? '重新录制' : '开始注册'/);
  assert.match(source, /enrolled \|\| hasCompleteSampleSet \? <RotateCcw/);
  assert.match(source, /setRecordingIndex\(shouldRestart \? 0 : samples\.length\)/);
});

test('recording UI exposes live quality state and next action guidance', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /RecordingQualityState/);
  assert.match(source, /recordingMetrics/);
  assert.match(source, /正在录音/);
  assert.match(source, /继续说话/);
  assert.match(source, /声音偏小/);
  assert.match(source, /有效语音不足/);
  assert.match(source, /可以停止本段录音/);
});

test('recording quality policy is loaded from IPC with an internal default fallback', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /speakerVerificationGetQualityPolicy/);
  assert.match(source, /INTERNAL_DEFAULT_RECORDING_QUALITY_POLICY/);
  assert.match(source, /录音质量标准暂时使用内部默认设置/);
  assert.doesNotMatch(source, /Keep these thresholds aligned/);
});

test('invalid recording samples are rejected before enrollment', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /evaluateRecordingQuality/);
  assert.match(source, /quality\.state !== 'ready'/);
  assert.match(source, /本段录音未达标，请重录/);
  assert.match(source, /const next = \[\.\.\.samples, sample\]/);

  const qualityCheckIndex = source.indexOf("quality.state !== 'ready'");
  const appendIndex = source.indexOf('const next = [...samples, sample]');
  assert.ok(qualityCheckIndex > 0, 'quality check should exist');
  assert.ok(appendIndex > 0, 'sample append should exist');
  assert.ok(qualityCheckIndex < appendIndex, 'invalid samples must be rejected before being appended');
});

test('UI renders all speaker verification runtime health states', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /未注册。注册后可在会议中识别你的发言为 ME。/);
  assert.match(source, /已注册，当前暂停。开启后才会在会议中识别 ME。/);
  assert.match(source, /已注册并启用。会议中会尝试识别你的发言为 ME。/);
  assert.match(source, /已注册，但本地声纹模型缺失，请重新安装模型。/);
  assert.match(source, /已注册，但声纹模型加载失败。/);
  assert.match(source, /已注册，但最近识别质量不稳定。/);
  assert.match(source, /当前不可用/);
});
