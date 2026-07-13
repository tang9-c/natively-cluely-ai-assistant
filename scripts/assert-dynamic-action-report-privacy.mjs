#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_KEYS = new Set([
  'transcript',
  'prompt',
  'promptBody',
  'evidence',
  'evidenceRefs',
  'excerpt',
  'providerBody',
  'providerResponse',
  'apiKey',
  'credential',
  'rawError',
]);

export function assertDynamicActionReportPrivacy({ reports, fixtures }) {
  const sensitiveValues = collectSensitiveFixtureValues(fixtures, [
    'text',
    'generatedAnswer',
    'excerpt',
    'prompt',
    'providerBody',
    'apiKey',
  ]).filter((value) => value.length >= 8);

  for (const report of reports) {
    walkJson(report, (key, value, jsonPath) => {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`privacy_forbidden_key:${jsonPath}`);
      if (typeof value === 'string' && /(?:sk|mcp|Bearer)[_-][A-Za-z0-9_-]{12,}/i.test(value)) {
        throw new Error(`privacy_credential_pattern:${jsonPath}`);
      }
    });
    const serialized = JSON.stringify(report);
    for (const sensitive of sensitiveValues) {
      if (serialized.includes(sensitive)) throw new Error('privacy_fixture_content_leaked');
    }
  }
}

export function collectSensitiveFixtureValues(value, keys, collected = []) {
  if (!value || typeof value !== 'object') return collected;
  if (Array.isArray(value)) {
    value.forEach((item) => collectSensitiveFixtureValues(item, keys, collected));
    return collected;
  }
  for (const [key, item] of Object.entries(value)) {
    if (keys.includes(key) && typeof item === 'string' && item.trim()) {
      collected.push(item.trim());
    }
    collectSensitiveFixtureValues(item, keys, collected);
  }
  return collected;
}

export function walkJson(value, visitor, jsonPath = '$') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, visitor, `${jsonPath}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${jsonPath}.${key}`;
    visitor(key, item, nextPath);
    walkJson(item, visitor, nextPath);
  }
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing_report:${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const reportDir = process.env.DYNAMIC_ACTIONS_REPORT_DIR
    ? path.resolve(process.env.DYNAMIC_ACTIONS_REPORT_DIR)
    : path.join(root, 'reports/dynamic-actions');
  try {
    assertDynamicActionReportPrivacy({
      reports: [
        readJson(path.join(reportDir, 'metrics-report.json')),
        readJson(path.join(reportDir, 'replay-report.json')),
      ],
      fixtures: readJson(path.join(root, 'tests/fixtures/dynamic-actions/continuation/sales.json')),
    });
    console.log(JSON.stringify({ reportDir, privacy: 'passed' }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
