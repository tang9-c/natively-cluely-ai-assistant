import { defineConfig } from '@playwright/test';
import production from './playwright.production.config';

// Exercise permissions UI and meeting navigation with file:// production chunks.
// Fixtures disable actual capture: these checks do not certify macOS TCC or sound.
export default defineConfig({
  ...production,
  testMatch: ['**/onboarding-theme.spec.ts', '**/onboarding-permissions.spec.ts', '**/onboarding-meeting.spec.ts'],
});
