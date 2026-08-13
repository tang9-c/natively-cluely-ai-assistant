#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage } from '@electron/asar';

const CPU_ARCHES = new Map([
  [0x01000007, 'x64'],
  [0x0100000c, 'arm64'],
]);

function cpuArch(cpuType) {
  return CPU_ARCHES.get(cpuType >>> 0) ?? `cpu-0x${(cpuType >>> 0).toString(16)}`;
}

export function inspectNativeBinary(buffer) {
  if (buffer.length < 8) return { format: 'unknown', arches: [] };
  const magic = buffer.readUInt32BE(0);
  if (magic === 0xfeedface || magic === 0xfeedfacf) {
    return { format: 'macho', arches: [cpuArch(buffer.readUInt32BE(4))] };
  }
  if (magic === 0xcefaedfe || magic === 0xcffaedfe) {
    return { format: 'macho', arches: [cpuArch(buffer.readUInt32LE(4))] };
  }
  if ([0xcafebabe, 0xcafebabf].includes(magic)) {
    const count = buffer.readUInt32BE(4);
    const stride = magic === 0xcafebabf ? 32 : 20;
    const arches = [];
    for (let index = 0; index < count && 8 + index * stride + 4 <= buffer.length; index += 1) {
      arches.push(cpuArch(buffer.readUInt32BE(8 + index * stride)));
    }
    return { format: 'macho', arches: [...new Set(arches)] };
  }
  if ([0xbebafeca, 0xbfbafeca].includes(magic)) {
    const count = buffer.readUInt32LE(4);
    const stride = magic === 0xbfbafeca ? 32 : 20;
    const arches = [];
    for (let index = 0; index < count && 8 + index * stride + 4 <= buffer.length; index += 1) {
      arches.push(cpuArch(buffer.readUInt32LE(8 + index * stride)));
    }
    return { format: 'macho', arches: [...new Set(arches)] };
  }
  if (buffer.subarray(0, 2).toString('ascii') === 'MZ' && buffer.length >= 0x40) {
    const peOffset = buffer.readUInt32LE(0x3c);
    if (peOffset + 6 <= buffer.length && buffer.subarray(peOffset, peOffset + 4).toString('binary') === 'PE\0\0') {
      const machine = buffer.readUInt16LE(peOffset + 4);
      const arch = machine === 0x8664
        ? 'x64'
        : machine === 0xaa64
          ? 'arm64'
          : machine === 0x014c
            ? 'x86'
            : `machine-0x${machine.toString(16)}`;
      return { format: 'pe', arches: [arch] };
    }
  }
  if (buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    return { format: 'elf', arches: [] };
  }
  return { format: 'unknown', arches: [] };
}

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const output = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() || entry.isSymbolicLink()) output.push(fullPath);
    }
  }
  return output;
}

function hasRelativeMatch(rootDir, pattern) {
  return walkFiles(rootDir).some(filePath => pattern.test(path.relative(rootDir, filePath).replaceAll(path.sep, '/')));
}

function readNativeHeader(filePath) {
  const header = Buffer.alloc(64 * 1024);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
}

function resourceRoot(appPath, platform) {
  return platform === 'darwin'
    ? path.join(appPath, 'Contents', 'Resources')
    : path.join(appPath, 'resources');
}

export function normalizeAsarEntry(entry) {
  const normalized = String(entry).replaceAll('\\', '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function isAllowedCompatibilityBinary({ appPath, filePath, platform, inspection }) {
  if (platform !== 'win32' || inspection.format !== 'pe' || inspection.arches.join(',') !== 'x86') {
    return false;
  }
  const relativePath = path.relative(appPath, filePath).replaceAll('\\', '/').toLowerCase();
  return relativePath === 'resources/elevate.exe';
}

export function validatePackagedRelease({ appPath, platform, arch }) {
  const errors = [];
  if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) {
    return { ok: false, platform, arch, errors: [`Unsupported release target: ${platform}/${arch}`] };
  }
  const resources = resourceRoot(appPath, platform);
  const unpacked = path.join(resources, 'app.asar.unpacked');
  const asarPath = path.join(resources, 'app.asar');
  const requiredPaths = [
    asarPath,
    path.join(resources, 'models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/config.json'),
    path.join(resources, 'models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tokenizer.json'),
    path.join(resources, 'models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/onnx/model_int8.onnx'),
    path.join(unpacked, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
  ];
  const nativeName = platform === 'darwin'
    ? `index.darwin-${arch}.node`
    : `index.win32-${arch}-msvc.node`;
  requiredPaths.push(path.join(unpacked, 'native-module', nativeName));
  for (const requiredPath of requiredPaths) {
    if (!fs.existsSync(requiredPath)) errors.push(`Missing required packaged asset: ${requiredPath}`);
  }

  const targetPatterns = platform === 'darwin'
    ? [
      new RegExp(`node_modules/sherpa-onnx-darwin-${arch}/sherpa-onnx\\.node$`),
      new RegExp(`node_modules/sqlite-vec-darwin-${arch}/vec0\\.dylib$`),
      new RegExp(`node_modules/@napi-rs/canvas-darwin-${arch}/.+\\.node$`),
      new RegExp(`node_modules/@img/sharp-darwin-${arch}/.+\\.node$`),
      new RegExp(`node_modules/onnxruntime-node/.+/darwin/${arch}/.+\\.dylib$`),
    ]
    : [
      /node_modules\/sherpa-onnx-win-x64\/sherpa-onnx\.node$/,
      /node_modules\/sqlite-vec-windows-x64\/vec0\.dll$/,
      /node_modules\/@napi-rs\/canvas-win32-x64-msvc\/.+\.node$/,
      /node_modules\/@img\/sharp-win32-x64\/.+\.node$/,
      /node_modules\/onnxruntime-node\/.+\/win32\/x64\/.+\.dll$/,
    ];
  for (const pattern of targetPatterns) {
    if (!hasRelativeMatch(unpacked, pattern)) errors.push(`Missing target runtime matching ${pattern}`);
  }

  if (fs.existsSync(asarPath)) {
    try {
      const entries = new Set(listPackage(asarPath).map(normalizeAsarEntry));
      for (const entry of [
        '/dist-electron/electron/main.js',
        '/dist-electron/electron/preload.js',
        '/dist-electron/electron/pdf.worker.mjs',
        '/dist-electron/electron/services/knowledge/pptx/pptx-render-child.mjs',
        '/dist-electron/electron/services/knowledge/pptx/createPptxFontMapping.js',
        '/dist-electron/electron/rag/vectorSearchWorker.js',
      ]) {
        if (!entries.has(entry)) errors.push(`Missing packaged runtime entry: ${entry}`);
      }
    } catch (error) {
      errors.push(`Invalid app.asar: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const nativeExtensions = platform === 'darwin' ? /\.(?:node|dylib)$/ : /\.(?:node|dll|exe)$/i;
  const expectedFormat = platform === 'darwin' ? 'macho' : 'pe';
  for (const filePath of walkFiles(appPath)) {
    let inspection;
    try {
      inspection = inspectNativeBinary(readNativeHeader(filePath));
    } catch (error) {
      if (nativeExtensions.test(filePath)) {
        errors.push(`Unreadable native binary: ${filePath} (${error instanceof Error ? error.message : String(error)})`);
      }
      continue;
    }
    const isExpectedNativeFormat = inspection.format === expectedFormat;
    if (!isExpectedNativeFormat && !nativeExtensions.test(filePath)) continue;
    const wrongPlatformOrArch = !isExpectedNativeFormat
      || inspection.arches.length === 0
      || inspection.arches.some(item => item !== arch);
    if (wrongPlatformOrArch && !isAllowedCompatibilityBinary({ appPath, filePath, platform, inspection })) {
      errors.push(`Wrong native platform/architecture: ${filePath} is ${inspection.format}/${inspection.arches.join(',') || 'unknown'}`);
    }
  }
  return { ok: errors.length === 0, platform, arch, errors };
}

function readOption(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsScript) {
  const appPath = readOption('path');
  const platform = readOption('platform');
  const arch = readOption('arch');
  if (!appPath || !platform || !arch) {
    console.error('Usage: node scripts/verify-packaged-release.mjs --path <app> --platform <darwin|win32> --arch <arm64|x64>');
    process.exit(2);
  }
  const result = validatePackagedRelease({ appPath: path.resolve(appPath), platform, arch });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
