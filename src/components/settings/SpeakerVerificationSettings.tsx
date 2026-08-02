import React, { useEffect, useRef, useState } from 'react';
import { Circle, Download, Mic, RotateCcw, ShieldCheck, Square, Trash2 } from 'lucide-react';
import type {
  SpeakerEnrollmentSample,
  SpeakerRecordingQualityPolicy,
  SpeakerVerificationStatus,
} from '../../types/electron';

const SPEAKER_MODEL_ID = 'csukuangfj/speaker-embedding-models';

interface LocalSpeakerModelInfo {
  id: string;
  name?: string;
  description?: string;
  sizeMb?: number;
  status?: 'available' | 'missing' | 'downloading' | 'error';
  errorMessage?: string | null;
}

function speakerVerificationHealthMessage(status: SpeakerVerificationStatus | null): string {
  switch (status?.health.state) {
    case 'paused': return '已注册，当前暂停。开启后才会在会议中识别 ME。';
    case 'ready': return '已注册并启用。会议中会尝试识别你的发言为 ME。';
    case 'model_missing': return '已注册，但本地声纹模型缺失，请重新安装模型。';
    case 'model_error': return '已注册，但声纹模型加载失败。';
    case 'degraded': return '已注册，但最近识别质量不稳定。';
    case 'not_enrolled':
    default: return '未注册。注册后可在会议中识别你的发言为 ME。';
  }
}

function sanitizedSpeakerVerificationError(_error: unknown, fallback: string): string {
  return fallback;
}

function sanitizedModelDownloadError(error: unknown): string {
  const value = typeof error === 'string' ? error : '';
  const sanitized = value
    .replace(/https?:\/\/[^\s|)]+/g, (url) => {
      try {
        const parsed = new URL(url);
        parsed.search = '';
        return parsed.toString();
      } catch {
        return url.split('?')[0] || url;
      }
    })
    .replace(/[?&][A-Za-z0-9_.~%+-]+=[A-Za-z0-9_.~%+-]+/g, '')
    .trim();
  return sanitized || '声纹模型安装失败，请检查网络后重试。';
}

const PROMPTS = [
  '今天的会议我们将讨论产品路线图、技术实现和时间表。',
  '接下来请介绍一下客户那边的最新反馈。',
  '请用你平时说话的方式自由讲一小段最近正在处理的事情。',
] as const;

const INTERNAL_DEFAULT_RECORDING_QUALITY_POLICY: SpeakerRecordingQualityPolicy = {
  minDurationMs: 1500,
  minRms: 0.005,
  minVoiceRatio: 0.12,
  voiceSampleThreshold: 0.01,
  minVerificationDurationMs: 1500,
};

type RecordingQualityState = 'listening' | 'too_short' | 'too_quiet' | 'not_enough_voice' | 'ready';

interface RecordedSample {
  samples: Float32Array;
  sampleRate: number;
  deviceFingerprint?: string;
}

interface RecordingMetrics {
  durationMs: number;
  rms: number;
  voiceRatio: number;
  state: RecordingQualityState;
}

interface ActiveRecording {
  tracks: MediaStreamTrack[];
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  chunks: Float32Array[];
  sampleRate: number;
  deviceFingerprint?: string;
}

const EMPTY_RECORDING_METRICS: RecordingMetrics = {
  durationMs: 0,
  rms: 0,
  voiceRatio: 0,
  state: 'listening',
};

function qualityFromMetrics(
  durationMs: number,
  rms: number,
  voiceRatio: number,
  policy: SpeakerRecordingQualityPolicy,
): RecordingMetrics {
  if (durationMs < policy.minDurationMs) {
    return { durationMs, rms, voiceRatio, state: 'too_short' };
  }
  if (rms < policy.minRms) {
    return { durationMs, rms, voiceRatio, state: 'too_quiet' };
  }
  if (voiceRatio < policy.minVoiceRatio) {
    return { durationMs, rms, voiceRatio, state: 'not_enough_voice' };
  }
  return { durationMs, rms, voiceRatio, state: 'ready' };
}

function evaluateRecordingQuality(
  samples: Float32Array,
  sampleRate: number,
  policy: SpeakerRecordingQualityPolicy,
): RecordingMetrics {
  if (samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { ...EMPTY_RECORDING_METRICS, state: 'too_short' };
  }

  let sumSquares = 0;
  let voiced = 0;
  for (const value of samples) {
    sumSquares += value * value;
    if (Math.abs(value) >= policy.voiceSampleThreshold) voiced += 1;
  }

  const durationMs = Math.round((samples.length / sampleRate) * 1000);
  const rms = Math.sqrt(sumSquares / samples.length);
  const voiceRatio = voiced / samples.length;

  return qualityFromMetrics(durationMs, rms, voiceRatio, policy);
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCount(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function enrollmentQualityText(band: NonNullable<SpeakerVerificationStatus['quality']>['qualityBand']): string {
  switch (band) {
    case 'stable': return '稳定';
    case 'weak_boundary': return '边界偏弱，建议在安静环境重录';
    case 'needs_rerecord': return '建议重录';
    default: return '旧版本注册，暂无评分';
  }
}

function enrollmentQualityClassName(band: NonNullable<SpeakerVerificationStatus['quality']>['qualityBand']): string {
  switch (band) {
    case 'stable': return 'text-emerald-300';
    case 'weak_boundary': return 'text-amber-300';
    case 'needs_rerecord': return 'text-red-300';
    default: return 'text-text-tertiary';
  }
}

function recordingQualityMessage(metrics: RecordingMetrics, policy: SpeakerRecordingQualityPolicy): string {
  switch (metrics.state) {
    case 'too_short':
      return `继续说话，还需要至少 ${formatDuration(Math.max(0, policy.minDurationMs - metrics.durationMs))}`;
    case 'too_quiet':
      return '声音偏小，靠近麦克风或提高音量';
    case 'not_enough_voice':
      return '有效语音不足，请连续说完本段提示词';
    case 'ready':
      return '可以停止本段录音';
    case 'listening':
    default:
      return '正在录音，请按提示词自然说话';
  }
}

async function startActiveRecording(
  policy: SpeakerRecordingQualityPolicy,
  onMetrics?: (metrics: RecordingMetrics) => void,
): Promise<ActiveRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let totalSamples = 0;
  let sumSquares = 0;
  let voicedSamples = 0;
  source.connect(processor);
  processor.connect(audioContext.destination);
  processor.onaudioprocess = event => {
    const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
    chunks.push(chunk);
    totalSamples += chunk.length;
    for (const value of chunk) {
      sumSquares += value * value;
      if (Math.abs(value) >= policy.voiceSampleThreshold) voicedSamples += 1;
    }
    const durationMs = Math.round((totalSamples / audioContext.sampleRate) * 1000);
    const rms = Math.sqrt(sumSquares / totalSamples);
    const voiceRatio = voicedSamples / totalSamples;
    onMetrics?.(qualityFromMetrics(durationMs, rms, voiceRatio, policy));
  };
  return {
    tracks: stream.getTracks(),
    audioContext,
    source,
    processor,
    chunks,
    sampleRate: audioContext.sampleRate,
    deviceFingerprint: stream.getAudioTracks()[0]?.label,
  };
}

async function stopActiveRecording(active: ActiveRecording): Promise<RecordedSample> {
  active.processor.disconnect();
  active.source.disconnect();
  active.tracks.forEach(track => track.stop());
  await active.audioContext.close();
  const total = active.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const chunk of active.chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    samples,
    sampleRate: active.sampleRate,
    deviceFingerprint: active.deviceFingerprint,
  };
}

export function SpeakerVerificationSettings() {
  const [status, setStatus] = useState<SpeakerVerificationStatus | null>(null);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [speakerModelInfo, setSpeakerModelInfo] = useState<LocalSpeakerModelInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const [samples, setSamples] = useState<RecordedSample[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingMetrics, setRecordingMetrics] = useState<RecordingMetrics>(EMPTY_RECORDING_METRICS);
  const [qualityPolicy, setQualityPolicy] = useState<SpeakerRecordingQualityPolicy>(INTERNAL_DEFAULT_RECORDING_QUALITY_POLICY);
  const [usingInternalQualityPolicy, setUsingInternalQualityPolicy] = useState(false);
  const mediaRef = useRef<ActiveRecording | null>(null);

  const refresh = async () => {
    const next = await window.electronAPI?.speakerVerificationGetStatus?.();
    if (next) setStatus(next);
    const models = await window.electronAPI?.localModelsGetList?.();
    const speakerModel = models?.models?.find((model: any) => model.id === SPEAKER_MODEL_ID) as LocalSpeakerModelInfo | undefined;
    setSpeakerModelInfo(speakerModel ?? null);
    setModelAvailable(speakerModel?.status === 'available');
    setDownloadError(speakerModel?.status === 'error' ? sanitizedModelDownloadError(speakerModel.errorMessage) : null);
  };

  useEffect(() => {
    void refresh();
    void (async () => {
      try {
        const policy = await window.electronAPI?.speakerVerificationGetQualityPolicy?.();
        if (!policy) throw new Error('speaker_recording_quality_policy_unavailable');
        setQualityPolicy(policy);
        setUsingInternalQualityPolicy(false);
      } catch {
        setQualityPolicy(INTERNAL_DEFAULT_RECORDING_QUALITY_POLICY);
        setUsingInternalQualityPolicy(true);
      }
    })();
    const offProgress = window.electronAPI?.onLocalModelsDownloadProgress?.((payload: { modelId: string; progress: number }) => {
      if (payload.modelId === SPEAKER_MODEL_ID) {
        setDownloadError(null);
        setDownloadProgress(payload.progress);
      }
    });
    const offComplete = window.electronAPI?.onLocalModelsDownloadComplete?.((payload: { modelId: string }) => {
      if (payload.modelId === SPEAKER_MODEL_ID) {
        setDownloadProgress(null);
        setDownloadError(null);
        void refresh();
      }
    });
    const offError = window.electronAPI?.onLocalModelsDownloadError?.((payload: { modelId: string; error: string }) => {
      if (payload.modelId === SPEAKER_MODEL_ID) {
        setDownloadProgress(null);
        setDownloadError(sanitizedModelDownloadError(payload.error));
        void refresh();
      }
    });
    return () => {
      offProgress?.();
      offComplete?.();
      offError?.();
      if (mediaRef.current) {
        void stopActiveRecording(mediaRef.current);
        mediaRef.current = null;
      }
    };
  }, []);

  const downloadModel = async () => {
    setBusy(true);
    setError(null);
    setDownloadError(null);
    setDownloadProgress(0);
    try {
      const result = await window.electronAPI?.localModelsStartDownload?.(SPEAKER_MODEL_ID);
      if (!result?.success) {
        if (result?.error === 'already-downloading') {
          setDownloadProgress(null);
          return;
        }
        setDownloadError(sanitizedModelDownloadError(result?.error));
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const beginRecording = async () => {
    setError(null);
    try {
      const shouldRestart = enrolled || samples.length >= PROMPTS.length;
      if (shouldRestart) {
        setSamples([]);
      }
      setRecordingMetrics(EMPTY_RECORDING_METRICS);
      mediaRef.current = await startActiveRecording(qualityPolicy, setRecordingMetrics);
      setRecordingIndex(shouldRestart ? 0 : samples.length);
    } catch (err: any) {
      setError(sanitizedSpeakerVerificationError(err, '无法启动麦克风录音'));
    }
  };

  const finishRecording = async () => {
    if (!mediaRef.current) return;
    setBusy(true);
    try {
      const sample = await stopActiveRecording(mediaRef.current);
      mediaRef.current = null;
      setRecordingIndex(null);
      const quality = evaluateRecordingQuality(sample.samples, sample.sampleRate, qualityPolicy);
      setRecordingMetrics(quality);
      if (quality.state !== 'ready') {
        setError(`本段录音未达标，请重录。${recordingQualityMessage(quality, qualityPolicy)}`);
        return;
      }
      const next = [...samples, sample];
      setSamples(next);
      if (next.length === PROMPTS.length) {
        const payload: SpeakerEnrollmentSample[] = next.map(item => ({
          samples: Array.from(item.samples),
          sampleRate: item.sampleRate,
          deviceFingerprint: item.deviceFingerprint,
        }));
        const result = await window.electronAPI?.speakerVerificationEnroll?.(payload);
        if (!result?.success) {
        setError(sanitizedSpeakerVerificationError(result?.error, '声音注册失败'));
        } else if (result.status) {
          setStatus(result.status);
          setSamples([]);
        }
      }
    } catch (err: any) {
      setError(sanitizedSpeakerVerificationError(err, '麦克风录音失败'));
    } finally {
      setBusy(false);
      setRecordingIndex(null);
    }
  };

  const cancelRecording = async () => {
    if (mediaRef.current) {
      await stopActiveRecording(mediaRef.current);
      mediaRef.current = null;
    }
    setRecordingIndex(null);
    setRecordingMetrics(EMPTY_RECORDING_METRICS);
  };

  const deleteProfile = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI?.speakerVerificationDeleteProfile?.();
      if (!result?.success) {
        setError(sanitizedSpeakerVerificationError(result?.error, '无法删除声音注册'));
      }
      setConfirmDelete(false);
      setSamples([]);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const setVerificationMode = async (mode: 'off' | 'local') => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI?.setSpeakerVerificationMode?.(mode);
      if (!result?.success) {
        setError(sanitizedSpeakerVerificationError(result?.error, '无法更新本机识别状态'));
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const enrolled = status?.enrolled === true;
  const verificationEnabled = status?.mode === 'local';
  const hasCompleteSampleSet = samples.length >= PROMPTS.length;
  const currentPrompt = PROMPTS[recordingIndex ?? samples.length] ?? PROMPTS[0];
  const recordingQuality = recordingQualityMessage(recordingMetrics, qualityPolicy);
  const recordingButtonTitle = recordingMetrics.state === 'ready' ? '可以停止本段录音' : recordingQuality;
  const verificationStats = status?.stats;
  const totalVerifications = formatCount(verificationStats?.totalVerifications);
  const positiveVerifications = formatCount(verificationStats?.positiveVerifications);
  const lowConfidenceRejections = formatCount(verificationStats?.lowConfidenceRejections);
  const lowQualitySkips = formatCount(verificationStats?.lowQualitySkips);
  const errorOrTimeoutCount = formatCount(verificationStats?.errorCount) + formatCount(verificationStats?.timeoutCount);

  return (
    <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <label className="text-xs font-medium text-text-secondary block">我的声音</label>
          <p className="text-[11px] mt-1 text-text-tertiary">
            {speakerVerificationHealthMessage(status)}
          </p>
          {status?.enrolled && !status.enabled && status.health.state !== 'paused' && (
            <p className="text-[11px] mt-1 text-red-300">当前不可用</p>
          )}
          {status?.enrolledAt && (
            <p className="text-[11px] mt-1 text-text-tertiary">
              注册时间：{new Date(status.enrolledAt).toLocaleString()}
            </p>
          )}
          {error && <p className="text-[11px] mt-2 text-red-400">{error}</p>}
          {usingInternalQualityPolicy && (
            <p className="text-[11px] mt-2 text-amber-300">录音质量标准暂时使用内部默认设置。</p>
          )}
          {!modelAvailable && (
            <p className="text-[11px] mt-2 text-amber-300">
              需要先安装本地声纹模型，安装后才能注册声音。
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!modelAvailable ? (
            <button type="button" onClick={downloadModel} disabled={busy} className="rounded-md p-2 bg-bg-input text-text-secondary hover:text-text-primary disabled:opacity-50" title="安装声纹模型">
              <Download size={14} />
            </button>
          ) : recordingIndex !== null ? (
            <button type="button" onClick={finishRecording} disabled={busy} className="rounded-md p-2 bg-red-500/15 text-red-300 disabled:opacity-50" title={recordingButtonTitle}>
              <Square size={14} />
            </button>
          ) : (
            <button type="button" onClick={beginRecording} disabled={busy} className="rounded-md p-2 bg-accent-primary text-white disabled:opacity-50" title={enrolled ? '重新注册' : hasCompleteSampleSet ? '重新录制' : '开始注册'}>
              {enrolled || hasCompleteSampleSet ? <RotateCcw size={14} /> : <Mic size={14} />}
            </button>
          )}
          {enrolled && (
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} className="rounded-md p-2 bg-bg-input text-text-secondary hover:text-red-300 disabled:opacity-50" title="删除声音注册">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {!modelAvailable && (
        <div className="rounded-lg border border-border-subtle bg-bg-input p-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-text-secondary">
                {speakerModelInfo?.name ?? '本地声纹模型'}
              </p>
              <p className="mt-1 text-[11px] text-text-tertiary">
                {speakerModelInfo?.description ?? '用于在会议中识别你的发言为 ME'}
              </p>
            </div>
            <span className="shrink-0 text-[11px] text-text-tertiary">
              约 {speakerModelInfo?.sizeMb ?? 28} MB
            </span>
          </div>
          {downloadProgress !== null && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-text-tertiary">
                <span>正在安装</span>
                <span>{Math.round(downloadProgress)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-card">
                <div className="h-full bg-accent-primary transition-all" style={{ width: `${downloadProgress}%` }} />
              </div>
            </div>
          )}
          {downloadError && (
            <div className="space-y-2">
              <p className="text-[11px] text-red-300">{downloadError}</p>
              <button
                type="button"
                onClick={downloadModel}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-xs text-white bg-accent-primary disabled:opacity-50"
              >
                重试安装
              </button>
            </div>
          )}
        </div>
      )}

      {enrolled && (
        <div className="rounded-lg border border-border-subtle bg-bg-input p-3 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-text-secondary">
              {verificationEnabled ? '本机识别已开启' : '本机识别已暂停，声纹仍保存在本机'}
            </p>
            <button
              type="button"
              onClick={() => void setVerificationMode(verificationEnabled ? 'off' : 'local')}
              disabled={busy}
              className={`w-11 h-6 rounded-full relative transition-colors shrink-0 disabled:opacity-50 ${verificationEnabled ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
              role="switch"
              aria-checked={verificationEnabled}
              aria-label="本机识别"
            >
              <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${verificationEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          {status?.quality ? (
            <div className="grid grid-cols-2 gap-2 text-[11px] text-text-tertiary">
              <div className="col-span-2">
                <span className="text-text-secondary">注册质量：</span>
                <span className={enrollmentQualityClassName(status.quality.qualityBand)}>
                  {enrollmentQualityText(status.quality.qualityBand)}
                </span>
              </div>
              <div>
                <span className="block text-text-secondary">最低相似度</span>
                {formatPercent(status.quality.minSelfSimilarity)}
              </div>
              <div>
                <span className="block text-text-secondary">平均相似度</span>
                {formatPercent(status.quality.meanSelfSimilarity)}
              </div>
              <div>
                <span className="block text-text-secondary">当前阈值</span>
                {formatPercent(status.quality.calibratedThreshold)}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-text-tertiary">注册质量：旧版本注册，暂无评分</p>
          )}
        </div>
      )}

      {enrolled && (
        <div className="rounded-lg border border-border-subtle bg-bg-input p-3">
          <p className="text-xs font-medium text-text-secondary">最近会议识别</p>
          {totalVerifications === 0 ? (
            <p className="mt-2 text-[11px] text-text-tertiary">暂无会议识别数据</p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-text-tertiary">
              <div>
                <span className="block text-text-secondary">ME 命中</span>
                {positiveVerifications} / {totalVerifications}
              </div>
              <div>
                <span className="block text-text-secondary">低置信拒绝</span>
                {lowConfidenceRejections}
              </div>
              <div>
                <span className="block text-text-secondary">低质量跳过</span>
                {lowQualitySkips}
              </div>
              <div>
                <span className="block text-text-secondary">错误/超时</span>
                {errorOrTimeoutCount}
              </div>
            </div>
          )}
        </div>
      )}

      {(samples.length > 0 || recordingIndex !== null) && (
        <div className="rounded-lg border border-border-subtle bg-bg-input p-3">
          <div className="flex items-center gap-2 text-[11px] text-text-secondary">
            <Circle size={10} className={recordingIndex !== null ? 'fill-red-400 text-red-400' : ''} />
            第 {Math.min(samples.length + 1, PROMPTS.length)} 段 / 共 {PROMPTS.length} 段
          </div>
          <p className="mt-2 text-xs text-text-primary">{currentPrompt}</p>
          {recordingIndex !== null && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <span className="font-medium text-red-300">正在录音</span>
                <span className={recordingMetrics.state === 'ready' ? 'text-emerald-300' : 'text-text-tertiary'}>
                  {recordingQuality}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-text-tertiary">
                <div>
                  <span className="block text-text-secondary">时长</span>
                  {formatDuration(recordingMetrics.durationMs)}
                </div>
                <div>
                  <span className="block text-text-secondary">音量</span>
                  {Math.round(Math.min(1, recordingMetrics.rms / 0.05) * 100)}%
                </div>
                <div>
                  <span className="block text-text-secondary">有效语音</span>
                  {Math.round(recordingMetrics.voiceRatio * 100)}%
                </div>
              </div>
            </div>
          )}
          {recordingIndex !== null && (
            <button type="button" onClick={cancelRecording} className="mt-2 text-[11px] text-text-tertiary hover:text-text-primary">
              取消本段录音
            </button>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border-subtle bg-bg-input p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
          <ShieldCheck size={14} />
          隐私说明
        </div>
        <ul className="mt-2 space-y-1 text-[11px] text-text-tertiary">
          <li>声音注册只会在会议中识别你的发言为 ME。</li>
          <li>声纹数据仅保存在本机，不会保存注册录音。</li>
          <li>不会用于登录、认证、安全审核、广告或跨设备身份。</li>
          <li>删除后会硬删除本地声纹向量和统计信息，不会默认改写历史会议。</li>
        </ul>
      </div>

      {confirmDelete && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-red-200">删除声音注册？</p>
            <p className="text-[11px] mt-1 text-red-100/80">
              删除后，CueUp 将不再识别你的发言为 ME。历史会议不会自动改写。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md px-3 py-1.5 text-xs text-text-secondary bg-bg-input">
              取消
            </button>
            <button type="button" onClick={deleteProfile} className="rounded-md px-3 py-1.5 text-xs text-white bg-red-500">
              删除声音注册
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
