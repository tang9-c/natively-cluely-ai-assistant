import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';
import { DatabaseManager } from '../../../dist-electron/electron/db/DatabaseManager.js';
import { SettingsManager } from '../../../dist-electron/electron/services/SettingsManager.js';
import { ProfileDatabase } from '../../../dist-electron/electron/services/profile/ProfileDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const profileUi = fs.readFileSync(path.join(root, 'src/components/ProfileIntelligenceSettings.tsx'), 'utf8');
const popupUi = fs.readFileSync(path.join(root, 'src/components/SettingsPopup.tsx'), 'utf8');

function around(source, marker, chars = 900) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing marker: ${marker}`);
  return source.slice(start, start + chars);
}

test('SettingsManager restores its in-memory value when persistence fails', () => {
  const manager = Object.create(SettingsManager.prototype);
  manager.settings = { knowledgeMode: false };
  manager.saveSettings = () => {
    throw new Error('simulated disk full');
  };

  assert.throws(() => manager.set('knowledgeMode', true), /simulated disk full/);
  assert.equal(manager.get('knowledgeMode'), false);
});

test('profile database writes propagate storage failures', () => {
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = {
    prepare() {
      throw new Error('simulated readonly database');
    },
  };

  assert.throws(() => manager.savePersona('x'), /simulated readonly database/);
  assert.throws(() => manager.saveCustomNotes('x'), /simulated readonly database/);
  assert.throws(() => manager.saveActiveJD('raw', '{}', 'hash'), /simulated readonly database/);
});

test('ProfileDatabase rejects an unverified JD write', () => {
  const profileDb = Object.create(ProfileDatabase.prototype);
  profileDb.db = {
    saveActiveJD: () => 0,
    getActiveJD: () => null,
  };

  assert.throws(
    () => profileDb.saveJD('raw', { title: 'Engineer' }, 'hash'),
    /JD persistence verification failed/,
  );
});

test('profile text handlers persist and verify before updating runtime context', () => {
  const notes = sliceSafeHandleBlock(ipc, 'profile:save-notes');
  const persona = sliceSafeHandleBlock(ipc, 'profile:save-persona');

  assert.ok(notes.indexOf('saveCustomNotes(trimmed)') < notes.indexOf('setCustomNotes(trimmed)'));
  assert.match(notes, /getCustomNotes\(\)[\s\S]*!==\s*trimmed/);
  assert.ok(persona.indexOf('savePersona(trimmed)') < persona.indexOf('setPersonaPrompt(trimmed)'));
  assert.match(persona, /getPersona\(\)[\s\S]*!==\s*trimmed/);
});

test('profile settings UI updates destructive and toggle state only after IPC success', () => {
  const profileDelete = around(profileUi, 'profileDelete?.()');
  const profileToggle = around(profileUi, 'profileSetMode?.(newState)');
  const jdDelete = around(profileUi, 'profileDeleteJD?.()');
  const notesSave = around(profileUi, 'profileSaveNotes?.(val)');
  const popupToggle = around(popupUi, 'profileSetMode?.(newState)');

  assert.match(profileDelete, /if\s*\([^)]*\.success\)/);
  assert.match(profileToggle, /if\s*\([^)]*\.success\)/);
  assert.match(jdDelete, /if\s*\([^)]*\.success\)/);
  assert.match(notesSave, /if\s*\([^)]*\.success\)/);
  assert.ok(popupToggle.indexOf('profileSetMode?.(newState)') < popupToggle.indexOf('setProfileMode(newState)'));
  assert.match(popupToggle, /if\s*\([^)]*\.success\)/);
});

test('profile scenario uploads validate subtype and use one atomic database call', () => {
  const upload = sliceSafeHandleBlock(ipc, 'profile:upload-document');

  assert.match(upload, /supportedDocSubtypes\.includes\(/);
  assert.match(upload, /addReferenceFileWithMetadata\(/);
  assert.doesNotMatch(upload, /modesManager\.addReferenceFile\(/);
  assert.doesNotMatch(upload, /upsertModeReferenceFileMetadata\(/);
});
