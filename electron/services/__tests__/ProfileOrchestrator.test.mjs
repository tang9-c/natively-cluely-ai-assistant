import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const mockElectron = {
  app: {
    getPath: (name) => {
      if (name === 'userData') return path.join(os.tmpdir(), `profile-orch-userdata-${process.hrtime.bigint()}`);
      return os.tmpdir();
    },
    getAppPath: () => process.cwd(),
  },
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: mockElectron,
  children: [],
  paths: [],
};

const { ProfileOrchestrator } = require('../../../dist-electron/electron/services/profile/ProfileOrchestrator.js');
const { DocType } = require('../../../dist-electron/electron/services/profile/types.js');

describe('ProfileOrchestrator', () => {
  let orchestrator;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-orch-'));
    orchestrator = new ProfileOrchestrator();
    orchestrator.deleteDocumentsByType(DocType.RESUME);
    orchestrator.deleteDocumentsByType(DocType.JD);

    let callIndex = 0;
    const responses = [
      JSON.stringify({
        identity: { name: 'Alice', email: 'a@example.com' },
        skills: ['TypeScript'],
        experience: [{ title: 'Eng', organization: 'Acme', start: '2020-01', end: '2023-01' }],
        projects: [{ name: 'P1' }],
        education: [{ degree: 'BS', institution: 'MIT', year: '2015' }],
      }),
      JSON.stringify({
        title: 'Senior Eng',
        company: 'BigCo',
        technologies: ['Node'],
        requirements: ['5+ years'],
        keywords: ['backend'],
        responsibilities: ['Build API'],
      }),
    ];
    orchestrator.setLLMHelper({
      generateContentStructured: async () => {
        const idx = callIndex;
        callIndex += 1;
        return responses[idx] ?? '{}';
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ingests a resume and reports status', async () => {
    const filePath = path.join(tmpDir, 'resume.txt');
    fs.writeFileSync(filePath, 'Alice is an engineer at Acme from 2020 to 2023.');

    const result = await orchestrator.ingestDocument(filePath, DocType.RESUME);
    assert.equal(result.success, true);

    const status = orchestrator.getStatus();
    assert.equal(status.hasResume, true);
    assert.equal(status.resumeSummary.name, 'Alice');
    assert.equal(status.resumeSummary.role, 'Eng');

    const profile = orchestrator.getProfileData();
    assert.equal(profile.identity.name, 'Alice');
    assert.equal(profile.experienceCount, 1);
    assert.equal(profile.projectCount, 1);
    assert.equal(profile.nodeCount, 3);
    assert.deepEqual(profile.skills, ['TypeScript']);
  });

  it('ingests a JD and exposes it in profile data', async () => {
    const resumePath = path.join(tmpDir, 'resume.txt');
    fs.writeFileSync(resumePath, 'Alice is an engineer.');
    await orchestrator.ingestDocument(resumePath, DocType.RESUME);

    const jdPath = path.join(tmpDir, 'jd.txt');
    fs.writeFileSync(jdPath, 'Senior Eng at BigCo. Node, 5+ years.');

    const result = await orchestrator.ingestDocument(jdPath, DocType.JD);
    assert.equal(result.success, true);

    const profile = orchestrator.getProfileData();
    assert.equal(profile.hasActiveJD, true);
    assert.equal(profile.activeJD.title, 'Senior Eng');
    assert.equal(profile.activeJD.company, 'BigCo');
  });

  it('deletes resume by type', async () => {
    const filePath = path.join(tmpDir, 'resume.txt');
    fs.writeFileSync(filePath, 'Alice engineer.');
    await orchestrator.ingestDocument(filePath, DocType.RESUME);
    orchestrator.deleteDocumentsByType(DocType.RESUME);
    assert.equal(orchestrator.getStatus().hasResume, false);
  });

  it('returns an error for unsupported file types', async () => {
    const filePath = path.join(tmpDir, 'resume.png');
    fs.writeFileSync(filePath, 'not used');
    const result = await orchestrator.ingestDocument(filePath, DocType.RESUME);
    assert.equal(result.success, false);
  });

  it('exposes runtime methods used by main and LLMHelper', () => {
    for (const method of [
      'setLLMHelper',
      'setKnowledgeMode',
      'isKnowledgeMode',
      'processQuestion',
      'feedForDepthScoring',
      'feedInterviewerUtterance',
      'setGenerateContentFn',
      'setLiveCoachingContentFn',
      'setEmbedFn',
      'setEmbedQueryFn',
      'setCustomNotes',
      'getCustomNotes',
    ]) {
      assert.equal(typeof orchestrator[method], 'function', `${method} must exist`);
    }
  });
});
