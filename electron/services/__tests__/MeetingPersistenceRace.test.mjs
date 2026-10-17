import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../MeetingPersistence.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const stopStart = source.indexOf('    public async stopMeeting');
const stopEnd = source.indexOf('    /**\n     * Heavy lifting', stopStart);
const stopSource = source.slice(stopStart, stopEnd);

test('stopMeeting saves placeholder before starting background processing', () => {
  assert.ok(stopStart >= 0, 'stopMeeting should exist');
  assert.ok(stopEnd > stopStart, 'stopMeeting source should be isolated');

  const placeholderSaveIndex = stopSource.indexOf('DatabaseManager.getInstance().saveMeeting(placeholder, snapshot.startTime, durationMs);');
  const backgroundStartIndex = stopSource.indexOf('this.processAndSaveMeeting(snapshot, meetingId, metadataSnapshot, modeSnapshot)');

  assert.ok(placeholderSaveIndex >= 0, 'placeholder should be saved');
  assert.ok(backgroundStartIndex >= 0, 'background processing should be queued');
  assert.ok(placeholderSaveIndex < backgroundStartIndex, 'background processing must not start before placeholder save');
});

test('final routing assigns one stable ID before both session and IPC; interim stays uneditable', async () => {
  const ts = (await import('typescript')).default;
  const crypto = await import('node:crypto');
  const main = fs.readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');
  const start = main.indexOf('  private routeTranscriptPayload(');
  const end = main.indexOf('  public injectBenchmarkTranscript(', start);
  const method = main.slice(start,end).replace('private routeTranscriptPayload','routeTranscriptPayload');
  const code = ts.transpileModule(`class Route { ${method} }`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const Route = new Function('crypto',`${code};return Route;`)(crypto);
  const route = new Route();
  const seen=[]; const sent=[];
  const { SessionTracker } = await import('../../../dist-electron/electron/SessionTracker.js');
  const tracker = new SessionTracker();
  route.logMeetingEchoDiagnostics=()=>{};
  route.intelligenceManager={getSessionGeneration:()=> tracker.getSessionGeneration(),handleTranscript:p=>{ seen.push({...p});tracker.addTranscript(p); }};
  route.transcriptIpcBatcher={enqueue:p=>sent.push(p)};
  route.routeTranscriptPayload({speaker:'user',text:'fictional',final:true});
  assert.ok(seen[0].segmentId);
  assert.equal(seen[0].segmentId,sent[0].segmentId);
  assert.equal(seen[0].sessionGeneration,tracker.getSessionGeneration());
  assert.equal(tracker.getFullTranscript()[0].segmentId,sent[0].segmentId);
  route.routeTranscriptPayload({speaker:'user',text:'interim',final:false});
  assert.equal(sent[1].segmentId,undefined);
});
