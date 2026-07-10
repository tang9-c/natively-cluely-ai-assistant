// electron/services/__tests__/ModesManager.comprehensive.test.mjs
//
// Phase 5 — supplemental coverage for ModesManager (currently 39.63% lines).
// The existing ModesManager.test.mjs covers CRUD, intent keyword sanitization,
// the buildActiveModeContextBlock, premium-intercept gate, and prompt-suffix
// stripping. This file pins the remaining public surface:
//   - ensureSeeded: idempotent seeding of all built-in templates
//   - deleteMode: removes the mode row
//   - setActiveMode: switching the active pointer, including setActiveMode(null)
//   - addReferenceFile / deleteReferenceFile: ref-file CRUD
//   - addNoteSection / updateNoteSection / deleteNoteSection / removeAllNoteSections
//   - getModes: always returns 'general' first regardless of createdAt
//   - getActiveMode: returns null when no mode is active
//   - resetModeIntentKeywords: returns [] for an unknown mode id
//   - buildRetrievedActiveModeContextBlock: lexical retrieval block
//   - buildSummarySafeModeContextBlock: opt-out flag controls reference snippets
//   - buildSummarySafeModeContextBlock: returns '' for an unknown modeId

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modesPath = path.resolve(__dirname, '../../../dist-electron/electron/services/ModesManager.js');
const databasePath = path.resolve(__dirname, '../../../dist-electron/electron/db/DatabaseManager.js');

const modesMod = await import(pathToFileURL(modesPath).href);
const databaseMod = await import(pathToFileURL(databasePath).href);

const { ModesManager, MODE_TEMPLATES, TEMPLATE_NOTE_SECTIONS, DEFAULT_MODE_CUSTOM_CONTEXT_BY_TEMPLATE } = modesMod;
const { DatabaseManager } = databaseMod;

const BASE_TIME = '2026-05-14T00:00:00.000Z';

function modeRow({ id, template_type, name = template_type, custom_context = '', is_active = 0, created_at = BASE_TIME }) {
  return { id, name, template_type, custom_context, is_active, created_at };
}

function referenceRow({ id, mode_id, file_name, content, created_at = BASE_TIME }) {
  return { id, mode_id, file_name, content, created_at };
}

function sectionRow({ id, mode_id, title, description = '', sort_order = 0, created_at = BASE_TIME }) {
  return { id, mode_id, title, description, sort_order, created_at };
}

function makeDb({ modes = [], files = [], sections = [] } = {}) {
  return {
    modes: [...modes],
    files: [...files],
    sections: [...sections],
    calls: {
      addNoteSection: [],
      updateNoteSection: [],
      deleteNoteSection: [],
      deleteAllNoteSections: [],
      addReferenceFile: [],
      deleteReferenceFile: [],
      deleteMode: [],
      setActiveMode: [],
    },
    getModes() {
      return this.modes;
    },
    getActiveMode() {
      return this.modes.find(mode => mode.is_active === 1) ?? null;
    },
    getReferenceFiles(modeId) {
      return this.files.filter(file => file.mode_id === modeId);
    },
    createMode(mode) {
      this.modes.push(modeRow({
        id: mode.id,
        name: mode.name,
        template_type: mode.templateType,
        custom_context: mode.customContext ?? '',
      }));
    },
    updateMode(id, updates) {
      const mode = this.modes.find(row => row.id === id);
      if (!mode) return;
      if (updates.name !== undefined) mode.name = updates.name;
      if (updates.templateType !== undefined) mode.template_type = updates.templateType;
      if (updates.customContext !== undefined) mode.custom_context = updates.customContext;
    },
    deleteMode(id) {
      this.calls.deleteMode.push(id);
      this.modes = this.modes.filter(mode => mode.id !== id);
      this.files = this.files.filter(file => file.mode_id !== id);
      this.sections = this.sections.filter(section => section.mode_id !== id);
    },
    setActiveMode(id) {
      this.calls.setActiveMode.push(id);
      for (const mode of this.modes) mode.is_active = mode.id === id ? 1 : 0;
    },
    getNoteSections(modeId) {
      return this.sections.filter(section => section.mode_id === modeId);
    },
    addNoteSection(section) {
      this.calls.addNoteSection.push(section);
      this.sections.push(sectionRow({
        id: section.id,
        mode_id: section.modeId,
        title: section.title,
        description: section.description ?? '',
        sort_order: section.sortOrder ?? this.sections.length,
      }));
    },
    updateNoteSection(id, updates) {
      this.calls.updateNoteSection.push({ id, updates });
      const section = this.sections.find(row => row.id === id);
      if (!section) return;
      if (updates.title !== undefined) section.title = updates.title;
      if (updates.description !== undefined) section.description = updates.description;
    },
    deleteNoteSection(id) {
      this.calls.deleteNoteSection.push(id);
      this.sections = this.sections.filter(section => section.id !== id);
    },
    deleteAllNoteSections(modeId) {
      this.calls.deleteAllNoteSections.push(modeId);
      this.sections = this.sections.filter(section => section.mode_id !== modeId);
    },
    addReferenceFile(file) {
      this.calls.addReferenceFile.push(file);
      this.files.push(referenceRow({
        id: file.id,
        mode_id: file.modeId,
        file_name: file.fileName,
        content: file.content,
      }));
    },
    deleteReferenceFile(id) {
      this.calls.deleteReferenceFile.push(id);
      this.files = this.files.filter(file => file.id !== id);
    },
    getIntentKeywords() { return []; },
    upsertIntentKeywords() {},
    resetIntentKeywords() {},
    seedDefaultIntentKeywordsForMode() {},
  };
}

let db;

function installDb(dbState) {
  db = dbState;
  ModesManager.__setDatabaseForTests?.(db);
  DatabaseManager.getInstance = () => db;
  // We deliberately do NOT reset the singleton — ModesManager.instance is
  // a private static field. `__setDatabaseForTests` already re-routes
  // getDatabase() to the freshly-installed mock on every call, so the
  // existing instance picks up the new mock automatically.
}

beforeEach(() => {
  installDb(makeDb());
});

test('ensureSeeded is idempotent — running twice yields the same eight production modes', () => {
  const manager = ModesManager.getInstance();
  manager.ensureSeeded();
  const firstCount = db.modes.length;
  const firstIds = new Set(db.modes.map(m => m.id));

  manager.ensureSeeded();

  assert.equal(db.modes.length, firstCount, 'second ensureSeeded must not create duplicates');
  assert.equal(db.modes.length, MODE_TEMPLATES.length, 'every production template should be seeded');
  for (const id of firstIds) {
    assert.ok(db.modes.find(m => m.id === id), 'previously seeded mode id must remain');
  }
});

test('ensureSeeded creates a row for every missing templateType', () => {
  // Pre-seed only 'sales'; the rest should be added.
  installDb(makeDb({
    modes: [modeRow({ id: 'pre-existing-sales', template_type: 'sales', name: 'Sales' })],
  }));
  ModesManager.getInstance().ensureSeeded();
  const types = db.modes.map(m => m.template_type).sort();
  assert.deepEqual(types, [...MODE_TEMPLATES.map(t => t.type)].sort());
});

test('deleteMode delegates to the database deleteMode', () => {
  const sales = ModesManager.getInstance().createMode({ name: 'Sales', templateType: 'sales' });
  ModesManager.getInstance().addReferenceFile({
    modeId: sales.id,
    fileName: 'pricing.md',
    content: 'Pricing content.',
  });

  ModesManager.getInstance().deleteMode(sales.id);

  assert.deepEqual(db.calls.deleteMode, [sales.id]);
  assert.equal(db.modes.find(m => m.id === sales.id), undefined);
  assert.equal(db.files.filter(f => f.mode_id === sales.id).length, 0,
    'deleting a mode should also clear its reference files');
});

test('setActiveMode(null) clears the active pointer so getActiveMode returns null', () => {
  installDb(makeDb({
    modes: [modeRow({ id: 'sales-mode', template_type: 'sales', is_active: 1 })],
  }));

  const active = ModesManager.getInstance().getActiveMode();
  assert.ok(active);

  ModesManager.getInstance().setActiveMode(null);
  assert.equal(ModesManager.getInstance().getActiveMode(), null);
  assert.deepEqual(db.calls.setActiveMode, [null]);
});

test('setActiveMode flips exclusivity — only one mode is active at a time', () => {
  installDb(makeDb({
    modes: [
      modeRow({ id: 'm-sales', template_type: 'sales', is_active: 1 }),
      modeRow({ id: 'm-team', template_type: 'team-meet', is_active: 0 }),
    ],
  }));

  ModesManager.getInstance().setActiveMode('m-team');

  const active = ModesManager.getInstance().getActiveMode();
  assert.equal(active?.id, 'm-team');
  assert.equal(active?.templateType, 'team-meet');
  // The previously active mode must have been cleared.
  assert.equal(db.modes.find(m => m.id === 'm-sales').is_active, 0);
});

test('addReferenceFile assigns a ref_ id, persists content, and returns the new file', () => {
  const sales = ModesManager.getInstance().createMode({ name: 'Sales', templateType: 'sales' });

  const ref = ModesManager.getInstance().addReferenceFile({
    modeId: sales.id,
    fileName: 'pricing.md',
    content: 'Enterprise price is $20k annually.',
  });

  assert.equal(ref.id.startsWith('ref_'), true, 'addReferenceFile should return a ref_ id');
  assert.equal(ref.modeId, sales.id);
  assert.equal(ref.fileName, 'pricing.md');
  assert.equal(ref.content, 'Enterprise price is $20k annually.');
  assert.equal(typeof ref.createdAt, 'string');

  // It should appear in getReferenceFiles for the mode.
  const files = ModesManager.getInstance().getReferenceFiles(sales.id);
  assert.equal(files.length, 1);
  assert.equal(files[0].id, ref.id);
});

test('deleteReferenceFile removes the row from the database', () => {
  const sales = ModesManager.getInstance().createMode({ name: 'Sales', templateType: 'sales' });
  const ref = ModesManager.getInstance().addReferenceFile({
    modeId: sales.id,
    fileName: 'pricing.md',
    content: 'content',
  });

  ModesManager.getInstance().deleteReferenceFile(ref.id);

  assert.deepEqual(db.calls.deleteReferenceFile, [ref.id]);
  assert.equal(db.files.find(f => f.id === ref.id), undefined);
  assert.equal(ModesManager.getInstance().getReferenceFiles(sales.id).length, 0);
});

test('addNoteSection assigns a sortOrder equal to the current section count', () => {
  const sales = ModesManager.getInstance().createMode({ name: 'Sales', templateType: 'sales' });
  // Sales template ships with 6 sections; adding a 7th should pick sortOrder=6.
  const before = ModesManager.getInstance().getNoteSections(sales.id);
  const expectedSort = before.length;

  const section = ModesManager.getInstance().addNoteSection({
    modeId: sales.id,
    title: 'New Section',
    description: 'A user-added note section.',
  });

  assert.equal(section.sortOrder, expectedSort);
  assert.equal(section.id.startsWith('ns_'), true);
  assert.equal(section.title, 'New Section');
  assert.equal(section.description, 'A user-added note section.');

  const after = ModesManager.getInstance().getNoteSections(sales.id);
  assert.equal(after.length, before.length + 1);
});

test('updateNoteSection only updates the fields the caller passes', () => {
  const sales = ModesManager.getInstance().createMode({ name: 'Sales', templateType: 'sales' });
  const [first] = ModesManager.getInstance().getNoteSections(sales.id);

  ModesManager.getInstance().updateNoteSection(first.id, { title: 'Updated Title' });

  assert.deepEqual(db.calls.updateNoteSection, [{ id: first.id, updates: { title: 'Updated Title' } }]);
  // Description is not part of the update payload, so the mock DB should not
  // have touched it (it stays in its original state).
  const refetched = ModesManager.getInstance().getNoteSections(sales.id).find(s => s.id === first.id);
  assert.equal(refetched.title, 'Updated Title');
  assert.equal(refetched.description, first.description);
});

test('deleteNoteSection removes a single section but leaves the others', () => {
  const sales = ModesManager.getInstance().createMode({ name: 'Sales', templateType: 'sales' });
  const [first, second] = ModesManager.getInstance().getNoteSections(sales.id);

  ModesManager.getInstance().deleteNoteSection(first.id);

  assert.deepEqual(db.calls.deleteNoteSection, [first.id]);
  const remaining = ModesManager.getInstance().getNoteSections(sales.id);
  assert.equal(remaining.find(s => s.id === first.id), undefined);
  assert.equal(remaining.find(s => s.id === second.id)?.id, second.id,
    'deleting one section must not affect siblings');
});

test('removeAllNoteSections clears every section for a given mode', () => {
  const sales = ModesManager.getInstance().createMode({ name: 'Sales', templateType: 'sales' });
  const recruiting = ModesManager.getInstance().createMode({ name: 'Recruiting', templateType: 'recruiting' });
  // Both modes have several default sections by now.

  ModesManager.getInstance().removeAllNoteSections(sales.id);

  assert.deepEqual(db.calls.deleteAllNoteSections, [sales.id]);
  assert.equal(ModesManager.getInstance().getNoteSections(sales.id).length, 0,
    'all sections for the targeted mode must be gone');
  assert.ok(ModesManager.getInstance().getNoteSections(recruiting.id).length > 0,
    'removing sections for one mode must not affect other modes');
});

test('getModes always returns the general template first regardless of createdAt', () => {
  installDb(makeDb({
    modes: [
      modeRow({ id: 'm-sales', template_type: 'sales', name: 'Sales', created_at: '2026-01-01T00:00:00.000Z' }),
      modeRow({ id: 'm-general', template_type: 'general', name: 'General', created_at: '2026-12-01T00:00:00.000Z' }),
      modeRow({ id: 'm-fde', template_type: 'fde', name: 'FDE', created_at: '2026-06-01T00:00:00.000Z' }),
    ],
  }));

  const modes = ModesManager.getInstance().getModes();

  assert.equal(modes[0].templateType, 'general',
    'general must always be at the top of the list, even when its createdAt is later');
  // The remaining modes should be sorted ascending by createdAt.
  const tail = modes.slice(1).map(m => m.templateType);
  assert.deepEqual(tail, ['sales', 'fde']);
});

test('getActiveMode returns null when no mode is active', () => {
  installDb(makeDb({
    modes: [
      modeRow({ id: 'm-sales', template_type: 'sales', is_active: 0 }),
      modeRow({ id: 'm-team', template_type: 'team-meet', is_active: 0 }),
    ],
  }));

  assert.equal(ModesManager.getInstance().getActiveMode(), null);
});

test('resetModeIntentKeywords returns [] for an unknown modeId without touching the DB', () => {
  const result = ModesManager.getInstance().resetModeIntentKeywords('mode_does_not_exist');
  assert.deepEqual(result, []);
});

test('buildRetrievedActiveModeContextBlock returns "" when no mode is active', () => {
  installDb(makeDb()); // no modes, no active

  const block = ModesManager.getInstance().buildRetrievedActiveModeContextBlock(
    'pricing objection handling',
    'Customer pushback on price.',
  );
  assert.equal(block, '');
});

test('buildRetrievedActiveModeContextBlock produces a non-empty XML block for the active mode', () => {
  installDb(makeDb({
    modes: [modeRow({ id: 'm-sales', template_type: 'sales', is_active: 1 })],
    files: [
      referenceRow({
        id: 'sales-pricing',
        mode_id: 'm-sales',
        file_name: 'pricing-latest.md',
        content: 'Pricing objection tactics for enterprise sales. Discount only after the security review.',
      }),
    ],
  }));

  const block = ModesManager.getInstance().buildRetrievedActiveModeContextBlock(
    'pricing objection handling',
    'Customer pushback on price.',
  );

  assert.ok(block.length > 0, 'retrieved block should be non-empty for a relevant query');
  assert.match(block, /<active_mode_retrieved_context>/);
  assert.match(block, /pricing-latest\.md/);
});

test('buildSummarySafeModeContextBlock returns "" for an unknown modeId', () => {
  assert.equal(
    ModesManager.getInstance().buildSummarySafeModeContextBlock('mode_does_not_exist'),
    '',
  );
});

test('buildSummarySafeModeContextBlock with includeReferenceSnippets=false returns only customContext', () => {
  installDb(makeDb({
    modes: [modeRow({
      id: 'm-sales',
      template_type: 'sales',
      custom_context: 'Always connect pricing to implementation risk.',
      is_active: 0, // active flag does not matter here
    })],
    files: [referenceRow({
      id: 'sales-pricing',
      mode_id: 'm-sales',
      file_name: 'pricing-latest.md',
      content: 'Pricing objection tactics for enterprise sales deals. The standard response is to tie pricing to procurement timing.',
    })],
  }));

  const block = ModesManager.getInstance().buildSummarySafeModeContextBlock('m-sales', {
    query: 'pricing objection tactics',
    transcript: 'Customer pushback on price.',
    includeReferenceSnippets: false,
  });

  // Custom context is included, reference snippet is not.
  assert.match(block, /<active_mode_custom_instructions/);
  assert.match(block, /Always connect pricing to implementation risk/);
  assert.doesNotMatch(block, /<active_mode_retrieved_context>/,
    'opt-out must suppress the retrieved context block');
});

test('buildSummarySafeModeContextBlock with default options includes both customContext and reference snippets', () => {
  installDb(makeDb({
    modes: [modeRow({
      id: 'm-sales',
      template_type: 'sales',
      custom_context: 'Always connect pricing to implementation risk.',
    })],
    files: [referenceRow({
      id: 'sales-pricing',
      mode_id: 'm-sales',
      file_name: 'pricing-latest.md',
      content: 'Pricing objection tactics for enterprise sales deals. Tie pricing to procurement timing and rollout risk.',
    })],
  }));

  const block = ModesManager.getInstance().buildSummarySafeModeContextBlock('m-sales', {
    query: 'pricing objection tactics',
    transcript: 'Customer pushback on price.',
  });

  assert.match(block, /<active_mode_custom_instructions/);
  assert.match(block, /<active_mode_retrieved_context>/);
  assert.match(block, /pricing-latest\.md/);
});

test('every production template seeds at least three default note sections', () => {
  // Pre-conditions: TEMPLATE_NOTE_SECTIONS coverage.
  for (const tmpl of MODE_TEMPLATES) {
    const sections = TEMPLATE_NOTE_SECTIONS[tmpl.type];
    assert.ok(Array.isArray(sections) && sections.length >= 3,
      `${tmpl.type} must ship with >=3 default note sections`);
  }

  // Functional check: a freshly created mode should report those sections.
  const sales = ModesManager.getInstance().createMode({ name: 'Sales', templateType: 'sales' });
  const sections = ModesManager.getInstance().getNoteSections(sales.id);
  assert.equal(sections.length, TEMPLATE_NOTE_SECTIONS.sales.length);
  // Sort orders should be 0..N-1.
  assert.deepEqual(
    sections.map(s => s.sortOrder).sort((a, b) => a - b),
    sections.map((_, i) => i),
  );
});
