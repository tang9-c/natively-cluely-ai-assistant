import fs from 'fs';
import path from 'path';
import { DynamicActionEngine } from '../dynamic-actions/DynamicActionEngine';
import type {
  DynamicActionProductFixture,
  DynamicActionProductFixtureResult,
} from '../dynamic-actions/DynamicActionProductFixtures';
import { scoreDynamicActionProductFixtures } from '../dynamic-actions/DynamicActionProductFixtures';

export interface ProductRunnerInput {
  fixtureDir: string;
  outputDir: string;
}

export interface ProductRunnerReport {
  totalFixtures: number;
  results: DynamicActionProductFixtureResult[];
  score: ReturnType<typeof scoreDynamicActionProductFixtures>;
}

export function loadProductFixtures(fixtureDir: string): DynamicActionProductFixture[] {
  const files = ['sales.json', 'fde.json', 'team-meet.json'];
  return files.flatMap((file) => {
    const parsed = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8')) as DynamicActionProductFixture[];
    for (const fixture of parsed) validateFixture(fixture);
    return parsed;
  });
}

export async function runDynamicActionProductFixtures(input: ProductRunnerInput): Promise<ProductRunnerReport> {
  const fixtures = loadProductFixtures(input.fixtureDir);
  const engine = new DynamicActionEngine();
  const results: DynamicActionProductFixtureResult[] = [];

  for (const fixture of fixtures) {
    const transcript = fixture.transcriptTurns.map((turn) => turn.text).join('\n');
    const actions = engine.detectActions({
      transcript,
      modeTemplateType: fixture.modeTemplateType,
      modeId: fixture.modeTemplateType,
      sessionId: `fixture-${fixture.id}`,
      language: fixture.language,
    });
    const matchedAction = fixture.expected.actionType
      ? actions.find((action) => action.type === fixture.expected.actionType)
      : undefined;
    const firstAction = matchedAction ?? actions[0];
    results.push({
      fixtureId: fixture.id,
      shouldEmit: fixture.expected.shouldEmit,
      emitted: actions.length > 0,
      actionTypeMatched: !!matchedAction || (!fixture.expected.actionType && actions.length === 0),
      outputTypeMatched: !!firstAction && (
        !fixture.expected.outputType || firstAction.productContract?.outputType === fixture.expected.outputType
      ),
    });
  }

  const score = scoreDynamicActionProductFixtures(results);
  const report = { totalFixtures: fixtures.length, results, score };
  fs.mkdirSync(input.outputDir, { recursive: true });
  fs.writeFileSync(path.join(input.outputDir, 'product-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(input.outputDir, 'product-report.md'), renderMarkdown(report));
  return report;
}

function validateFixture(fixture: DynamicActionProductFixture): void {
  if (!fixture.id || !fixture.modeTemplateType || !Array.isArray(fixture.transcriptTurns)) {
    throw new Error(`Invalid dynamic action product fixture: ${fixture.id ?? 'unknown'}`);
  }
  if (!fixture.expected || typeof fixture.expected.shouldEmit !== 'boolean') {
    throw new Error(`Invalid dynamic action product expectation: ${fixture.id}`);
  }
  if ((fixture as any).mode || (fixture as any).expectedActions) {
    throw new Error(`Fixture uses obsolete Step 5 schema: ${fixture.id}`);
  }
}

function renderMarkdown(report: ProductRunnerReport): string {
  return [
    '# Dynamic Action Product Report',
    '',
    `Total fixtures: ${report.totalFixtures}`,
    `Recall: ${report.score.recallNumerator}/${report.score.recallDenominator} (${formatRate(report.score.recallRate)})`,
    `False positives: ${report.score.falsePositiveNumerator}/${report.score.falsePositiveDenominator} (${formatRate(report.score.falsePositiveRate)})`,
    '',
  ].join('\n');
}

function formatRate(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}
