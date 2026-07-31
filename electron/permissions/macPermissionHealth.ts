import { app, desktopCapturer, systemPreferences } from 'electron';
import { execFile as execFileCallback } from 'child_process';
import fs from 'fs';
import path from 'path';
import util from 'util';

const execFileAsync = util.promisify(execFileCallback);
let cachedConfiguredAppId: string | null | undefined;
let cachedRuntimeInfoPlistBundleId: string | null | undefined;

export type MacPermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted';
export type PermissionRecommendedFix = 'open-settings' | 'reset-tcc' | 'restart-app' | 'none';
export type TccRepairScope = 'screen' | 'microphone' | 'both';
export type MacSystemAudioBackend = 'coreaudio' | 'sck' | 'wasapi' | 'unknown';

export interface MacPermissionHealth {
  status: MacPermissionStatus;
  capturable: boolean;
  effectiveGranted: boolean;
  staleGrantSuspected: boolean;
  recommendedFix: PermissionRecommendedFix;
  sourceCount: number;
  error?: string;
}

export interface MacSystemAudioPermissionHealth extends MacPermissionHealth {
  backend: MacSystemAudioBackend;
  services: string[];
}

export interface MacScreenPermissionHealthOptions {
  probeScreenSources?: boolean;
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

export async function resolveMacScreenPermissionHealth(
  context: string,
  options: MacScreenPermissionHealthOptions = {},
): Promise<MacPermissionHealth> {
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

  if (options.probeScreenSources === false) {
    return {
      status,
      capturable: status === 'granted',
      effectiveGranted: status === 'granted',
      staleGrantSuspected: false,
      recommendedFix: status === 'granted' ? 'none' : 'open-settings',
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

export async function resolveMacSystemAudioPermissionHealth(
  context: string,
  backend: MacSystemAudioBackend = 'unknown',
  options: MacScreenPermissionHealthOptions = {},
): Promise<MacSystemAudioPermissionHealth> {
  const screenHealth = await resolveMacScreenPermissionHealth(context, options);
  return {
    ...screenHealth,
    backend,
    services: process.platform === 'darwin' ? ['ScreenCapture', 'AudioCapture'] : [],
  };
}

function getTccRepairServices(scope: TccRepairScope): string[] {
  if (scope === 'both') {
    return ['ScreenCapture', 'AudioCapture', 'Microphone'];
  }
  if (scope === 'screen') {
    return ['ScreenCapture', 'AudioCapture'];
  }
  return ['Microphone'];
}

function isValidBundleIdentifier(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(value);
}

function readConfiguredAppId(): string | null {
  if (cachedConfiguredAppId !== undefined) {
    return cachedConfiguredAppId;
  }

  try {
    const packageJsonPath = path.join(app.getAppPath(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      build?: { appId?: unknown };
    };
    const configuredAppId = packageJson.build?.appId;
    cachedConfiguredAppId = typeof configuredAppId === 'string' ? configuredAppId : null;
  } catch (error) {
    cachedConfiguredAppId = null;
    console.warn('[Permissions] Failed to read configured appId from package.json:', error);
  }

  return cachedConfiguredAppId;
}

function readRuntimeInfoPlistBundleIdentifier(): string | null {
  if (cachedRuntimeInfoPlistBundleId !== undefined) {
    return cachedRuntimeInfoPlistBundleId;
  }

  try {
    const resourcesPath = process.resourcesPath;
    if (!resourcesPath) {
      cachedRuntimeInfoPlistBundleId = null;
      return cachedRuntimeInfoPlistBundleId;
    }

    const infoPlistPath = path.join(path.dirname(resourcesPath), 'Info.plist');
    const plist = fs.readFileSync(infoPlistPath, 'utf8');
    const match = plist.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
    cachedRuntimeInfoPlistBundleId = match?.[1]?.trim() || null;
  } catch (error) {
    cachedRuntimeInfoPlistBundleId = null;
    console.warn('[Permissions] Failed to read runtime bundle identifier from Info.plist:', error);
  }

  return cachedRuntimeInfoPlistBundleId;
}

export function resolveMacBundleIdentifier(): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  const runtimeBundleId = (app as any).getBundleID?.();
  if (isValidBundleIdentifier(runtimeBundleId)) {
    return runtimeBundleId;
  }

  if (runtimeBundleId) {
    console.warn(`[Permissions] Ignoring invalid runtime bundle identifier: ${runtimeBundleId}`);
  }

  const configuredAppId = readConfiguredAppId();
  if (isValidBundleIdentifier(configuredAppId)) {
    return configuredAppId;
  }

  if (configuredAppId) {
    console.warn(`[Permissions] Ignoring invalid configured appId: ${configuredAppId}`);
  }

  const infoPlistBundleId = readRuntimeInfoPlistBundleIdentifier();
  if (isValidBundleIdentifier(infoPlistBundleId)) {
    return infoPlistBundleId;
  }

  if (infoPlistBundleId) {
    console.warn(`[Permissions] Ignoring invalid Info.plist CFBundleIdentifier: ${infoPlistBundleId}`);
  }

  return null;
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

  const bundleId = resolveMacBundleIdentifier();
  if (!bundleId) {
    return {
      success: false,
      bundleId: null,
      commandsRun: [],
      requiresRestart: false,
      error: 'Unable to resolve a valid macOS bundle identifier for TCC repair.',
    };
  }

  const services = getTccRepairServices(scope);
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
