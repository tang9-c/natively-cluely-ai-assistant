export type LongMeetingBenchmarkPhase = 'warmup' | 'meeting' | 'stopping' | 'post_stop';

export interface LongMeetingBenchmarkSample {
  elapsedMs: number;
  phase: LongMeetingBenchmarkPhase;
  checkpoint?: 'T0' | 'T1' | 'T2';
  main: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
    cpuPercent: number | null;
    eventLoopDelayP95Ms: number | null;
    activeTimers: number | null;
    activeRequests: number | null;
  };
  processes: Array<{ type: string; pid: number; cpuPercent: number; workingSetBytes: number }>;
  session: {
    fullSegments: number;
    effectiveSegments: number;
    epochSummaries: number;
    actionCandidates: number;
    shownCards: number;
  };
  stt: {
    workerCount: number;
    leaseCount: number;
    activeTasks: number;
    queuedTasks: number;
    pendingAudio: number;
    vadBacklog: number | null;
  };
  rag: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    embeddingBatches: number | null;
  };
  ipc: { pending: number; batches: number; averageBatchSize: number; maxPending: number };
  renderer: {
    workingSetBytes: number | null;
    domNodeCount: number | null;
    transcriptTotalRows: number | null;
    transcriptRenderedRows: number | null;
    updateCount: number | null;
    longTaskCount: number | null;
  };
  files: {
    databaseBytes: number;
    walBytes: number;
    tempAudioBytes: number;
    logBytes: number;
    embeddingRows: number;
  };
}

export interface LongMeetingBenchmarkReport {
  schemaVersion: 1;
  environment: {
    platform: NodeJS.Platform;
    arch: string;
    appVersion: string;
    electronVersion: string;
  };
  configuration: {
    source: 'synthetic' | 'sensevoice-audio';
    durationMinutes: number;
    sampleIntervalMs: number;
    meetingMode: string;
  };
  availability: Record<string, string | null>;
  samples: LongMeetingBenchmarkSample[];
  summary: {
    peakRssBytes: number;
    peakHeapUsedBytes: number;
    rssSlopeBytesPerMinute: number | null;
    heapSlopeBytesPerMinute: number | null;
    maxQueueDepths: Record<string, number>;
  };
  checkpoints: Record<'T0' | 'T1' | 'T2', LongMeetingBenchmarkSample>;
  acceptance: Record<string, {
    pass: boolean;
    actual: number | boolean | null;
    limit: number | boolean;
    reason?: string;
  }>;
}
