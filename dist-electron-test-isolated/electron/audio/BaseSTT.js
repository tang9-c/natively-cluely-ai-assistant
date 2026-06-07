"use strict";
/**
 * BaseSTT — Abstract base class for all Speech-to-Text providers.
 *
 * Every STT provider extends this class and implements the core audio pipeline:
 *   start()  → begin receiving audio
 *   stop()   → flush and shut down
 *   write()  → feed raw PCM audio chunks
 *
 * Optional capabilities are exposed as overridable no-ops so main.ts can call
 * them without instanceof checks or type casts:
 *   finalize()              — force a final transcript flush
 *   setAudioChannelCount()  — stereo vs mono
 *   notifySpeechEnded()     — native VAD speech-end callback
 *   setSampleRate()         — input sample rate from capture pipeline
 *   setCredentials()        — provider-specific credential file path
 *
 * Events (via EventEmitter):
 *   'transcript' ({ text: string, isFinal: boolean, confidence: number })
 *   'error'      (Error)
 *   'warning'    ({ code: string, message: string, ... })
 *   'languageDetected' (string) — auto-detected language code
 *   'buffer-overflow' ({ channel: string })
 *   'persistent-reconnect' ({ attempts: number })
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseSTT = void 0;
const events_1 = require("events");
class BaseSTT extends events_1.EventEmitter {
    _isActive = false;
    _sampleRate = 16000;
    _numChannels = 1;
    _languageKey = 'en';
    // ── Configuration (override when provider supports it) ─────────────────
    /** Input sample rate from the capture pipeline. Subclass should reconnect if needed. */
    setSampleRate(rate) {
        if (this._sampleRate === rate)
            return;
        this._sampleRate = rate;
    }
    /** Number of audio channels. Subclass should reconnect if needed. */
    setAudioChannelCount(count) {
        if (this._numChannels === count)
            return;
        this._numChannels = count;
    }
    /** Recognition language key (e.g. 'english-us', 'auto'). Subclass maps to provider code. */
    setRecognitionLanguage(key) {
        this._languageKey = key;
    }
    /** Provider-specific credential file path (e.g. Google JSON key). No-op for API-key providers. */
    setCredentials(_path) { }
    // ── Optional capabilities (no-op defaults) ─────────────────────────────
    /** Force a final transcript flush. REST providers upload buffered audio. */
    finalize() { }
    /** Called by the native VAD when speech ends. REST providers flush immediately. */
    notifySpeechEnded() { }
    // ── Shared helpers ─────────────────────────────────────────────────────
    emitTranscript(segment) {
        this.emit('transcript', segment);
    }
    emitError(err) {
        this.emit('error', err);
    }
    emitWarning(warning) {
        this.emit('warning', warning);
    }
    /** Resample Int16LE PCM from input rate/numChannels → target rate mono. */
    resampleToTarget(raw, targetRate) {
        const numSamples = Math.floor(raw.length / 2);
        const inputS16 = new Int16Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            inputS16[i] = raw.readInt16LE(i * 2);
        }
        if (this._sampleRate === targetRate && this._numChannels === 1) {
            return Buffer.from(inputS16.buffer);
        }
        let monoS16;
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
        }
        else {
            monoS16 = inputS16;
        }
        if (this._sampleRate === targetRate) {
            return Buffer.from(monoS16.buffer);
        }
        const factor = this._sampleRate / targetRate;
        const outLen = Math.floor(monoS16.length / factor);
        const outS16 = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) {
            outS16[i] = monoS16[Math.floor(i * factor)];
        }
        return Buffer.from(outS16.buffer);
    }
    /** Check if a PCM buffer is essentially silence. */
    isSilent(pcmBuffer, threshold = 50, step = 20) {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < pcmBuffer.length - 1; i += 2 * step) {
            const sample = pcmBuffer.readInt16LE(i);
            sum += sample * sample;
            count++;
        }
        if (count === 0)
            return true;
        const rms = Math.sqrt(sum / count);
        return rms < threshold;
    }
    /** Build a standard WAV RIFF header for mono 16-bit PCM. */
    addWavHeader(samples, sampleRate, channels = 1, bitsPerSample = 16) {
        const buffer = Buffer.alloc(44 + samples.length);
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + samples.length, 4);
        buffer.write('WAVE', 8);
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16);
        buffer.writeUInt16LE(1, 20);
        buffer.writeUInt16LE(channels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
        buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
        buffer.writeUInt16LE(bitsPerSample, 34);
        buffer.write('data', 36);
        buffer.writeUInt32LE(samples.length, 40);
        samples.copy(buffer, 44);
        return buffer;
    }
}
exports.BaseSTT = BaseSTT;
//# sourceMappingURL=BaseSTT.js.map