#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const key = process.env.NATIVELY_TEST_PPTX_VISION_KEY;
const fixture = process.env.NATIVELY_TEST_PPTX_PATH;

if (!key || !fixture) {
  console.log('SKIP: set NATIVELY_TEST_PPTX_VISION_KEY and NATIVELY_TEST_PPTX_PATH to run real PPTX smoke');
  process.exit(0);
}

if (!fs.existsSync(fixture)) {
  console.error(`Fixture not found: ${fixture}`);
  process.exit(1);
}

console.log(`Real PPTX smoke is configured for ${path.basename(fixture)}. Run the app-level ingestion manually until a stable fixture is committed.`);
