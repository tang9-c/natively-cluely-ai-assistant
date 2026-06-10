import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JDParser } = require('../../../dist-electron/electron/services/profile/parsers/JDParser.js');

describe('JDParser', () => {
  it('normalizes LLM output into JDParsed', async () => {
    const mockLlm = {
      parse: async () => ({
        title: 'Senior Frontend Engineer',
        company: 'Acme',
        level: 'Senior',
        location: 'Remote',
        technologies: ['React', 'TypeScript'],
        requirements: ['5+ years exp'],
        keywords: ['frontend', 'saas'],
        responsibilities: ['Build UI'],
        compensation_hint: '$150k-$200k',
        min_years_experience: 5,
      }),
    };

    const parser = new JDParser(mockLlm);
    const result = await parser.parse('raw jd text');

    assert.equal(result.title, 'Senior Frontend Engineer');
    assert.equal(result.company, 'Acme');
    assert.equal(result.level, 'Senior');
    assert.equal(result.location, 'Remote');
    assert.deepEqual(result.technologies, ['React', 'TypeScript']);
    assert.equal(result.min_years_experience, 5);
  });

  it('fills required arrays when LLM omits them', async () => {
    const mockLlm = {
      parse: async () => ({
        title: 'Fullstack Engineer',
      }),
    };

    const parser = new JDParser(mockLlm);
    const result = await parser.parse('raw jd text');

    assert.equal(result.title, 'Fullstack Engineer');
    assert.deepEqual(result.technologies, []);
    assert.deepEqual(result.requirements, []);
    assert.deepEqual(result.keywords, []);
    assert.deepEqual(result.responsibilities, []);
  });
});
