/**
 * RestSTT - REST-based Speech-to-Text for Groq, OpenAI Whisper, ElevenLabs, Azure, and IBM Watson
 *
 * Implements the same EventEmitter interface as GoogleSTT:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk: Buffer)
 *
 * Buffers raw PCM chunks, prepends a WAV header, and uploads via REST every ~3 seconds.
 * Supports two upload modes:
 *   - Multipart FormData (Groq, OpenAI, ElevenLabs)
 *   - Raw binary body (Azure, IBM Watson)
 */

import axios from 'axios';
import FormData from 'form-data';
import { RECOGNITION_LANGUAGES } from '../config/languages';
import {
    QCLOUD_LLM_BASE_URL,
    QCLOUD_STT_QUERY_ENDPOINT,
    QCLOUD_STT_SUBMIT_ENDPOINT,
} from '../llm/QCloudLlmConstants';
import { BaseSTT } from './BaseSTT';
import {
    extractDoubaoAucTranscript,
    extractDoubaoAucTranscriptionJson,
    transcribeDoubaoAucFile,
    transcribeNewApiDoubaoAucMultipartFile,
    type DoubaoAucTranscriptionResult,
    type DoubaoAucUtterance,
} from './doubaoAucClient';
import { SpeakerDiarizationAligner } from './SpeakerDiarizationAligner';
import { buffer16ToFloat32 } from '../services/speaker/speakerAudioUtils';
import {
    buildSegmentationDiagnostics,
    buildSttSegmentPlan,
    dedupeOverlappedTranscript,
} from './SttSegmentation';

export type RestSttProvider = 'groq' | 'openai' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'doubao' | 'doubao-auc' | 'qcloud-stt';
export type SpeakerSeparationMode = 'auto' | 'off';

interface RestSttOptions {
    speakerSeparationMode?: SpeakerSeparationMode;
    speaker?: 'interviewer' | 'user';
}

interface RestSttProviderConfig {
    endpoint: string;
    model: string;
    authHeader: Record<string, string>;
    uploadType: 'multipart' | 'binary' | 'json' | 'auc-multipart';
    extraFormFields?: Record<string, string>;
    buildMultipartFields?: () => Record<string, string>;
    /** Extract transcript text from the API response */
    extractTranscript: (data: any) => string;
    /** For async providers: submit endpoint (if different from query endpoint) */
    submitEndpoint?: string;
    /** For async providers: query endpoint */
    queryEndpoint?: string;
    /** For async providers: build the request body from audio buffer */
    buildRequestBody?: (audioBase64: string, mimeType: string) => any;
    supportsDiarization?: boolean;
    diarizationMode?: 'none' | 'provider-utterances';
}

type ProviderConfigFactory = (apiKey: string, region?: string, languageKey?: string, options?: RestSttOptions) => RestSttProviderConfig;

const PROVIDER_CONFIGS: Record<RestSttProvider, ProviderConfigFactory> = {
    groq: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
            model: 'whisper-large-v3-turbo',
            authHeader: { Authorization: `Bearer ${apiKey}` },
            uploadType: 'multipart',
            extraFormFields: {
                temperature: '0',
                response_format: 'json',
                ...(lang ? { language: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    openai: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.openai.com/v1/audio/transcriptions',
            model: 'whisper-1',
            authHeader: { Authorization: `Bearer ${apiKey}` },
            uploadType: 'multipart',
            extraFormFields: {
                ...(lang ? { language: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    elevenlabs: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.elevenlabs.io/v1/speech-to-text',
            model: 'scribe_v2',
            authHeader: { 'xi-api-key': apiKey },
            uploadType: 'multipart',
            extraFormFields: {
                ...(lang ? { language_code: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    azure: (apiKey, region = 'eastus', languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.bcp47 : undefined;
        const finalLang = lang || 'en-US';
        return {
            endpoint: `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${finalLang}`,
            model: '',
            authHeader: { 'Ocp-Apim-Subscription-Key': apiKey },
            uploadType: 'binary',
            extractTranscript: (data: any) => {
                return data?.DisplayText ?? '';
            },
        };
    },
    ibmwatson: (apiKey, region = 'us-south', languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.bcp47 : undefined;
        const finalLang = lang || 'en-US';
        return {
            endpoint: `https://api.${region}.speech-to-text.watson.cloud.ibm.com/v1/recognize?language=${finalLang}`,
            model: '',
            authHeader: { Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}` },
            uploadType: 'binary',
            extractTranscript: (data: any) => {
                try {
                    return data?.results?.[0]?.alternatives?.[0]?.transcript ?? '';
                } catch {
                    return '';
                }
            },
        };
    },
    doubao: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://ark.cn-beijing.volces.com/api/v3/audio/transcriptions',
            model: 'volc.seedasr.sauc.duration',
            authHeader: { Authorization: `Bearer ${apiKey}` },
            uploadType: 'multipart',
            extraFormFields: {
                ...(lang ? { language: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    'doubao-auc': (apiKey, region, languageKey, options) => {
        // New console API uses single X-Api-Key header (no more AppId|AccessKey)
        const authHeader: Record<string, string> = {
            'X-Api-Key': apiKey.trim(),
            'X-Api-Resource-Id': 'volc.seedasr.auc',
        };
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.bcp47 : undefined;
        const speakerSeparationMode = options?.speakerSeparationMode ?? 'auto';
        const languageSupportsSpeakerSeparation = !lang || lang === 'zh-CN';
        const enableSpeakerSeparation = speakerSeparationMode === 'auto' && languageSupportsSpeakerSeparation;

        return {
            endpoint: 'https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel',
            model: 'volc.seedasr.auc',
            authHeader,
            uploadType: 'json',
            submitEndpoint: 'https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/submit',
            queryEndpoint: 'https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/query',
            supportsDiarization: true,
            diarizationMode: 'provider-utterances',
            buildRequestBody: (audioBase64: string, mimeType: string) => {
                const format = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp3') ? 'mp3' : 'wav';
                return {
                    user: { uid: 'cluely-user' },
                    audio: {
                        data: audioBase64,
                        format: format,
                        codec: 'raw',
                        rate: 16000,
                        bits: 16,
                        channel: 1,
                        ...(lang ? { language: lang } : {}),
                    },
                    request: {
                        model_name: 'bigmodel',
                        enable_itn: true,
                        enable_punc: true,
                        enable_ddc: false,
                        enable_speaker_info: enableSpeakerSeparation,
                        ...(enableSpeakerSeparation ? { ssd_version: '200' } : {}),
                        enable_channel_split: false,
                        show_utterances: true,
                        vad_segment: true,
                    },
                };
            },
            extractTranscript: extractDoubaoAucTranscript,
        };
    },
    'qcloud-stt': (apiKey, _region, languageKey, options) => {
        const requestedLanguage = languageKey || 'auto';
        const requestedBcp47 = requestedLanguage !== 'auto'
            ? RECOGNITION_LANGUAGES[requestedLanguage]?.bcp47
            : undefined;
        const speakerSeparationMode = options?.speakerSeparationMode ?? 'auto';
        const languageSupportsSpeakerSeparation =
            requestedLanguage === 'auto'
            || requestedLanguage === 'chinese'
            || requestedBcp47 === 'zh-CN';
        const enableSpeakerSeparation =
            speakerSeparationMode === 'auto' && languageSupportsSpeakerSeparation;

        return {
            endpoint: `${QCLOUD_LLM_BASE_URL}/v1/doubao/audio/auc`,
            submitEndpoint: QCLOUD_STT_SUBMIT_ENDPOINT,
            queryEndpoint: QCLOUD_STT_QUERY_ENDPOINT,
            model: 'bigmodel',
            authHeader: {
                Authorization: `Bearer ${apiKey.trim()}`,
            },
            uploadType: 'auc-multipart',
            supportsDiarization: true,
            diarizationMode: 'provider-utterances',
            buildMultipartFields: () => ({
                model: 'bigmodel',
                enable_speaker_info: enableSpeakerSeparation ? 'true' : 'false',
                enable_emotion_detection: 'true',
                show_utterances: 'true',
                enable_itn: 'true',
            }),
            extractTranscript: extractDoubaoAucTranscript,
        };
    },
};

// Minimum buffer size before sending (avoid sending tiny fragments)
// 16kHz * 2 bytes/sample * 1 channel * 0.125 seconds = 4000 bytes
// Lowered from 16000 to allow short command utterances ("Yes", "Stop") to flush instantly.
const MIN_BUFFER_BYTES = 4000;

// Safety-net upload interval (ms). Primary flush is triggered by speech_ended events.
// This fires as a backstop if someone talks continuously for >10s without any pause,
// preventing unbounded buffer growth and Whisper API timeouts.
const SAFETY_NET_INTERVAL_MS = 10000;

// Silence threshold - if RMS is below this, skip the upload
const SILENCE_RMS_THRESHOLD = 50;
const AUC_MIC_SILENCE_RMS_THRESHOLD = 15;
const REST_STT_SEGMENT_DURATION_SEC = 10;
const REST_STT_SEGMENT_OVERLAP_SEC = 2;
const REST_STT_SEGMENT_PRE_ROLL_SEC = 1;
const REST_STT_SEGMENT_POST_ROLL_SEC = 1;
const REST_STT_MIN_SEGMENTED_UPLOAD_SEC = 12;

export class RestSTT extends BaseSTT {
    private provider: RestSttProvider;
    private apiKey: string;
    private region?: string;
    private config: RestSttProviderConfig;
    private options: RestSttOptions;
    private diarizationAligner: SpeakerDiarizationAligner;

    private chunks: Buffer[] = [];
    private totalBufferedBytes = 0;
    private safetyNetTimer: NodeJS.Timeout | null = null;
    private isUploading = false;
    private flushPending = false;  // Bug #2 fix: queue flush when upload in progress
    private currentUploadPromise: Promise<void> | null = null;

    // Audio config (must match SystemAudioCapture output)
    private bitsPerSample = 16;

    constructor(provider: RestSttProvider, apiKey: string, modelOverride?: string, region?: string, options: RestSttOptions = {}) {
        super();
        this.provider = provider;
        this.apiKey = apiKey;
        this.region = region;
        this.options = { speaker: 'interviewer', ...options };
        this.config = PROVIDER_CONFIGS[provider](apiKey, region, undefined, this.options);
        this.diarizationAligner = new SpeakerDiarizationAligner(this.options.speaker || 'interviewer');
        if (modelOverride) {
            this.config.model = modelOverride;
        }
        console.log(`[RestSTT] Initialized for provider: ${provider}, model: ${this.config.model || '(default)'}`);
    }

    /**
     * Update API key (e.g., when user saves a new key)
     */
    setApiKey(apiKey: string): void {
        this.apiKey = apiKey;
        this.config = PROVIDER_CONFIGS[this.provider](apiKey, this.region, this._languageKey, this.options);
        console.log(`[RestSTT] API key updated for ${this.provider}`);
    }

    /**
     * Update sample rate to match the audio source
     */
    setSampleRate(rate: number): void {
        if (this._sampleRate === rate) return;
        console.log(`[RestSTT] Updating sample rate to ${rate}Hz`);
        this._sampleRate = rate;
    }

    /**
     * Update channel count
     */
    setAudioChannelCount(count: number): void {
        if (this._numChannels === count) return;
        console.log(`[RestSTT] Updating channel count to ${count}`);
        this._numChannels = count;
    }

    /**
     * Update recognition language
     */
    setRecognitionLanguage(key: string): void {
        this._languageKey = key;
        console.log(`[RestSTT] Updating recognition language to: ${key}`);
        this.config = PROVIDER_CONFIGS[this.provider](this.apiKey, this.region, key, this.options);
    }

    /**
     * No-op for RestSTT (no Google credentials needed)
     */
    setCredentials(_keyFilePath: string): void {
        console.log(`[RestSTT] setCredentials called (no-op for REST provider)`);
    }

    /**
     * Start the upload timer
     */
    public start(): void {
        if (this._isActive) return;

        console.log(`[RestSTT] Starting (${this.provider})...`);
        this._isActive = true;
        this.chunks = [];
        this.totalBufferedBytes = 0;

        // Safety-net timer: flush even during continuous speech to prevent
        // unbounded buffer growth and Whisper API file-size/timeout errors.
        // Primary flush is driven by Rust speech_ended events.
        this.safetyNetTimer = setInterval(() => {
            void this.flushAndUpload('safety-net');
        }, SAFETY_NET_INTERVAL_MS);
    }

    /**
     * Stop the upload timer and flush remaining buffer
     */
    stop(): void {
        if (!this._isActive) return;

        console.log(`[RestSTT] Stopping (${this.provider})...`);
        this._isActive = false;

        if (this.safetyNetTimer) {
            clearInterval(this.safetyNetTimer);
            this.safetyNetTimer = null;
        }

        // Flush remaining audio
        void this.flushAndUpload('stop');
    }

    /**
     * Write raw PCM audio data to the internal buffer
     */
    write(audioData: Buffer): void {
        if (!this._isActive) return;
        this.chunks.push(audioData);
        this.totalBufferedBytes += audioData.length;
    }

    /**
     * Called when the native SilenceSuppressor detects speech has ended.
     * The internal Rust engine already applies a 150-200ms VAD hangover to avoid
     * word-breaks, so we flush immediately without adding redundant TS debouncing.
     */
    notifySpeechEnded(): void {
        if (!this._isActive) return;

        console.log(`[RestSTT] Speech ended detected by native VAD — flushing buffer immediately`);
        void this.flushAndUpload('speech-ended');
    }

    finalize(): void {
        if (!this._isActive) return;
        console.log(`[RestSTT] Finalize — flushing buffer immediately`);
        void this.flushAndUpload('finalize');
    }

    async drainFinals(timeoutMs: number = 5000): Promise<void> {
        this.finalize();

        const startedAt = Date.now();
        while (this.isUploading || this.flushPending || this.currentUploadPromise) {
            const remainingMs = timeoutMs - (Date.now() - startedAt);
            if (remainingMs <= 0) {
                console.warn(`[RestSTT] drainFinals timed out after ${timeoutMs}ms; continuing with pending upload`);
                return;
            }

            const inFlight = this.currentUploadPromise;
            if (inFlight) {
                await Promise.race([
                    inFlight.catch((): void => undefined),
                    new Promise<void>(resolve => setTimeout(resolve, Math.min(remainingMs, 50))),
                ]);
            } else {
                await new Promise<void>(resolve => setTimeout(resolve, Math.min(remainingMs, 50)));
            }
        }
    }

    /**
     * Concatenate buffered chunks, add WAV header, and upload to REST API
     */
    private async flushAndUpload(trigger: string = 'manual'): Promise<void> {
        // Skip if no data
        if (this.chunks.length === 0 || this.totalBufferedBytes < MIN_BUFFER_BYTES) {
            if (trigger !== 'safety-net') {
                const reason = this.chunks.length === 0 ? 'empty-buffer' : 'below-min-buffer';
                console.log(
                    `[RestSTT] Flush skipped (${reason})`,
                    {
                        provider: this.provider,
                        trigger,
                        chunks: this.chunks.length,
                        bufferedBytes: this.totalBufferedBytes,
                        minBytes: MIN_BUFFER_BYTES,
                    },
                );
            }
            return;
        }

        // Bug #2 fix: if currently uploading, queue a flush for when it completes
        if (this.isUploading) {
            this.flushPending = true;
            return this.currentUploadPromise ?? Promise.resolve();
        }

        // Reset safety-net timer to prevent double-flush
        if (this.safetyNetTimer) {
            clearInterval(this.safetyNetTimer);
            this.safetyNetTimer = setInterval(() => {
                void this.flushAndUpload('safety-net');
            }, SAFETY_NET_INTERVAL_MS);
        }

        // Grab current buffer and reset
        const currentChunks = this.chunks;
        this.chunks = [];
        const currentBytes = this.totalBufferedBytes;
        this.totalBufferedBytes = 0;

        // Concatenate all chunks
        const rawPcm = Buffer.concat(currentChunks);

        // Check for silence (skip upload if audio is too quiet)
        const level = this.measurePcm16Level(rawPcm);
        const silenceThreshold = this.getSilenceRmsThreshold();
        if (level.rms < silenceThreshold) {
            console.log(`[RestSTT] Skipping silent buffer`, {
                provider: this.provider,
                speaker: this.options.speaker,
                trigger,
                bytes: rawPcm.length,
                rms: level.rms,
                peak: level.peak,
                threshold: silenceThreshold,
                sampleRate: this._sampleRate,
                channels: this._numChannels,
            });
            return;
        }

        // Resample to 16kHz mono before upload. At 48kHz stereo this produces a
        // 6x smaller WAV file, reducing upload latency and keeping file sizes well
        // under the Groq/OpenAI 25MB limit even for 10-second safety-net flushes.
        const TARGET_RATE = 16_000;
        const pcm16k = this._sampleRate === TARGET_RATE && this._numChannels === 1
            ? rawPcm
            : this.resampleTo16kHz(rawPcm);

        this.isUploading = true;
        const uploadPromise = (async () => {
            const transcript = await this.uploadPcm16kWithSegmentation(pcm16k, trigger);
            await this.emitUploadResult(transcript, pcm16k);
        })()
            .catch(err => {
                console.error(`[RestSTT] Upload error:`, err);
                this.emit('error', err instanceof Error ? err : new Error(String(err)));
            })
            .finally(() => {
                this.isUploading = false;
                if (this.currentUploadPromise === uploadPromise) {
                    this.currentUploadPromise = null;
                }

                // Bug #2 fix: if a flush was requested while we were uploading, process it now
                if (this.flushPending) {
                    this.flushPending = false;
                    void this.flushAndUpload('queued');
                }
            });

        this.currentUploadPromise = uploadPromise;
        return uploadPromise;
    }

    /**
     * Upload WAV audio to the REST endpoint
     */
    private async emitUploadResult(
        transcript: string | DoubaoAucTranscriptionResult,
        pcm16k: Buffer,
    ): Promise<void> {
        if (typeof transcript === 'string') {
            if (transcript && transcript.trim().length > 0) {
                console.log(`[RestSTT] Transcript received`, { length: transcript.trim().length });
                const speakerVerification = await this.speakerVerificationAnnotator?.annotate(buffer16ToFloat32(pcm16k));
                this.emit('transcript', {
                    text: transcript.trim(),
                    isFinal: true,
                    confidence: 1.0,
                    ...(speakerVerification ? { speakerVerification } : {}),
                });
            }
            return;
        }

        if (!transcript || !Array.isArray(transcript.utterances)) return;
        const aligned = this.diarizationAligner.align({
            utterances: transcript.utterances,
            emitAfterMs: 0,
        });

        for (const utterance of aligned) {
            if (!utterance.text.trim()) continue;
            const utteranceSamples = this.slicePcm16kByTime(pcm16k, utterance.startMs, utterance.endMs);
            const speakerVerification = await this.speakerVerificationAnnotator?.annotate(utteranceSamples);
            const emotionMetadata = utterance.emotion && utterance.emotion !== 'neutral'
                ? { emotion: utterance.emotion, emotionSource: 'qcloud' as const }
                : {};
            this.emit('transcript', {
                text: utterance.text.trim(),
                isFinal: true,
                confidence: 1.0,
                speakerId: utterance.speakerId,
                speakerLabel: utterance.speakerLabel,
                providerSpeakerId: utterance.providerSpeakerId,
                diarizationProvider: 'doubao-auc',
                startTimestampMs: utterance.startMs,
                endTimestampMs: utterance.endMs,
                ...emotionMetadata,
                ...(speakerVerification ? { speakerVerification } : {}),
            });
        }
    }

    private slicePcm16kByTime(pcm16k: Buffer, startMs?: number, endMs?: number): Float32Array {
        if (startMs == null || endMs == null || endMs <= startMs) {
            return buffer16ToFloat32(pcm16k);
        }
        const startByte = Math.max(0, Math.floor((startMs / 1000) * 16000) * 2);
        const endByte = Math.min(pcm16k.length, Math.ceil((endMs / 1000) * 16000) * 2);
        return buffer16ToFloat32(pcm16k.subarray(startByte, endByte));
    }

    private shouldUseSegmentedUpload(pcm16k: Buffer): boolean {
        if (this.provider !== 'qcloud-stt' && this.provider !== 'doubao-auc') return false;
        const durationSec = pcm16k.length / (16_000 * 2);
        return durationSec >= REST_STT_MIN_SEGMENTED_UPLOAD_SEC;
    }

    private slicePcm16kBySeconds(pcm16k: Buffer, startSec: number, durationSec: number): Buffer {
        const startByte = Math.max(0, Math.floor(startSec * 16_000) * 2);
        const endByte = Math.min(pcm16k.length, Math.ceil((startSec + durationSec) * 16_000) * 2);
        return pcm16k.subarray(startByte, endByte);
    }

    private textFromUploadResult(result: string | DoubaoAucTranscriptionResult): string {
        if (typeof result === 'string') return result;
        if (typeof result.text === 'string' && result.text.trim()) return result.text;
        return (result.utterances || []).map((utterance) => utterance.text || '').join('');
    }

    private offsetDoubaoAucResult(
        result: DoubaoAucTranscriptionResult,
        offsetMs: number,
    ): DoubaoAucTranscriptionResult {
        return {
            ...result,
            utterances: Array.isArray(result.utterances)
                ? result.utterances.map((utterance) => ({
                    ...utterance,
                    startMs: typeof utterance.startMs === 'number' ? utterance.startMs + offsetMs : utterance.startMs,
                    endMs: typeof utterance.endMs === 'number' ? utterance.endMs + offsetMs : utterance.endMs,
                }))
                : [],
        };
    }

    private mergeDoubaoAucSegmentResults(results: DoubaoAucTranscriptionResult[]): DoubaoAucTranscriptionResult {
        const utterances = results
            .flatMap((result) => Array.isArray(result.utterances) ? result.utterances : [])
            .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
        const deduped: DoubaoAucUtterance[] = [];
        for (const utterance of utterances) {
            const previous = deduped[deduped.length - 1];
            if (previous && previous.text?.trim() === utterance.text?.trim()) continue;
            deduped.push(utterance);
        }
        return {
            ...results[0],
            text: dedupeOverlappedTranscript(results.map((result) => this.textFromUploadResult(result))),
            utterances: deduped,
        };
    }

    public async uploadPcm16kWithSegmentation(
        pcm16k: Buffer,
        trigger: string = 'manual',
    ): Promise<string | DoubaoAucTranscriptionResult> {
        if (!this.shouldUseSegmentedUpload(pcm16k)) {
            const result = await this.uploadAudio(this.addWavHeader(pcm16k, 16_000));
            const text = this.textFromUploadResult(result);
            const diagnostics = buildSegmentationDiagnostics({
                mode: 'full',
                overlapSec: 0,
                rawText: text,
                dedupedText: text,
                segmentCount: 1,
                failedSegmentCount: 0,
            });
            this.emitWarning({
                code: 'stt_segmentation_diagnostics',
                message: 'STT single upload diagnostics recorded',
                provider: this.provider,
                trigger: 'single-upload',
                rawChars: diagnostics.rawChars,
                dedupedChars: diagnostics.dedupedChars,
                removedDuplicateChars: diagnostics.removedDuplicateChars,
                warnings: diagnostics.warnings,
            });
            return result;
        }

        const durationSec = pcm16k.length / (16_000 * 2);
        const plan = buildSttSegmentPlan({
            mode: 'overlap',
            sourceStartSec: 0,
            sourceDurationSec: durationSec,
            segmentDurationSec: REST_STT_SEGMENT_DURATION_SEC,
            overlapSec: REST_STT_SEGMENT_OVERLAP_SEC,
            preRollSec: REST_STT_SEGMENT_PRE_ROLL_SEC,
            postRollSec: REST_STT_SEGMENT_POST_ROLL_SEC,
        });
        const rawTexts: string[] = [];
        const aucResults: DoubaoAucTranscriptionResult[] = [];
        let failedSegmentCount = 0;

        for (const segment of plan.segments) {
            try {
                const segmentPcm = this.slicePcm16kBySeconds(pcm16k, segment.audioStartSec, segment.audioDurationSec);
                const result = await this.uploadAudio(this.addWavHeader(segmentPcm, 16_000));
                rawTexts.push(this.textFromUploadResult(result));
                if (typeof result !== 'string') {
                    aucResults.push(this.offsetDoubaoAucResult(result, Math.round(segment.audioStartSec * 1000)));
                }
            } catch (error) {
                failedSegmentCount += 1;
                this.emitWarning({
                    code: 'partial_segment_failure',
                    message: 'One STT segment failed during segmented upload',
                    provider: this.provider,
                    segmentId: segment.id,
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                });
            }
        }

        if (rawTexts.length === 0 && aucResults.length === 0) {
            throw new Error('All STT segments failed during segmented upload');
        }

        const rawText = rawTexts.join('');
        const dedupedText = dedupeOverlappedTranscript(rawTexts);
        const diagnostics = buildSegmentationDiagnostics({
            mode: 'overlap',
            overlapSec: REST_STT_SEGMENT_OVERLAP_SEC,
            rawText,
            dedupedText,
            segmentCount: plan.segments.length,
            failedSegmentCount,
        });
        this.emitWarning({
            code: 'stt_segmentation_diagnostics',
            message: 'STT segmented upload diagnostics recorded',
            provider: this.provider,
            trigger: 'segmented-upload',
            flushTrigger: trigger,
            rawChars: diagnostics.rawChars,
            dedupedChars: diagnostics.dedupedChars,
            removedDuplicateChars: diagnostics.removedDuplicateChars,
            warnings: diagnostics.warnings,
        });

        if (aucResults.length > 0) {
            return this.mergeDoubaoAucSegmentResults(aucResults);
        }
        return dedupedText;
    }

    private async uploadAudio(wavBuffer: Buffer): Promise<string | DoubaoAucTranscriptionResult> {
        if (this.config.uploadType === 'binary') {
            return this.uploadBinary(wavBuffer);
        }
        if (this.config.uploadType === 'json') {
            return this.uploadJson(wavBuffer);
        }
        if (this.config.uploadType === 'auc-multipart') {
            return this.uploadAucMultipart(wavBuffer);
        }
        return this.uploadMultipart(wavBuffer);
    }

    /**
     * Upload via multipart FormData (Groq, OpenAI, ElevenLabs)
     */
    private async uploadMultipart(wavBuffer: Buffer): Promise<string> {
        const form = new FormData();

        form.append('file', wavBuffer, {
            filename: 'audio.wav',
            contentType: 'audio/wav',
        });

        // ElevenLabs uses 'model_id' instead of 'model'
        if (this.provider === 'elevenlabs') {
            form.append('model_id', this.config.model);
        } else {
            form.append('model', this.config.model);
        }

        if (this.config.extraFormFields) {
            for (const [key, value] of Object.entries(this.config.extraFormFields)) {
                form.append(key, value);
            }
        }

        const response = await axios.post(this.config.endpoint, form, {
            headers: {
                ...this.config.authHeader,
                ...form.getHeaders(),
            },
            timeout: 30000,
        });

        return this.config.extractTranscript(response.data);
    }

    /**
     * Upload via raw binary body (Azure, IBM Watson)
     */
    private async uploadBinary(wavBuffer: Buffer): Promise<string> {
        const response = await axios.post(this.config.endpoint, wavBuffer, {
            headers: {
                ...this.config.authHeader,
                'Content-Type': 'audio/wav',
            },
            timeout: 30000,
        });

        return this.config.extractTranscript(response.data);
    }

    /**
     * Upload via new-api Doubao AUC multipart submit + task_id JSON query (QCLOUD API).
     */
    private async uploadAucMultipart(wavBuffer: Buffer): Promise<string | DoubaoAucTranscriptionResult> {
        const jsonText = await transcribeNewApiDoubaoAucMultipartFile({
            submitEndpoint: this.config.submitEndpoint || this.config.endpoint,
            queryEndpoint: this.config.queryEndpoint || this.config.endpoint,
            authHeader: this.config.authHeader,
            audioBuffer: wavBuffer,
            filename: 'audio.wav',
            contentType: 'audio/wav',
            formFields: this.config.buildMultipartFields?.() || {},
            extractTranscript: extractDoubaoAucTranscriptionJson,
            post: (url, body, options) => axios.post(url, body, options),
            logger: console,
        });
        try {
            return JSON.parse(jsonText) as DoubaoAucTranscriptionResult;
        } catch {
            return jsonText;
        }
    }

    /**
     * Upload via JSON body with Base64 audio (Doubao AUC)
     * Two-step async process: submit -> query for results
     */
    private async uploadJson(wavBuffer: Buffer): Promise<string | DoubaoAucTranscriptionResult> {
        const submitEndpoint = this.config.submitEndpoint || this.config.endpoint;
        const queryEndpoint = this.config.queryEndpoint || this.config.endpoint;

        // Convert WAV buffer to Base64
        const audioBase64 = wavBuffer.toString('base64');
        const mimeType = 'audio/wav';

        // Build request body
        const requestBody = this.config.buildRequestBody
            ? this.config.buildRequestBody(audioBase64, mimeType)
            : { audio: audioBase64 };

        if (this.config.supportsDiarization && requestBody?.request?.enable_speaker_info) {
            const jsonText = await transcribeDoubaoAucFile({
                submitEndpoint,
                queryEndpoint,
                authHeader: this.config.authHeader,
                requestBody,
                extractTranscript: extractDoubaoAucTranscriptionJson,
                post: (url, body, options) => axios.post(url, body, options),
                logger: console,
            });
            try {
                return JSON.parse(jsonText) as DoubaoAucTranscriptionResult;
            } catch {
                return jsonText;
            }
        }

        return transcribeDoubaoAucFile({
            submitEndpoint,
            queryEndpoint,
            authHeader: this.config.authHeader,
            requestBody,
            extractTranscript: this.config.extractTranscript,
            post: (url, body, options) => axios.post(url, body, options),
            logger: console,
        });
    }

    /**
     * Resample Int16LE PCM from inputRate/numChannels → 16kHz mono.
     * Uses integer decimation (same approach as Rust DSP and OpenAIStreamingSTT).
     * Returns a new Buffer containing the resampled 16-bit mono PCM.
     */
    private resampleTo16kHz(raw: Buffer): Buffer {
        const TARGET_RATE = 16_000;

        // Build Int16Array from the raw buffer using safe byte-by-byte reads
        // to avoid alignment issues with unaligned ArrayBuffer slices.
        const numSamples = Math.floor(raw.length / 2);
        const inputS16 = new Int16Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            inputS16[i] = raw.readInt16LE(i * 2);
        }

        // Already at target rate and mono — return as-is
        if (this._sampleRate === TARGET_RATE && this._numChannels === 1) {
            return Buffer.from(inputS16.buffer);
        }

        // Mix down multi-channel to mono
        let monoS16: Int16Array;
        if (this._numChannels > 1) {
            const monoLen = Math.floor(inputS16.length / this._numChannels);
            monoS16 = new Int16Array(monoLen);
            for (let i = 0; i < monoLen; i++) {
                let sum = 0;
                for (let c = 0; c < this._numChannels; c++) {
                    sum += inputS16[i * this._numChannels + c];
                }
                monoS16[i] = Math.round(sum / this._numChannels);
            }
        } else {
            monoS16 = inputS16;
        }

        // Decimate to target rate
        if (this._sampleRate === TARGET_RATE) {
            return Buffer.from(monoS16.buffer);
        }

        const factor = this._sampleRate / TARGET_RATE;
        const outLen = Math.floor(monoS16.length / factor);
        const outS16 = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) {
            outS16[i] = monoS16[Math.floor(i * factor)];
        }
        return Buffer.from(outS16.buffer);
    }

    /**
     * Check if audio buffer is essentially silence
     */
    protected isSilent(pcmBuffer: Buffer): boolean {
        return this.measurePcm16Level(pcmBuffer).rms < this.getSilenceRmsThreshold();
    }

    private getSilenceRmsThreshold(): number {
        if ((this.provider === 'doubao-auc' || this.provider === 'qcloud-stt') && this.options.speaker === 'user') {
            return AUC_MIC_SILENCE_RMS_THRESHOLD;
        }
        return SILENCE_RMS_THRESHOLD;
    }

    private measurePcm16Level(pcmBuffer: Buffer): { rms: number; peak: number; sampledFrames: number } {
        let sum = 0;
        const step = 20; // Sample every 20th sample for speed
        let count = 0;
        let peak = 0;

        for (let i = 0; i < pcmBuffer.length - 1; i += 2 * step) {
            const sample = pcmBuffer.readInt16LE(i);
            const abs = Math.abs(sample);
            sum += sample * sample;
            if (abs > peak) peak = abs;
            count++;
        }

        if (count === 0) return { rms: 0, peak: 0, sampledFrames: 0 };
        const rms = Math.sqrt(sum / count);
        return { rms, peak, sampledFrames: count };
    }

    /**
     * Add a WAV RIFF header to raw PCM data.
     * channels defaults to 1 (mono) because callers always resample to mono first.
     * Critical: Most REST STT APIs require a valid WAV file, NOT raw PCM.
     */
    protected addWavHeader(samples: Buffer, sampleRate: number = 16_000, channels: number = 1): Buffer {
        const buffer = Buffer.alloc(44 + samples.length);
        // RIFF chunk descriptor
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + samples.length, 4);
        buffer.write('WAVE', 8);
        // fmt sub-chunk
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
        buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
        buffer.writeUInt16LE(channels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(sampleRate * channels * (this.bitsPerSample / 8), 28); // ByteRate
        buffer.writeUInt16LE(channels * (this.bitsPerSample / 8), 32);              // BlockAlign
        buffer.writeUInt16LE(this.bitsPerSample, 34);
        // data sub-chunk
        buffer.write('data', 36);
        buffer.writeUInt32LE(samples.length, 40);
        // Copy raw PCM data
        samples.copy(buffer, 44);

        return buffer;
    }
}
