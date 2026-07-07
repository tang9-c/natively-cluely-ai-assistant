import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { convertPptxToPng } from 'pptx-glimpse';
import { createPptxFontMapping } from './createPptxFontMapping.js';

const [inputPath, outputDir] = process.argv.slice(2);

if (!inputPath || !outputDir) {
  console.error('missing_args');
  process.exit(2);
}

await fs.mkdir(outputDir, { recursive: true });

const input = await fs.readFile(inputPath);
const report = await convertPptxToPng(input, {
  fontMapping: createPptxFontMapping(),
  logLevel: 'off',
  skipSystemFonts: true,
});
const slides = report.slides || [];

if (!Array.isArray(slides) || slides.length === 0) {
  console.error('pptx_no_slides');
  process.exit(3);
}

if (slides.length > 200) {
  console.error(`pptx_too_many_slides:${slides.length}`);
  process.exit(4);
}

for (const slide of slides) {
  const source = Buffer.isBuffer(slide.png) ? slide.png : Buffer.from(slide.png);
  const output = await sharp(source)
    .resize(640, 360, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  await fs.writeFile(
    path.join(outputDir, `slide-${String(slide.slideNumber).padStart(3, '0')}.jpg`),
    output,
  );
}

console.log(JSON.stringify({ slideCount: slides.length }));
