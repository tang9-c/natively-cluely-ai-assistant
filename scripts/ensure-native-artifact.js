#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const nativeModuleDir = path.join(rootDir, 'native-module');

const artifactByPlatform = {
  darwin: {
    x64: 'index.darwin-x64.node',
    arm64: 'index.darwin-arm64.node',
  },
  win32: {
    x64: 'index.win32-x64-msvc.node',
    ia32: 'index.win32-ia32-msvc.node',
    arm64: 'index.win32-arm64-msvc.node',
  },
  linux: {
    x64: 'index.linux-x64-gnu.node',
    arm64: 'index.linux-arm64-gnu.node',
  },
};

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function printMacXcodeHint() {
  const developerDir = commandOutput('xcode-select', ['-p']) || '(unavailable)';
  const xcodebuild = commandOutput('xcrun', ['--find', 'xcodebuild']);
  const hasFullXcode = developerDir.includes('/Applications/Xcode') || xcodebuild.includes('/Applications/Xcode');

  console.error(`Current developer directory: ${developerDir}`);
  if (!hasFullXcode) {
    console.error([
      'Full Xcode is required to build the macOS native audio module.',
      'Command Line Tools alone are not enough because the ScreenCaptureKit/cidre build uses xcodebuild.',
      '',
      'Fix:',
      '  1. Install Xcode from the App Store or Apple Developer downloads.',
      '  2. Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer',
      '  3. Run: npm run build:native',
      '',
      'For UI-only work, set NATIVELY_SKIP_NATIVE_CHECK=1 to bypass this preflight.',
    ].join('\n'));
  }
}

const platform = os.platform();
const arch = os.arch();
const artifactName = artifactByPlatform[platform]?.[arch];

if (process.env.NATIVELY_SKIP_NATIVE_CHECK === '1') {
  console.warn('[ensure-native-artifact] Skipping native audio artifact check because NATIVELY_SKIP_NATIVE_CHECK=1.');
  process.exit(0);
}

if (!artifactName) {
  console.warn(`[ensure-native-artifact] No native audio artifact mapping for ${platform}/${arch}; skipping check.`);
  process.exit(0);
}

const artifactPath = path.join(nativeModuleDir, artifactName);
if (fs.existsSync(artifactPath)) {
  console.log(`[ensure-native-artifact] Found ${path.relative(rootDir, artifactPath)}`);
  process.exit(0);
}

console.error(`[ensure-native-artifact] Missing required native audio artifact: ${path.relative(rootDir, artifactPath)}`);
console.error('System audio and microphone capture will fail with NATIVE_AUDIO_MODULE_UNAVAILABLE until this file exists.');

if (platform === 'darwin') {
  printMacXcodeHint();
} else {
  console.error('Run: npm run build:native');
}

process.exit(1);
