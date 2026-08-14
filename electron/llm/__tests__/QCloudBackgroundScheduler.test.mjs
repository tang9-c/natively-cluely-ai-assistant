import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const schedulerPath = path.resolve('dist-electron/electron/llm/QCloudBackgroundScheduler.js');

test('QCloudBackgroundScheduler limits independent background work to two requests', async () => {
  const { QCloudBackgroundScheduler } = await import(pathToFileURL(schedulerPath).href);
  const scheduler = new QCloudBackgroundScheduler(2);
  let active = 0;
  let peak = 0;
  const releases = [];
  const task = () => scheduler.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => releases.push(resolve));
    active -= 1;
  });

  const pending = [task(), task(), task()];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2);
  assert.equal(peak, 2);

  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2);
  assert.equal(peak, 2);

  releases.splice(0).forEach((release) => release());
  await Promise.all(pending);
});
