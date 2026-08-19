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
  const processingDrainIndex = endMeetingSource.indexOf(
    'await this.processingHelper.cancelAndDrain()',
    snapshotIndex,
  );
  const screenshotQueueIndex = endMeetingSource.indexOf('if (screenshotTasksDrained)', snapshotIndex);
  const deferredCleanupIndex = endMeetingSource.indexOf(
    'this.processingHelper.waitForCancelledScreenshotTasks()',
    screenshotQueueIndex,
  );

  assert.ok(snapshotIndex >= 0, 'meeting snapshot must be awaited');
  assert.ok(resetIndex > snapshotIndex, 'in-flight intelligence requests clear after snapshot');
  assert.ok(dynamicContextIndex > snapshotIndex, 'dynamic action context clears after snapshot');
  assert.ok(processingDrainIndex > snapshotIndex, 'screenshot processing drains after snapshot');
  assert.ok(screenshotQueueIndex > processingDrainIndex, 'screenshot queues clear only after consumers drain');
  assert.ok(deferredCleanupIndex > screenshotQueueIndex, 'timed-out consumers own detached files until they settle');
});

test('meeting stop flushes transcript IPC after STT drain and before persistence', () => {
  const drainIndex = endMeetingSource.indexOf('await this.drainSttFinalsForMeetingStop()');
  const flushIndex = endMeetingSource.indexOf("this.transcriptIpcBatcher.flush('meeting_stop')");
  const snapshotIndex = endMeetingSource.indexOf(
    'const meetingId = await this.intelligenceManager.stopMeeting()',
  );

  assert.ok(drainIndex >= 0, 'STT finals must drain before IPC flush');
  assert.ok(flushIndex > drainIndex, 'IPC flush must include trailing STT finals');
  assert.ok(snapshotIndex > flushIndex, 'meeting persistence must start after IPC flush');
});

test('main routes renderer transcript delivery through the batcher only', () => {
  assert.match(source, /this\.transcriptIpcBatcher\.enqueue\(transcriptPayload\)/);
  assert.doesNotMatch(source, /webContents\.send\('native-audio-transcript', transcriptPayload\)/);
  assert.match(source, /native-audio-transcript-batch/);
});

test('ProcessingHelper bounds teardown wait while retaining a completion for cancelled tasks', () => {
  const processingSource = fs.readFileSync(path.join(root, 'electron/ProcessingHelper.ts'), 'utf8');

  assert.match(processingSource, /activeScreenshotTasks\s*=\s*new Set<Promise<void>>\(\)/);
  assert.match(processingSource, /this\.activeScreenshotTasks\.add\(task\)/);
  assert.match(processingSource, /Promise\.allSettled\(cancelledTasks\)/);
  assert.match(processingSource, /Promise\.race\(/);
  assert.match(processingSource, /waitForCancelledScreenshotTasks\(\)/);
});

test('ScreenshotHelper can detach queues without deleting files still owned by consumers', () => {
  const screenshotSource = fs.readFileSync(path.join(root, 'electron/ScreenshotHelper.ts'), 'utf8');

  assert.match(screenshotSource, /public detachQueues\(\): string\[\]/);
  assert.match(screenshotSource, /public async deleteDetachedFiles\(paths: string\[\]\)/);
});
