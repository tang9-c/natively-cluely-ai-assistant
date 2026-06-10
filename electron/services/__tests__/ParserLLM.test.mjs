import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ParserLLM } = require('../../../dist-electron/electron/services/profile/parsers/ParserLLM.js');

describe('ParserLLM', () => {
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
    const mockHelper = {
      generateContentStructured: () => new Promise(() => {}),
    };
    const parser = new ParserLLM(mockHelper);
    await assert.rejects(() => parser.parse('prompt', 'schema'), /timed out/);
  });
});
