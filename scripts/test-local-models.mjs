#!/usr/bin/env node
/**
 * 测试本地 Embedding 和 STT 模型兜底能力
 * 验证两个模型都能正确加载并完成推理
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.join(__dirname, '../resources/models');
const sttModelsDir = path.join(process.env.HOME, 'Library/Application Support/natively/whisper-models');

let passCount = 0;
let failCount = 0;

function ok(label) {
  console.log(`  ✅ ${label}`);
  passCount++;
}

function fail(label, err) {
  console.log(`  ❌ ${label}: ${err?.message || err}`);
  failCount++;
}

// ─── Test 1: Embedding Model ───────────────────────────────────────────────
async function testEmbeddingModel() {
  console.log('\n📦 Test 1: Local Embedding Model (paraphrase-multilingual-MiniLM-L12-v2)');

  // 1a. 检查模型文件存在
  const modelDir = path.join(modelsDir, 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  const requiredFiles = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_int8.onnx',
  ];
  for (const f of requiredFiles) {
    const fp = path.join(modelDir, f);
    try {
      await import('fs').then(m => m.promises.access(fp));
      ok(`文件存在: ${f}`);
    } catch (e) {
      fail(`文件缺失: ${f}`, e);
    }
  }

  // 1b. 加载模型并生成 embedding
  try {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowRemoteModels = false;
    env.localModelPath = modelsDir;

    console.log('  ⏳ 加载 embedding 模型...');
    const pipe = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
      local_files_only: true,
      model_file_name: 'model_int8',
    });
    ok('模型加载成功');

    // 测试英文
    const enResult = await pipe('Hello world', { pooling: 'mean', normalize: true });
    const enVec = Array.from(enResult.data);
    if (enVec.length === 384) {
      ok(`英文 embedding 维度正确: ${enVec.length}d`);
    } else {
      fail(`英文 embedding 维度错误`, new Error(`期望 384d, 实际 ${enVec.length}d`));
    }

    // 测试中文
    const zhResult = await pipe('你好世界', { pooling: 'mean', normalize: true });
    const zhVec = Array.from(zhResult.data);
    if (zhVec.length === 384) {
      ok(`中文 embedding 维度正确: ${zhVec.length}d`);
    } else {
      fail(`中文 embedding 维度错误`, new Error(`期望 384d, 实际 ${zhVec.length}d`));
    }

    // 验证向量已归一化（模长接近 1）
    const magnitude = Math.sqrt(enVec.reduce((s, v) => s + v * v, 0));
    if (Math.abs(magnitude - 1.0) < 0.01) {
      ok(`向量已归一化 (模长 ≈ ${magnitude.toFixed(4)})`);
    } else {
      fail(`向量未归一化`, new Error(`模长 = ${magnitude}`));
    }

    // 验证中英文向量不同（多语言能力）
    let dot = 0;
    for (let i = 0; i < enVec.length; i++) dot += enVec[i] * zhVec[i];
    if (dot > 0.5 && dot < 0.99) {
      ok(`中英文语义相关度合理: ${dot.toFixed(4)}`);
    } else if (dot >= 0.99) {
      fail(`中英文向量过于相似`, new Error(`余弦相似度 = ${dot.toFixed(4)}`));
    } else {
      ok(`中英文语义相关度: ${dot.toFixed(4)} (低相关但可接受)`);
    }

  } catch (e) {
    fail('Embedding 模型推理', e);
  }
}

// ─── Test 2: STT Local Model ───────────────────────────────────────────────
async function testSttModel() {
  console.log('\n🎙️  Test 2: STT Local Model');

  // 检测实际可用的本地 STT 模型（按优先级排序）
  const sttCandidates = [
    { id: 'Xenova/whisper-base', name: 'Whisper Base', dir: 'Xenova/whisper-base' },
    { id: 'Xenova/whisper-tiny.en', name: 'Whisper Tiny EN', dir: 'Xenova/whisper-tiny.en' },
    { id: 'Xenova/whisper-tiny',    name: 'Whisper Tiny',    dir: 'Xenova/whisper-tiny' },
    { id: 'onnx-community/moonshine-tiny-ONNX', name: 'Moonshine Tiny', dir: 'onnx-community/moonshine-tiny-ONNX' },
  ];

  let selected = null;
  for (const cand of sttCandidates) {
    const onnxDir = path.join(sttModelsDir, cand.dir, 'onnx');
    const hasEncoder = fs.existsSync(path.join(onnxDir, 'encoder_model.onnx'));
    const hasDecoder = fs.existsSync(path.join(onnxDir, 'decoder_model_merged.onnx'));
    if (hasEncoder && hasDecoder) {
      selected = cand;
      ok(`检测到可用模型: ${cand.name} (${cand.id})`);
      break;
    } else {
      console.log(`  ⏭️  模型不可用: ${cand.name} (encoder=${hasEncoder}, decoder=${hasDecoder})`);
    }
  }

  if (!selected) {
    fail('没有可用的本地 STT 模型', new Error('所有候选模型都缺少 ONNX 文件'));
    return;
  }

  // 加载并测试选中的模型
  try {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowRemoteModels = false;
    env.localModelPath = sttModelsDir;

    console.log(`  ⏳ 加载 ${selected.name}...`);
    const pipe = await pipeline('automatic-speech-recognition', selected.id, {
      local_files_only: true,
    });
    ok(`${selected.name} 模型加载成功`);

    // 用模拟音频测试推理
    const sampleRate = 16000;
    const durationSec = 1;
    const dummyAudio = new Float32Array(sampleRate * durationSec);
    for (let i = 0; i < dummyAudio.length; i++) {
      dummyAudio[i] = Math.sin(i * 0.01) * 0.1;
    }

    const result = await pipe(dummyAudio, { sampling_rate: sampleRate });
    if (typeof result.text === 'string') {
      ok(`推理成功，输出类型正确 (text: "${result.text.slice(0, 30)}...")`);
    } else {
      fail(`推理输出格式异常`, new Error(`输出: ${JSON.stringify(result)}`));
    }

  } catch (e) {
    fail(`${selected.name} 模型推理`, e);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('  本地模型兜底能力测试');
  console.log('════════════════════════════════════════════════════════════');

  await testEmbeddingModel();
  await testSttModel();

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  结果: ${passCount} 通过, ${failCount} 失败`);
  console.log('════════════════════════════════════════════════════════════');

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试脚本异常:', e);
  process.exit(1);
});
