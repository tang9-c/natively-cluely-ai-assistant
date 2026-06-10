import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ResumeParser } = require('../../../dist-electron/electron/services/profile/parsers/ResumeParser.js');

describe('ResumeParser', () => {
  it('normalizes LLM output into ResumeParsed', async () => {
    const mockLlm = {
      parse: async () => ({
        identity: { name: 'Alice', email: 'a@example.com' },
        summary: 'Staff engineer',
        skills: ['TypeScript', 'Node.js'],
        experience: [
          { title: 'Eng', organization: 'Acme', start: '2020-01', end: '2023-01', description: 'Built things' },
        ],
        projects: [{ name: 'P1', description: 'Side project' }],
        education: [{ degree: 'BS', institution: 'MIT', year: '2015' }],
      }),
    };

    const parser = new ResumeParser(mockLlm);
    const result = await parser.parse('raw resume text');

    assert.equal(result.identity.name, 'Alice');
    assert.equal(result.identity.email, 'a@example.com');
    assert.equal(result.skills.length, 2);
    assert.equal(result.experience[0].title, 'Eng');
    assert.equal(result.projects[0].name, 'P1');
    assert.equal(result.education[0].institution, 'MIT');
  });

  it('fills required arrays when LLM omits them', async () => {
    const mockLlm = {
      parse: async () => ({
        identity: { name: 'Bob' },
      }),
    };

    const parser = new ResumeParser(mockLlm);
    const result = await parser.parse('raw resume text');

    assert.equal(result.identity.name, 'Bob');
    assert.deepEqual(result.skills, []);
    assert.deepEqual(result.experience, []);
    assert.deepEqual(result.projects, []);
    assert.deepEqual(result.education, []);
  });
});
