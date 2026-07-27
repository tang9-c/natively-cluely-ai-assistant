import { ChildProcess, fork } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';

import type { IntentResult } from './IntentClassifierShared';

type WorkerRequest =
    | {
        id: number;
        type: 'classify';
        text: string;
        modeTemplateType?: string | null;
        cacheDir: string;
        remoteHost: string;
      }
    | {
        id: number;
        type: 'warmup';
        cacheDir: string;
        remoteHost: string;
      };

type WorkerResponse =
    | { id: number; ok: true; result: IntentResult | null }
    | { id: number; ok: true; warmed: true }
    | { id: number; ok: false; error: string };

interface PendingRequest {
    resolve: (value: IntentResult | null) => void;
    timer: NodeJS.Timeout;
    type: WorkerRequest['type'];
}

const DEFAULT_CLASSIFY_TIMEOUT_MS = 15_000;
const DEFAULT_WARMUP_TIMEOUT_MS = 120_000;

export function resolveIntentClassifierWorkerPath(baseDir = __dirname): string {
    const colocatedWorker = path.join(baseDir, 'intentClassifierWorkerProcess.js');
    if (fs.existsSync(colocatedWorker)) {
        return colocatedWorker;
    }
    return path.join(baseDir, 'llm', 'intentClassifierWorkerProcess.js');
}

function getRemoteHost(): string {
    return (process.env.HF_ENDPOINT || 'https://modelscope.cn/models').replace(/\/$/, '') + '/';
}

export class IntentClassifierProcessHost {
    private child: ChildProcess | null = null;
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();
    private unavailableUntil = 0;

    constructor(
        private readonly workerPath = resolveIntentClassifierWorkerPath(),
        private readonly classifyTimeoutMs = DEFAULT_CLASSIFY_TIMEOUT_MS,
        private readonly warmupTimeoutMs = DEFAULT_WARMUP_TIMEOUT_MS,
    ) {}

    async classify(text: string, modeTemplateType?: string | null): Promise<IntentResult | null> {
        return this.send({
            id: 0,
            type: 'classify',
            text,
            modeTemplateType,
            cacheDir: this.getCacheDir(),
            remoteHost: getRemoteHost(),
        }, this.classifyTimeoutMs);
    }

    warmup(): void {
        this.send({
            id: 0,
            type: 'warmup',
            cacheDir: this.getCacheDir(),
            remoteHost: getRemoteHost(),
        }, this.warmupTimeoutMs).catch(() => {});
    }

    dispose(): void {
        const child = this.child;
        this.child = null;
        this.rejectPending('Intent classifier process disposed');
        if (child && !child.killed) {
            child.kill();
        }
    }

    private async send(request: WorkerRequest, timeoutMs: number): Promise<IntentResult | null> {
        if (Date.now() < this.unavailableUntil) {
            return null;
        }

        const child = this.ensureChild();
        if (!child?.connected) {
            return null;
        }

        const id = this.nextId++;
        const message = { ...request, id };

        return new Promise<IntentResult | null>((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                console.warn('[IntentClassifier] Isolated classifier timed out', { type: request.type, timeoutMs });
                resolve(null);
            }, timeoutMs);

            this.pending.set(id, { resolve, timer, type: request.type });

            try {
                child.send(message);
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                console.warn('[IntentClassifier] Failed to send isolated classifier request', {
                    type: request.type,
                    error,
                });
                resolve(null);
            }
        });
    }

    private ensureChild(): ChildProcess | null {
        if (this.child?.connected) {
            return this.child;
        }

        try {
            const child = fork(this.workerPath, [], {
                stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: '1',
                },
            });

            child.on('message', (message: WorkerResponse) => this.handleMessage(message));
            child.on('error', (error) => this.handleExit('error', error));
            child.on('exit', (code, signal) => this.handleExit('exit', { code, signal }));
            child.stderr?.on('data', (chunk) => {
                const text = String(chunk).trim();
                if (text) {
                    console.warn('[IntentClassifier] Isolated classifier stderr', { length: text.length });
                }
            });

            this.child = child;
            return child;
        } catch (error) {
            console.warn('[IntentClassifier] Failed to start isolated classifier process', { error });
            this.unavailableUntil = Date.now() + 30_000;
            return null;
        }
    }

    private handleMessage(message: WorkerResponse): void {
        const pending = this.pending.get(message.id);
        if (!pending) return;

        clearTimeout(pending.timer);
        this.pending.delete(message.id);

        if (message.ok === false) {
            console.warn('[IntentClassifier] Isolated classifier request failed', {
                type: pending.type,
                error: message.error,
            });
            pending.resolve(null);
            return;
        }

        pending.resolve('result' in message ? message.result : null);
    }

    private handleExit(kind: 'error' | 'exit', detail: unknown): void {
        console.warn('[IntentClassifier] Isolated classifier process stopped', { kind, detail });
        this.child = null;
        this.unavailableUntil = Date.now() + 10_000;
        this.rejectPending('Intent classifier process stopped');
    }

    private rejectPending(reason: string): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.resolve(null);
        }
        this.pending.clear();
        if (reason) {
            console.warn('[IntentClassifier] Cleared pending classifier requests', { reason });
        }
    }

    private getCacheDir(): string {
        if (app?.getPath) {
            return path.join(app.getPath('userData'), 'models');
        }
        return path.join(os.tmpdir(), 'natively-intent-classifier-models');
    }
}

let singleton: IntentClassifierProcessHost | null = null;

export function getIntentClassifierProcessHost(): IntentClassifierProcessHost {
    if (!singleton) {
        singleton = new IntentClassifierProcessHost();
    }
    return singleton;
}

export function resetIntentClassifierProcessHostForTest(): void {
    singleton?.dispose();
    singleton = null;
}
