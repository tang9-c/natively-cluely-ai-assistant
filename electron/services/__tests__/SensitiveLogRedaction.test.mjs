import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('SessionTracker logs transcript and assistant message metadata without text snippets', () => {
  const source = read('electron/SessionTracker.ts');

  assert.match(source, /Coding question stored`, \{ source, length: trimmed\.length \}/);
  assert.match(source, /addAssistantMessage called`, \{ length: text\.length \}/);
  assert.match(source, /RX User Segment`, \{ final: segment\.final, length: segment\.text\.length \}/);
  assert.match(source, /RX Interviewer Segment`, \{ final: segment\.final, length: segment\.text\.length \}/);
  assert.match(source, /Force-saving pending interim interviewer transcript', \{ length: this\.lastInterimInterviewer\.text\.length \}/);
  assert.match(source, /Force-saving pending interim user transcript', \{ length: this\.lastInterimUser\.text\.length \}/);
  assert.doesNotMatch(source, /console\.log[\s\S]{0,120}substring\(/);
  assert.doesNotMatch(source, /Force-saving pending interim transcript:', this\.lastInterimInterviewer\.text/);
  assert.doesNotMatch(source, /Force-saving pending interim user transcript:', this\.lastInterimUser\.text/);
  assert.doesNotMatch(source, /transcriptEpochSummaries\.push\([^\n]*(substring|\.text)/);
  assert.doesNotMatch(source, /Earlier discussion[^`]*\$\{oldEntries\.slice/);
});

test('IntelligenceEngine logs interim transcript metadata without text snippets', () => {
  const source = read('electron/IntelligenceEngine.ts');

  assert.match(source, /Speculative inference fired on interim`, \{ length: text\.length, confidence \}/);
  assert.match(source, /Injecting interim transcript`, \{ length: lastInterim\.text\.length \}/);
  assert.doesNotMatch(source, /console\.log[\s\S]{0,120}substring\(/);
});

test('LLMHelper logs request and custom provider metadata without prompt or response snippets', () => {
  const source = read('electron/LLMHelper.ts');

  assert.match(source, /chatWithGemini called`, \{ messageLength: message\.length/);
  assert.match(source, /streamChatWithGemini called`, \{ messageLength: message\.length/);
  assert.match(source, /Custom Provider response received`, \{ status: response\.status, ok: response\.ok \}/);
  assert.match(source, /throw new Error\(`Custom Provider HTTP \$\{response\.status\}`\)/);
  assert.match(source, /Custom Provider stream HTTP error', \{ status: response\.status \}/);
  assert.doesNotMatch(source, /console\.log[\s\S]{0,120}message\.substring\(/);
  assert.doesNotMatch(source, /console\.log[\s\S]{0,120}JSON\.stringify\(data\)\.substring\(/);
  assert.doesNotMatch(source, /Custom Provider HTTP \$\{response\.status\}: \$\{JSON\.stringify\(data\)\.substring/);
  assert.doesNotMatch(source, /Custom Provider HTTP \$\{response\.status\}: \$\{errorText\.substring/);
});

test('STT providers log transcript metadata without transcript text', () => {
  const files = [
    'electron/audio/GoogleSTT.ts',
    'electron/audio/RestSTT.ts',
    'electron/audio/DeepgramStreamingSTT.ts',
    'electron/audio/OpenAIStreamingSTT.ts',
    'electron/audio/NativelyProSTT.ts',
    'electron/audio/ElevenLabsStreamingSTT.ts',
  ];

  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /console\.log[\s\S]{0,180}(transcript|msg\.text)[\s\S]{0,100}substring\(/, file);
    assert.doesNotMatch(source, /console\.log[\s\S]{0,180}text="\$\{transcript/, file);
    assert.doesNotMatch(source, /console\.log[\s\S]{0,180}JSON\.stringify\(msg\)\.(slice|substring)/, file);
    assert.doesNotMatch(source, /console\.log[\s\S]{0,180}apiKey\?\.slice/, file);
  }
});

test('speaker verification logs do not include raw audio or embedding values', () => {
  const files = [
    'electron/services/speaker/SpeakerEnrollmentService.ts',
    'electron/services/speaker/SpeakerVerificationService.ts',
    'electron/services/speaker/SpeakerVerificationAnnotator.ts',
    'electron/services/speaker/SpeakerEmbeddingExtractor.ts',
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /console\.(log|warn|error)\([^)]*samples/i, `${file} must not log samples`);
    assert.doesNotMatch(source, /console\.(log|warn|error)\([^)]*embedding/i, `${file} must not log embeddings`);
    assert.doesNotMatch(source, /console\.(log|warn|error)\([^)]*transcript/i, `${file} must not log transcripts`);
  }
});

test('IPC and meeting summary logs avoid answer and LLM response snippets', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const persistence = read('electron/MeetingPersistence.ts');
  const intentWorker = read('electron/llm/intentClassifierWorkerProcess.ts');

  assert.match(ipc, /gemini - chat response received`, \{ length: result\?\.length \?\? 0 \}/);
  assert.match(ipc, /Updated IntelligenceManager\.Last message`,[\s\S]{0,120}length: intelligenceManager\.getLastAssistantMessage\(\)\?\.length \?\? 0/);
  assert.doesNotMatch(ipc, /console\.log[\s\S]{0,140}result\.substring\(/);
  assert.doesNotMatch(ipc, /console\.log[\s\S]{0,140}getLastAssistantMessage\(\)\?\.substring\(/);

  assert.match(persistence, /LLM summary response received', \{ length: jsonStr\.length \}/);
  assert.match(persistence, /Failed to parse summary JSON'[\s\S]{0,180}responseLength: jsonStr\.length/);
  assert.match(persistence, /errorName: e instanceof Error \? e\.name : 'UnknownError'/);
  assert.match(persistence, /errorMessage: e instanceof Error \? e\.message : String\(e\)/);
  assert.doesNotMatch(persistence, /Failed to parse summary JSON'[\s\S]{0,180}error: e/);
  assert.doesNotMatch(persistence, /Raw LLM summary response/);
  assert.doesNotMatch(persistence, /Raw response:', jsonStr\.substring/);

  assert.match(intentWorker, /SLM classified', \{\s*intent,\s*confidence: topScore,\s*textLength: request\.text\.length,/);
  assert.doesNotMatch(intentWorker, /text\.substring\(/);
});
