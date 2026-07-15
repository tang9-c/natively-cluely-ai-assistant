import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const source = fs.readFileSync(path.join(root, 'src/components/Launcher.tsx'), 'utf8');

test('profile onboarding popover opts out of Electron drag regions', () => {
  const profileStart = source.indexOf('{showProfileOnboarding && (');
  assert.ok(profileStart >= 0, 'profile onboarding conditional should exist');
  const profileBlock = source.slice(profileStart, source.indexOf('</AnimatePresence>', profileStart));

  assert.match(profileBlock, /no-drag/);
  assert.match(profileBlock, /pointer-events-auto/);
});

test('profile onboarding actions share a persistent dismiss helper', () => {
  assert.match(source, /const dismissProfileOnboarding = \(\) => \{/);
  assert.match(source, /setShowProfileOnboarding\(false\)/);
  assert.match(source, /localStorage\.setItem\('natively_seen_profile_onboarding_v1', 'true'\)/);

  const profileButtonStart = source.indexOf('group/profile-btn');
  const profilePopoverStart = source.indexOf('{showProfileOnboarding && (');
  assert.ok(profileButtonStart >= 0, 'profile entry button should exist');
  assert.ok(profilePopoverStart > profileButtonStart, 'profile popover should follow the profile button');
  const modesButtonStart = source.indexOf('title="模式"', profilePopoverStart);
  assert.ok(modesButtonStart > profilePopoverStart, 'modes entry should follow profile onboarding');
  const profileArea = source.slice(profileButtonStart, modesButtonStart);
  const helperUses = profileArea.match(/dismissProfileOnboarding\(\)/g) ?? [];
  assert.ok(helperUses.length >= 3, 'profile button, ignore, and try actions should reuse dismiss helper');
});

test('profile onboarding exposes an explicit close button in the popover', () => {
  const profilePopoverStart = source.indexOf('{showProfileOnboarding && (');
  assert.ok(profilePopoverStart >= 0, 'profile onboarding conditional should exist');
  const profileBlock = source.slice(profilePopoverStart, source.indexOf('</AnimatePresence>', profilePopoverStart));

  assert.match(profileBlock, /aria-label="关闭档案智能提示"/);
  assert.match(profileBlock, /dismissProfileOnboarding\(\)/);
});

test('modes onboarding exposes an explicit close button in the popover', () => {
  const modesPopoverStart = source.indexOf('{showModesOnboarding && (');
  assert.ok(modesPopoverStart >= 0, 'modes onboarding conditional should exist');
  const modesBlock = source.slice(modesPopoverStart, source.indexOf('</AnimatePresence>', modesPopoverStart));

  assert.match(modesBlock, /aria-label="关闭模式提示"/);
  assert.match(modesBlock, /dismissModesOnboarding\(\)/);
});

test('delayed profile onboarding re-checks seen flag before showing', () => {
  assert.match(source, /const shouldShowProfileOnboarding = \(\) =>/);
  assert.match(source, /if \(mounted && shouldShowProfileOnboarding\(\)\) setShowProfileOnboarding\(true\)/);
});
