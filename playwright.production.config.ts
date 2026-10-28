import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Use the actual Vite production chunks over file://, with no Vite server.
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/onboarding-production.spec.ts',
  webServer: undefined,
});
