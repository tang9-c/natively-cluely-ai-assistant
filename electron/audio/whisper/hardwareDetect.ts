import os from 'os';

export type HardwareTier = 'excellent' | 'good' | 'limited';

export interface HardwareInfo {
    arch: string;
    platform: string;
    cpuModel: string;
    isAppleSilicon: boolean;
    totalRamGb: number;
    tier: HardwareTier;
    recommendation: string;
    recommendedModel: string;
}

export function detectHardware(): HardwareInfo {
    const arch = process.arch;
    const platform = process.platform;
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model ?? 'Unknown';
    const totalRamGb = Math.round(os.totalmem() / (1024 ** 3));

    // Apple Silicon: arm64 on macOS — Metal GPU acceleration, unified memory
    const isAppleSilicon = platform === 'darwin' && arch === 'arm64';
    // Intel Mac: x64 on macOS — CPU only, no Metal
    const isIntelMac = platform === 'darwin' && arch === 'x64';

    let tier: HardwareTier;
    let recommendation: string;
    let recommendedModel: string;

    // Whisper Base is the recommended default — multilingual (supports 99
    // languages), well-tested, and strikes a good balance between accuracy and
    // speed. For English-only use cases, Distil-Whisper or Moonshine offer
    // significantly lower latency.
    if (isAppleSilicon) {
        tier = 'excellent';
        recommendation = 'Apple Silicon — CoreML activates Metal GPU via ONNX Runtime. Whisper Base streams smoothly on the Neural Engine with multilingual support.';
        recommendedModel = 'Xenova/whisper-base';
    } else if (isIntelMac) {
        tier = 'limited';
        recommendation = 'Intel Mac — CPU inference with int8 quantization. Whisper Base runs adequately on CPU with multilingual support; Cloud STT (Groq/Deepgram) recommended for lowest latency.';
        recommendedModel = 'Xenova/whisper-base';
    } else if (platform === 'win32' && totalRamGb >= 8) {
        tier = 'good';
        recommendation = 'Windows — DirectML activates GPU acceleration (NVIDIA, AMD, Intel) via ONNX Runtime. Whisper Base streams in real-time on most gaming hardware with multilingual support.';
        recommendedModel = 'Xenova/whisper-base';
    } else if (platform === 'linux') {
        tier = 'good';
        recommendation = 'Linux — ONNX Runtime CPU with int8 quantization. Whisper Base offers reliable multilingual transcription.';
        recommendedModel = 'Xenova/whisper-base';
    } else {
        tier = 'limited';
        recommendation = 'Limited hardware — Whisper Base is the default. For minimal CPUs, consider Moonshine Tiny (English-only) for lower resource usage.';
        recommendedModel = 'Xenova/whisper-base';
    }

    return {
        arch,
        platform,
        cpuModel,
        isAppleSilicon,
        totalRamGb,
        tier,
        recommendation,
        recommendedModel,
    };
}
