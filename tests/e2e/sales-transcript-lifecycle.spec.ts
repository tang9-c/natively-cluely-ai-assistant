import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import { validateSalesTranscriptFixture } from '../utils/sales-transcript-fixture-validator.mjs';

const FIXTURE_PATH = join(
  __dirname,
  '..',
  'fixtures',
  'demo',
  '03_master_transcript',
  'sales',
  'sales_full_lifecycle_meeting.json',
);

let app: ElectronApplication;
let page: Page;
let salesFixture: ReturnType<typeof JSON.parse>;

async function findLauncherPage(electronApp: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 15_000;
  let fallback: Page | null = null;

  while (Date.now() < deadline) {
    const windows = electronApp.windows();
    fallback = fallback ?? windows[0] ?? null;

    for (const candidate of windows) {
      await candidate.waitForLoadState('domcontentloaded', { timeout: 2_000 }).catch(() => {});
      const url = candidate.url();
      let isDefaultWindow = false;
      try {
        isDefaultWindow = !new URL(url).searchParams.has('window');
      } catch {
        isDefaultWindow = false;
      }
      if (url.includes('window=launcher') || isDefaultWindow) {
        return candidate;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (fallback) return fallback;
  return electronApp.firstWindow();
}

async function setExpectedIntent(expectedIntent: string | null): Promise<void> {
  await app.evaluate((_electron, expected) => {
    (globalThis as any).__lastExpectedIntent = expected;
  }, expectedIntent);

  await page.evaluate((expected) => {
    (window as any).__lastExpectedIntent = expected;
  }, expectedIntent);
}

async function injectSegment(segment: any): Promise<void> {
  await setExpectedIntent(segment.expected_intent);

  const result = await page.evaluate(async (turn) => {
    (window as any).__lastIntentResult = undefined;
    const injected = await (window as any).electronAPI.injectTranscriptTurn({
      speaker: turn.speaker_id,
      text: turn.text,
      startMs: turn.start_ms,
      endMs: turn.end_ms,
    });
    (window as any).__lastIntentResult = injected.ok
      ? (injected.lastIntent ?? null)
      : undefined;
    return injected;
  }, segment);

  expect(result.ok, `transcript injection failed for ${segment.id}`).toBe(true);
}

test.beforeAll(async () => {
  const raw = readFileSync(FIXTURE_PATH, 'utf8');
  salesFixture = JSON.parse(raw);
  const validation = validateSalesTranscriptFixture(FIXTURE_PATH);
  if (!validation.ok) {
    throw new Error(`fixture validation failed: ${validation.errors.join('; ')}`);
  }

  app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_E2E: '1',
      ELECTRON_E2E_SKIP_AUDIO_START: '1',
    },
  });
  page = await findLauncherPage(app);

  const modeResult = await page.evaluate(async () => {
    const api = (window as any).electronAPI;
    const modes = await api.modesGetAll();
    const salesMode = modes.find((mode: any) => mode.templateType === 'sales');
    if (!salesMode) return { success: false, error: 'sales_mode_missing' };
    return api.modesSetActive(salesMode.id);
  });
  if (!modeResult.success) {
    throw new Error(`failed to activate sales mode: ${modeResult.error ?? 'unknown_error'}`);
  }
});

test.afterAll(async () => {
  await app?.close();
});

test('all sales_* intents triggered + 3 legacy intents suppressed', async () => {
  const observed = new Map<string, number>();
  for (const segment of salesFixture.segments) {
    if (segment.expected_intent === null) continue;

    await injectSegment(segment);
    await page.waitForFunction(
      () => (window as any).__lastIntentResult !== undefined,
      { timeout: 10_000 },
    );
    const intent: string | null = await page.evaluate(
      () => (window as any).__lastIntentResult,
    );
    if (intent) observed.set(intent, (observed.get(intent) ?? 0) + 1);
  }

  for (const [intent, required] of Object.entries(
    salesFixture.expected_intent_coverage as Record<string, number>,
  )) {
    if (intent === 'internal_chatter_suppression') continue;
    const actual = observed.get(intent) ?? 0;
    if (required === 0) {
      expect(actual, `legacy intent ${intent} should not trigger`).toBe(0);
    } else {
      expect(actual, `coverage for ${intent}`).toBeGreaterThanOrEqual(required);
    }
  }
});

test('internal chatter (S4) is suppressed', async () => {
  const segment036 = salesFixture.segments.find((segment: any) => segment.id === 'seg-036');
  expect(segment036, 'fixture must contain seg-036').toBeDefined();
  expect(segment036.expected_intent).toBeNull();

  await injectSegment(segment036);
  await page.waitForFunction(
    () => (window as any).__lastIntentResult !== undefined,
    { timeout: 10_000 },
  );
  const intent: string | null = await page.evaluate(
    () => (window as any).__lastIntentResult,
  );
  expect(intent).toBeNull();
});
