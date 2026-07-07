import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('PptxVisionDescriptor uses image only for markdown stage', async () => {
  const { PptxVisionDescriptor } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxVisionDescriptor.js');
  const calls = [];
  const llm = {
    generatePptxKnowledgeWithNatively: async (userMessage, systemPrompt, imagePaths) => {
      calls.push({ userMessage, systemPrompt, imagePaths });
      if (imagePaths?.length) return '# 标题\nDemo\n\n# 核心信息\nDemo';
      return JSON.stringify({
        summary: '该页介绍 Demo。',
        hypothetical_questions: ['问1', '问2', '问3', '问4', '问5'],
      });
    },
  };
  const descriptor = new PptxVisionDescriptor(llm);
  const markdown = await descriptor.describeSlide('/tmp/slide-001.jpg', 1, 1);
  const enhanced = await descriptor.enhanceMarkdown(markdown);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].imagePaths, ['/tmp/slide-001.jpg']);
  assert.equal(calls[1].imagePaths, undefined);
  assert.equal(enhanced.hypotheticalQuestions.length, 5);
});

test('PptxVisionDescriptor enhance retries once for invalid JSON then succeeds', async () => {
  const { PptxVisionDescriptor } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxVisionDescriptor.js');
  const responses = [
    'not-json',
    JSON.stringify({
      summary: '第二次成功。',
      hypothetical_questions: ['问1', '问2', '问3', '问4', '问5'],
    }),
  ];
  const calls = [];
  const llm = {
    generatePptxKnowledgeWithNatively: async (userMessage, systemPrompt, imagePaths) => {
      calls.push({ userMessage, systemPrompt, imagePaths });
      return responses.shift();
    },
  };
  const descriptor = new PptxVisionDescriptor(llm);

  const enhanced = await descriptor.enhanceMarkdown('# 标题\nDemo');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].imagePaths, undefined);
  assert.equal(calls[1].imagePaths, undefined);
  assert.equal(enhanced.summary, '第二次成功。');
  assert.equal(enhanced.hypotheticalQuestions.length, 5);
});

test('PptxVisionDescriptor enhance does not retry deterministic JSON shape errors', async () => {
  const { PptxVisionDescriptor } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxVisionDescriptor.js');
  const calls = [];
  const llm = {
    generatePptxKnowledgeWithNatively: async (userMessage, systemPrompt, imagePaths) => {
      calls.push({ userMessage, systemPrompt, imagePaths });
      return JSON.stringify({
        hypothetical_questions: ['问1', '问2', '问3', '问4', '问5'],
      });
    },
  };
  const descriptor = new PptxVisionDescriptor(llm);

  await assert.rejects(
    () => descriptor.enhanceMarkdown('# 标题\nDemo'),
    /pptx_enhance_missing_summary/,
  );
  assert.equal(calls.length, 1);
});
