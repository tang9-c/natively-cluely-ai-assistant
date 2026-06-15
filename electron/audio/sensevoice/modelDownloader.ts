import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { getSenseVoiceModelDir } from './modelManager';
import { SENSEVOICE_DEFAULT_MODEL_ID, type SenseVoiceModelId } from './types';

const REQUIRED_FILES = ['model.int8.onnx', 'tokens.txt'] as const;

type ProgressCallback = (progress: number) => void;

function remoteBaseUrl(): string {
  return (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/$/, '');
}

function fileUrl(modelId: string, filename: string): string {
  return `${remoteBaseUrl()}/${modelId}/resolve/main/${filename}`;
}

function downloadFile(url: string, destination: string, onBytes: (bytes: number, total?: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
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
        const tmp = `${destination}.download`;
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
      req.on('error', reject);
    };
    request(url);
  });
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
    await downloadFile(fileUrl(modelId, filename), destination, (bytes, total) => {
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
