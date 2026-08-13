export type LocalSttEngine = 'whisper' | 'sensevoice';
export type LocalSttHardwareProvider = 'cpu' | 'coreml' | 'directml' | 'dml';

export interface LocalSttProviderPlan {
  requestedProviders: LocalSttHardwareProvider[];
  fallbackProvider: 'cpu' | null;
  cacheConfig: { enabled: boolean };
  diagnosticLabel: string;
  benchmarkRequired: boolean;
}

export interface LocalSttProviderOptions {
  benchmarkApproved?: boolean;
  runtimeSupportsCandidate?: boolean;
}

export interface LocalSttBenchmarkRun {
  rtf: number;
  error?: string | null;
}

export interface LocalSttQualityMetrics {
  characterErrorRate: number;
  keywordRecall: number;
}

export interface LocalSttProviderInitialization<T> {
  value: T;
  providerRequested: string;
  providerActual: string;
  fallbackReason: string | null;
}

export function initializeLocalSttProvider<T>(input: {
  requestedProviders?: string[];
  fallbackProvider?: string | null;
  create: (provider: string) => T;
}): LocalSttProviderInitialization<T> {
  const providerRequested = input.requestedProviders?.[0] ?? 'cpu';
  try {
    return {
      value: input.create(providerRequested),
      providerRequested,
      providerActual: providerRequested === 'cpu' ? 'cpu' : 'unknown',
      fallbackReason: providerRequested === 'cpu' ? null : 'actual_provider_unverified',
    };
  } catch {
    if (!input.fallbackProvider || input.fallbackProvider === providerRequested) {
      throw new Error('Local STT provider unavailable');
    }
    return {
      value: input.create(input.fallbackProvider),
      providerRequested,
      providerActual: input.fallbackProvider,
      fallbackReason: 'candidate_initialization_failed',
    };
  }
}

function cpuPlan(label: string, benchmarkRequired: boolean): LocalSttProviderPlan {
  return {
    requestedProviders: ['cpu'],
    fallbackProvider: null,
    cacheConfig: { enabled: false },
    diagnosticLabel: label,
    benchmarkRequired,
  };
}

export function resolveLocalSttProvider(
  platform: NodeJS.Platform | string,
  arch: string,
  engine: LocalSttEngine,
  options: LocalSttProviderOptions = {},
): LocalSttProviderPlan {
  if (engine === 'whisper') {
    if (platform === 'darwin' && arch === 'arm64') {
      return {
        requestedProviders: ['coreml'],
        fallbackProvider: 'cpu',
        cacheConfig: { enabled: false },
        diagnosticLabel: 'whisper-coreml',
        benchmarkRequired: false,
      };
    }
    if (platform === 'win32') {
      return {
        requestedProviders: ['dml'],
        fallbackProvider: 'cpu',
        cacheConfig: { enabled: false },
        diagnosticLabel: 'whisper-directml',
        benchmarkRequired: false,
      };
    }
    return cpuPlan('whisper-cpu', false);
  }

  if (platform === 'darwin' && arch === 'arm64') {
    if (!options.benchmarkApproved) {
      return cpuPlan('sensevoice-cpu-benchmark-required', true);
    }
    return {
      requestedProviders: ['coreml'],
      fallbackProvider: 'cpu',
      cacheConfig: { enabled: false },
      diagnosticLabel: 'sensevoice-coreml-benchmark-approved',
      benchmarkRequired: true,
    };
  }

  if (platform === 'win32' && arch === 'x64') {
    if (!options.benchmarkApproved || !options.runtimeSupportsCandidate) {
      return cpuPlan('sensevoice-cpu-directml-unverified', true);
    }
    return {
      requestedProviders: ['directml'],
      fallbackProvider: 'cpu',
      cacheConfig: { enabled: false },
      diagnosticLabel: 'sensevoice-directml-benchmark-approved',
      benchmarkRequired: true,
    };
  }

  return cpuPlan(platform === 'darwin' ? 'sensevoice-cpu-intel-mac' : 'sensevoice-cpu', true);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function evaluateLocalSttHardwareBenchmark(input: {
  cpuRuns: LocalSttBenchmarkRun[];
  candidateRuns: LocalSttBenchmarkRun[];
  cpuQuality: LocalSttQualityMetrics;
  candidateQuality: LocalSttQualityMetrics;
}): { approved: boolean; rtfImprovement: number; reasons: string[] } {
  const reasons: string[] = [];
  if (input.cpuRuns.length < 3 || input.candidateRuns.length < 3) reasons.push('insufficient_runs');
  if (input.cpuRuns.some(run => run.error) || input.candidateRuns.some(run => run.error)) {
    reasons.push('provider_error');
  }
  const cpuMedian = median(input.cpuRuns.map(run => run.rtf));
  const candidateMedian = median(input.candidateRuns.map(run => run.rtf));
  const rtfImprovement = cpuMedian > 0 ? (cpuMedian - candidateMedian) / cpuMedian : 0;
  if (rtfImprovement < 0.2) reasons.push('rtf_gain_below_20_percent');
  if (input.candidateQuality.characterErrorRate > input.cpuQuality.characterErrorRate) {
    reasons.push('character_error_rate_regressed');
  }
  if (input.candidateQuality.keywordRecall < input.cpuQuality.keywordRecall) {
    reasons.push('keyword_recall_regressed');
  }
  return { approved: reasons.length === 0, rtfImprovement, reasons };
}
