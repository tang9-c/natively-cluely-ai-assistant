import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../../..');

function loadModule() {
  const source = fs.readFileSync(path.join(root, 'src/lib/overlayPointerHitTest.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { exports: module.exports, module });
  return module.exports;
}

test('recognizes targets inside a declared overlay interactive region', () => {
  const { isOverlayInteractiveTarget } = loadModule();
  const target = {
    closest(selector) {
      return selector === '[data-overlay-interactive]' ? { dataset: {} } : null;
    },
  };

  assert.equal(isOverlayInteractiveTarget(target), true);
});

test('rejects transparent, missing, and non-element targets', () => {
  const { isOverlayInteractiveTarget } = loadModule();

  assert.equal(isOverlayInteractiveTarget({ closest: () => null }), false);
  assert.equal(isOverlayInteractiveTarget(null), false);
  assert.equal(isOverlayInteractiveTarget({}), false);
});
