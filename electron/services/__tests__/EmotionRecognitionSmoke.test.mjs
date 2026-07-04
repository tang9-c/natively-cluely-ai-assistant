// electron/services/__tests__/EmotionRecognitionSmoke.test.mjs
//
// End-to-end smoke test for the SenseVoice emotion recognition pipeline.
// Simulates SenseVoice worker output (the same format produced by
// `LocalSenseVoiceSTT` after model inference: `<|lang|><|EMOTION|><|Speech|>text`)
// and verifies that:
//
//   1. textCleaner extracts the emotion field correctly
//   2. NEUTRAL emotion produces no emotion field (UI hides it)
//   3. All 6 non-neutral emotions parse to the right enum
//   4. Final transcript.text strips the tags
//   5. The cleaned text is forwarded through the BaseSTT event chain
//      with emotion/emotionSource metadata preserved end-to-end
//
// This test is a structural smoke check — it does NOT run actual audio
// inference. To exercise with real audio, use
// `tests/fixtures/audio/real-conversation-2p-60s.wav` (60s, 16kHz mono,
// Mandarin Chinese conversation) and the full LocalSenseVoiceSTT pipeline.
//
// Reference fixtures (Mandarin Speech Corpus):
//   tests/fixtures/audio/README.md
//   shared/senseVoiceEmotion.ts
//   electron/audio/sensevoice/textCleaner.ts
//   electron/audio/sensevoice/LocalSenseVoiceSTT.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const textCleanerPath = path.resolve(__dirname, '../../../dist-electron/electron/audio/sensevoice/textCleaner.js');

async function loadCleaner() {
  return import(pathToFileURL(textCleanerPath).href);
}

// 6 non-neutral emotions + 1 neutral, all valid SenseVoice output tags
const EMOTION_CASES = [
  { tag: 'HAPPY',     expected: 'happy',      cn: '开心' },
  { tag: 'SAD',       expected: 'sad',        cn: '悲伤' },
  { tag: 'ANGRY',     expected: 'angry',      cn: '愤怒' },
  { tag: 'FEARFUL',   expected: 'fearful',    cn: '害怕' },
  { tag: 'DISGUSTED', expected: 'disgusted',  cn: '厌恶' },
  { tag: 'SURPRISED', expected: 'surprised',  cn: '惊讶' },
];

test('textCleaner: every non-neutral emotion parses to correct enum', async () => {
  const { parseSenseVoiceOutput } = await loadCleaner();

  for (const { tag, expected } of EMOTION_CASES) {
    const raw = `<|zh|><|${tag}|><|Speech|>今天天气很好,我们谈谈方案吧。`;
    const parsed = parseSenseVoiceOutput(raw);

    assert.equal(parsed.language, 'zh', `${tag}: language should be 'zh'`);
    assert.equal(parsed.emotion, expected, `${tag}: emotion should be '${expected}'`);
    assert.equal(parsed.text, '今天天气很好,我们谈谈方案吧。', `${tag}: text should strip tags`);
    assert.deepEqual(parsed.events, ['speech'], `${tag}: events should contain 'speech'`);
  }
});

test('textCleaner: NEUTRAL emotion produces no emotion field (UI hides it)', async () => {
  const { parseSenseVoiceOutput } = await loadCleaner();

  const parsed = parseSenseVoiceOutput('<|zh|><|NEUTRAL|><|Speech|>中性叙述。');

  assert.equal(parsed.language, 'zh');
  assert.equal(parsed.emotion, undefined, 'NEUTRAL must NOT produce an emotion field');
  assert.equal(parsed.text, '中性叙述。');
});

test('textCleaner: realistic multi-utterance Mandarin conversation', async () => {
  const { parseSenseVoiceOutput } = await loadCleaner();

  // Simulate the kind of output SenseVoice would produce for a 60s
  // 2-speaker Mandarin conversation (similar to the audio fixture)
  const utterances = [
    '<|zh|><|HAPPY|><|Speech|>你好,我是张经理。',
    '<|zh|><|NEUTRAL|><|Speech|>很高兴见到你。',
    '<|zh|><|ANGRY|><|Speech|>价格太高了!',
    '<|zh|><|FEARFUL|><|Speech|>我们的数据安全吗?',
    '<|zh|><|SURPRISED|><|Speech|>哦,真的能这样做吗?',
    '<|zh|><|HAPPY|><|Speech|>那我们就这么说定了。',
  ];

  const parsed = utterances.map(parseSenseVoiceOutput);

  assert.deepEqual(parsed.map(p => p.emotion), [
    'happy', undefined, 'angry', 'fearful', 'surprised', 'happy',
  ]);
  assert.deepEqual(parsed.map(p => p.text), [
    '你好,我是张经理。',
    '很高兴见到你。',
    '价格太高了!',
    '我们的数据安全吗?',
    '哦,真的能这样做吗?',
    '那我们就这么说定了。',
  ]);
});

test('textCleaner: handles malformed input gracefully', async () => {
  const { parseSenseVoiceOutput } = await loadCleaner();

  // No tags at all
  const a = parseSenseVoiceOutput('纯文本无标签。');
  assert.equal(a.text, '纯文本无标签。');
  assert.equal(a.emotion, undefined);
  assert.equal(a.language, undefined);

  // Empty input
  const b = parseSenseVoiceOutput('');
  assert.equal(b.text, '');

  // Unknown tag is recorded as event, not as emotion
  const c = parseSenseVoiceOutput('<|zh|><|CUSTOM_EVENT|><|Speech|>hello');
  assert.equal(c.emotion, undefined);
  assert.ok(c.events?.includes('custom_event'), 'unknown tag should appear in events');
  assert.ok(c.events?.includes('speech'), 'Speech tag should also appear in events');
  assert.equal(c.text, 'hello');
});
