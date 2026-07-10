// electron/services/__tests__/ScenarioContextService.deep.test.mjs
//
// Phase 6 deep coverage for ScenarioContextService. Targets public methods:
//   - buildForRequest()
//   - resolveScenarioMode() (called indirectly)
//   - getRetrievedModeContext() (called indirectly)
//   - buildMasterProfileBlock() (called indirectly)
//   - formatDocumentContext() (called indirectly via adapter)
//
// Each test isolates the deps to exercise a single branch. The registry is the
// default (only `ScenarioContextService` is exported, no `registry` knob), so
// we drive every code path by varying `activeMode.templateType` and the
// metadata/doc-subtype combinations.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);

const servicePath = path.resolve(__dirname, '../../../dist-electron/electron/services/profile/ScenarioContextService.js');

function buildDeps(overrides = {}) {
  const mode = overrides.mode ?? {
    id: 'mode_x',
    name: 'X',
    templateType: 'sales',
    customContext: '',
    isActive: true,
    createdAt: '2026-07-01T00:00:00.000Z',
  };
  const refs = overrides.refs ?? [
    {
      id: 'ref1',
      modeId: mode.id,
      fileName: 'doc.md',
      content: 'doc content',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
  ];
  const metaRows = overrides.metaRows ?? [
    {
      reference_file_id: 'ref1',
      scenario_type: 'sales',
      doc_subtype: 'case-study',
      parsed_json: null,
      file_hash: null,
    },
  ];

  return {
    modesManager: {
      getActiveMode: () => mode,
      getModes: () => [mode],
      getReferenceFiles: () => refs,
      ensureSeeded: () => {},
      buildRetrievedActiveModeContextBlockHybrid: async () =>
        overrides.hybrid ?? '',
      buildRetrievedActiveModeContextBlock: () =>
        overrides.lexical ?? '',
    },
    db: {
      getModeReferenceFileMetadataForMode: () => metaRows,
      getProfileMaster: () => overrides.profile ?? null,
      getPersona: () => '',
    },
  };
}

describe('ScenarioContextService — resolveScenarioMode fallbacks', () => {
  test('uses general mode from getModes() when active mode is null', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const generalMode = {
      id: 'mode_general',
      name: 'General',
      templateType: 'general',
      customContext: '',
      isActive: false,
      createdAt: '2026-07-01T00:00:00.000Z',
    };
    const service = new ScenarioContextService({
      modesManager: {
        getActiveMode: () => null,
        getModes: () => [generalMode],
        getReferenceFiles: () => [],
        buildRetrievedActiveModeContextBlockHybrid: async () => '',
        buildRetrievedActiveModeContextBlock: () => '',
        ensureSeeded: () => {},
      },
      db: {
        getModeReferenceFileMetadataForMode: () => [],
        getProfileMaster: () => null,
        getPersona: () => '',
      },
    });
    const result = await service.buildForRequest({ query: 'q' });
    assert.match(result.systemPromptSuffix, /general scenario/i);
  });

  test('returns empty when no active mode AND no getModes function', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService({
      modesManager: {
        getActiveMode: () => null,
        ensureSeeded: () => {},
        // no getModes — resolveScenarioMode returns null
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
    const result = await service.buildForRequest({ query: 'q' });
    assert.equal(result.systemPromptSuffix, '');
    assert.equal(result.contextBlock, '');
    assert.deepEqual(result.dataScopes, []);
  });

  test('unknown templateType falls back to DEFAULT_GENERAL_RESOLUTION', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(buildDeps({
      mode: {
        id: 'm1', name: 'm', templateType: 'no-such-template',
        isActive: true, customContext: '', createdAt: '',
      },
    }));
    const result = await service.buildForRequest({ query: 'q', includeSystemPrompt: true });
    // The default resolution maps to "general" scenarioType → "general scenario" suffix.
    assert.match(result.systemPromptSuffix, /general scenario/i);
  });

  test('resolveScenarioMode: ensureSeeded called once when active is null', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    let seeded = 0;
    const generalMode = {
      id: 'mode_general', name: 'General', templateType: 'general',
      isActive: false, customContext: '', createdAt: '',
    };
    const service = new ScenarioContextService({
      modesManager: {
        getActiveMode: () => null,
        getModes: () => [generalMode],
        getReferenceFiles: () => [],
        ensureSeeded: () => { seeded += 1; },
        buildRetrievedActiveModeContextBlockHybrid: async () => '',
        buildRetrievedActiveModeContextBlock: () => '',
      },
      db: {
        getModeReferenceFileMetadataForMode: () => [],
        getProfileMaster: () => null,
        getPersona: () => '',
      },
    });
    await service.buildForRequest({ query: 'q' });
    assert.equal(seeded, 1, 'ensureSeeded should be invoked exactly once when active mode is missing');
  });
});

describe('ScenarioContextService — getRetrievedModeContext branches', () => {
  test('hybrid returning a non-empty string short-circuits (lexical never called)', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    let lexicalCalls = 0;
    const deps = buildDeps({
      hybrid: '<active_mode_retrieved_context><snippet><source>x</source><text>hybrid wins</text></snippet></active_mode_retrieved_context>',
      lexical: () => { lexicalCalls += 1; return '<should-not-appear/>'; },
    });
    // re-wrap lexical to count calls
    deps.modesManager.buildRetrievedActiveModeContextBlock = () => {
      lexicalCalls += 1;
      return '<should-not-appear/>';
    };
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });
    assert.match(result.contextBlock, /hybrid wins/);
    assert.equal(lexicalCalls, 0, 'lexical path must not be invoked when hybrid returns content');
  });

  test('hybrid returning empty string falls through to lexical', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const deps = buildDeps({
      hybrid: '',
      lexical: '<lexical-block>lexical-fired</lexical-block>',
    });
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });
    assert.match(result.contextBlock, /lexical-fired/);
  });

  test('hybrid throwing AND lexical throwing → empty retrieved, but master/doc blocks still emit', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const deps = buildDeps({
      hybrid: () => { throw new Error('hybrid boom'); },
    });
    deps.modesManager.buildRetrievedActiveModeContextBlockHybrid = async () => {
      throw new Error('hybrid boom');
    };
    deps.modesManager.buildRetrievedActiveModeContextBlock = () => {
      throw new Error('lexical boom');
    };
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });
    assert.equal(
      result.contextBlock.includes('<active_mode_retrieved_context'),
      false,
      'no retrieved context must be emitted when both paths throw',
    );
    // But scenario_documents block should still be present (from docSubtype=case-study)
    assert.match(result.contextBlock, /<scenario-document/);
  });
});

describe('ScenarioContextService — buildMasterProfileBlock field combinations', () => {
  test('omits block when only contact_info_json is present (no displayName/headline/summary/skills/experience)', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const deps = buildDeps({
      profile: {
        display_name: '',
        headline: '',
        summary: '',
        contact_info_json: JSON.stringify({ email: 'x@y.com' }),
        experience_json: '[]',
        skills_json: '[]',
      },
    });
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });
    assert.equal(result.contextBlock.includes('<profile_master'), false,
      'profile_master should be omitted when no displayable content exists');
  });

  test('renders contact_info even when other fields are empty (but display_name must exist)', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const deps = buildDeps({
      profile: {
        display_name: 'Solo',
        headline: '',
        summary: '',
        contact_info_json: JSON.stringify({ email: 'solo@x.com' }),
        experience_json: '[]',
        skills_json: '[]',
      },
    });
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });
    assert.match(result.contextBlock, /<profile_master/);
    assert.match(result.contextBlock, /solo@x\.com/);
    assert.ok(result.dataScopes.includes('profile_history'));
  });

  test('renders skills array when present, dropping invalid skills_json gracefully', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const deps = buildDeps({
      profile: {
        display_name: 'S',
        headline: 'h',
        summary: 's',
        contact_info_json: '{}',
        experience_json: '[]',
        skills_json: '[{"name":"Go"},{"name":"Rust"}]',
      },
    });
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });
    assert.match(result.contextBlock, /Go/);
    assert.match(result.contextBlock, /Rust/);
  });

  test('rendered JSON is XML-escaped (angle brackets in summary become &lt;)', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const deps = buildDeps({
      profile: {
        display_name: '<weird>',
        headline: '',
        summary: 'A < B > C & "ok"',
        contact_info_json: '{}',
        experience_json: '[]',
        skills_json: '[]',
      },
    });
    const service = new ScenarioContextService(deps);
    const result = await service.buildForRequest({ query: 'q' });
    // XML entities
    assert.match(result.contextBlock, /&lt;weird&gt;/);
    assert.match(result.contextBlock, /A &lt; B &gt; C &amp; /);
    // raw < in summary must NOT appear inside the profile_master JSON payload
    const m = result.contextBlock.match(/<profile_master[^>]*>([^<]*)<\/profile_master>/);
    assert.ok(m, 'profile_master block should be present');
    assert.equal(m[1].includes('<weird>'), false,
      'raw angle brackets must be escaped');
  });

  test('negative or non-numeric masterProfileMaxChars falls back to 4000 default', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const deps = buildDeps({
      profile: {
        display_name: 'X',
        headline: '',
        summary: 'short',
        contact_info_json: '{}',
        experience_json: '[]',
        skills_json: '[]',
      },
    });
    // negative should be replaced with default
    const service = new ScenarioContextService({ ...deps, masterProfileMaxChars: -5 });
    const result = await service.buildForRequest({ query: 'q' });
    assert.match(result.contextBlock, /<profile_master/);
  });
});

describe('ScenarioContextService — formatDocumentContext across scenario types', () => {
  test('emits scenario-document for case-study sales', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(buildDeps({
      metaRows: [{ reference_file_id: 'ref1', scenario_type: 'sales', doc_subtype: 'case-study', parsed_json: null, file_hash: null }],
    }));
    const result = await service.buildForRequest({ query: 'q' });
    assert.match(result.contextBlock, /<scenario-document[^>]*scenario="sales"[^>]*subtype="case-study"/);
  });

  test('emits scenario-document for memo/team-meet (different scenario type)', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(buildDeps({
      mode: { id: 'm', name: 't', templateType: 'team-meet', isActive: true, customContext: '', createdAt: '' },
      metaRows: [{ reference_file_id: 'ref1', scenario_type: 'team-meet', doc_subtype: 'agenda', parsed_json: null, file_hash: null }],
    }));
    const result = await service.buildForRequest({ query: 'q' });
    assert.match(result.contextBlock, /<scenario-document[^>]*scenario="team-meet"[^>]*subtype="agenda"/);
  });

  test('document content is XML-escaped inside <scenario-document>', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(buildDeps({
      refs: [{
        id: 'ref1', modeId: 'mode_x', fileName: 'x.md',
        content: 'A & B <ok>',
        createdAt: '2026-07-01',
      }],
    }));
    const result = await service.buildForRequest({ query: 'q' });
    assert.match(result.contextBlock, /A &amp; B &lt;ok&gt;/);
    // raw <ok> must not appear inside <scenario-document>
    const block = result.contextBlock.match(/<scenario-document[^>]*>([\s\S]*?)<\/scenario-document>/);
    assert.ok(block, 'scenario-document should exist');
    assert.equal(block[1].includes('<ok>'), false);
  });

  test('title and source attributes appear in scenario-document tag', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(buildDeps({
      refs: [{
        id: 'ref1', modeId: 'mode_x', fileName: 'pricing-cheatsheet.md',
        content: 'pricing details',
        createdAt: '2026-07-01',
      }],
      metaRows: [{ reference_file_id: 'ref1', scenario_type: 'sales', doc_subtype: 'pricing-objections', parsed_json: null, file_hash: null }],
    }));
    const result = await service.buildForRequest({ query: 'q' });
    assert.match(result.contextBlock, /title="pricing-cheatsheet\.md"/);
    assert.match(result.contextBlock, /source="pricing-cheatsheet\.md"/);
  });

  test('refs whose scenario_type mismatches the active template are filtered out', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(buildDeps({
      mode: { id: 'm', name: 's', templateType: 'sales', isActive: true, customContext: '', createdAt: '' },
      refs: [
        { id: 'a', modeId: 'm', fileName: 'a.md', content: 'sales-only', createdAt: '' },
        { id: 'b', modeId: 'm', fileName: 'b.md', content: 'team-meet-only', createdAt: '' },
      ],
      metaRows: [
        { reference_file_id: 'a', scenario_type: 'sales', doc_subtype: 'case-study', parsed_json: null, file_hash: null },
        { reference_file_id: 'b', scenario_type: 'team-meet', doc_subtype: 'agenda', parsed_json: null, file_hash: null },
      ],
    }));
    const result = await service.buildForRequest({ query: 'q' });
    assert.match(result.contextBlock, /sales-only/);
    assert.equal(result.contextBlock.includes('team-meet-only'), false);
  });

  test('null content falls back to empty string in scenario-document', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(buildDeps({
      refs: [{
        id: 'ref1', modeId: 'mode_x', fileName: 'no-content.md',
        content: null,  // explicit null
        createdAt: '2026-07-01',
      }],
    }));
    const result = await service.buildForRequest({ query: 'q' });
    // The scenario-document block should still be present (no throw)
    assert.match(result.contextBlock, /<scenario-document/);
  });

  test('dataScopes includes reference_files when scenario_documents block is emitted', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(buildDeps());
    const result = await service.buildForRequest({ query: 'q' });
    assert.ok(result.dataScopes.includes('reference_files'));
  });

  test('dataScopes is empty when neither retrieved nor docs nor profile are present', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService({
      modesManager: {
        getActiveMode: () => ({
          id: 'm1', name: 'g', templateType: 'general',
          isActive: true, customContext: '', createdAt: '',
        }),
        getReferenceFiles: () => [],
        ensureSeeded: () => {},
        buildRetrievedActiveModeContextBlockHybrid: async () => '',
        buildRetrievedActiveModeContextBlock: () => '',
      },
      db: {
        getModeReferenceFileMetadataForMode: () => [],
        getProfileMaster: () => null,
        getPersona: () => '',
      },
    });
    const result = await service.buildForRequest({ query: 'q' });
    assert.deepEqual(result.dataScopes, []);
  });
});

describe('ScenarioContextService — interview scenario subScenario suffix', () => {
  test('recruiting template uses recruiter sub-scenario suffix', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(buildDeps({
      mode: { id: 'm', name: 'r', templateType: 'recruiting', isActive: true, customContext: '', createdAt: '' },
    }));
    const result = await service.buildForRequest({ query: 'q', includeSystemPrompt: true });
    assert.match(result.systemPromptSuffix, /recruiter perspective/i);
  });

  test('technical-interview template uses technical sub-scenario suffix', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(buildDeps({
      mode: { id: 'm', name: 't', templateType: 'technical-interview', isActive: true, customContext: '', createdAt: '' },
    }));
    const result = await service.buildForRequest({ query: 'q', includeSystemPrompt: true });
    assert.match(result.systemPromptSuffix, /technical interview scenario/i);
  });

  test('looking-for-work template uses candidate perspective suffix', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    const service = new ScenarioContextService(buildDeps({
      mode: { id: 'm', name: 'l', templateType: 'looking-for-work', isActive: true, customContext: '', createdAt: '' },
    }));
    const result = await service.buildForRequest({ query: 'q', includeSystemPrompt: true });
    assert.match(result.systemPromptSuffix, /candidate perspective/i);
  });

  test('long transcript is forwarded to retrieval context (no truncation)', async () => {
    const { ScenarioContextService } = cjsRequire(servicePath);
    let receivedQuery;
    let receivedTranscript;
    const deps = buildDeps();
    deps.modesManager.buildRetrievedActiveModeContextBlockHybrid = async (q, t) => {
      receivedQuery = q;
      receivedTranscript = t;
      return '<retrieved/>';
    };
    const service = new ScenarioContextService(deps);
    const longTranscript = 'A'.repeat(8000);
    await service.buildForRequest({ query: 'Q', transcript: longTranscript, tokenBudget: 500 });
    assert.equal(receivedQuery, 'Q');
    assert.equal(receivedTranscript, longTranscript);
    assert.equal(receivedTranscript.length, 8000);
  });
});