import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CompanyNameExtractor } = require('../../../dist-electron/electron/services/profile/extractors/CompanyNameExtractor.js');

describe('CompanyNameExtractor', () => {
  it('classifies source documents as reference_files', async () => {
    let capturedScopes;
    const extractor = new CompanyNameExtractor({
      parse: async (_prompt, _schema, scopes) => {
        capturedScopes = scopes;
        return { companyName: 'Acme' };
      },
    });

    const result = await extractor.extract('private company document', 'company-research');

    assert.equal(result, 'Acme');
    assert.deepEqual(capturedScopes, ['reference_files']);
  });

  it('does not hide a data-scope policy rejection', async () => {
    const scopeError = new Error('reference files blocked');
    scopeError.name = 'ProviderScopeError';
    const extractor = new CompanyNameExtractor({
      parse: async () => {
        throw scopeError;
      },
    });

    await assert.rejects(
      () => extractor.extract('private company document', 'company-research'),
      error => error === scopeError,
    );
  });
});
