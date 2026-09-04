import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadSpeakerVerificationSettings() {
  const componentPath = path.join(repoRoot, 'src/components/settings/SpeakerVerificationSettings.tsx');
  const previousTsLoader = Module._extensions['.ts'];
  Module._extensions['.ts'] = (module, filename) => {
    const compiledModule = transformSync(fs.readFileSync(filename, 'utf8'), {
      loader: 'ts',
      format: 'cjs',
      target: 'es2020',
    });
    module._compile(compiledModule.code, filename);
  };
  const compiled = transformSync(fs.readFileSync(componentPath, 'utf8'), {
    loader: 'tsx',
    format: 'cjs',
    target: 'es2020',
  });
  const componentModule = new Module(componentPath);
  componentModule.filename = componentPath;
  componentModule.paths = Module._nodeModulePaths(path.dirname(componentPath));
  try {
    componentModule._compile(compiled.code, componentPath);
    return componentModule.exports;
  } finally {
    if (previousTsLoader) {
      Module._extensions['.ts'] = previousTsLoader;
    } else {
      delete Module._extensions['.ts'];
    }
  }
}

test('SpeakerVerificationSettings renders its primary Chinese status and controls', () => {
  const { SpeakerVerificationSettings } = loadSpeakerVerificationSettings();
  const html = renderToStaticMarkup(React.createElement(SpeakerVerificationSettings));

  assert.match(html, /我的声音/);
  assert.match(html, /未注册。注册后可在会议中识别你的发言为 ME。/);
  assert.match(html, /安装声纹模型/);
  assert.match(html, /模型健康/);
  assert.match(html, /检查模型/);
});

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

test('UI explains ME label effects without weakening privacy boundaries', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /ME 标签会影响实时回答看到的说话人上下文。/);
  assert.match(source, /高置信识别为 ME 的发言不会触发面向对方发言的动态动作。/);
  assert.match(source, /声纹数据仅保存在本机/);
  assert.match(source, /不会保存注册录音/);
  assert.match(source, /不会用于登录、认证、安全审核、广告或跨设备身份/);
  assert.match(source, /不会默认改写历史会议/);
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

test('speaker enrollment uses long prompts with eight voiced seconds and a fifteen second cap', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');

  assert.match(source, /const MAX_RECORDING_DURATION_MS = 15_000/);
  assert.match(source, /今天的会议我们会依次讨论产品目标、技术方案、交付时间和团队分工/);
  assert.match(source, /客户最近重点关注系统稳定性、数据安全、部署方式和使用体验/);
  assert.match(source, /包括遇到的问题、你的判断以及下一步准备怎么做/);
  assert.match(source, /durationMs \* voiceRatio/);
  assert.match(source, /durationMs >= MAX_RECORDING_DURATION_MS/);
  assert.match(source, /disabled=\{busy \|\| recordingMetrics\.state !== 'ready'\}/);
  assert.match(source, /mediaRef\.current = null;\s+setBusy\(true\);/);
  assert.match(source, /formatDuration\(MAX_RECORDING_DURATION_MS\)/);
  assert.match(source, /formatDuration\(qualityPolicy\.minDurationMs\)/);
});

test('each speaker enrollment prompt contains enough Chinese speech for the eight-second voice target', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  const promptBlock = source.match(/const PROMPTS = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
  const prompts = [...promptBlock.matchAll(/'([^']+)'/g)].map(match => match[1]);

  assert.equal(prompts.length, 3);
  for (const prompt of prompts) {
    const hanCharacters = [...prompt].filter(character => /\p{Script=Han}/u.test(character)).length;
    assert.ok(hanCharacters >= 65, `提示词汉字数不足：${hanCharacters}`);
    assert.ok(hanCharacters <= 75, `提示词汉字数过多：${hanCharacters}`);
  }
});

test('recording limit failure asks for a rerecord instead of asking the user to continue a stopped recording', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');

  assert.match(source, /\(\) => void finishRecording\(true\)/);
  assert.match(source, /onClick=\{\(\) => void finishRecording\(false\)\}/);
  assert.match(source, /recordingEnded/);
  assert.match(source, /有效语音不足，请重录/);
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

test('unstable enrollment explains cross-recording inconsistency without blaming room noise', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /speaker_enrollment_unstable_profile/);
  assert.match(source, /三段录音的声纹差异较大，请保持同一麦克风和自然音量重新录制。/);
  assert.doesNotMatch(source, /声音样本不稳定，请在安静环境重新录制三段语音。/);
});

test('UI exposes speaker model health check states and latency', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /modelHealthText/);
  assert.match(source, /模型健康/);
  assert.match(source, /模型正常/);
  assert.match(source, /模型缺失/);
  assert.match(source, /模型加载失败/);
  assert.match(source, /检查耗时 \{Math\.round\(displayedModelHealth\.loadLatencyMs\)\} ms/);
  assert.match(source, /检查模型/);
  assert.match(source, /speakerVerificationGetHealth\?\.\(\{ smokeTest: true \}\)/);
  assert.match(source, /speaker_embedding_model_health_ipc_failed/);
});

test('enrolled profiles can be paused without deleting their local voiceprint', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /status\?\.mode === 'local'/);
  assert.match(source, /本机识别已开启/);
  assert.match(source, /本机识别已暂停，声纹仍保存在本机/);
  assert.match(source, /setSpeakerVerificationMode\?\.\(mode\)/);
  assert.match(source, /verificationEnabled \? 'off' : 'local'/);
  assert.match(source, /role="switch"/);
});

test('registered voice profiles render enrollment quality summary', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /enrollmentQualityText/);
  assert.match(source, /stable['"]:\s*return '稳定'/);
  assert.match(source, /weak_boundary['"]:\s*return '边界偏弱，建议在安静环境重录'/);
  assert.match(source, /needs_rerecord['"]:\s*return '建议重录'/);
  assert.match(source, /注册质量：/);
  assert.match(source, /最低相似度/);
  assert.match(source, /平均相似度/);
  assert.match(source, /当前阈值/);
  assert.match(source, /formatPercent\(status\.quality\.minSelfSimilarity\)/);
  assert.match(source, /formatPercent\(status\.quality\.meanSelfSimilarity\)/);
  assert.match(source, /formatPercent\(status\.quality\.calibratedThreshold\)/);
});

test('legacy registered voice profiles show missing quality copy without fake scores', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /status\?\.quality \?/);
  assert.match(source, /注册质量：旧版本注册，暂无评分/);
  assert.doesNotMatch(source, /qualityScore\s*\?\?/);
  assert.doesNotMatch(source, /minSelfSimilarity\s*\?\?/);
});

test('registered profiles render recent verification reliability stats', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /最近会议识别/);
  assert.match(source, /ME 命中/);
  assert.match(source, /positiveVerifications\} \/ \{totalVerifications/);
  assert.match(source, /低置信拒绝/);
  assert.match(source, /lowConfidenceRejections/);
  assert.match(source, /低质量跳过/);
  assert.match(source, /lowQualitySkips/);
  assert.match(source, /错误\/超时/);
  assert.match(source, /errorOrTimeoutCount/);
  assert.match(source, /nearThresholdNonMeCount >= 3/);
  assert.match(source, /最近有多次非 ME 片段接近阈值，建议重录声音。/);
  assert.doesNotMatch(source, /lowConfidenceCount/);
  assert.doesNotMatch(source, /lowQualityCount/);
});

test('registered profiles without verification stats show no data copy and no raw evidence fields', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /totalVerifications === 0/);
  assert.match(source, /暂无会议识别数据/);
  assert.doesNotMatch(source, /rawTranscript/);
  assert.doesNotMatch(source, /speakerText/);
  assert.doesNotMatch(source, /audioPath/);
});

test('speaker model install diagnostics show model details, progress, sanitized failures, and retry', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /interface LocalSpeakerModelInfo/);
  assert.match(source, /setSpeakerModelInfo\(speakerModel \?\? null\)/);
  assert.match(source, /本地声纹模型/);
  assert.match(source, /用于在会议中识别你的发言为 ME/);
  assert.match(source, /约 \{speakerModelInfo\?\.sizeMb \?\? 28\} MB/);
  assert.match(source, /正在安装/);
  assert.match(source, /\{Math\.round\(downloadProgress\)\}%/);
  assert.match(source, /重试安装/);
  assert.match(source, /setDownloadError\(sanitizedModelDownloadError\(payload\.error\)\)/);
  assert.match(source, /setDownloadError\(sanitizedModelDownloadError\(result\?\.error\)\)/);
  assert.match(source, /parsed\.search = ''/);
  assert.doesNotMatch(source, /setError\('声纹模型安装失败'\)/);
});

test('speaker enrollment sends PCM16 ArrayBuffer instead of expanding Float32 samples to number arrays', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');
  assert.match(source, /function float32ToPcm16Buffer\(samples: Float32Array\): ArrayBuffer/);
  assert.match(source, /new ArrayBuffer\(samples\.length \* 2\)/);
  assert.match(source, /view\.setInt16\(i \* 2,[\s\S]*true\)/);
  assert.match(source, /pcm16: float32ToPcm16Buffer\(item\.samples\)/);
  assert.doesNotMatch(source, /Array\.from\(item\.samples\)/);
});
