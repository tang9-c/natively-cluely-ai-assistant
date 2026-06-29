import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { getSenseVoiceModelDir } from './modelManager';
import { SENSEVOICE_DEFAULT_MODEL_ID, type SenseVoiceModelId } from './types';

const REQUIRED_FILES = ['model.int8.onnx', 'tokens.txt'] as const;
const DEFAULT_ENDPOINTS = ['https://huggingface.co', 'https://hf-mirror.com'] as const;
const DEFAULT_FILE_BASE_URLS = ['https://feigenbaum.cdn.bcebos.com/onnx'] as const;
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
const DOWNLOAD_HEADERS = {
  'User-Agent': 'Natively/2.7 SenseVoiceModelDownloader',
  Accept: 'application/octet-stream,*/*',
};

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

function defaultFileBaseUrls(): string[] {
  const configured = process.env.SENSEVOICE_DEFAULT_MODEL_FILE_BASE_URLS;
  if (configured) {
    return configured
      .split(',')
      .map(normalizeEndpoint)
      .filter(Boolean);
  }
  return [...DEFAULT_FILE_BASE_URLS];
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
    ...defaultFileBaseUrls(),
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

function requestTimeoutMs(): number {
  const configured = Number(process.env.SENSEVOICE_MODEL_DOWNLOAD_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_REQUEST_TIMEOUT_MS;
}

function getElectronNetFetch(): ((input: string, init?: any) => Promise<Response>) | undefined {
  if (!process.versions.electron) return undefined;
  try {
    const electron = require('electron');
    return electron?.net?.fetch?.bind(electron.net);
  } catch {
    return undefined;
  }
}

function createIdleTimeout(onTimeout: () => void): { reset: () => void; clear: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const timeoutMs = requestTimeoutMs();
  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onTimeout, timeoutMs);
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  reset();
  return { reset, clear };
}

async function downloadFileWithElectronNet(
  url: string,
  destination: string,
  onBytes: (bytes: number, total?: number) => void,
): Promise<void> {
  const electronFetch = getElectronNetFetch();
  if (!electronFetch) {
    throw new Error('electron.net.fetch is unavailable');
  }

  const tmp = `${destination}.download`;
  const controller = new AbortController();
  const idle = createIdleTimeout(() => {
    controller.abort(new Error(`Download timed out after ${requestTimeoutMs() / 1000}s: ${safeUrlForError(url)}`));
  });
  let out: fs.WriteStream | undefined;

  try {
    const response = await electronFetch(url, {
      headers: DOWNLOAD_HEADERS,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status}: ${safeUrlForError(response.url || url)}`);
    }
    if (!response.body) {
      throw new Error(`Download response had no body: ${safeUrlForError(response.url || url)}`);
    }

    const totalHeader = Number(response.headers.get('content-length') ?? 0);
    const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    out = fs.createWriteStream(tmp);
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        idle.reset();
        const chunk = Buffer.from(value);
        onBytes(chunk.length, total);
        if (!out.write(chunk)) {
          await new Promise<void>((resolve, reject) => {
            out.once('drain', resolve);
            out.once('error', reject);
          });
        }
      }
    } finally {
      reader.releaseLock();
    }

    await new Promise<void>((resolve, reject) => {
      out.end((error?: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });
    fs.renameSync(tmp, destination);
  } catch (error: any) {
    out?.destroy();
    fs.rmSync(tmp, { force: true });
    if (error?.name === 'AbortError' && controller.signal.reason instanceof Error) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    idle.clear();
  }
}

function downloadFile(url: string, destination: string, onBytes: (bytes: number, total?: number) => void): Promise<void> {
  const electronFetch = getElectronNetFetch();
  if (electronFetch) {
    return downloadFileWithElectronNet(url, destination, onBytes);
  }

  return new Promise((resolve, reject) => {
    const tmp = `${destination}.download`;
    const request = (target: string, redirectCount = 0) => {
      const parsed = new URL(target);
      const client = parsed.protocol === 'http:' ? http : https;
      const req = client.get(parsed, { headers: DOWNLOAD_HEADERS }, (res) => {
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
      req.setTimeout(requestTimeoutMs(), () => {
        req.destroy(new Error(`Download timed out after ${requestTimeoutMs() / 1000}s: ${safeUrlForError(target)}`));
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
