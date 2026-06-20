// electron/services/__tests__/ProfileOrchestrator.Research.test.mjs
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);

// Stub electron module before requiring any dist-electron code that
// transitively loads DatabaseManager (which calls app.getPath).
const mockElectron = {
  app: {
    getPath: (name) => {
      if (name === 'userData') {
        return path.join(os.tmpdir(), `profile-research-userdata-${process.hrtime.bigint()}`);
      }
      return os.tmpdir();
    },
    getAppPath: () => process.cwd(),
  },
};
const electronPath = cjsRequire.resolve('electron');
cjsRequire.cache[electronPath] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: mockElectron,
  children: [],
  paths: [],
};

const orchestratorPath = path.resolve(
  __dirname, '../../../dist-electron/electron/services/profile/ProfileOrchestrator.js',
);
const credsPath = path.resolve(
  __dirname, '../../../dist-electron/electron/services/CredentialsManager.js',
);

describe('ProfileOrchestrator — Research integration', () => {
  let origGetKey;
  let origTavilyEnv;

  beforeEach(() => {
    const creds = cjsRequire(credsPath);
    origGetKey = creds.getTavilyApiKey;
    origTavilyEnv = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
  });

  const restoreCreds = () => {
    const creds = cjsRequire(credsPath);
    creds.getTavilyApiKey = origGetKey;
    if (origTavilyEnv !== undefined) {
      process.env.TAVILY_API_KEY = origTavilyEnv;
    } else {
      delete process.env.TAVILY_API_KEY;
    }
  };

  test('runCompanyResearch() returns TAVILY_KEY_MISSING when no key configured', async () => {
    const creds = cjsRequire(credsPath);
    creds.getTavilyApiKey = () => null;

    const { ProfileOrchestrator } = cjsRequire(orchestratorPath);
    const o = new ProfileOrchestrator();
    const r = await o.runCompanyResearch('Apple');
    assert.equal(r.success, false);
    assert.equal(r.errorCode, 'TAVILY_KEY_MISSING');
    restoreCreds();
  });

  test('runCompanyResearch() delegates to engine when key present', async () => {
    const creds = cjsRequire(credsPath);
    creds.getTavilyApiKey = () => 'tvly-test';

    const { ProfileOrchestrator } = cjsRequire(orchestratorPath);
    const o = new ProfileOrchestrator();
    // Inject a stub engine to bypass the real one
    o.researchEngine = {
      research: async (name) => ({ success: true, dossier: { companyName: name }, cached: false }),
      clearCache: async () => 0,
    };
    const r = await o.runCompanyResearch('Apple');
    assert.equal(r.success, true);
    assert.equal(r.dossier.companyName, 'Apple');
    restoreCreds();
  });

  test('runCompanyResearch() falls back to TAVILY_API_KEY env var when no stored key', async () => {
    const creds = cjsRequire(credsPath);
    creds.getTavilyApiKey = () => null;
    process.env.TAVILY_API_KEY = 'tvly-env';

    const { ProfileOrchestrator } = cjsRequire(orchestratorPath);
    const o = new ProfileOrchestrator();
    o.researchEngine = {
      research: async (name) => ({ success: true, dossier: { companyName: name }, cached: false }),
      clearCache: async () => 0,
    };
    const r = await o.runCompanyResearch('Apple');
    assert.equal(r.success, true);
    assert.equal(r.dossier.companyName, 'Apple');
    restoreCreds();
  });

  test('getCompanyResearchEngine() returns the same instance on repeated calls', async () => {
    const creds = cjsRequire(credsPath);
    creds.getTavilyApiKey = () => 'k';
    const { ProfileOrchestrator } = cjsRequire(orchestratorPath);
    const o = new ProfileOrchestrator();
    const e1 = o.getCompanyResearchEngine();
    const e2 = o.getCompanyResearchEngine();
    assert.ok(e1);
    assert.equal(e1, e2);
    restoreCreds();
  });
});
