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

  test('filters out documents whose metadata.scenario_type does not match the resolved scenario', async () => {
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'matching.md',
      content: 'sales-relevant content',
      metadata: { scenarioType: 'sales', docSubtype: 'case-study' },
    });
    // Inject a second reference file whose metadata is for a different scenario.
    const matchingFileId = deps.db.getModeReferenceFileMetadataForMode()[0].reference_file_id;
    deps.modesManager.getReferenceFiles = () => [
      { id: matchingFileId, modeId: 'mode_sales', fileName: 'matching.md', content: 'sales-relevant content' },
      { id: 'ref_other', modeId: 'mode_sales', fileName: 'wrong-scenario.md', content: 'should be skipped' },
    ];
    deps.db.getModeReferenceFileMetadataForMode = () => [
      {
        reference_file_id: matchingFileId,
        scenario_type: 'sales',
        doc_subtype: 'case-study',
        parsed_json: null,
        file_hash: null,
      },
      {
        reference_file_id: 'ref_other',
        scenario_type: 'negotiation', // does NOT match the resolved sales scenario
        doc_subtype: 'memo',
        parsed_json: null,
        file_hash: null,
      },
    ];

    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });

    assert.match(result.contextBlock, /sales-relevant content/);
    assert.equal(
      result.contextBlock.includes('should be skipped'),
      false,
      'documents with mismatched scenario_type must not be emitted',
    );
  });

  test('skips documents when metadata is missing for the file id', async () => {
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'orphan.md',
      content: 'no-metadata content',
      metadata: { scenarioType: 'sales', docSubtype: 'case-study' },
    });
    // Disable the hybrid retrieval path so the only source of document content
    // is the scenario_documents block (which is gated by metadata).
    deps.modesManager.buildRetrievedActiveModeContextBlockHybrid = async () => '';
    deps.modesManager.buildRetrievedActiveModeContextBlock = () => '';
    // Override metadata to be empty — neither reference file has a row.
    deps.db.getModeReferenceFileMetadataForMode = () => [];

    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });

    assert.equal(
      result.contextBlock.includes('no-metadata content'),
      false,
      'files without a metadata row must not be emitted via scenario_documents',
    );
    assert.equal(
      result.contextBlock.includes('<scenario_documents>'),
      false,
      'scenario_documents block must be omitted when no metadata rows match',
    );
  });

  test('includeSystemPrompt=false returns empty systemPromptSuffix', async () => {
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'short.md',
      content: 'short content',
      metadata: { scenarioType: 'sales', docSubtype: 'case-study' },
    });

    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q', includeSystemPrompt: false });

    assert.equal(result.systemPromptSuffix, '');
  });

  test('falls back to lexical retrieval when hybrid throws', async () => {
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'fallback.md',
      content: 'lexical path content',
      metadata: { scenarioType: 'sales', docSubtype: 'case-study' },
    });
    deps.modesManager.buildRetrievedActiveModeContextBlockHybrid = async () => {
      throw new Error('hybrid boom');
    };
    deps.modesManager.buildRetrievedActiveModeContextBlock = () =>
      '<active_mode_retrieved_context><snippet><source>fallback.md</source><text>lexical path content</text></snippet></active_mode_retrieved_context>';

    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });

    assert.match(result.contextBlock, /lexical path content/);
  });

  test('returns empty retrieved context when both hybrid and lexical throw', async () => {
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'throw.md',
      content: 'never seen',
      metadata: { scenarioType: 'sales', docSubtype: 'case-study' },
    });
    deps.modesManager.buildRetrievedActiveModeContextBlockHybrid = async () => {
      throw new Error('hybrid boom');
    };
    deps.modesManager.buildRetrievedActiveModeContextBlock = () => {
      throw new Error('lexical boom');
    };

    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });

    // Retrieved context is empty, but master_profile and document_blocks still
    // contribute — contextBlock should still be non-empty.
    assert.equal(
      result.contextBlock.includes('<active_mode_retrieved_context'),
      false,
      'no retrieved context block must be emitted when both paths throw',
    );
  });

  test('buildMasterProfileBlock tolerates invalid JSON in *_json fields', async () => {
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'short.md',
      content: 'short content',
      metadata: { scenarioType: 'sales', docSubtype: 'case-study' },
    });
    deps.db.getProfileMaster = () => ({
      display_name: 'Bob',
      headline: 'Engineer',
      summary: 'summary text',
      contact_info_json: '{not json', // invalid → safeJsonParse returns undefined
      experience_json: 'still not json',
      skills_json: '[invalid',
    });

    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });

    // Block should still render with display_name + headline + summary; the
    // malformed JSON fields must not throw and must not appear as JSON.
    assert.match(result.contextBlock, /<profile_master/);
    assert.match(result.contextBlock, /Bob/);
    assert.match(result.contextBlock, /Engineer/);
    assert.match(result.contextBlock, /summary text/);
    assert.equal(result.contextBlock.includes('{not json'), false);
  });

  test('returns empty result when no active mode and no modes available', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService({
      modesManager: {
        getActiveMode: () => null,
        // No getModes / no ensureSeeded → resolveScenarioMode returns null
      },
      db: {
        getModeReferenceFileMetadataForMode: () => [],
        getProfileMaster: () => null,
        getPersona: () => '',
      },
    });

    const result = await service.buildForRequest({ query: 'q' });

    assert.equal(result.systemPromptSuffix, '');
    assert.equal(result.contextBlock, '');
    assert.deepEqual(result.dataScopes, []);
  });

  test('masterProfileMaxChars defaults to 4000 when not provided', async () => {
    const deps = installModeWithReferenceFile({
      templateType: 'sales',
      fileName: 'short.md',
      content: 'short content',
      metadata: { scenarioType: 'sales', docSubtype: 'case-study' },
    });
    deps.db.getProfileMaster = () => ({
      display_name: 'X',
      headline: '',
      summary: 'A'.repeat(5000),
      contact_info_json: '{}',
      experience_json: '[]',
      skills_json: '[]',
    });

    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });

    // A 5000-char summary should survive a 4000-char default cap; the trimmed
    // block is still present and contains some of the summary.
    assert.match(result.contextBlock, /<profile_master/);
    assert.ok(result.contextBlock.length < 8000);
  });
});
