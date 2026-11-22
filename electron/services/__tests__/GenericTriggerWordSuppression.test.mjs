import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron');
const { DynamicActionDetector } = await import(pathToFileURL(path.join(distRoot, 'services/dynamic-actions/DynamicActionDetector.js')).href);
const { defaultKeywordMapForTemplate, matchIntentKeywords } = await import(pathToFileURL(path.join(distRoot, 'llm/IntentKeywordDefaults.js')).href);
const { detectIntentByPattern } = await import(pathToFileURL(path.join(distRoot, 'llm/IntentClassifier.js')).href);

// Incidental generic words that show up in any CAD / CAE / PLM / QMS meeting.
const CHATTER = {
  fde: [
    '下周我们团建，大家记得报名。',
    '这个版本的 PPT 我再改一下。',
    '会议室环境挺好的。',
    'Creo 我们以前也用过。',
    '加密狗插上就能用。',
    '我们的自动化程度还比较低。',
    '这个接口我们后面再说。',
    'We had a rapid review of the slides.',
    'The release notes are on the wiki.',
  ],
  sales: [
    '下周我们内部开个同步会。',
    'Our schedule is tight this week.',
    '下一页我们看看功能列表。',
  ],
  'team-meet': [
    '我确认一下大家都在。',
    '我们定期开这个会。',
    '依赖包已经装好了。',
    'The beta build is on the wiki.',
  ],
};

for (const [mode, sentences] of Object.entries(CHATTER)) {
  test(`${mode}: incidental generic words do not trigger cards`, () => {
    const detector = new DynamicActionDetector();
    const keywordMap = defaultKeywordMapForTemplate(mode);
    for (const transcript of sentences) {
      const triggers = detector.detectTriggers({ transcript, modeTemplateType: mode });
      assert.deepEqual(triggers.map(({ trigger }) => trigger.type), [], `detector: ${transcript}`);
      assert.equal(matchIntentKeywords(transcript, mode, keywordMap), null, `keywords: ${transcript}`);
      assert.equal(detectIntentByPattern(transcript, mode), null, `intent regex: ${transcript}`);
    }
  });
}

test('ASCII intent keywords match whole words and treat "." as one character', () => {
  const fde = defaultKeywordMapForTemplate('fde');
  assert.equal(matchIntentKeywords('a rapid prototype', 'fde', fde), null);
  assert.equal(matchIntentKeywords('Need the API spec', 'fde', fde)?.intent, 'fde_integration');

  const team = defaultKeywordMapForTemplate('team-meet');
  assert.equal(matchIntentKeywords("I'll send the notes", 'team-meet', team)?.intent, 'capture_action');
  assert.equal(matchIntentKeywords('the metadata is ready', 'team-meet', team), null);
});
