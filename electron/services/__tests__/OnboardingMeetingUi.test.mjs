import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { mainMethods } from './helpers/onboardingRuntime.mjs';
const require = createRequire(import.meta.url), ts = require('typescript');
test('Launcher failure result object never counts as a successful start', async () => {
  const ast = ts.createSourceFile('Launcher.tsx', fs.readFileSync('src/components/Launcher.tsx', 'utf8'), ts.ScriptTarget.Latest, true);
  let source;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleStartMeetingClick') source = node.initializer.getText(ast); ts.forEachChild(node, visit); }; visit(ast);
  assert.ok(source); const calls = [], module = { exports: null };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${source}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, isMeetingActive: false, isStartingMeeting: false, setIsStartingMeeting: v => calls.push(v),
      onStartMeeting: async () => ({ success: false, errorCode: 'device_missing' }), analytics: { trackCommandExecuted: () => calls.push('tracked') } });
  await module.exports(); assert.deepEqual(calls, [true, false]);
});
test('late async audio failure from another session is ignored; current failure cleans up and returns Launcher once', () => {
  const App = mainMethods(['handleMeetingAudioStartupFailure'], { _redactForLog: () => '[REDACTED]' });
  const app = new App(); let windows = 0, stops = 0; const facts = [];
  app.isMeetingActive = true; app.intelligenceManager = { getSessionGeneration: () => 'current' };
  app.adaptivePreloadManager = { notifyMeetingStopped: () => stops++ };
  app.broadcastMeetingState = () => {}; app.broadcast = () => {}; app.stopDefaultOutputWatcher = () => {};
  app.windowHelper = { setWindowMode: mode => { assert.equal(mode, 'launcher'); windows++; } };
  app.recordOnboardingMeetingEvent = event => facts.push(event);
  app.handleMeetingAudioStartupFailure(new Error('private provider body'), 1, 'old');
  assert.equal(app.isMeetingActive, true); assert.equal(windows, 0); assert.equal(facts.length, 0);
  app.handleMeetingAudioStartupFailure(new Error('private provider body'), 2, 'current');
  assert.equal(app.isMeetingActive, false); assert.equal(stops, 1); assert.equal(windows, 1);
  assert.equal(facts[0].kind, 'failed'); assert.equal(facts[0].generation, 2);
});
