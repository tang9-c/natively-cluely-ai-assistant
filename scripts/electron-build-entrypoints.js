const fs = require('fs');
const path = require('path');

const PACKAGE_ENTRY_POINTS = [
  'electron/main.ts',
  'electron/preload.ts',
  'electron/audio/whisper/whisperWorker.ts',
  'electron/audio/sensevoice/senseVoiceWorker.ts',
  'electron/services/speaker/SpeakerEmbeddingExtractorWorker.ts',
  'electron/services/knowledge/pptx/createPptxFontMapping.ts',
  'electron/llm/intentClassifierWorkerProcess.ts',
  'electron/rag/vectorSearchWorker.ts',
];

function findTypeScriptFiles(dir, rootDir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'test') continue;
      results.push(...findTypeScriptFiles(fullPath, rootDir));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(path.relative(rootDir, fullPath));
    }
  }
  return results;
}

function getElectronEntryPoints(rootDir, mode = 'development') {
  if (mode === 'package') return [...PACKAGE_ENTRY_POINTS];

  const results = [];
  for (const directoryName of ['electron', 'shared']) {
    const directory = path.resolve(rootDir, directoryName);
    if (fs.existsSync(directory)) {
      results.push(...findTypeScriptFiles(directory, rootDir));
    }
  }
  return results;
}

function prepareElectronOutDir(outDir, mode = 'development') {
  if (mode === 'package') {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });
}

module.exports = {
  getElectronEntryPoints,
  prepareElectronOutDir,
};
