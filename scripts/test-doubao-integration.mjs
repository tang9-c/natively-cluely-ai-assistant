#!/usr/bin/env node
/**
 * Doubao 集成测试脚本
 * 验证 LLM、STT、Embedding 三个模块的 API 调用格式是否正确
 *
 * 用法:
 *   DOUBAO_API_KEY=your-key node scripts/test-doubao-integration.mjs
 *   DOUBAO_LLM_API_KEY=your-llm-key DOUBAO_API_KEY=your-stt-key node scripts/test-doubao-integration.mjs
 */

import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

const DOUBAO_LLM_KEY = process.env.DOUBAO_LLM_API_KEY || process.env.DOUBAO_API_KEY;
// For Ark platform APIs (LLM + Embedding), use the Ark API key (Bearer token format)
// For AUC STT, use the AUC-specific key (x-api-key or AppId|AccessKey format)
const DOUBAO_STT_KEY = process.env.DOUBAO_API_KEY;
const DOUBAO_EMBEDDING_KEY = process.env.DOUBAO_LLM_API_KEY || process.env.DOUBAO_API_KEY;

const LLM_MODEL = 'doubao-seed-2-0-lite-260215';
const STT_MODEL = 'volc.seedasr.sauc.duration';
// Use endpoint ID (ep-xxx) for embedding, NOT the model name
const EMBEDDING_MODEL = process.env.DOUBAO_EMBEDDING_MODEL || 'doubao-embedding-large-text-250515';

const BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

let passed = 0;
let failed = 0;

function log(label, msg) {
    console.log(`[${label}] ${msg}`);
}

async function testLLM() {
    console.log('\n========== LLM Test ==========');
    if (!DOUBAO_LLM_KEY) {
        log('SKIP', 'LLM: No DOUBAO_LLM_API_KEY or DOUBAO_API_KEY set');
        return;
    }

    try {
        const response = await axios.post(
            `${BASE_URL}/chat/completions`,
            {
                model: LLM_MODEL,
                messages: [{ role: 'user', content: 'Hello, respond with exactly: OK' }],
                max_tokens: 10,
            },
            {
                headers: {
                    Authorization: `Bearer ${DOUBAO_LLM_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 15000,
            }
        );

        const content = response.data?.choices?.[0]?.message?.content;
        log('PASS', `LLM response: "${content?.trim()}"`);
        passed++;
    } catch (error) {
        log('FAIL', `LLM: ${error?.response?.status} ${error?.response?.statusText}`);
        log('DETAIL', error?.response?.data?.error?.message || error.message);
        failed++;
    }
}

async function testSTT() {
    console.log('\n========== STT Test ==========');
    // Standard STT uses Ark platform API key (Bearer token), same as LLM
    const sttKey = DOUBAO_LLM_KEY || DOUBAO_STT_KEY;
    if (!sttKey) {
        log('SKIP', 'STT: No DOUBAO_LLM_API_KEY or DOUBAO_API_KEY set');
        return;
    }

    // Create a minimal valid WAV file (1 second of silence, 16kHz, mono, 16-bit)
    const sampleRate = 16000;
    const duration = 1;
    const numSamples = sampleRate * duration;
    const pcmData = Buffer.alloc(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
        pcmData.writeInt16LE(0, i * 2);
    }

    const wavBuffer = Buffer.alloc(44 + pcmData.length);
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + pcmData.length, 4);
    wavBuffer.write('WAVE', 8);
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16);
    wavBuffer.writeUInt16LE(1, 20);
    wavBuffer.writeUInt16LE(1, 22);
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(sampleRate * 2, 28);
    wavBuffer.writeUInt16LE(2, 32);
    wavBuffer.writeUInt16LE(16, 34);
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(pcmData.length, 40);
    pcmData.copy(wavBuffer, 44);

    try {
        const form = new FormData();
        form.append('file', wavBuffer, { filename: 'test.wav', contentType: 'audio/wav' });
        form.append('model', STT_MODEL);

        const response = await axios.post(
            `${BASE_URL}/audio/transcriptions`,
            form,
            {
                headers: {
                    Authorization: `Bearer ${sttKey}`,
                    ...form.getHeaders(),
                },
                timeout: 30000,
            }
        );

        const text = response.data?.text ?? '';
        log('PASS', `STT response: "${text}" (status: ${response.status})`);
        passed++;
    } catch (error) {
        log('FAIL', `STT: ${error?.response?.status} ${error?.response?.statusText}`);
        log('DETAIL', error?.response?.data?.error?.message || error.message);
        failed++;
    }
}

async function testAUCSTT() {
    console.log('\n========== AUC STT Test ==========');
    if (!DOUBAO_STT_KEY) {
        log('SKIP', 'AUC STT: No DOUBAO_API_KEY set');
        return;
    }

    // Create a minimal valid WAV file (1 second of silence, 16kHz, mono, 16-bit)
    const sampleRate = 16000;
    const duration = 1;
    const numSamples = sampleRate * duration;
    const pcmData = Buffer.alloc(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
        pcmData.writeInt16LE(0, i * 2);
    }

    const wavBuffer = Buffer.alloc(44 + pcmData.length);
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + pcmData.length, 4);
    wavBuffer.write('WAVE', 8);
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16);
    wavBuffer.writeUInt16LE(1, 20);
    wavBuffer.writeUInt16LE(1, 22);
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(sampleRate * 2, 28);
    wavBuffer.writeUInt16LE(2, 32);
    wavBuffer.writeUInt16LE(16, 34);
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(pcmData.length, 40);
    pcmData.copy(wavBuffer, 44);

    const audioBase64 = wavBuffer.toString('base64');
    const isNewConsole = DOUBAO_STT_KEY.includes('|');
    let authHeader;
    if (isNewConsole) {
        const parts = DOUBAO_STT_KEY.split('|');
        authHeader = {
            'X-Api-App-Key': parts[0].trim(),
            'X-Api-Access-Key': parts[1].trim(),
            'X-Api-Resource-Id': 'volc.bigasr.auc',
        };
    } else {
        authHeader = {
            'x-api-key': DOUBAO_STT_KEY.trim(),
            'X-Api-Resource-Id': 'volc.bigasr.auc',
        };
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    try {
        const submitRes = await axios.post(
            'https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/submit',
            {
                user: { uid: 'test-user' },
                audio: { data: audioBase64, format: 'wav', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
                request: {
                    model_name: 'bigmodel',
                    enable_itn: true,
                    enable_punc: true,
                    enable_ddc: false,
                    enable_speaker_info: false,
                    enable_channel_split: false,
                    show_utterances: true,
                    vad_segment: true,
                }
            },
            {
                headers: {
                    ...authHeader,
                    'Content-Type': 'application/json',
                    'X-Api-Request-Id': requestId,
                    'X-Api-Sequence': '-1',
                },
                timeout: 30000
            }
        );

        const reqid = submitRes.data?.reqid;
        const statusCode = submitRes.headers['x-api-status-code'];
        if (statusCode && statusCode !== '20000000') {
            log('FAIL', `AUC STT submit failed: status=${statusCode}, message=${submitRes.headers['x-api-message'] || 'Unknown'}`);
            failed++;
        } else {
            log('PASS', `AUC STT submit: reqid=${reqid}, status_code=${statusCode || 'ok'} (http: ${submitRes.status})`);
            passed++;
        }
    } catch (error) {
        log('FAIL', `AUC STT: ${error?.response?.status} ${error?.response?.statusText}`);
        log('DETAIL', error?.response?.data?.error?.message || JSON.stringify(error?.response?.data) || error.message);
        failed++;
    }
}

async function testEmbedding() {
    console.log('\n========== Embedding Test ==========');
    if (!DOUBAO_EMBEDDING_KEY) {
        log('SKIP', 'Embedding: No DOUBAO_API_KEY set');
        return;
    }

    // Test 1: Standard endpoint with standard input format
    try {
        const response = await axios.post(
            `${BASE_URL}/embeddings`,
            {
                model: EMBEDDING_MODEL,
                input: 'Hello world',
                encoding_format: 'float',
            },
            {
                headers: {
                    Authorization: `Bearer ${DOUBAO_EMBEDDING_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 15000,
            }
        );

        const embedding = response.data?.data?.[0]?.embedding;
        const dim = embedding?.length;
        log('PASS', `Standard endpoint: embedding dim=${dim} (status: ${response.status})`);
        passed++;
    } catch (error) {
        log('FAIL', `Standard endpoint: ${error?.response?.status} ${error?.response?.statusText}`);
        log('DETAIL', error?.response?.data?.error?.message || error.message);
        failed++;
    }

    // Test 2: Standard endpoint with batch input
    try {
        const response = await axios.post(
            `${BASE_URL}/embeddings`,
            {
                model: EMBEDDING_MODEL,
                input: ['Hello', 'World'],
                encoding_format: 'float',
            },
            {
                headers: {
                    Authorization: `Bearer ${DOUBAO_EMBEDDING_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 15000,
            }
        );

        const count = response.data?.data?.length;
        log('PASS', `Batch endpoint: ${count} embeddings returned (status: ${response.status})`);
        passed++;
    } catch (error) {
        log('FAIL', `Batch endpoint: ${error?.response?.status} ${error?.response?.statusText}`);
        log('DETAIL', error?.response?.data?.error?.message || error.message);
        failed++;
    }

    // Test 3: Multimodal endpoint (fallback)
    try {
        const response = await axios.post(
            `${BASE_URL}/embeddings/multimodal`,
            {
                model: EMBEDDING_MODEL,
                input: [{ type: 'text', text: 'Hello world' }],
                encoding_format: 'float',
            },
            {
                headers: {
                    Authorization: `Bearer ${DOUBAO_EMBEDDING_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 15000,
            }
        );

        // Multimodal endpoint returns { data: { embedding: [...] } } not { data: [{ embedding: [...] }] }
        const embedding = response.data?.data?.embedding ?? response.data?.data?.[0]?.embedding;
        const dim = embedding?.length;
        log('PASS', `Multimodal endpoint: embedding dim=${dim} (status: ${response.status})`);
        passed++;
    } catch (error) {
        log('FAIL', `Multimodal endpoint: ${error?.response?.status} ${error?.response?.statusText}`);
        log('DETAIL', error?.response?.data?.error?.message || error.message);
        failed++;
    }

    // Test 4: Multimodal batch endpoint (parallel single requests fallback)
    try {
        const texts = ['Hello', 'World'];
        const embeddings = await Promise.all(texts.map(text =>
            axios.post(
                `${BASE_URL}/embeddings/multimodal`,
                { model: EMBEDDING_MODEL, input: [{ type: 'text', text }], encoding_format: 'float' },
                { headers: { Authorization: `Bearer ${DOUBAO_EMBEDDING_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 }
            )
        ));
        const dims = embeddings.map(r => r.data?.data?.embedding?.length ?? r.data?.data?.[0]?.embedding?.length);
        log('PASS', `Multimodal parallel batch: ${embeddings.length} embeddings, dims=[${dims.join(', ')}] (status: ${embeddings[0].status})`);
        passed++;
    } catch (error) {
        log('FAIL', `Multimodal batch: ${error?.response?.status} ${error?.response?.statusText}`);
        log('DETAIL', error?.response?.data?.error?.message || error.message);
        failed++;
    }
}

async function main() {
    console.log('Doubao Integration Test');
    console.log('========================');
    console.log('LLM Key:', DOUBAO_LLM_KEY ? `${DOUBAO_LLM_KEY.slice(0, 8)}...` : 'NOT SET');
    console.log('STT Key:', DOUBAO_STT_KEY ? `${DOUBAO_STT_KEY.slice(0, 8)}...` : 'NOT SET');
    console.log('Embedding Key:', DOUBAO_EMBEDDING_KEY ? `${DOUBAO_EMBEDDING_KEY.slice(0, 8)}...` : 'NOT SET');

    await testLLM();
    await testSTT();
    await testAUCSTT();
    await testEmbedding();

    console.log('\n========== Summary ==========');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Skipped: ${3 - (DOUBAO_LLM_KEY ? 1 : 0) - (DOUBAO_STT_KEY ? 1 : 0) - (DOUBAO_EMBEDDING_KEY ? 1 : 0)}`);

    if (failed > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
