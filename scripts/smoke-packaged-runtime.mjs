#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function appExecutable(appPath) {
  if (process.platform === 'win32') return path.join(appPath, 'CueUp.exe');
  return path.join(appPath, 'Contents', 'MacOS', 'CueUp');
}

function resourcesPath(appPath) {
  return process.platform === 'win32'
    ? path.join(appPath, 'resources')
    : path.join(appPath, 'Contents', 'Resources');
}

function createMinimalPdf(text) {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${escaped.length + 25} >>\nstream\nBT /F1 18 Tf 72 720 Td (${escaped}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

async function createMinimalPptx(packageRequire, outputPath) {
  const JSZip = packageRequire('jszip');
  const zip = new JSZip();
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
        <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
        <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
        <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
        <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
      </Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
      </Relationships>`,
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
        <p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
        <p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>
      </p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      </Relationships>`,
    'ppt/slides/slide1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>
        <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
        <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="10058400" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200"/><a:t>Packaged PPTX smoke</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>
      </p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    'ppt/slideMasters/slideMaster1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
    'ppt/slideLayouts/slideLayout1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    'ppt/theme/theme1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Smoke"><a:themeElements><a:clrScheme name="Smoke"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Smoke"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Smoke"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`,
  };
  for (const [name, value] of Object.entries(files)) zip.file(name, value);
  fs.writeFileSync(outputPath, await zip.generateAsync({ type: 'nodebuffer' }));
}

function readPcm16Wav(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WAVE') {
    throw new Error('SenseVoice smoke fixture must be a PCM WAV file');
  }
  let offset = 12;
  let format;
  let data;
  while (offset + 8 <= buffer.length) {
    const id = buffer.subarray(offset, offset + 4).toString('ascii');
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') format = {
      encoding: buffer.readUInt16LE(body),
      channels: buffer.readUInt16LE(body + 2),
      sampleRate: buffer.readUInt32LE(body + 4),
      bits: buffer.readUInt16LE(body + 14),
    };
    if (id === 'data') data = buffer.subarray(body, body + size);
    offset = body + size + (size % 2);
  }
  if (!format || !data || format.encoding !== 1 || format.channels !== 1 || format.bits !== 16) {
    throw new Error('SenseVoice smoke fixture must be mono PCM16 WAV');
  }
  const samples = new Float32Array(data.length / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = data.readInt16LE(index * 2) / 32768;
  return { samples, sampleRate: format.sampleRate };
}

function waitForWorker(worker, predicate, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('SenseVoice packaged worker timed out')), timeoutMs);
    const onMessage = message => {
      if (message?.type === 'error') finish(new Error(message.message || 'SenseVoice worker error'));
      else if (predicate(message)) finish(null, message);
    };
    const onError = error => finish(error);
    const finish = (error, value) => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      if (error) reject(error); else resolve(value);
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
  });
}

async function runInternal({ appPath, modelDir, audioPath }) {
  const resources = resourcesPath(appPath);
  const asarPath = path.join(resources, 'app.asar');
  const unpackedPath = path.join(resources, 'app.asar.unpacked');
  const packageRequire = createRequire(path.join(asarPath, 'package.json'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-packaged-smoke-'));
  const results = {};
  try {
    const pdfPath = path.join(tempDir, 'smoke.pdf');
    fs.writeFileSync(pdfPath, createMinimalPdf('CueUp packaged PDF smoke'));
    const { PDFParse } = packageRequire('pdf-parse');
    PDFParse.setWorker(pathToFileURL(path.join(asarPath, 'dist-electron/electron/pdf.worker.mjs')).href);
    const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });
    const parsed = await parser.getText();
    await parser.destroy();
    if (!parsed.text.includes('CueUp packaged PDF smoke')) throw new Error('Packaged PDF text mismatch');
    results.pdf = { ok: true, chars: parsed.text.trim().length };

    const pptxPath = path.join(tempDir, 'smoke.pptx');
    const pptxOutput = path.join(tempDir, 'pptx-output');
    await createMinimalPptx(packageRequire, pptxPath);
    const child = spawnSync(process.execPath, [
      path.join(asarPath, 'dist-electron/electron/services/knowledge/pptx/pptx-render-child.mjs'),
      pptxPath,
      pptxOutput,
      path.join(resources, 'fonts'),
    ], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (child.status !== 0) throw new Error(`Packaged PPTX renderer failed (${child.status}): ${child.stderr.trim()}`);
    const renderedSlides = fs.readdirSync(pptxOutput).filter(name => name.endsWith('.jpg'));
    if (renderedSlides.length !== 1) throw new Error(`Expected one rendered PPTX slide, got ${renderedSlides.length}`);
    results.pptx = { ok: true, slideCount: renderedSlides.length };

    if (process.platform === 'win32') packageRequire('sherpa-onnx-node');

    const transformersPath = path.join(asarPath, 'node_modules/@huggingface/transformers/dist/transformers.node.mjs');
    const { pipeline, env } = await import(pathToFileURL(transformersPath).href);
    env.cacheDir = path.join(resources, 'models');
    env.localModelPath = path.join(resources, 'models');
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.proxy = true;
    const embedder = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
      local_files_only: true,
      model_file_name: 'model_int8',
    });
    const embedding = await embedder('packaged embedding smoke', { pooling: 'mean', normalize: true });
    if (embedding.data.length !== 384) throw new Error(`Expected 384 embedding dimensions, got ${embedding.data.length}`);
    results.embedding = { ok: true, dimensions: embedding.data.length };

    const Database = packageRequire('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO smoke VALUES (1, \'ready\');');
    if (db.prepare('SELECT value FROM smoke WHERE id = 1').get().value !== 'ready') throw new Error('Packaged SQLite query failed');
    results.database = { ok: true };
    const vecLibrary = process.platform === 'win32'
      ? path.join(unpackedPath, 'node_modules/sqlite-vec-windows-x64/vec0.dll')
      : path.join(unpackedPath, `node_modules/sqlite-vec-darwin-${process.arch}/vec0.dylib`);
    db.loadExtension(vecLibrary);
    db.exec('CREATE VIRTUAL TABLE vectors USING vec0(embedding float[3]);');
    const vector = values => Buffer.from(new Float32Array(values).buffer);
    db.prepare('INSERT INTO vectors(rowid, embedding) VALUES (?, ?)').run(1n, vector([1, 0, 0]));
    db.prepare('INSERT INTO vectors(rowid, embedding) VALUES (?, ?)').run(2n, vector([0, 1, 0]));
    const match = db.prepare('SELECT rowid, distance FROM vectors WHERE embedding MATCH ? ORDER BY distance LIMIT 1').get(vector([0.9, 0.1, 0]));
    if (Number(match.rowid) !== 1) throw new Error('Packaged sqlite-vec RAG query returned the wrong row');
    results.rag = { ok: true, topRowId: Number(match.rowid) };
    db.close();

    const modelFile = path.join(modelDir, 'model.int8.onnx');
    const tokensFile = path.join(modelDir, 'tokens.txt');
    for (const required of [modelFile, tokensFile, audioPath]) {
      if (!fs.existsSync(required)) throw new Error(`Missing SenseVoice smoke input: ${required}`);
    }
    const { samples, sampleRate } = readPcm16Wav(audioPath);
    if (sampleRate !== 16000) throw new Error(`SenseVoice smoke fixture sample rate must be 16000, got ${sampleRate}`);
    const worker = new Worker(path.join(asarPath, 'dist-electron/electron/audio/sensevoice/senseVoiceWorker.js'));
    try {
      worker.postMessage({
        type: 'init', modelDir, modelFile, tokensFile, numThreads: 4,
        requestedProviders: ['cueup-invalid-gpu'], fallbackProvider: 'cpu', verboseLogging: false,
      });
      const ready = await waitForWorker(worker, message => message?.type === 'ready');
      worker.postMessage({ type: 'transcribe', taskId: 'packaged-smoke', samples }, [samples.buffer]);
      const transcript = await waitForWorker(worker, message => message?.type === 'result' && message.taskId === 'packaged-smoke');
      if (!String(transcript.text || '').trim()) throw new Error('Packaged SenseVoice returned an empty transcript');
      if (!ready.fallbackReason) throw new Error('Packaged SenseVoice did not report GPU fallback diagnostics');
      results.sensevoice = {
        ok: true,
        chars: String(transcript.text).trim().length,
        providerRequested: ready.providerRequested,
        providerActual: ready.providerActual,
        fallbackReason: ready.fallbackReason,
        fallbackVerified: true,
      };
    } finally {
      await worker.terminate();
    }

    return { ok: true, platform: process.platform, arch: process.arch, results };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const appPath = path.resolve(option('app') || '');
const modelDir = path.resolve(option('sensevoice-model-dir') || '');
const audioPath = path.resolve(option('audio') || '');
if (!option('app') || !option('sensevoice-model-dir') || !option('audio')) {
  console.error('Usage: node scripts/smoke-packaged-runtime.mjs --app <packaged-app> --sensevoice-model-dir <model-dir> --audio <pcm16-wav>');
  process.exit(2);
}

if (!process.argv.includes('--internal-run')) {
  const executable = appExecutable(appPath);
  const child = spawnSync(executable, [
    path.resolve(process.argv[1]), '--internal-run', '--app', appPath,
    '--sensevoice-model-dir', modelDir, '--audio', audioPath,
  ], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 360_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  process.stdout.write(child.stdout || '');
  process.stderr.write(child.stderr || '');
  process.exit(child.status ?? 1);
}

runInternal({ appPath, modelDir, audioPath })
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
