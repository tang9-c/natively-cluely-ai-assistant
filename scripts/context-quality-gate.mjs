#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const QUALITY_RULES = [
  {
    category: 'prompt_or_answer_generation',
    reason: 'Prompt, provider routing, answer streaming, or realtime LLM path changed.',
    patterns: [
      /^electron\/llm\//,
      /^electron\/LLMHelper\.ts$/,
      /^electron\/IntelligenceEngine\.ts$/,
      /^electron\/IntelligenceManager\.ts$/,
    ],
  },
  {
    category: 'rag_or_material_context',
    reason: 'RAG retrieval, material indexing, or uploaded material context changed.',
    patterns: [
      /^electron\/rag\//,
      /^electron\/services\/knowledge\//,
      /^electron\/services\/materials\//,
    ],
  },
  {
    category: 'context_selection',
    reason: 'Realtime context selection or context orchestration changed.',
    patterns: [
      /^electron\/services\/context\//,
      /^electron\/services\/RealtimeContextOrchestrator\.ts$/,
      /^electron\/services\/__tests__\/RealtimeContextOrchestrator\.test\.mjs$/,
    ],
  },
  {
    category: 'dynamic_action_rules',
    reason: 'Dynamic action trigger, semantic gate, or final transcript action path changed.',
    patterns: [
      /^electron\/services\/dynamic-actions\//,
      /^electron\/services\/__tests__\/DynamicActionEngine\.test\.mjs$/,
      /^electron\/services\/__tests__\/ModeEventClassifier\.test\.mjs$/,
      /^electron\/services\/__tests__\/IntelligenceEngineDynamicActions\.test\.mjs$/,
    ],
  },
  {
    category: 'answer_trace_or_metrics',
    reason: 'Answer trace, quality metrics, diagnostics, or persistence changed.',
    patterns: [
      /^electron\/services\/eval\//,
      /^electron\/services\/__tests__\/Answer.*\.test\.mjs$/,
      /^electron\/db\/DatabaseManager\.ts$/,
      /^scripts\/context-quality-smoke-report\.mjs$/,
    ],
  },
  {
    category: 'business_system_context',
    reason: 'Business system context, fixed reply, or no-fabrication guard changed.',
    patterns: [
      /^electron\/services\/business-system\//,
      /^electron\/services\/__tests__\/BusinessSystem.*\.test\.mjs$/,
    ],
  },
  {
    category: 'speaker_or_screen_context',
    reason: 'Speaker or screen context can affect realtime answer grounding.',
    patterns: [
      /^electron\/services\/__tests__\/SpeakerContextPolicy\.test\.mjs$/,
      /^electron\/services\/ScreenUnderstandingService\.ts$/,
      /^electron\/ProcessingHelper\.ts$/,
    ],
  },
  {
    category: 'quality_gate_itself',
    reason: 'Quality gate policy, scripts, or roadmap changed.',
    patterns: [
      /^package\.json$/,
      /^scripts\/context-quality-gate\.mjs$/,
      /^scripts\/__tests__\/context-quality-gate\.test\.mjs$/,
      /^docs\/engineering\/REALTIME_LLM_PATHS_AUDIT\.md$/,
      /^docs\/engineering\/CONTEXT_SYSTEM_ROADMAP\.md$/,
    ],
  },
];

export function classifyQualityGate(changedFiles) {
  const normalizedFiles = changedFiles
    .map((file) => String(file || '').trim().replaceAll('\\', '/'))
    .filter(Boolean);

  const matches = [];
  for (const file of normalizedFiles) {
    const rule = QUALITY_RULES.find((candidate) =>
      candidate.patterns.some((pattern) => pattern.test(file)),
    );
    if (rule) {
      matches.push({
        category: rule.category,
        file,
        reason: rule.reason,
      });
    }
  }

  return {
    required: matches.length > 0,
    matches,
  };
}

export function formatQualityGateReport(result) {
  if (!result.required) {
    return 'Context quality gate not required for current diff.';
  }

  const reasons = result.matches
    .map((match) => `- ${match.category}: ${match.file}`)
    .join('\n');

  return [
    'Context quality gate required.',
    '',
    'Reasons:',
    reasons,
    '',
    'Required commands:',
    '- npm run test:quality:smoke',
    '- npm run test:quality:diagnostics',
    '',
    'Fast local loop after one build:',
    '- npm run build:electron',
    '- npm run test:quality:smoke:no-build',
    '- npm run test:quality:diagnostics:no-build',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    base: 'HEAD',
    list: false,
    run: false,
    noBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') {
      args.base = argv[index + 1] || args.base;
      index += 1;
    } else if (arg === '--list') {
      args.list = true;
    } else if (arg === '--run') {
      args.run = true;
    } else if (arg === '--no-build') {
      args.noBuild = true;
    }
  }

  if (!args.list && !args.run) {
    args.list = true;
  }

  return args;
}

function runGitDiff(base) {
  const result = spawnSync('git', ['diff', '--name-only', base, '--'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git diff --name-only ${base} -- failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runQualityCommands({ noBuild }) {
  if (!noBuild) {
    runCommand('npm', ['run', 'build:electron']);
  }
  runCommand('npm', ['run', 'test:quality:smoke:no-build']);
  runCommand('npm', ['run', 'test:quality:diagnostics:no-build']);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = runGitDiff(args.base);
  const result = classifyQualityGate(changedFiles);
  console.log(formatQualityGateReport(result));

  if (args.run && result.required) {
    runQualityCommands(args);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}
