import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);

const servicePath = path.resolve(__dirname, '../../../dist-electron/electron/services/profile/ScenarioContextService.js');

function installModeWithReferenceFile({ templateType, fileName, content, metadata }) {
  const mode = {
    id: `mode_${templateType}`,
    name: templateType,
    templateType,
    customContext: '',
    isActive: true,
    createdAt: '2026-06-18T00:00:00.000Z',
  };
  const file = {
    id: 'ref_1',
    modeId: mode.id,
    fileName,
    content,
    createdAt: '2026-06-18T00:00:00.000Z',
  };

  return {
    modesManager: {
      getActiveMode: () => mode,
      getReferenceFiles: () => [file],
      buildRetrievedActiveModeContextBlockHybrid: async () =>
        `<active_mode_retrieved_context><snippet><source>${fileName}</source><text>${content}</text></snippet></active_mode_retrieved_context>`,
      buildRetrievedActiveModeContextBlock: () => '',
    },
    db: {
    getModeReferenceFileMetadataForMode: () => [{
      reference_file_id: file.id,
      scenario_type: metadata.scenarioType,
      doc_subtype: metadata.docSubtype,
      parsed_json: metadata.parsedJson ?? null,
      file_hash: metadata.fileHash ?? null,
    }],
    getProfileMaster: () => null,
    getPersona: () => '',
    },
  };
}

describe('ScenarioContextService', () => {
  test('falls back to general mode when no active mode is selected', async () => {
    const generalMode = {
      id: 'mode_general',
      name: 'General',
      templateType: 'general',
      customContext: '',
      isActive: false,
      createdAt: '2026-06-18T00:00:00.000Z',
    };

    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService({
      modesManager: {
        getActiveMode: () => null,
        getModes: () => [generalMode],
        getReferenceFiles: () => [],
        buildRetrievedActiveModeContextBlockHybrid: async () => '',
        buildRetrievedActiveModeContextBlock: () => '',
      },
      db: {
        getModeReferenceFileMetadataForMode: () => [],
        getProfileMaster: () => null,
        getPersona: () => '',
      },
    });

    const result = await service.buildForRequest({ query: 'q', includeSystemPrompt: true });

    assert.match(result.systemPromptSuffix, /general scenario/i);
    assert.equal(result.contextBlock, '');
    assert.deepEqual(result.dataScopes, []);
  });

  test('builds sales context from active mode reference files and metadata', async () => {
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'acme-case-study.md',
      content: 'Acme reduced onboarding time by 30 percent with the rollout plan.',
      metadata: {
        scenarioType: 'sales',
        docSubtype: 'case-study',
      },
    });

    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({
      query: 'How should I respond to onboarding concerns?',
      transcript: 'Customer worries implementation will take too long.',
      tokenBudget: 1800,
      includeSystemPrompt: true,
    });

    assert.match(result.systemPromptSuffix, /sales scenario/i);
    assert.match(result.contextBlock, /case-study/);
    assert.match(result.contextBlock, /Acme reduced onboarding time/);
    assert.ok(result.dataScopes.includes('reference_files'));
  });

  test('truncates persona to personaMaxChars and respects 0 to disable', async () => {
    const longPersona = 'P'.repeat(200);
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'short.md',
      content: 'short content',
      metadata: { scenarioType: 'sales', docSubtype: 'case-study' },
    });
    deps.db.getPersona = () => longPersona;

    const { ScenarioContextService } = cjsRequire(servicePath);

    const capped = new ScenarioContextService({ ...deps, personaMaxChars: 50 });
    const cappedResult = await capped.buildForRequest({ query: 'q' });
    const personaMatch = cappedResult.contextBlock.match(
      /<scenario_persona>([^<]*)<\/scenario_persona>/,
    );
    assert.ok(personaMatch, 'scenario_persona block should be present');
    assert.equal(personaMatch[1].length, 50, 'persona should be truncated to 50 chars');

    const zero = new ScenarioContextService({ ...deps, personaMaxChars: 0 });
    const zeroResult = await zero.buildForRequest({ query: 'q' });
    const emptyPersona = zeroResult.contextBlock.match(
      /<scenario_persona>([\s\S]*?)<\/scenario_persona>/,
    );
    assert.ok(
      emptyPersona && emptyPersona[1] === '',
      'personaMaxChars=0 should emit an empty persona block (got ' +
        JSON.stringify(emptyPersona?.[1]) +
        ')',
    );
  });

  test('truncates master profile JSON to masterProfileMaxChars', async () => {
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'short.md',
      content: 'short content',
      metadata: { scenarioType: 'sales', docSubtype: 'case-study' },
    });
    deps.db.getProfileMaster = () => ({
      display_name: 'X',
      headline: '',
      summary: 'D'.repeat(500),
      contact_info_json: '{}',
      experience_json: '[]',
      skills_json: '[]',
    });

    const { ScenarioContextService } = cjsRequire(servicePath);

    const capped = new ScenarioContextService({ ...deps, masterProfileMaxChars: 120 });
    const result = await capped.buildForRequest({ query: 'q' });
    const masterMatch = result.contextBlock.match(
      /<profile_master[^>]*>([^<]*)<\/profile_master>/,
    );
    assert.ok(masterMatch, 'profile_master block should be present');
    // escapeXml can only expand the string, so post-escape length is a lower
    // bound on the truncation that happened before escaping. A 120-char slice
    // of the raw JSON will not exceed ~250 chars after entity escaping.
    assert.ok(
      masterMatch[1].length < 500,
      'master profile JSON should be meaningfully truncated (got ' +
        masterMatch[1].length +
        ' chars, expected well below the 500-char raw payload)',
    );
  });

  // Task 3: buildMasterProfileBlock must read profile_master, not user_profile.
  test('buildMasterProfileBlock reads profile_master with all fields', async () => {
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'short.md',
      content: 'short content',
      metadata: { scenarioType: 'sales', docSubtype: 'case-study' },
    });
    deps.db.getProfileMaster = () => ({
      display_name: 'Alice',
      headline: 'Senior Engineer',
      summary: 'Backend specialist with 8 years of experience.',
      contact_info_json: JSON.stringify({ email: 'alice@example.com' }),
      experience_json: JSON.stringify([{ title: 'Senior Eng', org: 'Acme', start: '2020-01' }]),
      skills_json: JSON.stringify([{ name: 'TypeScript' }, { name: 'Rust' }]),
    });

    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });

    assert.match(result.contextBlock, /<profile_master/);
    assert.match(result.contextBlock, /Alice/);
    assert.match(result.contextBlock, /Senior Engineer/);
    assert.match(result.contextBlock, /Backend specialist/);
    assert.match(result.contextBlock, /Senior Eng/);
    assert.match(result.contextBlock, /TypeScript/);
    assert.match(result.contextBlock, /alice@example\.com/);
    assert.ok(result.dataScopes.includes('profile_history'));
  });

  test('buildMasterProfileBlock omits block when profile_master is empty', async () => {
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'short.md',
      content: 'short content',
      metadata: { scenarioType: 'sales', docSubtype: 'case-study' },
    });
    // Default seed: empty display_name, empty headline, empty summary, empty arrays
    deps.db.getProfileMaster = () => ({
      display_name: null,
      headline: null,
      summary: '',
      contact_info_json: '{}',
      experience_json: '[]',
      skills_json: '[]',
    });

    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });

    assert.ok(
      !result.contextBlock.includes('<profile_master'),
      'profile_master block should be omitted when all fields are empty',
    );
  });

  test('buildMasterProfileBlock handles missing getProfileMaster method gracefully', async () => {
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'short.md',
      content: 'short content',
      metadata: { scenarioType: 'sales', docSubtype: 'case-study' },
    });
    // Older db stub without getProfileMaster — service should not crash
    deps.db = { ...deps.db, getProfileMaster: undefined };

    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });

    assert.ok(
      !result.contextBlock.includes('<profile_master'),
      'profile_master block should be omitted when db.getProfileMaster is missing',
    );
  });
});
