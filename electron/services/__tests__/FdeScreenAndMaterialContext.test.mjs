import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');

test('fde plan preserves read-only business context language', () => {
  const detector = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionDetector.ts'), 'utf8');
  assert.match(detector, /read-only|只读/);
  assert.match(detector, /Do not imply automatic writes|不能.*写入|PLM.*QMS/s);
});

test('fde product contract keeps human-in-the-loop boundaries visible', () => {
  const contract = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionProductContract.ts'), 'utf8');
  assert.match(contract, /human confirmation|人工确认|read-only|只读/i);
  assert.match(contract, /fde_agent_feasibility/);
});

