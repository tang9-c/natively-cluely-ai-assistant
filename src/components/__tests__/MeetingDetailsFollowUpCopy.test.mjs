import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const draft = '下周提供 Windchill 协同演示，并确认 PLM 与 ERP 接口。';

test('follow-up draft copy provides success and failure feedback', async (t) => {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import MeetingDetails from './src/components/MeetingDetails';
        createRoot(document.getElementById('root')).render(React.createElement(MeetingDetails, {
          meeting: { id: 'copy-test', title: '复制测试', date: '2026-10-15', duration: '1:00',
            detailedSummary: { actionItems: [], keyPoints: [], followUpDraft: ${JSON.stringify(draft)} }
          }
        }));`,
      resolveDir: repoRoot,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.png': 'dataurl', '.css': 'empty' },
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.route('http://localhost/copy-test', route => route.fulfill({
    contentType: 'text/html',
    body: '<html data-theme="light"><body><div id="root"></div></body></html>',
  }));

  const render = async () => {
    await page.goto('http://localhost/copy-test');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole('heading', { name: '跟进草稿', exact: true }).waitFor();
    return page.getByRole('heading', { name: '跟进草稿', exact: true }).locator('..');
  };

  await t.test('click writes only the draft to the real clipboard and acknowledges success', async () => {
    const section = await render();
    await section.getByRole('button', { name: /复制/ }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), draft);
    await section.getByRole('button', { name: '已复制', exact: true }).waitFor({ timeout: 3000 });
  });

  await t.test('clipboard rejection shows an error and lets the user retry', async () => {
    const section = await render();
    await page.evaluate(() => {
      window.originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    });
    await section.getByRole('button', { name: /复制/ }).click();
    await page.getByRole('status').filter({ hasText: /复制失败/ }).waitFor({ timeout: 3000 });
    await page.evaluate(() => { navigator.clipboard.writeText = window.originalWriteText; });
    await section.getByRole('button', { name: /复制/ }).click();
    await section.getByRole('button', { name: '已复制', exact: true }).waitFor({ timeout: 3000 });
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), draft);
  });

  await t.test('missing clipboard API reports failure instead of silently ignoring the click', async () => {
    const section = await render();
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
    await section.getByRole('button', { name: /复制/ }).click();
    await page.getByRole('status').filter({ hasText: /复制失败/ }).waitFor({ timeout: 3000 });
  });
});
