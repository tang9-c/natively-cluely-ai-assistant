#!/usr/bin/env node
/**
 * Manual QCLOUD lite32k PPTX smoke.
 *
 * This script is intentionally opt-in. It sends the first rendered slide of a
 * local PPTX fixture to QCLOUD and verifies the Markdown enhancement contract.
 *
 * Usage:
 *   NATIVELY_TEST_PPTX_VISION_KEY=... NATIVELY_TEST_PPTX_PATH=/path/to/deck.pptx npm run test:pptx-lite32k:real
 *
 * It never prints API keys or extracted slide content.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

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

if (path.extname(fixture).toLowerCase() !== '.pptx') {
  console.error('NATIVELY_TEST_PPTX_PATH must point to a .pptx file');
  process.exit(1);
}

const require = createRequire(import.meta.url);

function requireBuiltModule(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    console.error(`Failed to load ${modulePath}. Run npm run build:electron first.`);
    throw error;
  }
}

async function main() {
  const { LLMHelper } = requireBuiltModule('../dist-electron/electron/LLMHelper.js');
  const { PptxSlideRenderer } = requireBuiltModule('../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const { PptxVisionDescriptor } = requireBuiltModule('../dist-electron/electron/services/knowledge/pptx/PptxVisionDescriptor.js');

  const llm = new LLMHelper();
  llm.setNativelyKey(key);
  llm.setModel('natively');

  const renderer = new PptxSlideRenderer();
  const descriptor = new PptxVisionDescriptor(llm);
  const deck = await renderer.renderToTempImages(fixture);

  try {
    if (deck.slides.length === 0) {
      throw new Error('pptx_smoke_no_slides');
    }

    const firstSlide = deck.slides[0];
    const markdown = await descriptor.describeSlide(firstSlide.imagePath, firstSlide.slideIndex, deck.slides.length);
    const enhanced = await descriptor.enhanceMarkdown(markdown);

    if (!markdown.trim()) {
      throw new Error('pptx_smoke_empty_markdown');
    }
    if (!enhanced.summary.trim()) {
      throw new Error('pptx_smoke_empty_summary');
    }
    if (!Array.isArray(enhanced.hypotheticalQuestions) || enhanced.hypotheticalQuestions.length !== 5) {
      throw new Error('pptx_smoke_invalid_questions');
    }

    console.log(`PASS: PPTX lite32k smoke verified 1/${deck.slides.length} slide(s) from ${path.basename(fixture)}`);
  } finally {
    await deck.cleanup();
  }
}

main().catch((error) => {
  console.error(error?.message || 'PPTX lite32k smoke failed');
  process.exit(1);
});
