import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { getSenseVoiceModelDir } from './modelManager';
import { SENSEVOICE_DEFAULT_MODEL_ID, type SenseVoiceModelId } from './types';

const REQUIRED_FILES = ['model.int8.onnx', 'tokens.txt'] as const;
const DEFAULT_ENDPOINTS = ['https://huggingface.co', 'https://hf-mirror.com'] as const;
const REQUEST_TIMEOUT_MS = 15000;

type ProgressCallback = (progress: number) => void;

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/$/, '');
}

function downloadEndpoints(): string[] {
  const configured = process.env.SENSEVOICE_MODEL_ENDPOINTS;
  if (configured) {
    return configured
      .split(',')
      .map(normalizeEndpoint)
      .filter(Boolean);
  }
  if (process.env.HF_ENDPOINT) {
    return [normalizeEndpoint(process.env.HF_ENDPOINT)];
  }
  return [...DEFAULT_ENDPOINTS];
}

function fileUrl(endpoint: string, modelId: string, filename: string): string {
  return `${endpoint}/${modelId}/resolve/main/${filename}`;
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
            reject(new Error(`Too many redirects while downloading ${url}`));
            return;
          }
          request(new URL(res.headers.location, parsed).toString(), redirectCount + 1);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`Download failed with HTTP ${status}: ${target}`));
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
        req.destroy(new Error(`Download timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${target}`));
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
  const endpoints = downloadEndpoints();
  if (endpoints.length === 0) {
    throw new Error('No SenseVoice model download endpoints configured');
  }

  const errors: string[] = [];
  for (const endpoint of endpoints) {
    try {
      await downloadFile(fileUrl(endpoint, modelId, filename), destination, onBytes);
      return;
    } catch (error: any) {
      errors.push(`${endpoint}: ${error?.message ?? String(error)}`);
    }
  }

  throw new Error(`Failed to download ${filename}. Tried ${endpoints.length} endpoint(s): ${errors.join(' | ')}`);
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
