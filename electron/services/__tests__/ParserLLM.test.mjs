import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ParserLLM } = require('../../../dist-electron/electron/services/profile/parsers/ParserLLM.js');

describe('ParserLLM', () => {
  it('forwards the required reference file scope to structured generation', async () => {
    let capturedOptions;
    const mockHelper = {
      generateContentStructured: async (_prompt, options) => {
        capturedOptions = options;
        return '{"ok":true}';
      },
    };
    const parser = new ParserLLM(mockHelper);

    await parser.parse('private resume sentinel', 'schema', ['reference_files']);

    assert.deepEqual(capturedOptions?.dataScopes, ['reference_files']);
  });

  it('does not retry a data-scope policy rejection', async () => {
    let calls = 0;
    const scopeError = new Error('reference files blocked');
    scopeError.name = 'ProviderScopeError';
    const mockHelper = {
      generateContentStructured: async () => {
        calls += 1;
        throw scopeError;
      },
    };
    const parser = new ParserLLM(mockHelper);

    await assert.rejects(
      () => parser.parse('private resume sentinel', 'schema', ['reference_files']),
      error => error === scopeError,
    );
    assert.equal(calls, 1);
  });

  it('does not write model response content to logs', async () => {
    const sentinel = 'PRIVATE_RESUME_RESPONSE_7F3A';
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.map(String).join(' '));
    try {
      const parser = new ParserLLM({
        generateContentStructured: async () => `{"summary":"${sentinel}"}`,
      });
      await parser.parse('prompt', 'schema', ['reference_files']);
    } finally {
      console.log = originalLog;
    }

    assert.doesNotMatch(logs.join('\n'), new RegExp(sentinel));
  });

  it('parses a JSON object from a plain string response', async () => {
    const mockHelper = {
      generateContentStructured: async () => '{"name":"Alice","age":30}',
    };
    const parser = new ParserLLM(mockHelper);
    const result = await parser.parse('prompt', 'schema');
    assert.equal(result.name, 'Alice');
    assert.equal(result.age, 30);
  });

  it('parses JSON from a markdown fenced response', async () => {
    const mockHelper = {
      generateContentStructured: async () => '```json\n{"name":"Bob"}\n```',
    };
    const parser = new ParserLLM(mockHelper);
    const result = await parser.parse('prompt', 'schema');
    assert.equal(result.name, 'Bob');
  });

  it('retries once and returns valid JSON on second attempt', async () => {
    let calls = 0;
    const mockHelper = {
      generateContentStructured: async () => {
        calls += 1;
        return calls === 1 ? 'not json' : '{"ok":true}';
      },
    };
    const parser = new ParserLLM(mockHelper);
    const result = await parser.parse('prompt', 'schema');
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  });

  it('throws after two failed attempts', async () => {
    const mockHelper = {
      generateContentStructured: async () => 'still not json',
    };
    const parser = new ParserLLM(mockHelper);
    await assert.rejects(() => parser.parse('prompt', 'schema'));
  });

  it('times out when generateContentStructured hangs', async () => {
    const previousTimeout = process.env.NATIVELY_PARSER_TIMEOUT_MS;
    const previousUnref = process.env.NATIVELY_PARSER_TIMEOUT_UNREF;
    process.env.NATIVELY_PARSER_TIMEOUT_MS = '10';
    process.env.NATIVELY_PARSER_TIMEOUT_UNREF = '0';

    const mockHelper = {
      generateContentStructured: () => new Promise(() => {}),
    };
    const parser = new ParserLLM(mockHelper);
    try {
      await assert.rejects(() => parser.parse('prompt', 'schema'), /timed out/);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.NATIVELY_PARSER_TIMEOUT_MS;
      } else {
        process.env.NATIVELY_PARSER_TIMEOUT_MS = previousTimeout;
      }
      if (previousUnref === undefined) {
        delete process.env.NATIVELY_PARSER_TIMEOUT_UNREF;
      } else {
        process.env.NATIVELY_PARSER_TIMEOUT_UNREF = previousUnref;
      }
    }
  });
});
