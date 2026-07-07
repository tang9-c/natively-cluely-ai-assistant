import type { BrowserWindow } from 'electron';

export interface NativeStealthGateOptions {
  platform?: NodeJS.Platform;
  skipOnAppleSilicon?: boolean;
  isAppleSiliconMac?: () => boolean;
}

type NativeStealthModule = {
  applyStealthToWindow?: (handle: Buffer) => void;
};

type NativeStealthModuleLoader = () => NativeStealthModule | null;

export interface NativeStealthApplyOptions extends NativeStealthGateOptions {
  label: string;
  loadNativeModule?: NativeStealthModuleLoader;
}

export type NativeStealthStatus = 'applied' | 'skipped' | 'unavailable' | 'error';

export interface NativeStealthResult {
  status: NativeStealthStatus;
  disabledByEnv: boolean;
  platform: NodeJS.Platform;
  error?: unknown;
}

export function shouldApplyNativeStealth(options: NativeStealthGateOptions = {}): boolean {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') return false;
  if (process.env.NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH === '1') return false;
  if (options.skipOnAppleSilicon && options.isAppleSiliconMac?.()) return false;
  return true;
}

export function applyNativeStealthIfEnabled(
  window: BrowserWindow | null | undefined,
  options: NativeStealthApplyOptions,
): NativeStealthResult {
  const platform = options.platform ?? process.platform;
  const disabledByEnv = process.env.NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH === '1';
  const base = { disabledByEnv, platform };

  if (!window || window.isDestroyed() || !shouldApplyNativeStealth(options)) {
    if (platform === 'darwin') {
      console.warn(`[${options.label}] Native stealth skipped`, {
        platform,
        arch: process.arch,
        disabledByEnv,
      });
    }
    return { ...base, status: 'skipped' };
  }

  try {
    const loadNativeModule =
      options.loadNativeModule ??
      (() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nativeLoader = require('../audio/nativeModuleLoader') as {
          loadNativeModule: NativeStealthModuleLoader;
        };
        return nativeLoader.loadNativeModule();
      });
    const native = loadNativeModule();
    if (native && typeof native.applyStealthToWindow === 'function') {
      native.applyStealthToWindow(window.getNativeWindowHandle());
      console.log(`[${options.label}] Applied native stealth`, {
        platform,
        arch: process.arch,
      });
      return { ...base, status: 'applied' };
    }

    console.warn(`[${options.label}] applyStealthToWindow unavailable — rebuild native module for full stealth`);
    return { ...base, status: 'unavailable' };
  } catch (error) {
    console.error(`[${options.label}] Failed to apply native stealth:`, error);
    return { ...base, status: 'error', error };
  }
}
