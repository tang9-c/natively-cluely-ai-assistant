import { app, desktopCapturer, systemPreferences } from 'electron';
import { execFile as execFileCallback } from 'child_process';
import util from 'util';

const execFileAsync = util.promisify(execFileCallback);

export type MacPermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted';
export type PermissionRecommendedFix = 'open-settings' | 'reset-tcc' | 'restart-app' | 'none';
export type TccRepairScope = 'screen' | 'microphone' | 'both';

export interface MacPermissionHealth {
  status: MacPermissionStatus;
  capturable: boolean;
  effectiveGranted: boolean;
  staleGrantSuspected: boolean;
  recommendedFix: PermissionRecommendedFix;
  sourceCount: number;
  error?: string;
}

export interface TccRepairResult {
  success: boolean;
  bundleId: string | null;
  commandsRun: string[];
  requiresRestart: boolean;
  error?: string;
}

async function probeMacScreenSources(context: string): Promise<{ capturable: boolean; sourceCount: number; error?: string }> {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return { capturable: true, sourceCount: 0 };
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
    const sourceCount = sources.filter((source) => source.id.startsWith('screen:')).length;
    return { capturable: sourceCount > 0, sourceCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Permissions] Screen Recording probe failed during ${context}: ${message}`);
    return { capturable: false, sourceCount: 0, error: message };
  }
}

export async function resolveMacScreenPermissionHealth(context: string): Promise<MacPermissionHealth> {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return {
      status: 'granted',
      capturable: true,
      effectiveGranted: true,
      staleGrantSuspected: false,
      recommendedFix: 'none',
      sourceCount: 0,
    };
  }

  let status: MacPermissionStatus;
  try {
    status = systemPreferences.getMediaAccessStatus('screen') as MacPermissionStatus;
  } catch (error) {
    console.error('[Permissions] Failed to read macOS screen recording status:', error);
    status = 'not-determined';
  }

  if (status === 'restricted') {
    return {
      status,
      capturable: false,
      effectiveGranted: false,
      staleGrantSuspected: false,
      recommendedFix: 'none',
      sourceCount: 0,
    };
  }

  if (status === 'not-determined') {
    return {
      status,
      capturable: false,
      effectiveGranted: false,
      staleGrantSuspected: false,
      recommendedFix: 'restart-app',
      sourceCount: 0,
    };
  }

  const probe = await probeMacScreenSources(context);

  if (status === 'granted') {
    if (probe.capturable) {
      return {
        status,
        capturable: true,
        effectiveGranted: true,
        staleGrantSuspected: false,
        recommendedFix: 'none',
        sourceCount: probe.sourceCount,
      };
    }

    return {
      status,
      capturable: false,
      effectiveGranted: false,
      staleGrantSuspected: true,
      recommendedFix: 'reset-tcc',
      sourceCount: probe.sourceCount,
      error: probe.error,
    };
  }

  if (probe.capturable) {
    return {
      status,
      capturable: true,
      effectiveGranted: true,
      staleGrantSuspected: false,
      recommendedFix: 'none',
      sourceCount: probe.sourceCount,
    };
  }

  return {
    status,
    capturable: false,
    effectiveGranted: false,
    staleGrantSuspected: false,
    recommendedFix: 'open-settings',
    sourceCount: probe.sourceCount,
    error: probe.error,
  };
}

export function resolveMacMicrophonePermissionHealth(): MacPermissionHealth {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return {
      status: 'granted',
      capturable: true,
      effectiveGranted: true,
      staleGrantSuspected: false,
      recommendedFix: 'none',
      sourceCount: 0,
    };
  }

  let status: MacPermissionStatus;
  try {
    status = systemPreferences.getMediaAccessStatus('microphone') as MacPermissionStatus;
  } catch (error) {
    console.error('[Permissions] Failed to read macOS microphone status:', error);
    status = 'not-determined';
  }

  return {
    status,
    capturable: status === 'granted',
    effectiveGranted: status === 'granted',
    staleGrantSuspected: false,
    recommendedFix:
      status === 'granted'
        ? 'none'
        : status === 'not-determined'
          ? 'restart-app'
          : status === 'restricted'
            ? 'none'
            : 'open-settings',
    sourceCount: 0,
  };
}

export async function repairMacTccPermissions(scope: TccRepairScope): Promise<TccRepairResult> {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return {
      success: false,
      bundleId: null,
      commandsRun: [],
      requiresRestart: false,
      error: 'TCC repair is only available on packaged macOS builds.',
    };
  }

  const bundleId = app.getBundleID();
  const services =
    scope === 'both'
      ? ['ScreenCapture', 'Microphone']
      : [scope === 'screen' ? 'ScreenCapture' : 'Microphone'];
  const commandsRun: string[] = [];

  try {
    for (const service of services) {
      await execFileAsync('tccutil', ['reset', service, bundleId]);
      commandsRun.push(`tccutil reset ${service} ${bundleId}`);
    }

    return {
      success: true,
      bundleId,
      commandsRun,
      requiresRestart: true,
    };
  } catch (error) {
    return {
      success: false,
      bundleId,
      commandsRun,
      requiresRestart: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
