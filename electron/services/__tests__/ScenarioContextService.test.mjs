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
});
