import { monitorEventLoopDelay } from 'node:perf_hooks';

import type {
  LongMeetingBenchmarkPhase,
  LongMeetingBenchmarkSample,
} from '../../shared/longMeetingBenchmark';

type SessionMetrics = LongMeetingBenchmarkSample['session'];
type SttMetrics = LongMeetingBenchmarkSample['stt'];
type RagMetrics = LongMeetingBenchmarkSample['rag'];
type IpcMetrics = LongMeetingBenchmarkSample['ipc'];
type ProcessMetrics = LongMeetingBenchmarkSample['processes'];
type FileMetrics = LongMeetingBenchmarkSample['files'];

export interface LongMeetingRuntimeProbeDependencies {
  getSession: () => SessionMetrics;
  getStt: () => SttMetrics;
  getRag: () => RagMetrics;
  getIpc: () => IpcMetrics;
  getProcesses: () => ProcessMetrics;
  getFiles: () => FileMetrics | Promise<FileMetrics>;
  memoryUsage?: () => NodeJS.MemoryUsage;
  cpuUsage?: () => NodeJS.CpuUsage;
  now?: () => number;
  eventLoopDelayP95Ms?: () => number | null;
}

export class LongMeetingRuntimeProbe {
  private readonly eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
  private readonly memoryUsage: () => NodeJS.MemoryUsage;
  private readonly cpuUsage: () => NodeJS.CpuUsage;
  private readonly now: () => number;
  private previousCpu: NodeJS.CpuUsage;
  private previousAt: number;

  constructor(private readonly dependencies: LongMeetingRuntimeProbeDependencies) {
    this.memoryUsage = dependencies.memoryUsage ?? process.memoryUsage;
    this.cpuUsage = dependencies.cpuUsage ?? process.cpuUsage;
    this.now = dependencies.now ?? Date.now;
    this.previousCpu = this.cpuUsage();
    this.previousAt = this.now();
    this.eventLoopMonitor.enable();
  }

  async snapshot(input: {
    elapsedMs: number;
    phase: LongMeetingBenchmarkPhase;
    checkpoint?: 'T0' | 'T1' | 'T2';
  }): Promise<LongMeetingBenchmarkSample> {
    const memory = this.memoryUsage();
    const currentCpu = this.cpuUsage();
    const currentAt = this.now();
    const wallMicros = Math.max(1, (currentAt - this.previousAt) * 1_000);
    const usedMicros = Math.max(
      0,
      currentCpu.user - this.previousCpu.user + currentCpu.system - this.previousCpu.system,
    );
    const cpuPercent = usedMicros / wallMicros * 100;
    this.previousCpu = currentCpu;
    this.previousAt = currentAt;

    const measuredDelay = this.dependencies.eventLoopDelayP95Ms
      ? this.dependencies.eventLoopDelayP95Ms()
      : this.eventLoopMonitor.percentile(95) / 1_000_000;
    this.eventLoopMonitor.reset();

    return {
      ...input,
      main: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
        cpuPercent,
        eventLoopDelayP95Ms: Number.isFinite(measuredDelay) ? measuredDelay : null,
        activeTimers: null,
        activeRequests: null,
      },
      processes: this.dependencies.getProcesses(),
      session: this.dependencies.getSession(),
      stt: this.dependencies.getStt(),
      rag: this.dependencies.getRag(),
      ipc: this.dependencies.getIpc(),
      renderer: {
        workingSetBytes: null,
        domNodeCount: null,
        transcriptTotalRows: null,
        transcriptRenderedRows: null,
        updateCount: null,
        longTaskCount: null,
      },
      files: await this.dependencies.getFiles(),
    };
  }

  dispose(): void {
    this.eventLoopMonitor.disable();
  }
}
