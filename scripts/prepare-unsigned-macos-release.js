#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(repoRoot, 'release');
const appName = 'CueUp.app';
const scriptName = 'OPEN-UNSIGNED-CUEUP-MAC.sh';
const docName = 'INSTALL-UNSIGNED-MACOS.txt';

if (!fs.existsSync(releaseDir)) {
  console.log('[prepare-unsigned-macos-release] release/ not found, skipping.');
  process.exit(0);
}

const shellScript = `#!/bin/bash
set -euo pipefail

APP_NAME="${appName}"
DEFAULT_APP="/Applications/$APP_NAME"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARTIFACT_APP="$SCRIPT_DIR/mac-x64/$APP_NAME"

TARGET_APP="\${1:-}"

if [ -z "$TARGET_APP" ]; then
  if [ -d "$DEFAULT_APP" ]; then
    TARGET_APP="$DEFAULT_APP"
  elif [ -d "$ARTIFACT_APP" ]; then
    TARGET_APP="$ARTIFACT_APP"
  else
    echo "Could not find $APP_NAME automatically."
    echo "Usage: ./$(basename "$0") /path/to/$APP_NAME"
    exit 1
  fi
fi

if [ ! -d "$TARGET_APP" ]; then
  echo "App not found: $TARGET_APP"
  exit 1
fi

echo "Removing quarantine flag from:"
echo "  $TARGET_APP"
xattr -cr "$TARGET_APP"

echo
echo "Done. Opening app..."
open "$TARGET_APP"
`;

const instructions = `Unsigned macOS build helper
===========================

If macOS says "${appName}" is damaged or cannot be opened:

1. Copy ${appName} into /Applications, or keep the unpacked app under release/mac-x64/.
2. Run:

   ./${scriptName}

3. If your app lives somewhere else, pass the full path:

   ./${scriptName} "/path/to/${appName}"

What this does:
- removes the com.apple.quarantine flag from the app bundle
- opens the app after cleanup

Why this is needed:
- this build is ad-hoc signed for self-testing
- it is not notarized yet, so Gatekeeper may block first launch
`;

fs.writeFileSync(path.join(releaseDir, scriptName), shellScript, { mode: 0o755 });
fs.writeFileSync(path.join(releaseDir, docName), instructions, 'utf8');

console.log(`[prepare-unsigned-macos-release] Wrote ${scriptName} and ${docName} to release/.`);
