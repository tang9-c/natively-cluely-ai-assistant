import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { getSenseVoiceModelDir } from './modelManager';
import { SENSEVOICE_DEFAULT_MODEL_ID, type SenseVoiceModelId } from './types';

const REQUIRED_FILES = ['model.int8.onnx', 'tokens.txt'] as const;
const MODELSCOPE_SENSEVOICE_REPO_ID =
  'chriscrs/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17';
const DEFAULT_ENDPOINTS = ['https://huggingface.co', 'https://hf-mirror.com'] as const;
const DEFAULT_FILE_BASE_URLS = [
  `https://www.modelscope.cn/models/${MODELSCOPE_SENSEVOICE_REPO_ID}/resolve/master`,
] as const;
const REQUEST_TIMEOUT_MS = 15000;

type ProgressCallback = (progress: number) => void;

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/$/, '');
}

function configuredFileBaseUrls(): string[] {
  const configured = process.env.SENSEVOICE_MODEL_FILE_BASE_URLS;
  if (!configured) return [];
  return configured
    .split(',')
    .map(normalizeEndpoint)
    .filter(Boolean);
}

function downloadFileBaseUrls(modelId: string): string[] {
  const configuredBases = configuredFileBaseUrls();
  if (configuredBases.length > 0) return configuredBases;

  const configured = process.env.SENSEVOICE_MODEL_ENDPOINTS;
  if (configured) {
    return configured
      .split(',')
      .map(normalizeEndpoint)
      .map(endpoint => `${endpoint}/${modelId}/resolve/main`)
      .filter(Boolean);
  }
  if (process.env.HF_ENDPOINT) {
    return [`${normalizeEndpoint(process.env.HF_ENDPOINT)}/${modelId}/resolve/main`];
  }
  return [
    ...DEFAULT_ENDPOINTS.map(endpoint => `${endpoint}/${modelId}/resolve/main`),
    ...DEFAULT_FILE_BASE_URLS,
  ];
}

function fileUrl(fileBaseUrl: string, filename: string): string {
  return `${fileBaseUrl}/${filename}`;
}

function safeUrlForError(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value;
  }
}

function downloadFile(url: string, destination: string, onBytes: (bytes: number, total?: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = `${destination}.download`;
    const request = (target: string, redirectCount = 0) => {
      const parsed = new URL(target);
      const client = parsed.protocol === 'http:' ? http : https;
      const req = client.get(parsed, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectCount >= 5) {
            reject(new Error(`Too many redirects while downloading ${safeUrlForError(url)}`));
            return;
          }
          request(new URL(res.headers.location, parsed).toString(), redirectCount + 1);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`Download failed with HTTP ${status}: ${safeUrlForError(target)}`));
          return;
        }

        const totalHeader = Number(res.headers['content-length'] ?? 0);
        const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined;
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const out = fs.createWriteStream(tmp);
        res.on('data', (chunk: Buffer) => onBytes(chunk.length, total));
        res.pipe(out);
        out.on('finish', () => {
          out.close(() => {
            fs.renameSync(tmp, destination);
            resolve();
          });
        });
        out.on('error', (error) => {
          fs.rmSync(tmp, { force: true });
          reject(error);
        });
      });
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error(`Download timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${safeUrlForError(target)}`));
      });
      req.on('error', (error) => {
        fs.rmSync(tmp, { force: true });
        reject(error);
      });
    };
    request(url);
  });
}

async function downloadFileWithFallback(
  modelId: string,
  filename: string,
  destination: string,
  onBytes: (bytes: number, total?: number) => void,
): Promise<void> {
  const fileBaseUrls = downloadFileBaseUrls(modelId);
  if (fileBaseUrls.length === 0) {
    throw new Error('No SenseVoice model download sources configured');
  }

  const errors: string[] = [];
  for (const fileBaseUrl of fileBaseUrls) {
    try {
      await downloadFile(fileUrl(fileBaseUrl, filename), destination, onBytes);
      return;
    } catch (error: any) {
      errors.push(`${safeUrlForError(fileBaseUrl)}: ${error?.message ?? String(error)}`);
    }
  }

  throw new Error(`Failed to download ${filename}. Tried ${fileBaseUrls.length} source(s): ${errors.join(' | ')}`);
}

export async function downloadSenseVoiceModel(
  modelId: SenseVoiceModelId = SENSEVOICE_DEFAULT_MODEL_ID,
  onProgress?: ProgressCallback,
): Promise<void> {
  const modelDir = getSenseVoiceModelDir(modelId);

  for (let index = 0; index < REQUIRED_FILES.length; index++) {
    const filename = REQUIRED_FILES[index];
    const destination = path.join(modelDir, filename);
    let fileBytes = 0;
    await downloadFileWithFallback(modelId, filename, destination, (bytes, total) => {
      fileBytes += bytes;
      if (total) {
        const fileProgress = Math.min(1, fileBytes / total);
        onProgress?.(Math.min(99, Math.round(((index + fileProgress) / REQUIRED_FILES.length) * 100)));
      } else {
        onProgress?.(Math.min(95, Math.round(((index + 0.5) / REQUIRED_FILES.length) * 100)));
      }
    });
  }

  onProgress?.(100);
}
