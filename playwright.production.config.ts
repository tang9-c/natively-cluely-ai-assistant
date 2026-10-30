import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Use the actual Vite production chunks over file://, with no Vite server.
// Compile the main bundle with test adapters; package builds deliberately omit those adapters.
export default defineConfig<{ rendererMode: 'development' | 'production' }>({
  ...base,
  testIgnore: [],
  testMatch: ['**/onboarding-consistency.spec.ts', '**/onboarding-theme.spec.ts', '**/onboarding-production.spec.ts', '**/onboarding-qcloud.spec.ts', '**/onboarding-permissions.spec.ts'],
  use: { ...base.use, rendererMode: 'production' },
  webServer: undefined,
});
