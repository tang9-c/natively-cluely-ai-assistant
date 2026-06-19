import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioRegistry } from '../../../dist-electron/electron/services/profile/scenarios/registry.js';

describe('ScenarioRegistry', () => {
  test('maps every built-in ModeTemplateType without renaming template types', () => {
    const registry = ScenarioRegistry.createDefault();

    assert.deepEqual(registry.resolveByTemplateType('sales'), {
      templateType: 'sales',
      scenarioType: 'sales',
    });
    assert.deepEqual(registry.resolveByTemplateType('looking-for-work'), {
      templateType: 'looking-for-work',
      scenarioType: 'interview',
      subScenario: 'candidate',
    });
    assert.deepEqual(registry.resolveByTemplateType('recruiting'), {
      templateType: 'recruiting',
      scenarioType: 'interview',
      subScenario: 'recruiter',
    });
    assert.deepEqual(registry.resolveByTemplateType('technical-interview'), {
      templateType: 'technical-interview',
      scenarioType: 'interview',
      subScenario: 'technical',
    });
    assert.deepEqual(registry.resolveByTemplateType('lecture'), {
      templateType: 'lecture',
      scenarioType: 'lecture',
    });
    assert.deepEqual(registry.resolveByTemplateType('team-meet'), {
      templateType: 'team-meet',
      scenarioType: 'team-meet',
    });
    assert.deepEqual(registry.resolveByTemplateType('general'), {
      templateType: 'general',
      scenarioType: 'general',
    });
  });

  test('sales adapter exposes required document subtypes from product goal', () => {
    const adapter = ScenarioRegistry.createDefault().get('sales');
    assert.deepEqual(adapter.supportedDocSubtypes, [
      'customer-profile',
      'product-intro',
      'solution-brief',
      'case-study',
      'pricing-objections',
    ]);
  });

  test('scenario adapters expose document subtypes from the scenario matrix', () => {
    const registry = ScenarioRegistry.createDefault();

    assert.deepEqual(registry.get('interview').supportedDocSubtypes, [
      'candidate-profile',
      'candidate-resume',
      'job-description',
      'company-research',
      'negotiation-script',
      'scorecard',
      'followup-script',
      'technical-spec',
      'rubric',
      'practice-problem',
    ]);
    assert.deepEqual(registry.get('lecture').supportedDocSubtypes, [
      'audience-profile',
      'outline',
      'references',
    ]);
    assert.deepEqual(registry.get('team-meet').supportedDocSubtypes, [
      'attendees',
      'agenda',
      'decision-log',
      'references',
    ]);
    assert.deepEqual(registry.get('general').supportedDocSubtypes, [
      'references',
      'context-note',
    ]);
  });

  test('scenario cards do not expose legacy document subtype names', () => {
    const legacySubtypes = new Set([
      'resume',
      'interview-plan',
      'coding-problem',
      'system-design-brief',
      'lecture-notes',
      'course-material',
      'syllabus',
      'reading',
      'project-brief',
      'meeting-notes',
      'general-reference',
    ]);

    for (const adapter of ScenarioRegistry.createDefault().list()) {
      for (const subtype of adapter.supportedDocSubtypes) {
        assert.equal(legacySubtypes.has(subtype), false, `${adapter.type} supports legacy subtype ${subtype}`);
      }
      for (const card of adapter.cards) {
        assert.equal(legacySubtypes.has(card.docSubtype), false, `${adapter.type} card uses legacy subtype ${card.docSubtype}`);
      }
    }
  });

  test('falls back to general scenario for unknown or missing template types', () => {
    const registry = ScenarioRegistry.createDefault();

    assert.deepEqual(registry.resolveByTemplateType(undefined), {
      templateType: 'general',
      scenarioType: 'general',
    });
    assert.deepEqual(registry.resolveByTemplateType('custom-discovery'), {
      templateType: 'general',
      scenarioType: 'general',
    });
  });
});
