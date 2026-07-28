import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/services/post-call/PostCallSummaryGenerator.js');
const {
  chunkTranscriptForSummary,
  generateFullTranscriptSummary,
} = await import(pathToFileURL(modulePath).href);

test('chunkTranscriptForSummary covers head middle and tail instead of a single leading truncation', () => {
  const head = '头部客户确认 SRM 现状。';
  const middle = '中部讨论 PLM QMS ERP 集成边界。';
  const tail = '尾部决定下周提供测试数据。';
  const context = `${head}\n${'中间填充内容。'.repeat(300)}\n${middle}\n${'更多填充内容。'.repeat(300)}\n${tail}`;

  const chunks = chunkTranscriptForSummary(context, 1000);

  assert.ok(chunks.length > 1);
  assert.ok(chunks[0].includes(head));
  assert.ok(chunks.some((chunk) => chunk.includes(middle)));
  assert.ok(chunks.at(-1).includes(tail));
});

test('generateFullTranscriptSummary summarizes every chunk before final merge', async () => {
  const calls = [];
  const llmHelper = {
    generateMeetingSummary: async (prompt, context) => {
      calls.push({ prompt, context });
      if (prompt.includes('归并')) {
        return JSON.stringify({
          overview: '完整会议覆盖头中尾',
          keyPoints: ['头部 SRM 现状', '中部集成边界', '尾部测试数据'],
          actionItems: ['客户下周提供测试数据'],
          decisions: ['第一阶段先确认集成边界'],
          openQuestions: [],
        });
      }
      return JSON.stringify({
        overview: `局部摘要 ${calls.length}`,
        keyPoints: [`片段 ${calls.length}`],
        actionItems: [],
        decisions: [],
        openQuestions: [],
      });
    },
  };

  const context = [
    '头部 SRM 现状。',
    '中段 '.repeat(900),
    '中部 PLM QMS ERP 集成边界。',
    '尾段 '.repeat(900),
    '尾部 客户下周提供测试数据。',
  ].join('\n');

  const summary = await generateFullTranscriptSummary({
    llmHelper,
    transcript: [],
    context,
    modeTemplateType: 'fde',
    modeNoteSections: [],
    modeContextBlock: '',
    baseRules: '规则：只基于会议内容。',
    groqSummaryPrompt: 'fallback',
    maxChunkChars: 1000,
  });

  assert.ok(calls.length >= 4, 'expected multiple chunk calls plus one merge call');
  assert.equal(summary.overview, '完整会议覆盖头中尾');
  assert.deepEqual(summary.actionItems, ['客户下周提供测试数据']);
  assert.deepEqual(summary.decisions, ['第一阶段先确认集成边界']);
});

test('generateFullTranscriptSummary keeps user-derived content out of system prompts', async () => {
  const calls = [];
  const llmHelper = {
    generateMeetingSummary: async (prompt, context) => {
      calls.push({ prompt, context });
      if (prompt.includes('归并')) {
        return JSON.stringify({
          overview: '完整摘要',
          sections: { '客户目标': ['客户要降低追溯成本'] },
          actionItems: [],
          decisions: [],
          openQuestions: [],
        });
      }
      return JSON.stringify({
        overview: '局部摘要包含客户要降低追溯成本',
        sections: { '客户目标': ['客户要降低追溯成本'] },
        actionItems: [],
        decisions: [],
        openQuestions: [],
      });
    },
  };

  await generateFullTranscriptSummary({
    llmHelper,
    transcript: [],
    context: '客户原文敏感内容 '.repeat(300),
    modeTemplateType: 'fde',
    modeNoteSections: [{ title: '客户目标', description: '客户目标描述' }],
    modeContextBlock: '客户资料敏感片段',
    baseRules: '规则：只基于会议内容。',
    groqSummaryPrompt: 'fallback',
    maxChunkChars: 1000,
  });

  assert.ok(calls.length > 1);
  for (const call of calls) {
    assert.ok(!call.prompt.includes('客户原文敏感内容'));
    assert.ok(!call.prompt.includes('客户资料敏感片段'));
    assert.ok(!call.prompt.includes('局部摘要包含客户要降低追溯成本'));
  }
  assert.ok(calls.some(call => call.context.includes('客户原文敏感内容')));
  assert.ok(calls.some(call => call.context.includes('客户资料敏感片段')));
  assert.ok(calls.some(call => call.context.includes('局部摘要包含客户要降低追溯成本')));
});

test('generateFullTranscriptSummary locally merges partials when final merge fails', async () => {
  const llmHelper = {
    generateMeetingSummary: async (prompt, context) => {
      if (prompt.includes('归并')) throw new Error('merge unavailable');
      if (context.includes('尾部')) {
        return JSON.stringify({
          overview: '尾部摘要',
          keyPoints: ['尾部确认验收标准'],
          actionItems: ['客户下周提供测试数据'],
          decisions: ['采用只读接入'],
          openQuestions: ['写回边界待确认'],
        });
      }
      return JSON.stringify({
        overview: '头部摘要',
        keyPoints: ['头部确认 SRM 现状'],
        actionItems: [],
        decisions: [],
        openQuestions: [],
      });
    },
  };

  const summary = await generateFullTranscriptSummary({
    llmHelper,
    transcript: [],
    context: '头部 SRM 现状。\n' + '中段 '.repeat(900) + '\n尾部 确认验收标准。',
    modeTemplateType: 'fde',
    modeNoteSections: [],
    modeContextBlock: '',
    baseRules: '规则：只基于会议内容。',
    groqSummaryPrompt: 'fallback',
    maxChunkChars: 1000,
  });

  assert.deepEqual(summary.keyPoints, ['头部确认 SRM 现状', '尾部确认验收标准']);
  assert.deepEqual(summary.actionItems, ['客户下周提供测试数据']);
  assert.deepEqual(summary.decisions, ['采用只读接入']);
  assert.deepEqual(summary.openQuestions, ['写回边界待确认']);
});

test('generateFullTranscriptSummary preserves mode section order during final merge', async () => {
  const llmHelper = {
    generateMeetingSummary: async (prompt) => {
      if (prompt.includes('归并')) {
        return JSON.stringify({
          overview: 'FDE 会议摘要',
          sections: {
            '客户目标': ['降低手工追溯成本'],
            '集成边界': ['第一阶段只读接入 PLM'],
          },
          actionItems: ['FDE 团队准备验证材料'],
          decisions: ['第一阶段只读接入 PLM'],
          openQuestions: ['写回边界待确认'],
        });
      }
      return JSON.stringify({ overview: '局部', sections: {}, actionItems: [], decisions: [], openQuestions: [] });
    },
  };

  const summary = await generateFullTranscriptSummary({
    llmHelper,
    transcript: [],
    context: '客户目标 '.repeat(500) + '集成边界 '.repeat(500),
    modeTemplateType: 'fde',
    modeNoteSections: [
      { title: '客户目标', description: '客户希望达到的业务结果' },
      { title: '集成边界', description: '系统和读写边界' },
    ],
    modeContextBlock: '',
    baseRules: '规则：只基于会议内容。',
    groqSummaryPrompt: 'fallback',
    maxChunkChars: 1000,
  });

  assert.deepEqual(summary.sections.map((section) => section.title), ['客户目标', '集成边界']);
  assert.deepEqual(summary.sections[0].bullets, ['降低手工追溯成本']);
  assert.deepEqual(summary.openQuestions, ['写回边界待确认']);
});

test('generateFullTranscriptSummary returns empty compatible structure when all LLM calls fail', async () => {
  const llmHelper = {
    generateMeetingSummary: async () => {
      throw new Error('provider unavailable');
    },
  };

  const summary = await generateFullTranscriptSummary({
    llmHelper,
    transcript: [],
    context: '有效会议内容 '.repeat(50),
    modeTemplateType: 'fde',
    modeNoteSections: [{ title: '客户目标', description: '' }],
    modeContextBlock: '',
    baseRules: '规则：只基于会议内容。',
    groqSummaryPrompt: 'fallback',
    maxChunkChars: 1000,
  });

  assert.deepEqual(summary.actionItems, []);
  assert.deepEqual(summary.keyPoints, []);
  assert.deepEqual(summary.decisions, []);
  assert.deepEqual(summary.openQuestions, []);
  assert.deepEqual(summary.sections, [{ title: '客户目标', bullets: [] }]);
});

test('generateFullTranscriptSummary sends exactly 50,000 cleaned characters in one core-budget request', async () => {
  const calls = [];
  const summary = await generateFullTranscriptSummary({
    llmHelper: {
      generateMeetingSummary: async (...args) => {
        calls.push(args);
        return JSON.stringify({ overview: '完整摘要', keyPoints: [], actionItems: [] });
      },
    },
    transcript: [],
    context: `  ${'甲'.repeat(50_000)}  `,
    modeTemplateType: 'general',
    modeNoteSections: [],
    modeContextBlock: '',
    baseRules: '规则：只基于会议内容。',
    groqSummaryPrompt: 'fallback',
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0][1], /完整会议转录：/);
  assert.deepEqual(calls[0][3], { maxOutputTokens: 4096 });
  assert.equal(summary.generationStatus, 'success');
});

for (const [label, response] of [
  ['throws', () => { throw new Error('one-shot unavailable'); }],
  ['returns empty text', () => ''],
  ['returns invalid JSON', () => '{invalid'],
]) {
  test(`generateFullTranscriptSummary falls back to chunks when a 24,001-50,000 character one-shot ${label}`, async () => {
    const calls = [];
    const summary = await generateFullTranscriptSummary({
      llmHelper: {
        generateMeetingSummary: async (...args) => {
          calls.push(args);
          if (calls.length === 1) return response();
          if (args[0].includes('归并')) {
            return JSON.stringify({ overview: '归并摘要', keyPoints: [], actionItems: [] });
          }
          return JSON.stringify({ overview: '局部摘要', keyPoints: [], actionItems: [] });
        },
      },
      transcript: [],
      context: '会议正文 '.repeat(5_000),
      modeTemplateType: 'general',
      modeNoteSections: [],
      modeContextBlock: '',
      baseRules: '规则：只基于会议内容。',
      groqSummaryPrompt: 'fallback',
    });

    assert.match(calls[0][1], /完整会议转录：/);
    assert.ok(calls.slice(1).some(([, context]) => context.includes('会议片段：')));
    assert.ok(calls.slice(1).some(([prompt]) => prompt.includes('归并')));
    assert.ok(calls.every((args) => JSON.stringify(args[3]) === JSON.stringify({ maxOutputTokens: 4096 })));
    assert.equal(summary.generationStatus, 'success');
  });
}

test('generateFullTranscriptSummary does not retry a failed one-shot at or below the chunk threshold', async () => {
  const calls = [];
  const summary = await generateFullTranscriptSummary({
    llmHelper: {
      generateMeetingSummary: async (...args) => {
        calls.push(args);
        throw new Error('one-shot unavailable');
      },
    },
    transcript: [],
    context: '会议正文 '.repeat(1_000),
    modeTemplateType: 'general',
    modeNoteSections: [],
    modeContextBlock: '',
    baseRules: '规则：只基于会议内容。',
    groqSummaryPrompt: 'fallback',
  });

  assert.equal(calls.length, 1);
  assert.equal(summary.generationStatus, 'failed');
});

test('generateFullTranscriptSummary skips the full request above 50,000 characters and ends every user context with its schema', async () => {
  const calls = [];
  const summary = await generateFullTranscriptSummary({
    llmHelper: {
      generateMeetingSummary: async (...args) => {
        calls.push(args);
        if (args[0].includes('归并')) {
          return JSON.stringify({
            overview: '完整摘要',
            sections: { 客户目标: ['降低追溯成本'] },
            actionItems: [],
            decisions: [],
            openQuestions: [],
          });
        }
        return JSON.stringify({
          overview: '局部摘要',
          sections: { 客户目标: ['降低追溯成本'] },
          actionItems: [],
          decisions: [],
          openQuestions: [],
        });
      },
    },
    transcript: [],
    context: '超长会议正文 '.repeat(10_000),
    modeTemplateType: 'fde',
    modeNoteSections: [{ title: '客户目标', description: '客户希望达到的业务结果' }],
    modeContextBlock: '模式资料',
    baseRules: '规则：只基于会议内容。',
    groqSummaryPrompt: 'fallback',
  });

  assert.ok(calls.length > 1);
  assert.ok(calls.every(([, context]) => !context.includes('完整会议转录：')));
  for (const [, context, , options] of calls) {
    assert.match(context, /--- (?:会议转录|局部摘要)结束 ---\n只返回合法 JSON，不要 markdown。\n\{[\s\S]*"客户目标": \[\][\s\S]*\}$/);
    assert.deepEqual(options, { maxOutputTokens: 4096 });
  }
  assert.equal(summary.generationStatus, 'success');
});
