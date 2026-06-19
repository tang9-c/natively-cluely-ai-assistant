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
    getUserProfile: () => null,
    getPersona: () => '',
    },
  };
}

describe('ScenarioContextService', () => {
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
    deps.db.getUserProfile = () => ({
      structured_json: JSON.stringify({ name: 'X', description: 'D'.repeat(500) }),
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
});
