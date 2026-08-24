import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const schemas = () => require('../../../dist-electron/electron/services/meeting-preparation/MeetingPreparationSchemas.js');

test('extractAndParse accepts fenced JSON and preserves uncertain fields', () => {
  const { extractAndParse, meetingContextSchema } = schemas();
  const result = extractAndParse(
    '```json\n{"topic":{"value":"产品交流","state":"confirmed"},"customer":{"value":"启明机器人","state":"needs_confirmation"},"participants":[],"goal":{"value":"需求发现","state":"confirmed"},"agenda":[],"background":""}\n```',
    meetingContextSchema,
  );

  assert.equal(result.customer.state, 'needs_confirmation');
});

test('extractAndParse rejects invented modes', () => {
  const { extractAndParse, modeRecommendationSchema } = schemas();

  assert.throws(() =>
    extractAndParse('{"templateType":"general","reason":"x","focus":"y"}', modeRecommendationSchema),
  );
});

test('extractAndParse rejects more than three questions', () => {
  const { extractAndParse, predictedQuestionsSchema } = schemas();
  const question = '{"question":"问题","keyMomentType":"proof","rationale":[],"knowledgeRequirements":[],"requiresInternalEvidence":true}';

  assert.throws(() =>
    extractAndParse(`{"questions":[${question},${question},${question},${question}]}`, predictedQuestionsSchema),
  );
});
