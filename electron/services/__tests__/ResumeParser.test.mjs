import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ResumeParser } = require('../../../dist-electron/electron/services/profile/parsers/ResumeParser.js');

describe('ResumeParser', () => {
  it('classifies resume text as reference_files', async () => {
    let capturedScopes;
    const parser = new ResumeParser({
      parse: async (_prompt, _schema, scopes) => {
        capturedScopes = scopes;
        return { identity: { name: 'Alice' } };
      },
    });

    await parser.parse('private resume text');

    assert.deepEqual(capturedScopes, ['reference_files']);
  });

  it('does not retry a data-scope policy rejection', async () => {
    let calls = 0;
    const scopeError = new Error('reference files blocked');
    scopeError.name = 'ProviderScopeError';
    const parser = new ResumeParser({
      parse: async () => {
        calls += 1;
        throw scopeError;
      },
    });

    await assert.rejects(() => parser.parse('private resume text'), error => error === scopeError);
    assert.equal(calls, 1);
  });

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

  // Regression: LLM hallucinated a single character "安" extracted from a
  // company name "阿里巴巴" in a real-world parse. The retry loop must catch
  // this and either get a better name on retry, or fail loudly.
  describe('name validation (rejects LLM hallucinations)', () => {
    it('retries when first attempt returns a single-character name', async () => {
      let callCount = 0;
      const mockLlm = {
        parse: async () => {
          callCount += 1;
          if (callCount === 1) {
            return { identity: { name: '安' } };
          }
          return { identity: { name: '唐九辰' } };
        },
      };

      const parser = new ResumeParser(mockLlm);
      const result = await parser.parse('raw resume text');

      assert.equal(callCount, 2, 'should retry on implausible name');
      assert.equal(result.identity.name, '唐九辰');
    });

    it('retries when first attempt returns a company name', async () => {
      let callCount = 0;
      const mockLlm = {
        parse: async () => {
          callCount += 1;
          if (callCount === 1) {
            // 阿里巴巴 是 experience[].organization 之一 → 应该被拒
            return {
              identity: { name: '阿里巴巴' },
              experience: [
                { title: 'Senior Eng', organization: '阿里巴巴' },
                { title: 'Eng', organization: '字节跳动' },
              ],
            };
          }
          return { identity: { name: '李四' } };
        },
      };

      const parser = new ResumeParser(mockLlm);
      const result = await parser.parse('raw resume text');

      assert.equal(callCount, 2, 'should retry on company-like name');
      assert.equal(result.identity.name, '李四');
    });

    it('rejects names with organization keywords', async () => {
      const candidates = [
        '字节跳动科技有限公司',
        'ABC Corp.',
        'Anker Innovations',
        'Acme Studio',
        '张三工作室',
        'Acme LLC',
        'Acme Co.',
        'ByteDance Holdings',
        'Anker Labs',
        'Anker Ventures',
        'Anker Group',
      ];
      // Each one should trigger at least one rejection
      for (const badName of candidates) {
        let callCount = 0;
        const mockLlm = {
          parse: async () => {
            callCount += 1;
            if (callCount === 1) {
              return { identity: { name: badName } };
            }
            // Second call returns a real name so we can observe the retry
            return { identity: { name: '王五' } };
          },
        };
        const parser = new ResumeParser(mockLlm);
        const result = await parser.parse('raw');
        assert.equal(callCount, 2, `should retry for bad name "${badName}"`);
        assert.equal(result.identity.name, '王五', `should accept retry name for "${badName}"`);
      }
    });

    it('throws after two failed attempts with implausible names', async () => {
      const mockLlm = {
        parse: async () => ({ identity: { name: '安' } }),
      };

      const parser = new ResumeParser(mockLlm);
      await assert.rejects(
        () => parser.parse('raw resume text'),
        /Could not parse resume|skeleton|empty/i,
      );
    });

    it('accepts a 2-character Chinese name on first try', async () => {
      const mockLlm = {
        parse: async () => ({ identity: { name: '李四' } }),
      };

      const parser = new ResumeParser(mockLlm);
      const result = await parser.parse('raw');
      assert.equal(result.identity.name, '李四');
    });

    it('accepts a 4-character Chinese name on first try', async () => {
      const mockLlm = {
        parse: async () => ({ identity: { name: '欧阳修之' } }),
      };

      const parser = new ResumeParser(mockLlm);
      const result = await parser.parse('raw');
      assert.equal(result.identity.name, '欧阳修之');
    });

    it('still rejects "Unknown" placeholder (regression for existing behavior)', async () => {
      let callCount = 0;
      const mockLlm = {
        parse: async () => {
          callCount += 1;
          if (callCount === 1) {
            return { identity: { name: 'Unknown' } };
          }
          return { identity: { name: '张三' } };
        },
      };

      const parser = new ResumeParser(mockLlm);
      const result = await parser.parse('raw');
      assert.equal(callCount, 2);
      assert.equal(result.identity.name, '张三');
    });
  });
});
