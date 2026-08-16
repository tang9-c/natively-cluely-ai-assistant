import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const start = source.indexOf('public async endMeeting');
const end = source.indexOf('private async drainSttFinalsForMeetingStop', start);
const endMeetingSource = source.slice(start, end);

test('meeting teardown clears transient resources only after persistence snapshot', () => {
  const snapshotIndex = endMeetingSource.indexOf(
    'const meetingId = await this.intelligenceManager.stopMeeting()',
  );
  const resetIndex = endMeetingSource.indexOf('this.intelligenceManager.resetEngine()', snapshotIndex);
  const dynamicContextIndex = endMeetingSource.indexOf(
    'this.intelligenceManager.clearDynamicActionContext()',
    snapshotIndex,
  );
  const screenshotQueueIndex = endMeetingSource.indexOf('this.clearQueues()', snapshotIndex);

  assert.ok(snapshotIndex >= 0, 'meeting snapshot must be awaited');
  assert.ok(resetIndex > snapshotIndex, 'in-flight intelligence requests clear after snapshot');
  assert.ok(dynamicContextIndex > snapshotIndex, 'dynamic action context clears after snapshot');
  assert.ok(screenshotQueueIndex > snapshotIndex, 'screenshot queues clear after snapshot');
});
