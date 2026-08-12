import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, systemPreferences, screen } from "electron"
import * as crypto from "crypto"
import path from "path"
import fs from "fs"
import { autoUpdater } from "electron-updater"
import type { ProfileOrchestratorRuntime } from "./services/profile/ProfileOrchestratorContract"
import { formatAcceleratorForPlatform, quitAcceleratorForPlatform } from "./utils/platformAccelerators"
import { dynamicActionAvailabilityFromArbitrations } from "../shared/dynamicActionAvailability"
if (!app.isPackaged) {
  require('dotenv').config();
}

// Handle stdout/stderr errors at the process level to prevent EIO crashes
// This is critical for Electron apps that may have their terminal detached
process.stdout?.on?.('error', () => { });
process.stderr?.on?.('error', () => { });

process.on('uncaughtException', (err) => {
  logToFile('[CRITICAL] Uncaught Exception: ' + redactArgsForLog([err]));
});

process.on('unhandledRejection', (reason, promise) => {
  logToFile('[CRITICAL] Unhandled Rejection: ' + redactArgsForLog([reason]));
});

// CQ-04 fix: do NOT call app.getPath() at module load time.
// app.getPath('documents') is not guaranteed to be available before app.whenReady().
// Use a lazy getter instead — the path is resolved on first logToFile() call.
let _logFile: string | null = null;
const getLogFile = (): string | null => {
  if (_logFile) return _logFile;
  try {
    _logFile = path.join(app.getPath('documents'), 'natively_debug.log');
    return _logFile;
  } catch {
    // app.ready not yet fired — return null, logToFile will skip silently
    return null;
  }
};

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const LEGACY_USER_DATA_DIR_NAME = 'Natively';
const LEGACY_USER_DATA_MIGRATION_MARKER = '.legacy-natively-migration-complete.json';
let sttQualityAcceptanceContext: SttQualityAcceptanceContext = { enabled: false, reason: 'not_configured' };

function hasCueUpUserData(userDataPath: string): boolean {
  return [
    'credentials.enc',
    'settings.json',
    'natively.db',
    'models',
    'whisper-models',
    'sensevoice-models',
    'skills',
    '.cueup-stt-quality-isolated',
  ].some((entry) => fs.existsSync(path.join(userDataPath, entry)));
}

// Lazy redactor import — pulled at first call so this file can boot even if
// the redactor module fails to load (we fall back to a no-op transform).
let _redactForLog: ((args: unknown[]) => string) | null = null;
function redactArgsForLog(args: unknown[]): string {
  if (!_redactForLog) {
    try {
      _redactForLog = require('./utils/redactForLog').redactForLog;
    } catch {
      _redactForLog = (xs: unknown[]) => xs.map(a => (a instanceof Error ? a.stack || a.message : (typeof a === 'object' ? JSON.stringify(a) : String(a)))).join(' ');
    }
  }
  return _redactForLog!(args);
}

/** Maximum log file size before rotation (10 MB). */
const LOG_MAX_BYTES = 10 * 1024 * 1024;

function logToFile(msg: string) {
  try {
    const logFile = getLogFile();
    // If the app isn't ready yet (path not available), skip silently.
    if (!logFile) return;

    // P2-1: rotate the log file when it exceeds LOG_MAX_BYTES so that long-running
    // sessions (or meetings with dense transcripts) don't fill the user's disk.
    // The previous log is kept as .log.1 for one-generation rollover.
    try {
      const stat = fs.statSync(logFile);
      if (stat.size >= LOG_MAX_BYTES) {
        const rotated = logFile + '.1';
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        fs.renameSync(logFile, rotated);
      }
    } catch {
      // statSync throws if the file doesn't exist yet — that's fine
    }
    fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n');
  } catch (e) {
    // Ignore logging errors
  }
}

function migrateLegacyUserDataForCueUpBranding(): void {
  try {
    const cueUpUserDataPath = app.getPath('userData');
    const legacyUserDataPath = path.join(app.getPath('appData'), LEGACY_USER_DATA_DIR_NAME);
    if (path.resolve(cueUpUserDataPath) === path.resolve(legacyUserDataPath)) return;
    if (hasCueUpUserData(cueUpUserDataPath)) return;
    if (!hasCueUpUserData(legacyUserDataPath)) return;

    fs.mkdirSync(cueUpUserDataPath, { recursive: true });
    fs.cpSync(legacyUserDataPath, cueUpUserDataPath, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
    fs.writeFileSync(
      path.join(cueUpUserDataPath, LEGACY_USER_DATA_MIGRATION_MARKER),
      JSON.stringify({ source: LEGACY_USER_DATA_DIR_NAME, completedAt: new Date().toISOString() }),
      { encoding: 'utf8', flag: 'wx' },
    );
    console.log('[Main] Migrated legacy Natively userData into CueUp userData path');
  } catch (err) {
    console.warn('[Main] Failed to migrate legacy userData for CueUp branding:', err);
  }
}

async function ensureMacMicrophoneAccess(context: string): Promise<boolean> {
  if (process.platform !== 'darwin') return true;

  try {
    const currentStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`[Main] macOS microphone permission before ${context}: ${currentStatus}`);

    if (currentStatus === 'granted') {
      return true;
    }

    const granted = await systemPreferences.askForMediaAccess('microphone');
    console.log(
      `[Main] macOS microphone permission request during ${context}: ${granted ? 'granted' : 'denied'}`
    );
    return granted;
  } catch (error) {
    console.error(`[Main] Failed to check macOS microphone permission during ${context}:`, error);
    return false;
  }
}

/**
 * Check macOS Screen Recording (kTCCServiceScreenCapture) permission status.
 *
 * Electron has no askForMediaAccess('screen') API — macOS only shows the TCC
 * dialog when the app actually calls a protected API (SCK / CoreAudio tap).
 * If the permission is 'denied', we cannot re-prompt; the user must re-enable
 * manually in System Settings → Privacy & Security → Screen Recording.
 *
 * Returns false only when the permission is explicitly 'denied'. All other
 * statuses ('granted', 'not-determined', 'restricted') return true because:
 *   - 'granted':         already allowed — nothing to do.
 *   - 'not-determined':  macOS will show the dialog when SCK/CoreAudio tap runs.
 *   - 'restricted':      managed device policy — nothing we can do programmatically.
 */
type MacScreenCaptureStatus = 'granted' | 'denied' | 'not-determined' | 'restricted';

type MacScreenCaptureCapability = {
  status: MacScreenCaptureStatus;
  capturable: boolean;
  effectiveDenied: boolean;
  staleGrantSuspected: boolean;
  recommendedFix: 'open-settings' | 'reset-tcc' | 'restart-app' | 'none';
  sourceCount: number;
  error?: string;
};

function normalizeRecognitionLanguageForProvider(provider: string, languageKey: string): string {
  // 'auto' currently has a supported end-to-end meaning only for NativelyProSTT.
  // Persisted settings may still contain 'auto' from an earlier provider choice,
  // so normalize again at provider construction time, not only when the user
  // changes the dropdown live.
  if (languageKey !== 'auto') return languageKey;
  if (provider === 'qcloud-stt') return 'chinese';
  return provider !== 'natively' ? 'english-us' : languageKey;
}

function getMacScreenCaptureStatus(): MacScreenCaptureStatus {
  if (process.platform !== 'darwin') return 'granted';

  // In development mode, macOS TCC often falsely reports 'denied' for the electron binary
  // even if the user has granted permission to their Terminal app.
  if (!app.isPackaged) {
    console.log('[Main] Ignoring screen capture permission check in development mode');
    return 'granted';
  }

  try {
    return systemPreferences.getMediaAccessStatus('screen') as MacScreenCaptureStatus;
  } catch (error) {
    console.error('[Main] Failed to check screen recording permission:', error);
    return 'not-determined';
  }
}

async function resolveMacScreenCaptureCapability(context: string): Promise<MacScreenCaptureCapability> {
  const health = await resolveMacScreenPermissionHealth(context);
  return {
    status: health.status,
    capturable: health.capturable,
    effectiveDenied: !health.effectiveGranted,
    staleGrantSuspected: health.staleGrantSuspected,
    recommendedFix: health.recommendedFix,
    sourceCount: health.sourceCount,
    error: health.error,
  };
}

/**
 * Format a user-facing audio/permission message for the current platform.
 * macOS has TCC (Screen Recording, Microphone) panes under System Settings;
 * Windows has no equivalent for screen-capture (system audio loopback runs
 * via WASAPI without OS-level gating) and gates the microphone via
 * Settings → Privacy → Microphone. Reusing macOS copy on Windows is the
 * cross-contamination class behind issue #252.
 */
// Variants prefixed `mac-` are macOS-only and reference TCC / CoreAudio /
// ScreenCaptureKit concepts that don't exist on Windows. Call sites for those
// must themselves be gated behind `process.platform === 'darwin'` — the
// prefix makes that constraint visible during code review. Cross-platform
// variants have no prefix and branch internally on isMac.
type PermissionReason =
  | 'screen-recording-denied'
  | 'mac-screen-recording-revoked-rebuild'
  | 'mac-coreaudio-audio-capture-revoked'
  | 'mac-system-audio-zero-fill'
  | 'system-audio-failure'
  | 'mic-denied'
  | 'mic-zero-fill'
  | 'mac-same-device-input-output'
  | 'system-audio-stuck';
function formatPermissionMessage(reason: PermissionReason, extra?: { device?: string }): string {
  const isMac = process.platform === 'darwin';
  switch (reason) {
    case 'screen-recording-denied':
      return isMac
        ? 'Screen Recording is not applied to this build yet. Interviewer audio will not be captured. Open System Settings → Privacy & Security → Screen Recording, toggle CueUp off and back on, then restart the app.'
        : 'System audio capture is unavailable. Interviewer audio will not be captured. Check your audio device routing in Settings and restart the meeting.';
    case 'mac-screen-recording-revoked-rebuild':
      // Defense-in-depth: even though all call sites must be darwin-gated
      // (the `mac-` prefix marks this constraint), if a future contributor
      // calls this from a cross-platform path we degrade gracefully rather
      // than leak macOS UI strings to Windows users.
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return 'System audio is being captured but every sample is silent. This usually means macOS Screen Recording permission needs to be re-granted to this build of CueUp. Open System Settings → Privacy & Security → Screen Recording, toggle CueUp off and back on, then restart the app. (If you recently rebuilt or updated, the previous grant may not apply.)';
    case 'mac-coreaudio-audio-capture-revoked':
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return 'CoreAudio system audio capture is running, but macOS is returning silent samples. This usually means the System Audio Recording permission cache no longer applies to this build of CueUp. Repair permissions, restart CueUp, then grant system audio recording again.';
    case 'mac-system-audio-zero-fill':
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return 'System audio capture is running but every sample is silent. Check that the interviewer audio is actually playing through the selected output device. If the output route changed, re-select the speakers/headphones. If you recently rebuilt or updated CueUp, re-toggle Screen Recording for CueUp and restart the app.';
    case 'mic-denied':
      return isMac
        ? 'Microphone access denied. Please allow microphone access in System Settings → Privacy & Security → Microphone, then restart CueUp.'
        : 'Microphone access denied. Please allow microphone access in Settings → Privacy → Microphone, then restart CueUp.';
    case 'mic-zero-fill':
      return isMac
        ? 'Microphone is producing silent audio. Check that the device is unmuted and that macOS Microphone permission is granted to CueUp in System Settings → Privacy & Security → Microphone.'
        : 'Microphone is producing silent audio. Check that the device is unmuted and that CueUp has microphone access in Settings → Privacy → Microphone.';
    case 'mac-same-device-input-output':
      // Defense-in-depth: see comment on `mac-screen-recording-revoked-rebuild`.
      // The CoreAudio Process Tap same-device limitation is macOS-specific;
      // on Windows WASAPI loopback works fine on the same device as the mic.
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return `Silent capture detected — input and output are the same device (${extra?.device ?? 'unknown'}). macOS cannot tap a device while it is also the active microphone. Switch input to built-in mic or output to built-in speakers.`;
    case 'system-audio-stuck':
      return 'No audio detected on system output for 8s. If your meeting app is using a different output device (Bluetooth headset, virtual cable, second monitor), switch it to your default output, or restart the meeting after switching.';
  }
}

console.log = (...args: any[]) => {
  logToFile('[LOG] ' + redactArgsForLog(args));
  try {
    originalLog.apply(console, args);
  } catch { }
};

console.warn = (...args: any[]) => {
  logToFile('[WARN] ' + redactArgsForLog(args));
  try {
    originalWarn.apply(console, args);
  } catch { }
};

console.error = (...args: any[]) => {
  logToFile('[ERROR] ' + redactArgsForLog(args));
  try {
    originalError.apply(console, args);
  } catch { }
};

const originalAppQuit = app.quit.bind(app);
app.quit = (() => {
  const stack = new Error('app.quit call stack').stack
    ?.split('\n')
    .slice(1)
    .join('\n');
  console.warn('[Main] app.quit requested', stack || '(no stack)');
  return originalAppQuit();
}) as typeof app.quit;

import { initializeIpcHandlers } from "./ipcHandlers"
import { WindowHelper } from "./WindowHelper"
import { SettingsWindowHelper } from "./SettingsWindowHelper"
import { ModelSelectorWindowHelper } from "./ModelSelectorWindowHelper"
import { CropperWindowHelper } from "./CropperWindowHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { KeybindManager } from "./services/KeybindManager"
import { ProcessingHelper } from "./ProcessingHelper"

import { IntelligenceManager } from "./IntelligenceManager"
import { SystemAudioCapture } from "./audio/SystemAudioCapture"
import { MicrophoneCapture } from "./audio/MicrophoneCapture"
import { AudioDevices } from "./audio/AudioDevices"
import { loadNativeModule } from "./audio/nativeModuleLoader"
import { BaseSTT, type TranscriptSegment } from "./audio/BaseSTT"
import { createSTTProvider } from "./audio/sttRegistry"
import { measureSystemAudioPcm16Level, preprocessCurrentChineseSystemAudio } from "./audio/SystemAudioPreprocessing"
import { ThemeManager } from "./ThemeManager"
import { RAGManager } from "./rag/RAGManager"
import { buildEmbeddingRuntimeConfig } from "./rag/EmbeddingRuntimeConfig"
import { DatabaseManager } from "./db/DatabaseManager"
import { resolveMacScreenPermissionHealth } from "./permissions/macPermissionHealth"
import {
  resolveSttQualityAcceptanceContext,
  SttQualityDiagnosticsCollector,
  type SttQualityAcceptanceContext,
} from "./services/SttQualityDiagnosticsCollector"

/** Unified type for all STT providers */
type STTProvider = BaseSTT;

type ScreenshotWindowMode = 'launcher' | 'overlay';

/** Payload for stt-status IPC events broadcast from main to renderer */
interface SttStatusPayload {
  state: 'connected' | 'reconnecting' | 'failed';
  provider: string;
  error?: string;
  channel: 'user' | 'interviewer';
  reconnectAttempts?: number;
}

interface OutputRouteDiagnostics {
  requestedOutputId: string | null;
  requestedOutputName: string | null;
  defaultOutputId: string | null;
  defaultOutputName: string | null;
  usingDefaultRoute: boolean;
  selectedDiffersFromDefault: boolean;
}

function isNativeAudioModuleUnavailable(err: unknown): boolean {
  return Boolean(
    err &&
    typeof err === 'object' &&
    (err as any).code === 'NATIVE_AUDIO_MODULE_UNAVAILABLE'
  );
}

type ScreenshotCaptureKind = 'full' | 'selective';

interface ScreenshotCaptureSession {
  captureKind: ScreenshotCaptureKind;
  wasMainWindowVisible: boolean;
  windowMode: ScreenshotWindowMode;
  wasSettingsVisible: boolean;
  wasModelSelectorVisible: boolean;
  overlayBounds: Electron.Rectangle | null;
  overlayDisplayId: number | null;
  restoreWithoutFocus: boolean;
}

// Profile Intelligence: local implementation replaces premium submodule.
let ProfileOrchestratorClass: any = null;
try {
    ProfileOrchestratorClass = require('./services/profile/ProfileOrchestrator').ProfileOrchestrator;
} catch (err) {
    console.log('[Main] Profile modules not available — profile intelligence disabled.', err);
}

import { CredentialsManager } from "./services/CredentialsManager"
import { SettingsManager } from "./services/SettingsManager"
import { setVerboseLoggingFlag } from "./verboseLog"
import { ReleaseNotesManager } from "./update/ReleaseNotesManager"
import { OllamaManager } from './services/OllamaManager'
import {
  AdaptivePreloadManager,
  type LocalSttPreloadSelection,
} from './services/AdaptivePreloadManager'
import type { LocalSttWorkerLease } from './audio/LocalSttWorkerPool'

type MeetingAudioSpeaker = 'interviewer' | 'user';

interface MeetingEchoTranscriptDiagnostic {
  at: number;
  normalizedText: string;
  textLength: number;
  final: boolean;
}

export class AppState {
  private static instance: AppState | null = null

  private windowHelper: WindowHelper
  public settingsWindowHelper: SettingsWindowHelper
  public modelSelectorWindowHelper: ModelSelectorWindowHelper
  public cropperWindowHelper: CropperWindowHelper
  private screenshotHelper: ScreenshotHelper
  public processingHelper: ProcessingHelper

  private intelligenceManager: IntelligenceManager
  private themeManager: ThemeManager
  private ragManager: RAGManager | null = null
  private knowledgeOrchestrator: any = null
  private tray: Tray | null = null
  private updateAvailable: boolean = false
  // View management
  private view: "queue" | "solutions" = "queue"

  private problemInfo: {
    problem_statement: string
    input_format: Record<string, any>
    output_format: Record<string, any>
    constraints: Array<Record<string, any>>
    test_cases: Array<Record<string, any>>
  } | null = null // Allow null

  private hasDebugged: boolean = false
  private isMeetingActive: boolean = false; // Guard for session state leaks
  // True between Stop click and the end of STT drain. The transcript handler
  // (and only the transcript handler) treats `isMeetingActive || _isDraining`
  // as "accept trailing finals" — every other call site looks at
  // `isMeetingActive` alone, which flips to false synchronously on Stop so the
  // launcher's "Meeting ongoing" pill switches back to "Start Natively" the
  // instant the user clicks Stop, with no 250 ms green-→-blue stutter.
  private _isDraining: boolean = false;
  // Tracks remembered output device so reconfigureAudio can no-op when nothing changed.
  // Mirrors the existing _lastRequestedInputDeviceId for the input side.
  private _lastRequestedOutputDeviceId: string | undefined = undefined;
  // Promise representing in-flight endMeeting background teardown (STT.stop +
  // intelligenceManager.stopMeeting + RAG cleanup). startMeeting() awaits this
  // before booting a new session so the shared STT instances are not torn down
  // mid-meeting by a stale teardown task.
  private _pendingTeardown: Promise<void> | null = null;
  private _meetingStartInFlight: Promise<void> | null = null;
  private _isQuitting: boolean = false;
  private _verboseLogging: boolean = false;
  // Tracks whether STT sample-rate has been applied for the current capture
  // session. Reset on every reconfigureAudio / new pipeline build so the next
  // first-chunk handler reads the freshly-detected native rate.
  private _sysSttRateApplied: boolean = false;
  private _micSttRateApplied: boolean = false;
  private _sckRouteIgnoredBroadcasted: boolean = false;
  private _screenTccRepairBannerShown: boolean = false;
  private _micTccRepairBannerShown: boolean = false;
  private _meetingHasMicTranscript: boolean = false;
  private _meetingHasAnyTranscript: boolean = false;
  private _meetingEchoTranscriptDiagnostics: Partial<Record<MeetingAudioSpeaker, MeetingEchoTranscriptDiagnostic>> = {};
  private _meetingAudioPeakDiagnostics: Record<MeetingAudioSpeaker, { peak: number; at: number }> = {
    interviewer: { peak: 0, at: 0 },
    user: { peak: 0, at: 0 },
  };
  private sttQualityDiagnosticsCollector: SttQualityDiagnosticsCollector | null = null;
  private _ollamaBootstrapPromise: Promise<void> | null = null;
  private readonly adaptivePreloadManager: AdaptivePreloadManager;
  private adaptiveSenseVoiceLease: LocalSttWorkerLease | null = null;
  private adaptiveSenseVoiceErrorHandler: ((error: Error) => void) | null = null;
  private screenshotCaptureInProgress: boolean = false;


  // Processing events
  public readonly PROCESSING_EVENTS = {
    //global states
    UNAUTHORIZED: "procesing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",

    //states for generating the initial solution
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",

    //states for processing the debugging
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error"
  } as const

  constructor() {
    // 1. Load boot-critical settings first (used by WindowHelpers)
    const settingsManager = SettingsManager.getInstance();
    this._verboseLogging = settingsManager.get('verboseLogging') ?? false;
    setVerboseLoggingFlag(this._verboseLogging);
    console.log(`[AppState] Initialized with verboseLogging=${this._verboseLogging}`);
    this.sttQualityDiagnosticsCollector = new SttQualityDiagnosticsCollector(sttQualityAcceptanceContext);
    this.adaptivePreloadManager = new AdaptivePreloadManager({
      preload: selection => this.preloadSelectedLocalStt(selection),
      release: () => this.releasePreloadedLocalStt(),
      isHeavyWorkActive: () => this.isHeavyIndexingActive(),
    });

    // 2. Initialize Helpers with loaded state
    this.windowHelper = new WindowHelper(this)
    this.settingsWindowHelper = new SettingsWindowHelper()
    this.modelSelectorWindowHelper = new ModelSelectorWindowHelper()
    this.cropperWindowHelper = new CropperWindowHelper()

    // 3. Initialize other helpers
    this.screenshotHelper = new ScreenshotHelper(this.view)
    this.processingHelper = new ProcessingHelper(this)

    // Initialize KeybindManager
    const keybindManager = KeybindManager.getInstance();
    keybindManager.setWindowHelper(this.windowHelper);
    keybindManager.setupIpcHandlers();
    keybindManager.onUpdate(() => {
      this.updateTrayMenu();
    });

    // Stealth keyboard tap (CGEventTap) IPC. Renderer drives the permission
    // flow + queries availability/state; the tap itself is toggled by the
    // global shortcut handler above. Only registered on macOS — on other
    keybindManager.onShortcutTriggered(async (actionId) => {
      console.log(`[Main] Global shortcut triggered: ${actionId}`);
      try {
        if (actionId === 'general:toggle-visibility') {
          this.toggleMainWindow();
        } else if (actionId === 'general:toggle-mouse-passthrough') {
          // Adapted from public PR #113 — verify premium interaction
          this.toggleOverlayMousePassthrough();
        } else if (actionId === 'general:take-screenshot') {
          // Route to renderer via global-shortcut so the renderer handles the
          // screenshot through the IPC invoke path (request/response guarantee).
          // The old pattern — main takes screenshot → fires screenshot-taken event →
          // renderer listener catches it — was unreliable in overlay mode because the
          // fire-and-forget event could be missed if the listener registration had any
          // timing gap. The invoke path used by generalHandlers.takeScreenshot() is
          // already proven to work for UI-button screenshots; reuse it here.
          const mainWindow = this.getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('global-shortcut', { action: 'takeScreenshot' });
          }
        } else if (actionId === 'general:selective-screenshot') {
          const mainWindow = this.getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('global-shortcut', { action: 'selectiveScreenshot' });
          }
        } else if (actionId === 'general:capture-and-process') {
          // Single-trigger: capture current screen then immediately request AI analysis
          const screenshotPath = await this.takeScreenshot(false);
          const preview = await this.getImagePreview(screenshotPath);
          // Ensure the window is visible so the user can see the response without stealing focus
          this.showMainWindow(true);
          const mainWindow = this.getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send("capture-and-process", {
              path: screenshotPath,
              preview
            });
          }

        // Chat actions — fire into the renderer without focusing the window
        } else if (actionId === 'chat:focusInput') {
          this.showMainWindow(true);
          const overlay = this.windowHelper.getOverlayWindow();
          if (overlay && !overlay.isDestroyed()) {
            overlay.webContents.send('ensure-expanded');
            overlay.webContents.send('global-shortcut', { action: 'focusInput' });
            overlay.focus();
          }
        } else if (
          actionId === 'chat:whatToAnswer' ||
          actionId === 'chat:clarify' ||
          actionId === 'chat:followUp' ||
          actionId === 'chat:answer' ||
          actionId === 'chat:codeHint' ||
          actionId === 'chat:brainstorm' ||
          actionId === 'chat:dynamicAction4' ||
          actionId === 'chat:scrollUp' ||
          actionId === 'chat:scrollDown' ||
          actionId === 'chat:scrollLeft' ||
          actionId === 'chat:scrollRight'
        ) {
          const actionMap: Record<string, string> = {
            'chat:whatToAnswer': 'whatToAnswer',
            'chat:clarify': 'clarify',
            'chat:followUp': 'followUp',
            'chat:answer': 'answer',
            'chat:codeHint': 'codeHint',
            'chat:brainstorm': 'brainstorm',
            'chat:dynamicAction4': 'dynamicAction4',
            'chat:scrollUp': 'scrollUp',
            'chat:scrollDown': 'scrollDown',
            'chat:scrollLeft': 'scrollLeft',
            'chat:scrollRight': 'scrollRight',
          };
          const action = actionMap[actionId];
          // Send to all windows without focusing — stealth operation
          const allWindows = BrowserWindow.getAllWindows();
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('global-shortcut', { action });
            }
          });

        // Window movement — move window position without focus change
        } else if (actionId === 'window:move-up') {
          this.windowHelper.moveWindowUp();
        } else if (actionId === 'window:move-down') {
          this.windowHelper.moveWindowDown();
        } else if (actionId === 'window:move-left') {
          this.windowHelper.moveWindowLeft();
        } else if (actionId === 'window:move-right') {
          this.windowHelper.moveWindowRight();

        // General actions that are now global (stealth)
        } else if (actionId === 'general:process-screenshots') {
          const allWindows = BrowserWindow.getAllWindows();
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('global-shortcut', { action: 'processScreenshots' });
            }
          });
        } else if (actionId === 'general:reset-cancel') {
          const allWindows = BrowserWindow.getAllWindows();
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('global-shortcut', { action: 'resetCancel' });
            }
          });
        }
      } catch (e: any) {
        if (e.message !== "Selection cancelled" && e.message !== "Screenshot capture already in progress") {
          console.error(`[Main] Error handling global shortcut ${actionId}:`, e);
        }
      }
    });

    // Inject WindowHelper into other helpers
    this.settingsWindowHelper.setWindowHelper(this.windowHelper);
    this.modelSelectorWindowHelper.setWindowHelper(this.windowHelper);





    // Initialize IntelligenceManager with LLMHelper
    this.intelligenceManager = new IntelligenceManager(this.processingHelper.getLLMHelper())

    // Initialize ThemeManager
    this.themeManager = ThemeManager.getInstance()

    // Restore boot-time LLMHelper settings.
    {
      const llmHelper = this.processingHelper.getLLMHelper();
      llmHelper.setCodexCliConfig({
        enabled: !!settingsManager.get('codexCliEnabled'),
        path: settingsManager.get('codexCliPath') || 'codex',
        model: settingsManager.get('codexCliModel') || 'gpt-5.4',
        timeoutMs: settingsManager.get('codexCliTimeoutMs') || 60_000,
        sandboxMode: settingsManager.get('codexCliSandboxMode') || 'read-only',
      });
      // Restore custom notes and persona for non-premium path
      try {
        const savedNotes = DatabaseManager.getInstance().getCustomNotes();
        if (savedNotes) {
          llmHelper.setCustomNotes(savedNotes);
        }
      } catch (_) {}
      try {
        const savedPersona = DatabaseManager.getInstance().getPersona();
        if (savedPersona) {
          llmHelper.setPersonaPrompt(savedPersona);
          console.log('[AppState] Persona restored');
        }
      } catch (_) {}
    }

    // Initialize RAGManager (requires database to be ready)
    this.initializeRAGManager()

    // Check and prep Ollama embedding model
    this.bootstrapOllamaEmbeddings()


    this.setupIntelligenceEvents()

    // Setup Ollama IPC
    this.setupOllamaIpcHandlers()

    // --- NEW SYSTEM AUDIO PIPELINE (SOX + NODE GOOGLE STT) ---
    // LAZY INIT: Do not setup pipeline here to prevent launch volume surge.
    // this.setupSystemAudioPipeline()

    // Initialize Auto-Updater
    this.setupAutoUpdater()
  }

  private broadcast(channel: string, ...args: any[]): void {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    });
  }

  public getIsMeetingActive(): boolean {
    return this.isMeetingActive;
  }

  public isQuitting(): boolean {
    return this._isQuitting;
  }

  public setQuitting(value: boolean): void {
    this._isQuitting = value;
  }

  private broadcastMeetingState(): void {
    this.broadcast('meeting-state-changed', { isActive: this.isMeetingActive });
  }

  private async bootstrapOllamaEmbeddings() {
    this._ollamaBootstrapPromise = (async () => {
      try {
        const { OllamaBootstrap } = require('./rag/OllamaBootstrap');
        const bootstrap = new OllamaBootstrap();

        // Fire and forget — don't await this before showing the window
        const result = await bootstrap.bootstrap('nomic-embed-text', (status: string, percent: number) => {
          // Send progress to renderer via IPC
          this.broadcast('ollama:pull-progress', { status, percent });
        });

        if (result === 'pulled' || result === 'already_pulled') {
          this.broadcast('ollama:pull-complete');
          // Re-resolve the embedding provider given that Ollama might now be available
          if (this.ragManager) {
             console.log('[AppState] Ollama model ready, re-evaluating RAG pipeline provider');
             this.ragManager.initializeEmbeddings(buildEmbeddingRuntimeConfig());
          }
        }
      } catch (err) {
         console.error('[AppState] Failed to bootstrap Ollama:', err);
      }
    })();
  }

  private initializeRAGManager(): void {
    try {
      const db = DatabaseManager.getInstance();
      const sqliteDb = db.getDb();

      if (sqliteDb) {
        this.ragManager = new RAGManager({
            db: sqliteDb,
            dbPath: db.getDbPath(),
            extPath: db.getExtPath(),
            ...buildEmbeddingRuntimeConfig(),
        });
        this.ragManager.setLLMHelper(this.processingHelper.getLLMHelper());
        console.log('[AppState] RAGManager initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize RAGManager:', error);
    }

    // Initialize Profile Intelligence Orchestrator (replaces premium submodule)
    try {
      const db = DatabaseManager.getInstance();
      const sqliteDb = db.getDb();

      if (sqliteDb && ProfileOrchestratorClass) {
        this.knowledgeOrchestrator = new ProfileOrchestratorClass() as ProfileOrchestratorRuntime;
        const knowledgeOrchestrator = this.knowledgeOrchestrator as ProfileOrchestratorRuntime;

        const llmHelper = this.processingHelper.getLLMHelper();
        knowledgeOrchestrator.setLLMHelper(llmHelper);

        // generateContent function for LLM calls
        // Join ALL content parts (some callers — e.g. live negotiation coaching —
        // Task 6: removed setGenerateContentFn / setLiveCoachingContentFn /
        // setEmbedFn / setEmbedQueryFn calls. These four injection surfaces
        // were dead — ProfileOrchestrator stored the references but never
        // consumed them. They were remnants of a "knowledge subsystem"
        // design that never landed. The `joinContents` helper above is also
        // no longer referenced and is removed with the rest of the block.

        // Attach KnowledgeOrchestrator to LLMHelper
        llmHelper.setKnowledgeOrchestrator(this.knowledgeOrchestrator);

        const sm = SettingsManager.getInstance();
        if (sm.get('knowledgeMode')) {
          knowledgeOrchestrator.setKnowledgeMode(true);
          console.log('[AppState] Knowledge mode restored from settings');
        }

        // Restore custom notes so LLMHelper has them from first request
        const savedNotes = DatabaseManager.getInstance().getCustomNotes();
        if (savedNotes) {
          llmHelper.setCustomNotes(savedNotes);
          console.log('[AppState] Custom notes restored');
        }

        console.log('[AppState] ProfileOrchestrator initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize ProfileOrchestrator:', error);
    }
  }

  private setupAutoUpdater(): void {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false  // Manual install only via button

    // Default to latest (stable) channel - matches latest.yml generated by electron-builder
    autoUpdater.channel = 'latest'
    console.log(`[AutoUpdater] Channel: ${autoUpdater.channel}`)

    autoUpdater.on("checking-for-update", () => {
      console.log("[AutoUpdater] Checking for update...")
      this.broadcast("update-checking")
    })

    autoUpdater.on("update-available", async (info) => {
      console.log("[AutoUpdater] Update available:", info.version)
      this.updateAvailable = true

      // Fetch structured release notes. Force-refresh because the user is being
      // notified about a new version: a stale cached body from the previous
      // version would render misleading release notes in the UI.
      const releaseManager = ReleaseNotesManager.getInstance();
      const notes = await releaseManager.fetchReleaseNotes(info.version, true);

      // Notify renderer that an update is available with parsed notes if available
      this.broadcast("update-available", {
        ...info,
        parsedNotes: notes
      })
    })

    autoUpdater.on("update-not-available", (info) => {
      console.log("[AutoUpdater] Update not available:", info.version)
      this.broadcast("update-not-available", info)
    })

    autoUpdater.on("error", (err) => {
      console.error("[AutoUpdater] Error:", err)
      // Include more details in the error message for debugging
      const errorMessage = err.message || err.toString() || 'Unknown update error'
      this.broadcast("update-error", errorMessage)
    })

    autoUpdater.on("download-progress", (progressObj) => {
      let log_message = "Download speed: " + progressObj.bytesPerSecond
      log_message = log_message + " - Downloaded " + progressObj.percent + "%"
      log_message = log_message + " (" + progressObj.transferred + "/" + progressObj.total + ")"
      console.log("[AutoUpdater] " + log_message)
      this.broadcast("download-progress", progressObj)
    })

    autoUpdater.on("update-downloaded", (info) => {
      console.log("[AutoUpdater] Update downloaded:", info.version)
      // Notify renderer that update is ready to install
      this.broadcast("update-downloaded", info)
    })

    // Start checking for updates with a 10-second delay
    setTimeout(() => {
      if (!app.isPackaged) {
        console.log("[AutoUpdater] Development mode: Skipping auto check (use manual button)");
      } else {
        autoUpdater.checkForUpdatesAndNotify().catch(err => {
          console.error("[AutoUpdater] Failed to check for updates:", err);
        });
      }
    }, 10000);
  }

  private async checkForUpdatesManual(): Promise<void> {
    try {
      console.log('[AutoUpdater] Checking for updates manually via GitHub API...');
      const releaseManager = ReleaseNotesManager.getInstance();
      // Fetch latest release
      const notes = await releaseManager.fetchReleaseNotes('latest');

      if (notes) {
        const currentVersion = app.getVersion();
        const latestVersionTag = notes.version; // e.g., "v1.2.0" or "1.2.0"
        const latestVersion = latestVersionTag.replace(/^v/, '');

        console.log(`[AutoUpdater] Manual Check: Current=${currentVersion}, Latest=${latestVersion}`);

        if (this.isVersionNewer(currentVersion, latestVersion)) {
          console.log('[AutoUpdater] Manual Check: New version found!');
          this.updateAvailable = true;

          // Mock an info object compatible with electron-updater
          const info = {
            version: latestVersion,
            files: [] as any[],
            path: '',
            sha512: '',
            releaseName: notes.summary,
            releaseNotes: notes.fullBody
          };

          // Notify renderer
          this.broadcast("update-available", {
            ...info,
            parsedNotes: notes
          });
        } else {
          console.log('[AutoUpdater] Manual Check: App is up to date.');
          this.broadcast("update-not-available", { version: currentVersion });
        }
      }
    } catch (err: any) {
      console.error('[AutoUpdater] Manual update check failed:', err);
      // Surface failure to the renderer so the UI doesn't get stuck in 'checking'.
      const errorMessage = err?.message || err?.toString() || 'Update check failed';
      this.broadcast("update-error", errorMessage);
    }
  }

  private isVersionNewer(current: string, latest: string): boolean {
    // semver-aware comparison. Handles:
    //  - 4+ segment version numbers (e.g. "1.0.0.1")
    //  - pre-release tags: a version with a pre-release is OLDER than the same
    //    version without one (2.1.0-beta.1 < 2.1.0). When both have pre-release
    //    tags, lexical comparison of dot-separated identifiers is used, with
    //    numeric identifiers compared as numbers.
    //  - build metadata (+build.123) is ignored per semver spec.
    const parse = (v: string) => {
      const [core, pre = ''] = v.replace(/^v/, '').split('-', 2);
      const buildStripped = (pre.split('+')[0] || '');
      const preIds = buildStripped ? buildStripped.split('.') : [];
      const mainIds = core.split('.').map((n) => {
        const num = parseInt(n, 10);
        return Number.isFinite(num) ? num : 0;
      });
      return { mainIds, preIds };
    };

    const comparePreId = (a: string, b: string): number => {
      const an = parseInt(a, 10);
      const bn = parseInt(b, 10);
      const aIsNum = Number.isFinite(an) && String(an) === a;
      const bIsNum = Number.isFinite(bn) && String(bn) === b;
      if (aIsNum && bIsNum) return an - bn;
      if (aIsNum) return -1; // numeric identifiers have lower precedence than non-numeric
      if (bIsNum) return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    };

    const c = parse(current);
    const l = parse(latest);
    const len = Math.max(c.mainIds.length, l.mainIds.length);
    for (let i = 0; i < len; i++) {
      const cv = c.mainIds[i] || 0;
      const lv = l.mainIds[i] || 0;
      if (lv > cv) return true;
      if (lv < cv) return false;
    }

    // Main versions are equal; pre-release decides. A version WITHOUT a
    // pre-release is newer than one with (e.g. 2.1.0 > 2.1.0-rc.1).
    if (c.preIds.length === 0 && l.preIds.length === 0) return false;
    if (c.preIds.length === 0) return false; // current is stable, latest is pre-release: latest is NOT newer
    if (l.preIds.length === 0) return true;  // current is pre-release, latest is stable: latest IS newer

    const preLen = Math.max(c.preIds.length, l.preIds.length);
    for (let i = 0; i < preLen; i++) {
      // Per semver: a larger set of pre-release fields has HIGHER precedence
      // than a smaller set (when all preceding identifiers are equal). So
      // 2.1.0-beta.1 > 2.1.0-beta, and 2.1.0-rc.1 > 2.1.0-rc.1.0.
      if (c.preIds[i] === undefined) return true;  // latest has more identifiers → newer
      if (l.preIds[i] === undefined) return false; // current has more identifiers → latest is NOT newer
      const cmp = comparePreId(c.preIds[i], l.preIds[i]);
      if (cmp !== 0) return cmp < 0;
    }
    return false;
  }


  public async quitAndInstallUpdate(): Promise<void> {
    console.log('[AutoUpdater] quitAndInstall called - applying update...')

    // On macOS, unsigned apps can't auto-restart via quitAndInstall
    // Workaround: Open the folder containing the downloaded update so user can install manually
    if (process.platform === 'darwin') {
      try {
        // Get the downloaded update file path (e.g., .../CueUp-1.0.9-mac.zip)
        const updateFile = (autoUpdater as any).downloadedUpdateHelper?.file
        console.log('[AutoUpdater] Downloaded update file:', updateFile)

        if (updateFile) {
          const updateDir = path.dirname(updateFile)
          // Open the directory containing the update in Finder
          await shell.openPath(updateDir)
          console.log('[AutoUpdater] Opened update directory:', updateDir)

          // Notify renderer so the UI can prompt the user with manual install instructions
          this.broadcast("update-manual-install-required", {
            reason: 'unsigned-macos',
            message: '已打开 Finder,请将 CueUp 拖入 Applications 文件夹覆盖安装。'
          })

          // Give the user time to read the prompt before quitting the app
          setTimeout(() => app.quit(), 3000)
          return
        }
      } catch (err) {
        console.error('[AutoUpdater] Failed to open update directory:', err)
      }
    }

    // Fallback to standard quitAndInstall (works on Windows/Linux or if signed)
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true)
      } catch (err) {
        console.error('[AutoUpdater] quitAndInstall failed:', err)
        app.exit(0)
      }
    })
  }

  public async checkForUpdates(): Promise<void> {
    console.log('[AutoUpdater] Manual check for updates requested')
    try {
      // In development mode, use manual GitHub API check (electron-updater skips in dev)
      if (!app.isPackaged) {
        await this.checkForUpdatesManual()
      } else {
        await autoUpdater.checkForUpdatesAndNotify()
      }
    } catch (err: any) {
      console.error('[AutoUpdater] checkForUpdates failed:', err)
      const errorMessage = err.message || err.toString() || 'Update check failed'
      this.broadcast("update-error", errorMessage)
    }
  }

  public async downloadUpdate(): Promise<void> {
    console.log('[AutoUpdater] Starting download...')
    try {
      // Errors during download are surfaced via autoUpdater.on("error") which
      // already broadcasts "update-error". Do not broadcast here to avoid duplicates.
      await autoUpdater.downloadUpdate()
    } catch (err: any) {
      console.error('[AutoUpdater] downloadUpdate failed:', err)
      const errorMessage = err?.message || err?.toString() || 'Update download failed'
      this.broadcast("update-error", errorMessage)
      throw err
    }
  }

  // New Property for System Audio & Microphone
  private systemAudioCapture: SystemAudioCapture | null = null;
  private microphoneCapture: MicrophoneCapture | null = null;
  private audioTestCapture: MicrophoneCapture | null = null; // For audio settings test
  private _audioTestStarting = false;               // P2-12: in-flight guard against concurrent calls
  private googleSTT: STTProvider | null = null; // Interviewer
  private googleSTT_User: STTProvider | null = null; // User

  private getSttRuntimeDiagnostics(
    speaker: 'interviewer' | 'user',
    requestedLanguageOverride?: string,
  ): {
    speaker: 'interviewer' | 'user';
    provider: string;
    requestedLanguageKey: string;
    effectiveLanguageKey: string;
    willHonorSelection: boolean;
    reasonCode: string;
    perChannelEnabled: boolean;
    activeModelId: string | null;
    globalModelId: string | null;
    micModelId: string | null;
    systemModelId: string | null;
  } {
    const { CredentialsManager } = require('./services/CredentialsManager');
    const { SettingsManager } = require('./services/SettingsManager');
    const { resolveSttLanguageCompatibility } = require('./audio/sttLanguageCompatibility');

    const credentialsManager = CredentialsManager.getInstance();
    const settingsManager = SettingsManager.getInstance();
    const provider = credentialsManager.getSttProvider();
    const requestedLanguageKey =
      requestedLanguageOverride ?? credentialsManager.getSttLanguage() ?? 'english-us';
    const perChannelEnabled = !!settingsManager.get('localWhisperPerChannelEnabled');
    const globalModelId = settingsManager.get('localWhisperModel') ?? null;
    const micModelId = settingsManager.get('localWhisperModelMic') ?? null;
    const systemModelId = settingsManager.get('localWhisperModelSystem') ?? null;
    const activeModelId =
      provider === 'local-whisper'
        ? perChannelEnabled
          ? (speaker === 'interviewer' ? systemModelId : micModelId) || globalModelId || 'Xenova/whisper-base'
          : globalModelId || 'Xenova/whisper-base'
        : null;
    const compatibility = resolveSttLanguageCompatibility({
      provider,
      requestedLanguageKey,
      localWhisper: {
        enabled: perChannelEnabled,
        globalModelId: globalModelId ?? '',
        micModelId: micModelId ?? '',
        systemModelId: systemModelId ?? '',
      },
    });

    return {
      speaker,
      provider,
      requestedLanguageKey,
      effectiveLanguageKey: compatibility.effectiveLanguageKey,
      willHonorSelection: compatibility.willHonorSelection,
      reasonCode: compatibility.reasonCode,
      perChannelEnabled,
      activeModelId,
      globalModelId,
      micModelId,
      systemModelId,
    };
  }

  private logSttRuntimeDiagnostics(
    context: string,
    speaker: 'interviewer' | 'user',
    requestedLanguageOverride?: string,
  ): void {
    try {
      const diagnostics = this.getSttRuntimeDiagnostics(speaker, requestedLanguageOverride);
      console.log(`[Main] STT diagnostics (${context})`, diagnostics);
    } catch (error: any) {
      console.warn(
        `[Main] Failed to collect STT diagnostics (${context}/${speaker}): ${error?.message || error}`,
      );
    }
  }

  private resetMeetingEchoDiagnostics(): void {
    this._meetingEchoTranscriptDiagnostics = {};
    this._meetingAudioPeakDiagnostics = {
      interviewer: { peak: 0, at: 0 },
      user: { peak: 0, at: 0 },
    };
  }

  private recordMeetingAudioPeak(speaker: MeetingAudioSpeaker, chunk: Buffer, now: number = Date.now()): void {
    let peak = 0;
    const stride = Math.max(2, (chunk.length >> 6) & ~1);
    for (let i = 0; i + 1 < chunk.length; i += stride) {
      const sample = chunk.readInt16LE(i);
      const abs = sample < 0 ? -sample : sample;
      if (abs > peak) peak = abs;
    }
    this._meetingAudioPeakDiagnostics[speaker] = {
      peak: peak / 32768,
      at: now,
    };
  }

  private normalizeTranscriptForEchoDiagnostics(text: string): string {
    return text
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  private transcriptSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;

    if (a.length < 2 || b.length < 2) {
      const aChars = new Set([...a]);
      const bChars = new Set([...b]);
      let overlap = 0;
      for (const ch of aChars) {
        if (bChars.has(ch)) overlap++;
      }
      const union = new Set([...aChars, ...bChars]).size;
      return union === 0 ? 0 : overlap / union;
    }

    const bigrams = new Map<string, number>();
    for (let i = 0; i < a.length - 1; i++) {
      const key = a.slice(i, i + 2);
      bigrams.set(key, (bigrams.get(key) ?? 0) + 1);
    }

    let overlap = 0;
    for (let i = 0; i < b.length - 1; i++) {
      const key = b.slice(i, i + 2);
      const count = bigrams.get(key) ?? 0;
      if (count > 0) {
        overlap++;
        if (count === 1) bigrams.delete(key);
        else bigrams.set(key, count - 1);
      }
    }

    return (2 * overlap) / ((a.length - 1) + (b.length - 1));
  }

  private logMeetingEchoDiagnostics(
    speaker: MeetingAudioSpeaker,
    text: string,
    final: boolean,
    receivedAt: number,
  ): void {
    if (!final) return;

    const counterpart: MeetingAudioSpeaker = speaker === 'user' ? 'interviewer' : 'user';
    const normalizedText = this.normalizeTranscriptForEchoDiagnostics(text);
    const current: MeetingEchoTranscriptDiagnostic = {
      at: receivedAt,
      normalizedText,
      textLength: text.trim().length,
      final,
    };
    const previousCounterpart = this._meetingEchoTranscriptDiagnostics[counterpart];
    const currentPeak = this._meetingAudioPeakDiagnostics[speaker];
    const counterpartPeak = this._meetingAudioPeakDiagnostics[counterpart];
    const deltaMs = previousCounterpart ? receivedAt - previousCounterpart.at : null;
    const absDeltaMs = deltaMs == null ? null : Math.abs(deltaMs);
    const sameWindow = absDeltaMs != null && absDeltaMs <= 2500;
    const textSimilarity =
      previousCounterpart && sameWindow
        ? this.transcriptSimilarity(normalizedText, previousCounterpart.normalizedText)
        : null;

    console.log('[Main][EchoDiag] meeting transcript channel comparison', {
      channel: speaker === 'user' ? 'mic' : 'system',
      counterpartChannel: counterpart === 'user' ? 'mic' : 'system',
      sameWindow,
      deltaMs,
      textSimilarity,
      textLength: current.textLength,
      counterpartTextLength: previousCounterpart?.textLength ?? null,
      audioPeak: currentPeak.peak,
      counterpartAudioPeak: counterpartPeak.peak,
      audioPeakAgeMs: currentPeak.at > 0 ? receivedAt - currentPeak.at : null,
      counterpartAudioPeakAgeMs: counterpartPeak.at > 0 ? receivedAt - counterpartPeak.at : null,
    });

    this._meetingEchoTranscriptDiagnostics[speaker] = current;
  }

  private createSTTProvider(speaker: 'interviewer' | 'user'): STTProvider | null {
    const { CredentialsManager } = require('./services/CredentialsManager');
    const sttProvider = CredentialsManager.getInstance().getSttProvider();
    const sttLanguage = normalizeRecognitionLanguageForProvider(
      sttProvider,
      CredentialsManager.getInstance().getSttLanguage(),
    );
    this.logSttRuntimeDiagnostics('create-stt-provider', speaker);

    // 'none' means the user has explicitly disabled STT (no provider selected).
    // Return null so the pipeline skips STT without falling back to Google.
    if (sttProvider === 'none') {
      console.log(`[Main] STT provider is 'none' — audio capture will proceed but transcription is disabled.`);
      return null;
    }

    const stt = createSTTProvider(sttProvider, speaker);
    if (!stt) return null;

    stt.setRecognitionLanguage(sttLanguage);
    try {
      const { SettingsManager } = require('./services/SettingsManager');
      const { SpeakerProfileStore } = require('./services/speaker/SpeakerProfileStore');
      const { getSharedSpeakerEmbeddingExtractor } = require('./services/speaker/SpeakerEmbeddingExtractor');
      const { SpeakerVerificationService } = require('./services/speaker/SpeakerVerificationService');
      const { SpeakerVerificationAnnotator } = require('./services/speaker/SpeakerVerificationAnnotator');
      const store = new SpeakerProfileStore(DatabaseManager.getInstance());
      const profile = store.getMeProfile();
      if (profile && SettingsManager.getInstance().getSpeakerVerificationMode() === 'local') {
        const extractor = getSharedSpeakerEmbeddingExtractor();
        const service = new SpeakerVerificationService({ store, extractor });
        stt.setSpeakerVerificationAnnotator(new SpeakerVerificationAnnotator({
          getMode: () => SettingsManager.getInstance().getSpeakerVerificationMode(),
          service,
        }));
      }
    } catch (error: any) {
      console.warn('[Main] Local speaker verification unavailable', {
        message: error?.message ?? String(error),
      });
    }

    // Wire Transcript Events
    stt.on('transcript', (segment: TranscriptSegment) => {
      // Accept transcripts while a meeting is active OR while we're draining
      // trailing finals after Stop. `_isDraining` covers the ~250 ms grace
      // window between Stop click and STT socket close so the user's last
      // sentence isn't silently dropped.
      if (!this.isMeetingActive && !this._isDraining) {
        return;
      }

      const receivedAt = Date.now();
      const transcriptPayload = {
        speaker: speaker,
        speakerId: segment.speakerId,
        speakerLabel: segment.speakerLabel,
        providerSpeakerId: segment.providerSpeakerId,
        diarizationProvider: segment.diarizationProvider,
        text: segment.text,
        timestamp: receivedAt,
        final: segment.isFinal,
        confidence: segment.confidence,
        startTimestampMs: segment.startTimestampMs,
        endTimestampMs: segment.endTimestampMs,
        emotion: segment.emotion,
        emotionSource: segment.emotionSource,
        emotionDegree: segment.emotionDegree,
        emotionScore: segment.emotionScore,
        emotionDegreeScore: segment.emotionDegreeScore,
        speakerVerification: segment.speakerVerification,
        coalescedFromCount: segment.coalescedFromCount,
        coalescedProvider: segment.coalescedProvider,
        rawSegmentIds: segment.rawSegmentIds
      };

      this.logMeetingEchoDiagnostics(speaker, segment.text, segment.isFinal, receivedAt);

      const transcriptResult = this.intelligenceManager.handleTranscript(transcriptPayload);

      // Feed final transcript to JIT RAG indexer
      if (segment.isFinal && this.ragManager) {
        if (!transcriptResult?.mergedIntoPrevious) {
          const ragTranscript = transcriptResult?.segment ?? transcriptPayload;
          this.ragManager.feedLiveTranscript([{
            speaker: ragTranscript.speaker,
            text: ragTranscript.text,
            timestamp: ragTranscript.timestamp
          }]);
        }
      }

      if (segment.isFinal && segment.text.trim()) {
        this._meetingHasAnyTranscript = true;
        if (speaker === 'user') this._meetingHasMicTranscript = true;
      }

      const helper = this.getWindowHelper();
      helper.getLauncherWindow()?.webContents.send('native-audio-transcript', transcriptPayload);
      helper.getOverlayWindow()?.webContents.send('native-audio-transcript', transcriptPayload);

      // Feed final recruiter (system audio) transcripts to the premium
      // negotiation tracker. Issue #272: gate by active mode template so the
      // tracker never accumulates negotiation state in modes where salary is
      // out of scope (technical-interview, team-meet, lecture). Output gating
      // in LLMHelper is the primary defense; gating at the source stops state
      // from carrying over to any future read site. Fails open if ModesManager
      // is unavailable.
      if (segment.isFinal && speaker === 'interviewer') {
        let trackerFeedAllowed = true;
        try {
          const { ModesManager } = require('./services/ModesManager');
          trackerFeedAllowed = ModesManager.getInstance().isPremiumKnowledgeInterceptAllowed();
        } catch (_err) {
          // fail open — preserve existing behaviour for modes that need the tracker
        }
        if (trackerFeedAllowed) {
          this.knowledgeOrchestrator?.feedInterviewerUtterance?.(segment.text);
        }
      }
    });

    this.broadcast('stt-status', {
      state: 'connected',
      provider: sttProvider,
      channel: speaker,
    } as SttStatusPayload);

    // Consecutive failure counter — reset on any successful final transcript
    let _consecutiveErrors = 0;

    // Track state so we broadcast 'connected' on recovery from failed/reconnecting
    let _lastState: 'connected' | 'reconnecting' | 'failed' = 'connected';

    stt.on('error', (err: Error) => {
      // Google streamingRecognize's 10s silence timeout closes the stream
      // with gRPC code 11 ("Audio Timeout Error"). GoogleSTT already
      // swallows this case before it reaches us, but other providers may
      // surface a similar idle-timeout that the lazy-reconnect path
      // recovers from cleanly. Downgrade to a one-liner here as well so
      // a stray bubble-up doesn't cascade into stack-trace noise.
      const grpcCode = (err as any)?.code;
      if (grpcCode === 11 || /Audio Timeout Error/i.test(err.message || '')) {
        console.warn(`[Main] STT (${speaker}) idle-timed-out (provider's no-audio limit), reconnecting on next chunk.`);
        return;
      }

      console.error(`[Main] STT (${speaker}) Error:`, err);

      // Extract richer error info from Axios errors (RestSTT)
      let errorMessage = err.message;
      const axiosErr = err as any;
      const httpStatus = axiosErr?.response?.status || 0;
      if (axiosErr?.response?.data?.error) {
        const respErr = axiosErr.response.data.error;
        const respMsg = typeof respErr === 'string' ? respErr : (respErr.message || respErr.code || JSON.stringify(respErr));
        errorMessage = httpStatus ? `${httpStatus} ${respMsg}` : respMsg;
      } else if (httpStatus) {
        errorMessage = `${httpStatus} ${axiosErr.response.statusText}`;
      }

      // Immediately fatal: auth/account problems — no amount of retrying helps
      const isAuthError = httpStatus === 401
        || err.message.toLowerCase().includes('auth_timeout')
        || err.message.toLowerCase().includes('invalid_key')
        || err.message.toLowerCase().includes('invalid api')
        || err.message.toLowerCase().includes('authentication');

      const isQuotaError = err.message.toLowerCase().includes('transcription_quota_exceeded')
        || err.message.toLowerCase().includes('quota');

      if (isAuthError) {
        _consecutiveErrors = 0;
        _lastState = 'failed';
        this.broadcast('stt-status', {
          state: 'failed',
          provider: sttProvider,
          error: errorMessage,
          channel: speaker,
        } as SttStatusPayload);
        return;
      }

      // Retryable: network drop, timeout, 5xx, 400, 429, WS drop
      _consecutiveErrors++;
      const maxErrors = 5;

      if (_consecutiveErrors >= maxErrors || isQuotaError) {
        _lastState = 'failed';
        this.broadcast('stt-status', {
          state: 'failed',
          provider: sttProvider,
          error: isQuotaError
            ? errorMessage
            : `STT provider failed (${_consecutiveErrors} consecutive errors): ${errorMessage}`,
          channel: speaker,
          reconnectAttempts: _consecutiveErrors,
        } as SttStatusPayload);
      } else {
        _lastState = 'reconnecting';
        this.broadcast('stt-status', {
          state: 'reconnecting',
          provider: sttProvider,
          error: errorMessage,
          channel: speaker,
          reconnectAttempts: _consecutiveErrors,
        } as SttStatusPayload);
      }
    });

    // Track successful transcripts — resets consecutive error counter
    // Broadcasts 'connected' whenever we recover from reconnecting/failed
    stt.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number }) => {
      if (segment.isFinal) {
        _consecutiveErrors = 0; // Success — reset counter
        if (_lastState !== 'connected') {
          _lastState = 'connected';
          this.broadcast('stt-status', {
            state: 'connected',
            provider: sttProvider,
            channel: speaker,
          } as SttStatusPayload);
        }
      }
    });

    // Non-fatal telemetry from providers (e.g. OpenAIStreamingSTT emits this
    // when the pre-session ring buffer evicts leading audio while waiting for
    // the WebSocket handshake). Surface it in the main-process log so the
    // signal isn't silently dropped — the event is informational, not a status
    // change, so we don't push it through the stt-status channel.
    stt.on('warning', (w: { code?: string; message?: string; droppedBytes?: number }) => {
      console.warn(`[Main] STT (${speaker}) warning: ${w?.code ?? 'unknown'}`,
        { provider: sttProvider, message: w?.message, droppedBytes: w?.droppedBytes });
    });

    stt.on('quality-diagnostic', (diagnostic: unknown) => {
      this.sttQualityDiagnosticsCollector?.write(diagnostic);
    });

    // Auto language detection: NativelyProSTT emits 'languageDetected' when the
    // backend resolves the language from the first audio batch. Notify the renderer
    // so the settings UI can show what was detected.
    // Use duck-type check instead of instanceof to avoid importing NativelyProSTT.
    if (typeof (stt as any).setChannel === 'function') {
      stt.on('languageDetected', (bcp47: string) => {
        console.log(`[Main] STT language auto-detected (${speaker}): ${bcp47}`);
        const helper = this.getWindowHelper();
        helper.getMainWindow()?.webContents.send('stt-language-auto-detected', bcp47);
        helper.getLauncherWindow()?.webContents.send('stt-language-auto-detected', bcp47);
      });

      // Persistent-reconnect signal: NativelyProSTT now retries indefinitely
      // with a 30s backoff cap, but we want the user to know after ~5 attempts
      // (~30–90s of dead transcript) that the issue is sustained, not a blip.
      // Reuse the stt-status channel with state='reconnecting' and a higher
      // attempts count so the renderer's existing banner picks it up.
      stt.on('persistent-reconnect', (info: { attempts: number }) => {
        console.warn(`[Main] STT persistent reconnect (${speaker}): ${info.attempts} consecutive attempts.`);
        this.broadcast('stt-status', {
          state: 'reconnecting',
          provider: sttProvider,
          error: `Reconnecting to transcription service — ${info.attempts} consecutive attempts. Check your network connection.`,
          channel: speaker,
          reconnectAttempts: info.attempts,
        } as SttStatusPayload);
      });
    }

    return stt;
  }

  /**
   * REFACTOR: wireSystemCapture / wireMicCapture.
   *
   * Previously the listener-wiring blocks for SystemAudioCapture were
   * duplicated three times (setupSystemAudioPipeline + happy-path of
   * reconfigureAudio + fallback-path of reconfigureAudio), each with its own
   * closure-local chunk counter (`_sysChunkCount` / `_rcfgSysChunkCount` /
   * `_dfltSysChunkCount`) and slightly different log prefix. That made it
   * impossible to know which counter was active from the logs.
   *
   * Consolidation: a single helper attaches all four listeners against the
   * given capture instance. The `label` parameter only affects logging so
   * the originating call site is still identifiable. setupAudioRecoveryHandler
   * is also called here so every wire-up path gets recovery for free.
   */
  private wireSystemCapture(capture: SystemAudioCapture, label: string = ''): void {
    const prefix = label ? `[Main] ${label} ` : '[Main] ';
    let chunkCount = 0;
    let levelLogCount = 0;
    let gainAppliedCount = 0;
    const shouldNormalizeChineseSystemAudio = (() => {
      try {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const cm = CredentialsManager.getInstance();
        const provider = cm.getSttProvider();
        const language = normalizeRecognitionLanguageForProvider(provider, cm.getSttLanguage());
        return provider === 'local-whisper' && language === 'chinese';
      } catch {
        return false;
      }
    })();
    // Watchdog: if no chunks arrive within 8s of capture start, the most likely
    // causes are (a) Screen Recording permission was revoked between the TCC
    // check and SCK init, (b) the meeting app routes audio to a device the
    // CoreAudio Tap isn't bound to, or (c) the system is genuinely silent.
    // Production-grade apps surface this so the user knows their interviewer's
    // audio isn't being picked up — instead of staring at an empty transcript.
    let stuckTimer: NodeJS.Timeout | null = null;
    const armStuckWatchdog = () => {
      if (stuckTimer) clearTimeout(stuckTimer);
      stuckTimer = setTimeout(() => {
        if (this.systemAudioCapture !== capture) return; // capture was replaced
        if (chunkCount > 0) return;                       // already producing
        if (!this.isMeetingActive) return;                // meeting ended

        // Bluetooth devices like AirPods register with separate identifiers
        // for input (cpal device name) and output (CoreAudio UID with
        // optional :input/:output suffix). When the user has the same
        // physical device on both sides of the pipeline, macOS cannot run a
        // CoreAudio Process Tap on it while it's also the active microphone
        // — the tap initializes "successfully" but every IO callback yields
        // zero frames. The 8s watchdog is the most reliable signal we get.
        // Surface the actual cause instead of a generic "route mismatch"
        // hint so the user knows what to change.
        // The same-device-input-output limitation is a CoreAudio Process Tap
        // constraint — only relevant on macOS. detectSameInputOutputDevice
        // is itself macOS-specific; skip the check on other platforms.
        const sameDeviceName = process.platform === 'darwin'
          ? this.detectSameInputOutputDevice()
          : null;
        if (sameDeviceName) {
          const msg = formatPermissionMessage('mac-same-device-input-output', { device: sameDeviceName });
          const backend = capture.getBackendName();
          console.warn(`${prefix}SystemAudioCapture ${msg}`);
          this.broadcast('audio-capture-failed', {
            channel: 'system',
            message: msg,
            attempt: 0,
            maxAttempts: 3,
            backend,
            terminal: false,
            stuck: true,
          });
          return;
        }

        const backend = capture.getBackendName();
        const routeDiagnostics = this.getOutputRouteDiagnostics();
        console.warn(`${prefix}SystemAudioCapture produced 0 chunks in 8s — likely silent capture (route mismatch or permission revoked).`);
        this.broadcast('audio-capture-failed', {
          channel: 'system',
          message: this.withOutputRouteHint(formatPermissionMessage('system-audio-stuck'), routeDiagnostics),
          attempt: 0,
          maxAttempts: 3,
          backend,
          routeDiagnostics,
          terminal: false,
          stuck: true,
        });
      }, 8000);
    };

    // TCC zero-fill detector. Apple's CoreAudio Process Tap returns zero-filled
    // buffers (instead of an OSStatus error) when the launched binary's
    // Screen Recording / audio-capture grant doesn't apply — typically after a
    // dev rebuild changes the bundle signature, or when the user revokes the
    // grant mid-session. Symptom: the IO proc fires at the correct cadence and
    // chunks flow normally, but every f32 sample is 0.0. Without a dedicated
    // detector, the no-chunks watchdog above never fires and the user just sees
    // an empty interviewer transcript with no idea why.
    //
    // Strategy: track the absolute peak of every chunk (cheap — 960 i16s per
    // 20ms chunk). After we've seen ZEROFILL_OBSERVATION_MS of nothing but
    // peak==0 chunks, broadcast a TCC-specific banner. Latch off the detector
    // permanently as soon as we see a single non-zero peak so a quiet meeting
    // doesn't trigger the warning later. The latency budget intentionally
    // exceeds the no-chunks watchdog (8s) so the two banners don't race.
    const ZEROFILL_OBSERVATION_MS = 12000;
    let firstChunkAt = 0;
    let zerofillLatched = false;       // true once a non-zero peak has been observed (detector off)
    let zerofillTriggered = false;     // true once we've already broadcast — prevent repeats
    capture.on('start', armStuckWatchdog);
    capture.on('stop', () => {
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
    });
    // Inter-chunk gap tracking. Normal cadence is one 20ms chunk every 20ms
    // (so ~50/sec). A gap >2s while the meeting is active and the capture is
    // still wired indicates a transient route change (AirPods plug/unplug,
    // HDMI attach, USB hot-plug). The 8s no-chunks watchdog above catches
    // longer outages; this just logs the in-between case so anyone reading
    // logs can correlate "transcript stuttered" with a route change instead
    // of suspecting STT or network problems. Deliberately not promoted to a
    // UI banner — that would spam during normal device juggling.
    let lastChunkAt = 0;
    capture.on('data', (chunk: Buffer) => {
      const now = Date.now();
      if (lastChunkAt > 0) {
        const gap = now - lastChunkAt;
        if (gap > 2000 && gap < 8000) {
          console.warn(`${prefix}SystemAudio chunk gap ${gap}ms — likely transient route change. Resuming.`);
        }
      }
      lastChunkAt = now;
      chunkCount++;
      if (chunkCount === 1 && stuckTimer) {
        clearTimeout(stuckTimer);
        stuckTimer = null;
      }
      if (!this._sysSttRateApplied && this.googleSTT && this.systemAudioCapture === capture) {
        const rate = capture.getSampleRate();
        const backend = capture.getBackendName();
        this.googleSTT.setSampleRate(rate);
        this.googleSTT.setAudioChannelCount?.(1);
        this._sysSttRateApplied = true;
        console.log(`${prefix}Interviewer STT rate locked from first chunk: ${rate}Hz (backend=${backend})`);
      }
      if (chunkCount <= 3 || chunkCount % 500 === 0) {
        console.log(`${prefix}SystemAudio->STT: chunk #${chunkCount}, ${chunk.length}B, googleSTT=${this.googleSTT ? 'active' : 'NULL'}`);
      }

      // TCC zero-fill check. macOS-specific: WASAPI loopback on Windows does
      // not produce sustained zero-fill on permission revocation, so the
      // detector has no diagnostic value off Darwin and the suggested fix
      // (System Settings → Screen Recording) doesn't apply.
      if (process.platform === 'darwin' && !zerofillLatched && !zerofillTriggered) {
        if (firstChunkAt === 0) firstChunkAt = Date.now();
        // Stride-sample 16 samples across the chunk — sufficient to catch any
        // real audio content, ~32× cheaper than scanning all 960 samples.
        let peak = 0;
        const stride = Math.max(2, (chunk.length >> 5) & ~1); // even byte offset
        for (let i = 0; i + 1 < chunk.length; i += stride) {
          const s = chunk.readInt16LE(i);
          const a = s < 0 ? -s : s;
          if (a > peak) { peak = a; if (peak > 8) break; }
        }
        if (peak > 8) {
          // Real audio observed — disable the detector for the rest of the session.
          zerofillLatched = true;
        } else if (Date.now() - firstChunkAt >= ZEROFILL_OBSERVATION_MS) {
          zerofillTriggered = true;
          void this.handleZeroFilledSystemAudio(capture, prefix, ZEROFILL_OBSERVATION_MS);
        }
      }

      let sttChunk = chunk;
      if (shouldNormalizeChineseSystemAudio) {
        const normalized = preprocessCurrentChineseSystemAudio(chunk);
        sttChunk = normalized.chunk;
        if (normalized.gain > 1) gainAppliedCount++;
        if (levelLogCount < 5 || chunkCount % 500 === 0) {
          const after = normalized.gain > 1 ? measureSystemAudioPcm16Level(sttChunk) : normalized.before;
          console.log(
            `${prefix}SystemAudio level: rms=${normalized.before.rms.toFixed(5)} peak=${normalized.before.peak.toFixed(5)} gain=${normalized.gain.toFixed(2)} afterRms=${after.rms.toFixed(5)} gainApplied=${gainAppliedCount}`,
          );
          levelLogCount++;
        }
      }

      this.recordMeetingAudioPeak('interviewer', sttChunk, now);
      this.googleSTT?.write(sttChunk);
    });
    capture.on('sample_rate_changed', (rate: number) => {
      console.log(`${prefix}SystemAudioCapture rate updated dynamically to ${rate}Hz`);
      this.googleSTT?.setSampleRate(rate);
    });
    capture.on('speech_ended', () => {
      this.googleSTT?.notifySpeechEnded?.();
    });
    // setupAudioRecoveryHandler registers its own 'error' listener — do not
    // add a duplicate logger here or the same error reports twice.
    this.setupAudioRecoveryHandler();
  }

  private async handleZeroFilledSystemAudio(
    capture: SystemAudioCapture,
    prefix: string,
    observationMs: number,
  ): Promise<void> {
    if (this.systemAudioCapture !== capture) return;
    if (!this.isMeetingActive) return;

    const sameDeviceName = process.platform === 'darwin'
      ? this.detectSameInputOutputDevice()
      : null;
    if (sameDeviceName) {
      const message = formatPermissionMessage('mac-same-device-input-output', { device: sameDeviceName });
      const backend = capture.getBackendName();
      console.warn(`${prefix}SystemAudio zero-fill matched same-device conflict: ${sameDeviceName}`);
      this.broadcast('audio-capture-failed', {
        channel: 'system',
        message,
        attempt: 0,
        maxAttempts: 3,
        backend,
        terminal: false,
        stuck: true,
      });
      return;
    }

    const screenCapability = await resolveMacScreenCaptureCapability('system audio zero-fill detector');
    const nativeRate = capture.getNativeSampleRate();
    const emittedRate = capture.getSampleRate();
    const backend = capture.getBackendName();
    const routeDiagnostics = this.getOutputRouteDiagnostics();
    console.warn(
      `${prefix}SystemAudio chunks all zero-filled for ${observationMs / 1000}s — ` +
      `backend=${backend} status=${screenCapability.status} capturable=${screenCapability.capturable} sources=${screenCapability.sourceCount} ` +
      `emittedRate=${emittedRate}Hz nativeRate=${nativeRate || 0}Hz ` +
      `requestedOutput=${routeDiagnostics.requestedOutputId || '(default)'} defaultOutput=${routeDiagnostics.defaultOutputId || '(unknown)'}`
    );

    const coreAudioTccSuspected =
      process.platform === 'darwin' &&
      backend === 'coreaudio' &&
      !screenCapability.effectiveDenied &&
      screenCapability.capturable;
    const baseMessage =
      screenCapability.staleGrantSuspected
        ? this.getStaleScreenRecordingMessage()
        : screenCapability.effectiveDenied || !screenCapability.capturable
          ? this.getStaleScreenRecordingMessage()
          : coreAudioTccSuspected
            ? this.getCoreAudioTccRepairMessage()
            : this.getSystemAudioZeroFillMessage();
    const message = this.withOutputRouteHint(baseMessage, routeDiagnostics);

    if (screenCapability.staleGrantSuspected) {
      this.broadcastScreenTccRepairRequired('SCREEN_TCC_RESET_REQUIRED', message, backend);
    } else if (coreAudioTccSuspected) {
      this.broadcastCoreAudioTccRepairRequired(message, backend);
    } else {
      this.broadcast('audio-capture-failed', {
        channel: 'system',
        message,
        attempt: 0,
        maxAttempts: 3,
        backend,
        routeDiagnostics,
        terminal: false,
        stuck: true,
      });
    }
  }

  private wireMicCapture(capture: MicrophoneCapture, label: string = ''): void {
    const prefix = label ? `[Main] ${label} ` : '[Main] ';
    let chunkCount = 0;
    // Mirror of the system-audio stuck watchdog: if the cpal callback never
    // produces samples within 8s of start (USB mic that disappears on open,
    // exclusive-mode contention with another app, default device returning
    // a handle that's actually muted), surface a clear UI signal instead of
    // letting the user transcript silently die.
    let stuckTimer: NodeJS.Timeout | null = null;
    const armStuckWatchdog = () => {
      if (stuckTimer) clearTimeout(stuckTimer);
      stuckTimer = setTimeout(() => {
        if (this.microphoneCapture !== capture) return;
        if (chunkCount > 0) return;
        if (!this.isMeetingActive) return;
        console.warn(`${prefix}MicrophoneCapture produced 0 chunks in 8s — likely silent capture (device contention, hot-unplug, or muted input).`);
        this.broadcast('audio-capture-failed', {
          channel: 'mic',
          message: 'No audio detected from your microphone for 8s. Check that your input device is unmuted and not in use by another app.',
          attempt: 0,
          maxAttempts: 3,
          terminal: false,
          stuck: true,
        });
      }, 8000);
    };
    capture.on('start', armStuckWatchdog);
    capture.on('stop', () => {
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
    });
    // Inter-chunk gap tracking — see wireSystemCapture for rationale.
    let lastChunkAt = 0;
    // Mic TCC / muted-input zero-fill detector. cpal will happily open a mic
    // stream and deliver silent (peak=0) buffers when:
    //   - macOS Microphone permission was revoked between TCC check and start,
    //   - the OS muted the input via the menu bar mic indicator,
    //   - the hardware mic is physically muted (some Jabra/Bose headsets),
    //   - exclusive-mode contention with a meeting app (Zoom/Teams) on Windows.
    // Same shape as the system tap zero-fill: chunks arrive on cadence but every
    // sample is 0. Without this, the user just sees an empty user transcript
    // and assumes the meeting itself is broken.
    const ZEROFILL_OBSERVATION_MS = 12000;
    let firstChunkAt = 0;
    let zerofillLatched = false;
    let zerofillTriggered = false;
    capture.on('data', (chunk: Buffer) => {
      const now = Date.now();
      if (lastChunkAt > 0) {
        const gap = now - lastChunkAt;
        if (gap > 2000 && gap < 8000) {
          console.warn(`${prefix}Mic chunk gap ${gap}ms — likely transient device change (USB hot-plug, BT reconnect). Resuming.`);
        }
      }
      lastChunkAt = now;
      chunkCount++;
      if (chunkCount === 1 && stuckTimer) {
        clearTimeout(stuckTimer);
        stuckTimer = null;
      }
      if (!this._micSttRateApplied && this.googleSTT_User && this.microphoneCapture === capture) {
        const rate = capture.getSampleRate();
        this.googleSTT_User.setSampleRate(rate);
        this.googleSTT_User.setAudioChannelCount?.(1);
        this._micSttRateApplied = true;
        console.log(`${prefix}User STT rate locked from first mic chunk: ${rate}Hz`);
      }

      if (!zerofillLatched && !zerofillTriggered) {
        if (firstChunkAt === 0) firstChunkAt = now;
        let peak = 0;
        const stride = Math.max(2, (chunk.length >> 5) & ~1);
        for (let i = 0; i + 1 < chunk.length; i += stride) {
          const s = chunk.readInt16LE(i);
          const a = s < 0 ? -s : s;
          if (a > peak) { peak = a; if (peak > 8) break; }
        }
        if (peak > 8) {
          zerofillLatched = true;
        } else if (now - firstChunkAt >= ZEROFILL_OBSERVATION_MS) {
          zerofillTriggered = true;
          console.warn(`${prefix}Mic chunks all zero-filled for ${ZEROFILL_OBSERVATION_MS / 1000}s — TCC denial or device-mute suspected.`);
          this.broadcastMicTccRepairRequired(formatPermissionMessage('mic-zero-fill'));
        }
      }

      this.recordMeetingAudioPeak('user', chunk, now);
      this.googleSTT_User?.write(chunk);
    });
    capture.on('sample_rate_changed', (rate: number) => {
      console.log(`${prefix}MicrophoneCapture rate updated dynamically to ${rate}Hz`);
      this.googleSTT_User?.setSampleRate(rate);
    });
    capture.on('speech_ended', () => {
      this.googleSTT_User?.notifySpeechEnded?.();
    });
    // setupMicRecoveryHandler registers its own 'error' listener.
    this.setupMicRecoveryHandler();
  }

  private broadcastNativeAudioModuleUnavailable(channel: 'system' | 'mic', err: unknown): void {
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'Native audio module is unavailable. Rebuild or reinstall CueUp for this Mac architecture, then restart the app.';
    this.broadcast('audio-capture-failed', {
      channel,
      message,
      code: 'NATIVE_AUDIO_MODULE_UNAVAILABLE',
      attempt: 0,
      maxAttempts: 0,
      terminal: true,
      stuck: false,
    });
  }

  private broadcastScreenTccRepairRequired(code: 'SCREEN_TCC_STALE_GRANTED' | 'SCREEN_TCC_RESET_REQUIRED', message: string, backend?: string): void {
    if (this._screenTccRepairBannerShown) return;
    this._screenTccRepairBannerShown = true;
    this.broadcast('audio-capture-failed', {
      channel: 'system',
      message,
      code,
      recommendedFix: 'reset-tcc',
      staleGrantSuspected: true,
      attempt: 0,
      maxAttempts: 0,
      backend,
      terminal: false,
      stuck: true,
    });
  }

  private broadcastCoreAudioTccRepairRequired(message: string, backend?: string): void {
    if (this._screenTccRepairBannerShown) return;
    this._screenTccRepairBannerShown = true;
    this.broadcast('audio-capture-failed', {
      channel: 'system',
      message,
      code: 'CORE_AUDIO_TCC_RESET_REQUIRED',
      recommendedFix: 'reset-tcc',
      staleGrantSuspected: true,
      attempt: 0,
      maxAttempts: 0,
      backend,
      terminal: false,
      stuck: true,
    });
  }

  private broadcastMicTccRepairRequired(message: string): void {
    if (this._micTccRepairBannerShown) return;
    this._micTccRepairBannerShown = true;
    this.broadcast('audio-capture-failed', {
      channel: 'mic',
      message,
      code: 'MIC_TCC_STALE_GRANTED',
      recommendedFix: 'reset-tcc',
      staleGrantSuspected: true,
      attempt: 0,
      maxAttempts: 0,
      terminal: false,
      stuck: true,
    });
  }

  private getStaleScreenRecordingMessage(): string {
    return process.platform === 'darwin'
      ? formatPermissionMessage('mac-screen-recording-revoked-rebuild')
      : formatPermissionMessage('screen-recording-denied');
  }

  private getCoreAudioTccRepairMessage(): string {
    return process.platform === 'darwin'
      ? formatPermissionMessage('mac-coreaudio-audio-capture-revoked')
      : formatPermissionMessage('system-audio-stuck');
  }

  private getSystemAudioZeroFillMessage(): string {
    return process.platform === 'darwin'
      ? formatPermissionMessage('mac-system-audio-zero-fill')
      : formatPermissionMessage('system-audio-failure');
  }

  private async setupSystemAudioPipeline(): Promise<void> {
    // REMOVED EARLY RETURN: if (this.systemAudioCapture && this.microphoneCapture) return; // Already initialized

    try {
      // 1. Initialize Captures if missing
      // If they already exist (e.g. from reconfigureAudio), they are already wired to write to this.googleSTT/User
      if (!this.systemAudioCapture) {
        const screenCapability = await resolveMacScreenCaptureCapability('system audio pipeline setup');
        if (screenCapability.effectiveDenied) {
          if (screenCapability.staleGrantSuspected) {
            const message = this.getStaleScreenRecordingMessage();
            console.warn('[Main] Skipping SystemAudioCapture init — stale Screen Recording grant suspected. Meeting will run mic-only.');
            this.broadcastScreenTccRepairRequired('SCREEN_TCC_STALE_GRANTED', message);
          } else {
            console.warn('[Main] Skipping SystemAudioCapture init — Screen Recording permission denied. Meeting will run mic-only.');
            this.broadcast('system-audio-permission-denied',
              formatPermissionMessage('screen-recording-denied'));
          }
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: null,
            actual: null,
            fellBack: true,
            reason: screenCapability.staleGrantSuspected ? 'screen-recording-stale-grant' : 'screen-recording-permission-denied',
          });
        } else {
          this.systemAudioCapture = new SystemAudioCapture();
          this.wireSystemCapture(this.systemAudioCapture);
          // Transparency: tell the renderer which device is actually being captured
          // even on the no-metadata default path. Previously only reconfigureAudio
          // broadcast this, so a meeting started without an explicit device choice
          // left the UI in the dark about whether system audio was using the
          // expected output route.
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: null,
            actual: 'default',
            fellBack: false,
          });
        }
      }

      if (!this.microphoneCapture) {
        try {
          this.microphoneCapture = new MicrophoneCapture();
          this.wireMicCapture(this.microphoneCapture);
        } catch (micErr) {
          this.microphoneCapture = null;
          if (isNativeAudioModuleUnavailable(micErr)) {
            this.broadcastNativeAudioModuleUnavailable('mic', micErr);
          } else {
            throw micErr;
          }
        }
      }

      // 2. Initialize STT Services if missing
      // STT init wraps each createSTTProvider in its own try/catch so a single
      // provider failure (bad API key, missing credentials file, network error
      // during constructor) doesn't break the entire pipeline AND the user gets
      // a specific UI signal instead of the generic "no transcript" experience.
      const { CredentialsManager } = require('./services/CredentialsManager');
      const sttProv = CredentialsManager.getInstance().getSttProvider();

      if (!this.googleSTT) {
        console.log(`[Main] Creating interviewer STT provider: ${sttProv}`);
        try {
          this.googleSTT = this.createSTTProvider('interviewer');
        } catch (sttErr) {
          console.error(`[Main] Interviewer STT init failed (${sttProv}):`, sttErr);
          this.googleSTT = null;
        }
        if (!this.googleSTT) {
          this.broadcast('audio-capture-failed', {
            channel: 'system',
            message: `Speech-to-text provider "${sttProv}" failed to initialize for the interviewer channel. Check your API key and credentials in Settings.`,
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }

      if (!this.googleSTT_User) {
        console.log(`[Main] Creating user STT provider: ${sttProv}`);
        try {
          this.googleSTT_User = this.createSTTProvider('user');
        } catch (sttErr) {
          console.error(`[Main] User STT init failed (${sttProv}):`, sttErr);
          this.googleSTT_User = null;
        }
        if (!this.googleSTT_User) {
          this.broadcast('audio-capture-failed', {
            channel: 'mic',
            message: `Speech-to-text provider "${sttProv}" failed to initialize for the microphone channel. Check your API key and credentials in Settings.`,
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }

      // STT sample rate is now applied lazily on the first chunk arrival
      // (see the 'data' handlers above). Pre-configuring here was racy because
      // SystemAudioCapture's monitor doesn't exist until start() and returns
      // the constructor default (48000) until the native bg-init thread
      // publishes the real rate — which on Windows after Fix #2 is known
      // synchronously, but on macOS CoreAudio Tap takes ~5-7s to propagate.
      this._sysSttRateApplied = false;
      this._micSttRateApplied = false;

      if (this._verboseLogging) console.log('[Main] Full Audio Pipeline (System + Mic) Initialized (Ready)');

    } catch (err) {
      console.error('[Main] Failed to setup System Audio Pipeline:', err);
    }
  }

  /**
   * PERF: Pre-construct STT provider objects at app launch so the meeting-start
   * critical path doesn't pay for createSTTProvider (which does CredentialsManager
   * lookup + listener wiring + per-provider class init).
   *
   * NOTE: this only constructs the JS objects. Provider sockets are still opened
   * lazily on first .write() / .start() — opening idle sockets at app launch
   * would burn provider quota and is provider-specific behavior we don't want
   * to assume. The actual streaming-WebSocket cold-start is a separate (larger)
   * optimization that should be done per-provider.
   *
   * Safe to call multiple times: existence guards in setupSystemAudioPipeline
   * prevent duplicate construction.
   */
  public prewarmSttProviders(): void {
    if (this.googleSTT && this.googleSTT_User) return;
    try {
      if (!this.googleSTT) {
        console.log('[Main] Pre-warming interviewer STT provider...');
        this.googleSTT = this.createSTTProvider('interviewer');
      }
      if (!this.googleSTT_User) {
        console.log('[Main] Pre-warming user STT provider...');
        this.googleSTT_User = this.createSTTProvider('user');
      }
    } catch (err) {
      // Pre-warm failure is non-fatal; setupSystemAudioPipeline will retry on
      // first meeting start with full error handling.
      console.warn('[Main] STT pre-warm failed (will retry on meeting start):', err);
    }
  }

  public scheduleAdaptiveLocalSttPreload(): void {
    try {
      const provider = CredentialsManager.getInstance().getSttProvider();
      if (provider === 'local-sensevoice') {
        const { SENSEVOICE_DEFAULT_MODEL_ID } = require('./audio/sensevoice/types');
        const { isSenseVoiceModelCached } = require('./audio/sensevoice/modelManager');
        this.adaptivePreloadManager.scheduleLocalSttPreload({
          provider,
          modelId: SENSEVOICE_DEFAULT_MODEL_ID,
          modelDownloaded: isSenseVoiceModelCached(SENSEVOICE_DEFAULT_MODEL_ID),
        });
        return;
      }
      if (provider === 'local-whisper') {
        const modelId = SettingsManager.getInstance().get('localWhisperModel') ?? 'Xenova/whisper-base';
        const { isModelCached } = require('./audio/whisper/modelManager');
        const { resolveInferenceConfig } = require('./audio/whisper/inferenceConfig');
        this.adaptivePreloadManager.scheduleLocalSttPreload({
          provider,
          modelId,
          modelDownloaded: isModelCached(modelId, resolveInferenceConfig().dtype),
        });
        return;
      }
      this.adaptivePreloadManager.scheduleLocalSttPreload({ provider, modelDownloaded: false });
    } catch (error) {
      console.warn('[AppState] Adaptive local STT preload skipped:', error);
    }
  }

  public async disposeIdleResources(): Promise<void> {
    await this.adaptivePreloadManager.disposeIdleResources();
  }

  private async preloadSelectedLocalStt(selection: LocalSttPreloadSelection): Promise<void> {
    if (selection.provider === 'local-whisper') {
      const { modelPreloader } = require('./audio/whisper/modelPreloader');
      modelPreloader.preload(selection.modelId);
      return;
    }
    if (selection.provider !== 'local-sensevoice') return;

    const { localSttWorkerPool } = require('./audio/LocalSttWorkerPool');
    const { createSenseVoiceWorkerConfig } = require('./audio/sensevoice/LocalSenseVoiceSTT');
    const lease = localSttWorkerPool.acquire(
      createSenseVoiceWorkerConfig({ modelId: selection.modelId }),
      'mic',
    ) as LocalSttWorkerLease;
    this.adaptiveSenseVoiceLease = lease;
    const retainCrashListener = () => {
      const onCrash = () => {
        if (this.adaptiveSenseVoiceLease !== lease) return;
        lease.off('error', onCrash);
        this.adaptiveSenseVoiceLease = null;
        this.adaptiveSenseVoiceErrorHandler = null;
        void lease.release().catch(() => {});
        this.adaptivePreloadManager.notifyPreloadedResourceInvalidated();
      };
      this.adaptiveSenseVoiceErrorHandler = onCrash;
      lease.on('error', onCrash);
    };
    if (lease.isReady) {
      retainCrashListener();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('SenseVoice adaptive preload timed out'));
      }, 60_000);
      const cleanup = () => {
        clearTimeout(timeout);
        lease.off('message', onMessage);
        lease.off('error', onError);
      };
      const onMessage = (message: { type?: string }) => {
        if (message.type !== 'ready') return;
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      lease.on('message', onMessage);
      lease.on('error', onError);
    }).then(retainCrashListener).catch(async error => {
      if (this.adaptiveSenseVoiceLease === lease) this.adaptiveSenseVoiceLease = null;
      await lease.release();
      throw error;
    });
  }

  private async releasePreloadedLocalStt(): Promise<void> {
    const lease = this.adaptiveSenseVoiceLease;
    this.adaptiveSenseVoiceLease = null;
    if (lease && this.adaptiveSenseVoiceErrorHandler) {
      lease.off('error', this.adaptiveSenseVoiceErrorHandler);
    }
    this.adaptiveSenseVoiceErrorHandler = null;
    if (lease) await lease.release();
    try {
      const { modelPreloader } = require('./audio/whisper/modelPreloader');
      modelPreloader.terminate();
    } catch {
      // Whisper compatibility preloader may not have been loaded.
    }
  }

  private isHeavyIndexingActive(): boolean {
    try {
      const ragQueue = this.ragManager?.getQueueStatus();
      const materialQueue = DatabaseManager.getInstance().getMaterialQueueStatus();
      return Boolean((ragQueue?.processing ?? 0) > 0 || materialQueue.processing > 0);
    } catch {
      return false;
    }
  }

  /**
   * Restart system + mic captures after a macOS sleep/wake cycle.
   *
   * Why this exists: when the laptop sleeps (lid close, "Sleep" menu, idle
   * timeout), CoreAudio invalidates the AggregateDevice handle, the SCK
   * stream silently dies, and the Process Tap stops delivering buffers. On
   * resume the OS doesn't notify our IO proc, so the captures sit there
   * looking healthy (chunkCount > 0 from before sleep, isRecording=true)
   * but never produce another chunk. The 8s no-chunks watchdog *would*
   * eventually fire, but only on the path where chunkCount stays at 0 — it
   * doesn't help mid-meeting after we've already seen audio.
   *
   * The WS connection is similarly half-dead: TCP keepalive won't notice
   * for 2+ hours on macOS, and meanwhile the renderer shows a frozen
   * transcript and a "Connected" badge.
   *
   * Cleanest fix: on system resume, if a meeting is active, destroy and
   * recreate both captures using the same device IDs the user originally
   * picked. The STT WS will close as a side effect of the capture stop and
   * reconnect via the existing scheduleReconnect path. Total dead air is
   * ~500ms — a small price for guaranteed recovery.
   */
  public async restartCapturesAfterResume(): Promise<void> {
    if (!this.isMeetingActive) {
      console.log('[Main] System resume — no active meeting, nothing to restart.');
      return;
    }
    console.log('[Main] System resume — restarting captures so CoreAudio/cpal handles are fresh.');

    // System audio (CoreAudio Tap is the most fragile across sleep cycles).
    if (this.systemAudioCapture) {
      try {
        this.systemAudioCapture.destroy();
      } catch (e) {
        console.warn('[Main] Resume: system capture destroy threw:', e);
      }
      this.systemAudioCapture = null;
    }
    try {
      const screenCapability = await resolveMacScreenCaptureCapability('resume capture restart');
      if (screenCapability.effectiveDenied) {
        if (screenCapability.staleGrantSuspected) {
          const message = this.getStaleScreenRecordingMessage();
          this.broadcastScreenTccRepairRequired('SCREEN_TCC_STALE_GRANTED', message);
        } else {
          this.broadcast(
            'system-audio-permission-denied',
            formatPermissionMessage('screen-recording-denied'),
          );
        }
        this.broadcastDeviceSelection({
          kind: 'output',
          requested: this._lastRequestedOutputDeviceId || null,
          actual: null,
          fellBack: true,
          reason: screenCapability.staleGrantSuspected
            ? 'screen-recording-stale-grant'
            : 'screen-recording-permission-denied',
        });
      } else {
        this.systemAudioCapture = new SystemAudioCapture(this._lastRequestedOutputDeviceId);
        this._sysSttRateApplied = false;
        this.wireSystemCapture(this.systemAudioCapture, '(Resume)');
        this.systemAudioCapture.start();
      }
    } catch (err) {
      console.error('[Main] Resume: failed to restart system capture:', err);
      this.broadcast('audio-capture-failed', {
        channel: 'system',
        message: 'System audio capture failed to restart after wake. End and restart the meeting to recover.',
        attempt: 0,
        maxAttempts: 0,
        terminal: true,
        stuck: false,
      });
    }

    // Mic — usually survives sleep but recreate to be safe; cpal exclusive
    // mode on Windows can silently drop the stream.
    if (this.microphoneCapture) {
      try {
        this.microphoneCapture.destroy();
      } catch (e) {
        console.warn('[Main] Resume: mic capture destroy threw:', e);
      }
      this.microphoneCapture = null;
    }
    try {
      this.microphoneCapture = new MicrophoneCapture(this._lastRequestedInputDeviceId);
      this._micSttRateApplied = false;
      this.wireMicCapture(this.microphoneCapture, '(Resume)');
      this.microphoneCapture.start();
    } catch (err) {
      console.error('[Main] Resume: failed to restart mic capture:', err);
      this.broadcast('audio-capture-failed', {
        channel: 'mic',
        message: 'Microphone failed to restart after wake. Check that no other app holds the mic, then end and restart the meeting.',
        attempt: 0,
        maxAttempts: 0,
        terminal: true,
        stuck: false,
      });
    }
  }

  /**
   * Broadcast which device the main process actually opened, vs what the
   * renderer requested. Renderer subscribes to this so it can show a banner
   * when fallback to default occurred (e.g. saved AirPods name no longer in
   * the cpal list because they're disconnected). Without this signal the UI
   * shows "AirPods selected" but capture is silently using built-in mic.
   */
  private broadcastDeviceSelection(payload: {
    kind: 'input' | 'output';
    requested: string | null;
    actual: string | null;
    fellBack: boolean;
    reason?: string;
  }): void {
    console.log(`[Main] device-selection-applied:`, payload);
    this.broadcast('device-selection-applied', payload);
  }

  private getOutputRouteDiagnostics(): OutputRouteDiagnostics {
    const normalizeOutputRouteDiagnosticId = (id: string | null | undefined): string | null =>
      id === 'sck' ? null : id || null;
    const requestedOutputId = normalizeOutputRouteDiagnosticId(this._lastRequestedOutputDeviceId);
    let defaultOutputId: string | null = null;

    try {
      const NativeModule: any = loadNativeModule();
      if (NativeModule && typeof NativeModule.getDefaultOutputDeviceId === 'function') {
        defaultOutputId = NativeModule.getDefaultOutputDeviceId() || null;
      }
    } catch {
      defaultOutputId = null;
    }

    let outputs: Array<{ id: string; name: string }> = [];
    try {
      outputs = AudioDevices.getOutputDevices();
    } catch {
      outputs = [];
    }

    const stripSuffix = (s: string) => s.replace(/:(input|output)$/i, '');
    const sameOutput = (a: string | null, b: string | null) =>
      !!a && !!b && stripSuffix(a).toLowerCase() === stripSuffix(b).toLowerCase();
    const findName = (id: string | null): string | null => {
      if (!id) return null;
      const idBase = stripSuffix(id).toLowerCase();
      return outputs.find(d => stripSuffix(d.id).toLowerCase() === idBase)?.name || null;
    };

    return {
      requestedOutputId,
      requestedOutputName: findName(requestedOutputId),
      defaultOutputId,
      defaultOutputName: findName(defaultOutputId),
      usingDefaultRoute: !requestedOutputId,
      selectedDiffersFromDefault: !!requestedOutputId && !!defaultOutputId && !sameOutput(requestedOutputId, defaultOutputId),
    };
  }

  private withOutputRouteHint(message: string, route: OutputRouteDiagnostics): string {
    const selected = route.requestedOutputName || route.requestedOutputId || 'Default output';
    const currentDefault = route.defaultOutputName || route.defaultOutputId || 'unknown';

    if (route.selectedDiffersFromDefault) {
      return `${message} CueUp is listening to "${selected}", while the system default output is "${currentDefault}". Make sure the meeting/interviewer audio is routed to "${selected}", or switch CueUp's speaker setting back to Default.`;
    }

    if (route.usingDefaultRoute && route.defaultOutputName) {
      return `${message} Current system default output: "${route.defaultOutputName}".`;
    }

    return message;
  }

  private maybeBroadcastSckOutputRouteIgnored(capture: SystemAudioCapture | null = this.systemAudioCapture): void {
    if (!capture || this._sckRouteIgnoredBroadcasted) return;
    let backend = 'unknown';
    try {
      backend = capture.getBackendName();
    } catch {
      backend = 'unknown';
    }
    if (backend !== 'sck') return;

    const routeDiagnostics = this.getOutputRouteDiagnostics();
    if (!routeDiagnostics.requestedOutputId) return;

    this._sckRouteIgnoredBroadcasted = true;
    const selected = routeDiagnostics.requestedOutputName || routeDiagnostics.requestedOutputId;
    const currentDefault = routeDiagnostics.defaultOutputName || routeDiagnostics.defaultOutputId || 'unknown';
    const message =
      `ScreenCaptureKit fallback is active and ignores the selected speaker "${selected}". ` +
      `Interviewer audio is captured from global system audio instead. Current system default output: "${currentDefault}".`;

    console.warn(`[Main] ${message}`);
    this.broadcast('audio-capture-failed', {
      channel: 'system',
      message,
      code: 'SCK_OUTPUT_ROUTE_IGNORED',
      attempt: 0,
      maxAttempts: 0,
      backend,
      routeDiagnostics,
      terminal: false,
      stuck: false,
    });
  }

  /**
   * Normalize a device id from the renderer/localStorage into the canonical
   * "use the system default" form (undefined). Treats null, empty string, and
   * the literal sentinel "default" as equivalent to "no preference".
   *
   * This matters because Rust's `list_input_devices()` returns ("default",
   * "Default Microphone") as the first option, so the renderer's "Default"
   * dropdown choice gets persisted as the literal string "default" — which
   * is truthy in JS and would otherwise:
   *   - defeat the default-output watcher's `_lastRequestedOutputDeviceId`
   *     guard (it skipped polling for users on Default because the field
   *     was the truthy string "default" instead of undefined),
   *   - leave the reconfigureAudio device-id comparison dependent on the
   *     exact string the renderer happened to send,
   *   - cause the mic recovery handler to attempt recreation with the
   *     literal "default" string (which Rust handles correctly, but only
   *     because of explicit special-casing in microphone.rs/sck.rs).
   * Centralizing the normalization here keeps every downstream consumer on
   * the same page about what "default" actually means.
   */
  private normalizeDeviceId(id: string | null | undefined): string | undefined {
    if (!id) return undefined;
    const trimmed = id.trim();
    if (!trimmed) return undefined;
    if (trimmed.toLowerCase() === 'default') return undefined;
    return trimmed;
  }

  /**
   * Detect the case where the requested input and output devices are the same
   * physical hardware (typically AirPods on both sides). Input IDs come from
   * cpal (device name), output IDs come from CoreAudio (UID with optional
   * :input/:output suffix), so direct string comparison won't catch the
   * conflict. We resolve the output UID to a friendly name via
   * AudioDevices.getOutputDevices() and compare it to the input name (case-
   * insensitive). Returns the friendly name when a same-device conflict is
   * detected, undefined otherwise.
   */
  private detectSameInputOutputDevice(): string | undefined {
    return this.checkSameInputOutputDevice(this._lastRequestedInputDeviceId, this._lastRequestedOutputDeviceId);
  }

  /**
   * Pure variant of detectSameInputOutputDevice that takes the IDs as args
   * instead of reading from instance state. Used by reconfigureAudio so the
   * conflict check runs against the INCOMING request before instance state
   * is mutated, which would otherwise interact badly with the skip-if-
   * unchanged early-exit.
   */
  private checkSameInputOutputDevice(inputId?: string, outputId?: string): string | undefined {
    if (!inputId || !outputId) return undefined;

    // Strip the macOS CoreAudio :input/:output suffix before any comparison —
    // a single Bluetooth device can appear with both suffixes.
    const stripSuffix = (s: string) => s.replace(/:(input|output)$/i, '');
    const inputBase = stripSuffix(inputId).toLowerCase();
    const outputBase = stripSuffix(outputId).toLowerCase();
    if (inputBase === outputBase) {
      return stripSuffix(inputId);
    }

    // Resolve the output UID to its friendly name and compare to the input
    // name (input IDs from cpal ARE the device name, e.g. "Evin's AirPods Pro").
    try {
      const outputs = AudioDevices.getOutputDevices();
      const outputMatch = outputs.find(d => stripSuffix(d.id).toLowerCase() === outputBase);
      if (outputMatch && outputMatch.name) {
        if (outputMatch.name.toLowerCase() === inputId.toLowerCase()) {
          return outputMatch.name;
        }
      }
    } catch {
      // Native module unavailable — fall through to "no conflict detected".
    }
    return undefined;
  }

  /**
   * Pick the best mic to use when the requested input conflicts with the
   * audio output (same physical device — typically AirPods on both sides).
   * Built-in mics get first preference because they are always available
   * and never participate in the Bluetooth aggregate that's blocking the
   * tap. Falls back to any other input that isn't the conflicting device.
   * Returns undefined if nothing else is plugged in.
   */
  private pickFallbackInputDevice(conflictingName: string): { id: string; name: string } | undefined {
    try {
      const inputs = AudioDevices.getInputDevices();
      if (!inputs?.length) return undefined;

      const stripSuffix = (s: string) => s.replace(/:(input|output)$/i, '');
      const conflictBase = stripSuffix(conflictingName).toLowerCase();
      const isConflicting = (d: { id: string; name: string }) =>
        stripSuffix(d.id).toLowerCase() === conflictBase ||
        d.name.toLowerCase() === conflictBase;
      // Built-in mics on macOS show up as "MacBook Pro Microphone" / "MacBook
      // Air Microphone" / "Built-in Microphone" / "iMac Microphone". Match
      // loosely so we don't miss future Apple naming changes.
      const isBuiltIn = (d: { id: string; name: string }) =>
        /macbook|built[- ]?in|imac|mac\s+studio|mac\s+mini/i.test(d.name);

      return inputs.find(d => !isConflicting(d) && isBuiltIn(d))
          ?? inputs.find(d => !isConflicting(d));
    } catch {
      return undefined;
    }
  }

  private async reconfigureAudio(inputDeviceId?: string | null, outputDeviceId?: string | null): Promise<void> {
    console.log(`[Main] Reconfiguring Audio: Input=${inputDeviceId}, Output=${outputDeviceId}`);

    // PERF: skip the entire destroy+recreate cycle when neither device changed
    // since the last reconfigure AND both captures already exist. Each
    // destroy()+new() costs 50–200ms (macOS CoreAudio Tap re-init, Windows
    // WASAPI device contention, CPAL stream open). The common case — user
    // starts a second meeting with the same mic/speakers — hits this path.
    let wantedInput = this.normalizeDeviceId(inputDeviceId);
    const wantedOutput = this.normalizeDeviceId(outputDeviceId);

    // Auto-fallback for the "same device on both sides" conflict (most common
    // with AirPods used for both listening and the meeting mic). macOS won't
    // tap a device while it's also the active microphone — the system audio
    // capture would silently produce zero-filled buffers and the interviewer
    // transcript would stay empty. Switch the mic to a non-conflicting input
    // (built-in preferred) so the user can keep their headphones for audio
    // output without touching system settings.
    //
    // This check runs BEFORE the skip-if-unchanged comparison so the skip
    // path uses the post-fallback wantedInput. Otherwise a stale identical
    // request could short-circuit a needed re-resolution (e.g., user
    // unplugged the built-in fallback after the first reconfigure).
    if (wantedInput && wantedOutput) {
      const conflict = this.checkSameInputOutputDevice(wantedInput, wantedOutput);
      if (conflict) {
        const fallback = this.pickFallbackInputDevice(conflict);
        if (fallback) {
          console.warn(`[Main] I/O conflict detected (${conflict} on both sides). Auto-switching mic to "${fallback.name}".`);
          wantedInput = this.normalizeDeviceId(fallback.id);
          this.broadcast('audio-input-auto-switched', {
            from: conflict,
            to: fallback.name,
            reason: 'same-device-conflict',
          });
        } else {
          console.warn(`[Main] I/O conflict detected (${conflict}) but no alternate input available — system audio will likely be silent.`);
        }
      }
    }

    if (
      this.systemAudioCapture &&
      this.microphoneCapture &&
      this._lastRequestedInputDeviceId === wantedInput &&
      this._lastRequestedOutputDeviceId === wantedOutput
    ) {
      console.log('[Main] Audio reconfigure skipped — device IDs unchanged.');
      return;
    }

    // Remember the (possibly fallback-overridden) input id so the mic-recovery
    // handler can recreate with the same selection if the cpal stream errors
    // out mid-meeting.
    this._lastRequestedInputDeviceId = wantedInput;
    this._lastRequestedOutputDeviceId = wantedOutput;
    this._sckRouteIgnoredBroadcasted = false;
    // Reset mic recovery counter for the new device choice.
    this._micRecoveryAttempts = 0;

    // 1. System Audio (Output Capture)
    if (this.systemAudioCapture) {
      // destroy() calls stop() AND removeAllListeners(), preventing EventEmitter listener leaks.
      // Using stop()+null would orphan all 'data', 'speech_ended', 'sample_rate_changed'
      // closures (they still hold a ref to `this`) and trigger them on the next meeting.
      this.systemAudioCapture.destroy();
      this.systemAudioCapture = null;
    }

    const screenCapability = await resolveMacScreenCaptureCapability('audio reconfigure');
    if (screenCapability.effectiveDenied) {
      if (screenCapability.staleGrantSuspected) {
        const message = this.getStaleScreenRecordingMessage();
        console.warn('[Main] Skipping SystemAudioCapture reconfigure — stale Screen Recording grant suspected. Meeting will run mic-only.');
        this.broadcastScreenTccRepairRequired('SCREEN_TCC_STALE_GRANTED', message);
      } else {
        console.warn('[Main] Skipping SystemAudioCapture reconfigure — Screen Recording permission denied. Meeting will run mic-only.');
        this.broadcast('system-audio-permission-denied',
          formatPermissionMessage('screen-recording-denied'));
      }
      this.broadcastDeviceSelection({
        kind: 'output',
        requested: wantedOutput || null,
        actual: null,
        fellBack: true,
        reason: screenCapability.staleGrantSuspected ? 'screen-recording-stale-grant' : 'screen-recording-permission-denied',
      });
    } else {
      try {
        console.log('[Main] Initializing SystemAudioCapture...');
        this.systemAudioCapture = new SystemAudioCapture(wantedOutput);
        this._sysSttRateApplied = false;
        this.wireSystemCapture(this.systemAudioCapture, '(Reconfigured)');
        console.log('[Main] SystemAudioCapture initialized.');
        this.broadcastDeviceSelection({
          kind: 'output',
          requested: wantedOutput || null,
          actual: wantedOutput || 'default',
          fellBack: false,
        });
      } catch (err) {
        console.warn('[Main] Failed to initialize SystemAudioCapture with preferred ID. Falling back to default.', err);
        try {
          this.systemAudioCapture = new SystemAudioCapture(); // Default
          this._sysSttRateApplied = false;
          this.wireSystemCapture(this.systemAudioCapture, '(Default)');
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: wantedOutput || null,
            actual: 'default',
            fellBack: true,
            reason: (err as Error)?.message || 'unknown',
          });
        } catch (err2) {
          console.error('[Main] Failed to initialize SystemAudioCapture (Default):', err2);
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: wantedOutput || null,
            actual: null,
            fellBack: true,
            reason: `Both preferred and default failed: ${(err2 as Error)?.message || 'unknown'}`,
          });
        }
      }
    }

    // 2. Microphone (Input Capture)
    if (this.microphoneCapture) {
      // destroy() calls stop() AND removeAllListeners(), preventing EventEmitter listener leaks.
      this.microphoneCapture.destroy();
      this.microphoneCapture = null;
    }

    try {
      console.log('[Main] Initializing MicrophoneCapture...');
      this.microphoneCapture = new MicrophoneCapture(wantedInput);
      this._micSttRateApplied = false;
      this.wireMicCapture(this.microphoneCapture, '(Reconfigured)');
      console.log('[Main] MicrophoneCapture initialized.');
      this.broadcastDeviceSelection({
        kind: 'input',
        requested: wantedInput || null,
        actual: wantedInput || 'default',
        fellBack: false,
      });
    } catch (err) {
      console.warn('[Main] Failed to initialize MicrophoneCapture with preferred ID. Falling back to default.', err);
      try {
        this.microphoneCapture = new MicrophoneCapture(); // Default
        this._micSttRateApplied = false;
        this.wireMicCapture(this.microphoneCapture, '(Default)');
        this.broadcastDeviceSelection({
          kind: 'input',
          requested: wantedInput || null,
          actual: 'default',
          fellBack: true,
          reason: (err as Error)?.message || 'unknown',
        });
      } catch (err2) {
        // Third-level fallback: enumerate every available input device and try
        // each in order. Common case where this matters: user has only
        // Bluetooth-HFP mics available (AirPods/Sony XM5), one of which
        // returns an unsupported sample format from cpal. Without this,
        // both `wantedInput` and `default` could be the SAME failing device,
        // and the user is left with a meeting that has zero mic input.
        console.warn('[Main] Default mic also failed. Enumerating remaining input devices to try each.', err2);
        const tried = new Set<string>([
          wantedInput ?? '',
          'default',
        ].filter(Boolean));
        const candidates = AudioDevices.getInputDevices()
          .map((d) => d.id)
          .filter((id) => id && !tried.has(id));
        let success = false;
        let lastErr: unknown = err2;
        for (const candidateId of candidates) {
          try {
            console.log(`[Main] Trying mic fallback candidate: ${candidateId}`);
            this.microphoneCapture = new MicrophoneCapture(candidateId);
            this._micSttRateApplied = false;
            this.wireMicCapture(this.microphoneCapture, `(Fallback:${candidateId})`);
            this.broadcastDeviceSelection({
              kind: 'input',
              requested: wantedInput || null,
              actual: candidateId,
              fellBack: true,
              reason: `Preferred and default failed; using ${candidateId}.`,
            });
            success = true;
            break;
          } catch (errN) {
            lastErr = errN;
            console.warn(`[Main] Fallback candidate ${candidateId} failed:`, errN);
          }
        }
        if (!success) {
          console.error('[Main] All input devices failed to initialize.', lastErr);
          this.microphoneCapture = null;
          this.broadcastDeviceSelection({
            kind: 'input',
            requested: wantedInput || null,
            actual: null,
            fellBack: true,
            reason: `All ${candidates.length + 2} input devices failed: ${(lastErr as Error)?.message || 'unknown'}`,
          });
          // Surface to UI so the user knows the meeting will be system-audio-only.
          this.broadcast('audio-capture-failed', {
            channel: 'mic',
            message: 'No working microphone could be initialized. Disconnect and reconnect your audio devices, or restart the app.',
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }
    }
  }

  /**
   * Serialization mutex for reconfigureSttProvider.
   *
   * Crash/hang fix (2026-06-05): STT provider changes can fire reconfigure
   * calls close together. Each call tears down and rebuilds the
   * native captures (SystemAudioCapture / MicrophoneCapture → CoreAudio /
   * ScreenCaptureKit / WASAPI). Two interleaved teardown+construct sequences
   * against the same native device handles is a native-resource race that
   * deadlocks the OS audio stack or crashes the process — manifesting as the
   * "app hangs / freezes the system right after entering the key" reports on
   * BOTH macOS and Windows (the bug is in this cross-platform JS orchestration,
   * not in any OS-specific native code).
   *
   * Every other capture-mutating flow in this class is already guarded
   * (`_systemAudioRecoveryInProgress`, `_defaultOutputSwitchInProgress`); this
   * path was the one gap. We serialize rather than drop: the second caller
   * genuinely needs to apply the latest provider config, so it awaits the
   * in-flight reconfigure and then runs its own against fresh state.
   */
  private _sttReconfigureChain: Promise<void> = Promise.resolve();

  /**
   * Reconfigure STT provider mid-session (called from IPC when user changes provider)
   * Destroys existing STT instances and recreates them with the new provider.
   *
   * Concurrency: serialized via `_sttReconfigureChain`. Concurrent callers are
   * queued and run one-at-a-time, so the native captures are never torn down /
   * rebuilt in parallel. A throw in one queued reconfigure must not break the
   * chain for the next caller, so the chain link swallows the error here and
   * re-throws to THIS caller only.
   */
  public async reconfigureSttProvider(): Promise<void> {
    const run = this._sttReconfigureChain.then(
      () => this._doReconfigureSttProvider(),
      // Previous link rejected — its error already surfaced to its own caller.
      // Don't let it poison this link; proceed with our reconfigure.
      () => this._doReconfigureSttProvider(),
    );
    // Keep the chain alive regardless of this run's outcome so a failure never
    // wedges all future reconfigures.
    this._sttReconfigureChain = run.then(
      (): undefined => undefined,
      (): undefined => undefined,
    );
    return run;
  }

  private async _doReconfigureSttProvider(): Promise<void> {
    console.log('[Main] Reconfiguring STT Provider...');

    // RC-01 fix: pause audio captures FIRST so their EventEmitter queues drain
    // before we null-out the STT instances. Without this, buffered 'data' events
    // still in-flight call this.googleSTT?.write() while googleSTT is already null.
    if (this.isMeetingActive) {
      this.systemAudioCapture?.stop();
      this.microphoneCapture?.stop();
    }

    // Now safe to destroy STT instances — no more audio events incoming
    if (this.googleSTT) {
      this.googleSTT.stop();
      this.googleSTT.removeAllListeners();
      this.googleSTT = null;
    }
    if (this.googleSTT_User) {
      this.googleSTT_User.stop();
      this.googleSTT_User.removeAllListeners();
      this.googleSTT_User = null;
    }

    // Only reinitialize the pipeline when a meeting is already active.
    // Outside a meeting, defer pipeline creation to startMeeting() so we never
    // eagerly construct a MicrophoneCapture (which calls build_input_stream on
    // macOS and immediately triggers the orange mic indicator even without .play()).
    if (this.isMeetingActive) {
      await this.setupSystemAudioPipeline();
      this.systemAudioCapture?.start();
      this.maybeBroadcastSckOutputRouteIgnored();
      this.microphoneCapture?.start();
      this.googleSTT?.start();
      this.googleSTT_User?.start();
    }

    console.log('[Main] STT Provider reconfigured');

    // Broadcast the new STT config state to all windows so they can update banners / warnings
    const { CredentialsManager: CM } = require('./services/CredentialsManager');
    const newProvider = CM.getInstance().getSttProvider();
    this.broadcast('stt-config-changed', { configured: newProvider !== 'none', provider: newProvider });
    this.scheduleAdaptiveLocalSttPreload();
  }

  /**
   * PR #173: Audio Recovery Handler
   *
   * Listens for 'audio-capture-failed' emit from SystemAudioCapture and
   * transparently restarts the full capture + STT pipeline without ending the
   * meeting session. Prevents silent audio loss when macOS CoreAudio or SCK
   * drops the capture stream mid-session (e.g. device re-plug, Display Sleep).
   */
  private _systemAudioRecoveryInProgress = false;
  private _systemAudioRecoveryAttempts = 0;
  private _systemAudioRecoveryTimer: NodeJS.Timeout | null = null;
  private _systemAudioLastFailureAt: number | null = null;
  private _systemAudioSuccessfulRestarts = 0;
  private _systemAudioConsecutiveFailures = 0;

  private setupAudioRecoveryHandler(): void {
    if (!this.systemAudioCapture) return;

    this.systemAudioCapture.on('error', async (err: Error) => {
      if (!this.isMeetingActive) return; // Only attempt recovery during active meetings

      if (isNativeAudioModuleUnavailable(err)) {
        this.broadcastNativeAudioModuleUnavailable('system', err);
        return;
      }

      const now = Date.now();
      this._systemAudioLastFailureAt = now;
      this._systemAudioConsecutiveFailures++;

      // Cap at 3 consecutive recovery attempts to avoid infinite restart loops
      if (this._systemAudioRecoveryInProgress || this._systemAudioRecoveryAttempts >= 3) {
        console.warn(
          `[AudioRecovery] Skipping recovery — already in progress or max attempts (${this._systemAudioRecoveryAttempts}/3) reached.`,
        );
        return;
      }

      this._systemAudioRecoveryInProgress = true;
      this._systemAudioRecoveryAttempts++;
      console.warn(
        `[AudioRecovery] SystemAudioCapture error — attempting recovery #${this._systemAudioRecoveryAttempts}: ${err.message}`,
      );

      // Surface the failure to the UI so the user sees the actual cause (e.g.
      // "ScreenCaptureKit access denied", "No displays found") instead of just
      // a generic STT 'reconnecting' indicator. This event is non-fatal — the
      // recovery attempt may still succeed.
      this.broadcast('audio-capture-failed', {
        channel: 'system',
        message: err.message,
        attempt: this._systemAudioRecoveryAttempts,
        maxAttempts: 3,
        backend: this.systemAudioCapture?.getBackendName(),
      });

      const oldCapture = this.systemAudioCapture;
      try {
        // Brief delay so the OS can release the device before re-acquisition
        await new Promise<void>(resolve => {
          this._systemAudioRecoveryTimer = setTimeout(resolve, 1500);
        });
        this._systemAudioRecoveryTimer = null;

        // Recovery via destroy+recreate, NOT stop()+start():
        //   - SystemAudioCapture.stop() defers the native teardown via setImmediate
        //     so the synchronously-following start() runs while the Rust capture_thread
        //     is still Some, and Rust's start() returns "Capture already running".
        //   - The deferred stop also leaves the SCK/CoreAudio Tap holding device
        //     resources, so even if start() succeeded the BG thread couldn't
        //     re-acquire them.
        // destroy() (called via the new instance shadow) synchronously removes
        // listeners; the old monitor's stop/join still completes in setImmediate.
        // The new instance has its own fresh state so there's no race.
        oldCapture?.destroy();
        this.systemAudioCapture = null;
        this._sysSttRateApplied = false;

        const screenCapability = await resolveMacScreenCaptureCapability('system audio recovery');
        if (screenCapability.effectiveDenied) {
          if (screenCapability.staleGrantSuspected) {
            this.broadcastScreenTccRepairRequired(
              'SCREEN_TCC_STALE_GRANTED',
              this.getStaleScreenRecordingMessage(),
            );
          } else {
            this.broadcast('system-audio-permission-denied', formatPermissionMessage('screen-recording-denied'));
          }
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: this._lastRequestedOutputDeviceId || null,
            actual: null,
            fellBack: true,
            reason: screenCapability.staleGrantSuspected ? 'screen-recording-stale-grant' : 'screen-recording-permission-denied',
          });
          return;
        }

        const fresh = new SystemAudioCapture(this._lastRequestedOutputDeviceId);
        this.systemAudioCapture = fresh;
        this.wireSystemCapture(fresh, '(Recovery)');
        fresh.start();
        this.maybeBroadcastSckOutputRouteIgnored(fresh);

        this._systemAudioSuccessfulRestarts++;
        this._systemAudioConsecutiveFailures = 0;
        console.log(
          `[AudioRecovery] SystemAudioCapture recreated successfully (total restarts: ${this._systemAudioSuccessfulRestarts}).`,
        );
      } catch (recoveryErr: any) {
        console.error(`[AudioRecovery] Recovery attempt #${this._systemAudioRecoveryAttempts} failed:`, recoveryErr);
        // If we've exhausted recovery, tell the renderer the failure is now terminal
        // for this meeting so it can stop showing "reconnecting" and surface a
        // mic-only banner instead.
        if (this._systemAudioRecoveryAttempts >= 3) {
          this.broadcast('audio-capture-failed', {
            channel: 'system',
            message: `System audio capture gave up after 3 attempts. Last error: ${recoveryErr?.message || err.message}`,
            attempt: this._systemAudioRecoveryAttempts,
            maxAttempts: 3,
            backend: oldCapture?.getBackendName(),
            terminal: true,
          });
        }
      } finally {
        this._systemAudioRecoveryInProgress = false;
      }
    });
  }

  /**
   * Default-output-device watcher.
   *
   * macOS CoreAudio Tap is per-device — it captures audio from one specific
   * output device. When SystemAudioCapture is created with no device id (the
   * common case), the Rust side binds the tap to whatever the system default
   * output WAS at meeting start. If the user later changes their default
   * output (plugs in headphones, switches AirPods, routes to a virtual cable),
   * the tap stays bound to the original device and captures silence — the
   * interviewer transcript suddenly stops with no obvious cause.
   *
   * Production-grade fix: poll the platform default output id every few
   * seconds while a meeting is active. When the id changes, recreate the
   * SystemAudioCapture so the tap follows the new route. This only runs when
   * we're using the default route (no explicit user-selected output device);
   * if the user picked a specific device, we honor that choice and don't
   * second-guess it.
   *
   * Cost: one napi call (CoreAudio HAL property read) every 4s — negligible.
   */
  private _defaultOutputWatcherInterval: NodeJS.Timeout | null = null;
  private _lastObservedDefaultOutputId: string | null = null;
  private _defaultOutputSwitchInProgress = false;

  private startDefaultOutputWatcher(): void {
    if (this._defaultOutputWatcherInterval) return; // already running
    const NativeModule: any = loadNativeModule();
    if (!NativeModule || typeof NativeModule.getDefaultOutputDeviceId !== 'function') {
      // Older binary without the export — silently skip; the rest of the
      // pipeline still works, just without auto-recovery on route changes.
      console.log('[DefaultOutputWatcher] Native getDefaultOutputDeviceId unavailable — skipping route-change watcher.');
      return;
    }
    try {
      this._lastObservedDefaultOutputId = NativeModule.getDefaultOutputDeviceId() || '';
    } catch {
      this._lastObservedDefaultOutputId = '';
    }
    console.log(`[DefaultOutputWatcher] Started. Initial default output: ${this._lastObservedDefaultOutputId || '(none)'}`);

    this._defaultOutputWatcherInterval = setInterval(() => {
      if (!this.isMeetingActive) return;
      // Only watch when we're on the default route. If the user explicitly
      // picked an output device, respect that choice.
      if (this._lastRequestedOutputDeviceId) return;
      if (this._defaultOutputSwitchInProgress) return;
      if (!this.systemAudioCapture) return;

      let currentId = '';
      try {
        currentId = NativeModule.getDefaultOutputDeviceId() || '';
      } catch (err) {
        // CoreAudio momentarily unavailable during route change — skip this tick.
        return;
      }
      if (!currentId) return;
      if (currentId === this._lastObservedDefaultOutputId) return;

      console.warn(`[DefaultOutputWatcher] Default output changed: ${this._lastObservedDefaultOutputId} → ${currentId}. Rebinding CoreAudio Tap.`);
      this._lastObservedDefaultOutputId = currentId;
      this.handleDefaultOutputChanged().catch(err => {
        console.error('[DefaultOutputWatcher] Failed to rebind tap:', err);
      });
    }, 4000);
  }

  private stopDefaultOutputWatcher(): void {
    if (this._defaultOutputWatcherInterval) {
      clearInterval(this._defaultOutputWatcherInterval);
      this._defaultOutputWatcherInterval = null;
    }
    this._lastObservedDefaultOutputId = null;
  }

  private async handleDefaultOutputChanged(): Promise<void> {
    if (this._defaultOutputSwitchInProgress) return;
    this._defaultOutputSwitchInProgress = true;
    try {
      // Same destroy+recreate pattern as setupAudioRecoveryHandler — never
      // stop+start, since the deferred native teardown races the synchronous
      // start. Reset the recovery counter so a subsequent unrelated failure
      // gets its full 3-attempt budget.
      const oldCapture = this.systemAudioCapture;
      oldCapture?.destroy();
      this.systemAudioCapture = null;
      this._sysSttRateApplied = false;
      this._systemAudioRecoveryAttempts = 0;
      this._systemAudioConsecutiveFailures = 0;

      const screenCapability = await resolveMacScreenCaptureCapability('default output route change');
      if (screenCapability.effectiveDenied) {
        if (screenCapability.staleGrantSuspected) {
          this.broadcastScreenTccRepairRequired(
            'SCREEN_TCC_STALE_GRANTED',
            this.getStaleScreenRecordingMessage(),
          );
        } else {
          this.broadcast('system-audio-permission-denied', formatPermissionMessage('screen-recording-denied'));
        }
        this.broadcastDeviceSelection({
          kind: 'output',
          requested: null,
          actual: null,
          fellBack: true,
          reason: screenCapability.staleGrantSuspected ? 'screen-recording-stale-grant' : 'screen-recording-permission-denied',
        });
        return;
      }

      // Pass undefined (not the new device id) so CoreAudio picks up the new
      // default at construction time. This is intentional: binding to a
      // stable id would defeat the whole point of "follow the user's route".
      const fresh = new SystemAudioCapture(undefined);
      this.systemAudioCapture = fresh;
      this.wireSystemCapture(fresh, '(RouteChanged)');
      fresh.start();
      this.maybeBroadcastSckOutputRouteIgnored(fresh);
      // Tell the renderer what's happening so any "interviewer went silent"
      // banners can clear once chunks resume.
      this.broadcastDeviceSelection({
        kind: 'output',
        requested: null,
        actual: 'default',
        fellBack: false,
        reason: 'output-route-changed',
      });
      console.log('[DefaultOutputWatcher] CoreAudio Tap rebound to new default output.');
    } finally {
      this._defaultOutputSwitchInProgress = false;
    }
  }

  // Mic-side equivalent of setupAudioRecoveryHandler. Pre-fix the cpal err_fn
  // (USB unplug, device-format change, exclusive-mode steal) only logged to
  // stderr — JS never learned the mic stream had stopped producing samples
  // and the user's voice silently disappeared from the transcript.
  private _micRecoveryInProgress = false;
  private _micRecoveryAttempts = 0;
  private _micRecoveryTimer: NodeJS.Timeout | null = null;
  /** Last input device id passed to reconfigureAudio; used by mic recovery. */
  private _lastRequestedInputDeviceId: string | undefined = undefined;

  private setupMicRecoveryHandler(): void {
    if (!this.microphoneCapture) return;

    this.microphoneCapture.on('error', async (err: Error) => {
      if (!this.isMeetingActive) return;

      if (isNativeAudioModuleUnavailable(err)) {
        this.broadcastNativeAudioModuleUnavailable('mic', err);
        return;
      }

      if (this._micRecoveryInProgress || this._micRecoveryAttempts >= 3) {
        console.warn(
          `[MicRecovery] Skipping recovery — already in progress or max attempts (${this._micRecoveryAttempts}/3) reached.`,
        );
        return;
      }

      this._micRecoveryInProgress = true;
      this._micRecoveryAttempts++;
      console.warn(
        `[MicRecovery] MicrophoneCapture error — attempting recovery #${this._micRecoveryAttempts}: ${err.message}`,
      );

      try {
        await new Promise<void>(resolve => {
          this._micRecoveryTimer = setTimeout(resolve, 1500);
        });
        this._micRecoveryTimer = null;

        // Tear down + recreate the mic only (don't touch the system-audio
        // capture; cpal needs a fresh device handle after error).
        if (this.microphoneCapture) {
          this.microphoneCapture.destroy();
          this.microphoneCapture = null;
        }
        this._micSttRateApplied = false;

        try {
          this.microphoneCapture = new MicrophoneCapture(this._lastRequestedInputDeviceId);
        } catch (createErr) {
          console.warn('[MicRecovery] Saved device unavailable on recovery, falling back to default.', createErr);
          this.microphoneCapture = new MicrophoneCapture();
        }

        // Re-wire the listeners that reconfigureAudio normally sets up.
        this.microphoneCapture.on('data', (chunk: Buffer) => {
          if (!this._micSttRateApplied && this.googleSTT_User && this.microphoneCapture) {
            const r = this.microphoneCapture.getSampleRate();
            this.googleSTT_User.setSampleRate(r);
            this.googleSTT_User.setAudioChannelCount?.(1);
            this._micSttRateApplied = true;
          }
          this.googleSTT_User?.write(chunk);
        });
        this.microphoneCapture.on('sample_rate_changed', (rate: number) => {
          this.googleSTT_User?.setSampleRate(rate);
        });
        this.microphoneCapture.on('speech_ended', () => {
          this.googleSTT_User?.notifySpeechEnded?.();
        });
        this.setupMicRecoveryHandler(); // re-attach on the new instance
        this.microphoneCapture.start();

        this._micRecoveryAttempts = 0;
        console.log('[MicRecovery] MicrophoneCapture restarted successfully.');
      } catch (recoveryErr: any) {
        console.error(`[MicRecovery] Recovery attempt #${this._micRecoveryAttempts} failed:`, recoveryErr);
      } finally {
        this._micRecoveryInProgress = false;
      }
    });
  }


  public async startAudioTest(deviceId?: string): Promise<void> {
    // P2-12: guard against two concurrent calls both passing the async permission check
    // before either has created a capture — the second call would orphan the first capture.
    if (this._audioTestStarting) return;
    // Block audio test while a meeting is live. Both code paths construct
    // their own MicrophoneCapture instance against the same device; on Windows
    // cpal grants exclusive access, so the second open silently degrades, and
    // on macOS the meeting's capture and the test capture compete for the
    // same input handle — symptom: meeting transcript stalls until the test
    // is closed. Reject the request loudly via the IPC error path so the
    // renderer can disable the Test button instead of letting the user think
    // their mic is broken.
    if (this.isMeetingActive) {
      throw new Error('Audio test is unavailable while a meeting is active. End the meeting first, then test your microphone.');
    }
    this._audioTestStarting = true;
    try {
      await this._startAudioTestImpl(deviceId);
    } finally {
      this._audioTestStarting = false;
    }
  }

  private async _startAudioTestImpl(deviceId?: string): Promise<void> {
    console.log(`[Main] Starting Audio Test on device: ${deviceId || 'default'}`);
    this.stopAudioTest(); // Stop any existing test

    if (!(await ensureMacMicrophoneAccess('audio test'))) {
      throw new Error(formatPermissionMessage('mic-denied'));
    }

    const attachAudioTestListeners = (capture: MicrophoneCapture) => {
      capture.on('data', (chunk: Buffer) => {
        const targets = [
          this.settingsWindowHelper.getSettingsWindow(),
          this.getWindowHelper().getLauncherWindow(),
          this.getWindowHelper().getOverlayWindow(),
        ].filter((win): win is BrowserWindow => !!win && !win.isDestroyed());

        if (targets.length === 0) return;

        let sum = 0;
        const step = 10;
        const len = chunk.length;

        for (let i = 0; i < len; i += 2 * step) {
          const val = chunk.readInt16LE(i);
          sum += val * val;
        }

        const count = len / (2 * step);
        if (count > 0) {
          const rms = Math.sqrt(sum / count);
          const level = Math.min(rms / 10000, 1.0);
          for (const target of targets) {
            target.webContents.send('audio-test-level', level);
          }
        }
      });

      capture.on('error', (err: Error) => {
        console.error('[Main] AudioTest Error:', err);
      });
    };

    try {
      this.audioTestCapture = new MicrophoneCapture(deviceId || undefined);
      attachAudioTestListeners(this.audioTestCapture);
      this.audioTestCapture.start();
    } catch (err) {
      console.warn('[Main] Failed to start audio test on preferred device. Falling back to default.', err);
      // RC-02 fix: explicitly stop and null the failed capture before creating
      // the fallback to prevent a brief double-microphone-capture window.
      try { this.audioTestCapture?.stop(); } catch { /* ignore errors on already-failed capture */ }
      this.audioTestCapture = null;
      try {
        this.audioTestCapture = new MicrophoneCapture();
        attachAudioTestListeners(this.audioTestCapture);
        this.audioTestCapture.start();
      } catch (fallbackErr) {
        console.error('[Main] Failed to start audio test:', fallbackErr);
        throw fallbackErr;
      }
    }
  }

  public stopAudioTest(): void {
    if (this.audioTestCapture) {
      console.log('[Main] Stopping Audio Test');
      this.audioTestCapture.stop();
      this.audioTestCapture = null;
    }
  }

  public finalizeMicSTT(): void {
    // We only want to finalize the user microphone, because the context is Manual Answer
    if (this.googleSTT_User?.finalize) {
      console.log('[Main] Finalizing STT');
      this.googleSTT_User.finalize();
    }
  }

  public async startMeeting(metadata?: any): Promise<void> {
    if (this.isMeetingActive) {
      this.windowHelper.setWindowMode('overlay', true);
      this.broadcastMeetingState();
      return;
    }

    if (this._meetingStartInFlight) {
      return this._meetingStartInFlight;
    }

    this._meetingStartInFlight = this.startMeetingInternal(metadata);
    try {
      await this._meetingStartInFlight;
    } finally {
      this._meetingStartInFlight = null;
    }
  }

  private async startMeetingInternal(metadata?: any): Promise<void> {
    console.log('[Main] Starting Meeting...', metadata);

    this.windowHelper.resetOverlayPosition();
    this.windowHelper.setWindowMode('overlay');
    this.broadcast('meeting-start-status', { phase: 'starting' });

    // If a previous endMeeting() is still draining STT in the background, wait
    // for it to finish before we boot a new session — otherwise the BG teardown
    // could call STT.stop() on instances the new meeting just started using.
    // In the common case (Stop, then Start seconds later) this awaits an
    // already-resolved promise and is free.
    if (this._pendingTeardown) {
      try {
        await this._pendingTeardown;
      } catch {
        // teardown already logs; safe to swallow here
      }
      this._pendingTeardown = null;
    }
    // PR #173: Reset audio recovery state for fresh session
    this._systemAudioRecoveryInProgress = false;
    this._systemAudioRecoveryAttempts = 0;
    this._systemAudioConsecutiveFailures = 0;
    this._sckRouteIgnoredBroadcasted = false;
    this._screenTccRepairBannerShown = false;
    this._micTccRepairBannerShown = false;
    this._meetingHasMicTranscript = false;
    this._meetingHasAnyTranscript = false;
    this.resetMeetingEchoDiagnostics();
    if (this._systemAudioRecoveryTimer) {
      clearTimeout(this._systemAudioRecoveryTimer);
      this._systemAudioRecoveryTimer = null;
    }

    if (!(await ensureMacMicrophoneAccess('meeting start'))) {
      const message = formatPermissionMessage('mic-denied');
      this.broadcast('meeting-start-status', { phase: 'failed', message });
      this.broadcast('meeting-audio-error', message);
      throw new Error(message);
    }

    // Check Screen Recording permission required for system audio capture
    // (CoreAudio Global Process Tap + ScreenCaptureKit both need this).
    // NOTE: The 'not-determined' TCC dialog is triggered once at app startup
    // (in initializeApp) so it never pops up mid-meeting here. We only act on
    // explicit 'denied' — in that case warn the user but let the meeting continue
    // with microphone-only transcription.
    if (process.platform === 'darwin') {
      const screenCapability = await resolveMacScreenCaptureCapability('meeting start');
      console.log(`[Main] macOS screen recording permission status: ${screenCapability.status}; capturable=${screenCapability.capturable}; sources=${screenCapability.sourceCount}`);
      if (screenCapability.effectiveDenied) {
        if (screenCapability.staleGrantSuspected) {
          const message = this.getStaleScreenRecordingMessage();
          console.warn('[Main]', message);
          this.broadcastScreenTccRepairRequired('SCREEN_TCC_STALE_GRANTED', message);
        } else {
          // Permission was explicitly denied — warn the user via the UI but do NOT
          // auto-open System Settings. Forcing that window open every meeting start
          // is extremely disruptive, especially when mic transcription is still working.
          // The UI will show a non-blocking banner; the user can fix it deliberately.
          const message = formatPermissionMessage('screen-recording-denied');
          console.warn('[Main]', message);
          this.broadcast('system-audio-permission-denied', message);
        }
        // NOTE: Do NOT call shell.openExternal() here — it hijacks focus on every meeting
        // start. The UI banner (system-audio-permission-denied IPC event) handles this.
      }
      // 'not-determined': Handled at startup. SCK/CoreAudio will trigger the TCC
      // dialog itself when it first attempts to access screen content.
    }

    this.logSttRuntimeDiagnostics('meeting-start', 'user');
    this.logSttRuntimeDiagnostics('meeting-start', 'interviewer');

    // ─── WINDOW SWAP BEFORE STATE BROADCAST ───────────────────────────────
    // Switch to the overlay BEFORE flipping `isMeetingActive` to true. If we
    // broadcast meeting-state-changed:{isActive:true} while the launcher is
    // still visible, the launcher's CTA pill briefly crossfades blue→green
    // before the renderer's follow-up setWindowMode('overlay') hides it —
    // visible as a flash. Switching first means the launcher hides before
    // the state event arrives, so the user only ever sees the overlay.
    this.windowHelper.setWindowMode('overlay');

    this.isMeetingActive = true;
    this.adaptivePreloadManager.notifyMeetingStarted();
    this.broadcastMeetingState()
    this.broadcast('meeting-start-status', { phase: 'ready' });
    if (metadata) {
      this.intelligenceManager.setMeetingMetadata(metadata);
    }

    // Phase 3 — bind dynamic action engine to this meeting + active mode.
    // Action store is per-(sessionId, modeId), so a fresh sessionId here gives
    // us per-meeting isolation. Re-binding on mode switch is handled in the
    // modes:set-active IPC handler.
    let _meetingTelemetrySessionId: string | undefined;
    try {
      const { ModesManager } = require('./services/ModesManager');
      const activeMode = ModesManager.getInstance().getActiveMode();
      if (activeMode) {
        const sessionId = `session_${crypto.randomUUID()}`;
        _meetingTelemetrySessionId = sessionId;
        this.intelligenceManager.setDynamicActionContext({
          sessionId,
          modeId: activeMode.id,
          modeTemplateType: activeMode.templateType,
        });
      }
    } catch (err) {
      // Auxiliary feature — never block meeting start.
      console.warn('[Main] failed to bind dynamic action context at meeting start:', (err as Error)?.message);
    }

    // Phase 6 — meeting_start telemetry (no transcript / no PII).
    try {
      const { telemetryService } = require('./services/telemetry/TelemetryService');
      const { ModesManager } = require('./services/ModesManager');
      const am = ModesManager.getInstance().getActiveMode();
      telemetryService.track({
        name: 'meeting_start',
        sessionId: _meetingTelemetrySessionId,
        modeId: am?.id,
        properties: { modeTemplateType: am?.templateType, hasMetadata: Boolean(metadata) },
      });
    } catch { /* non-fatal */ }

    // Emit session reset to clear UI state immediately
    this.getWindowHelper().getOverlayWindow()?.webContents.send('session-reset');
    this.getWindowHelper().getLauncherWindow()?.webContents.send('session-reset');

    if (process.env.ELECTRON_E2E_SKIP_AUDIO_START === '1') {
      console.log('[Main] E2E mode: skipping native audio pipeline start.');
      return;
    }

    // ★ ASYNC AUDIO INIT: Return INSTANTLY so the IPC response goes back
    // to the renderer immediately, allowing the UI to switch to overlay
    // without waiting for SCK/audio initialization (which takes 5-7 seconds).
    // setTimeout(0) ensures setWindowMode IPC is processed first.
    setTimeout(async () => {
      // BUG-02 fix: a fast start→stop sequence can call endMeeting() before
      // this callback fires, leaving isMeetingActive=false. If that happened,
      // do NOT boot the audio pipeline — it would run forever with no stop signal.
      if (!this.isMeetingActive) {
        console.warn('[Main] Meeting was cancelled before audio pipeline could start — aborting init.');
        return;
      }
      try {
        // Check for audio configuration preference
        if (metadata?.audio) {
          await this.reconfigureAudio(metadata.audio.inputDeviceId, metadata.audio.outputDeviceId);
        }

        // LAZY INIT: Ensure pipeline is ready (if not reconfigured above)
        await this.setupSystemAudioPipeline();

        // Start System Audio
        this.systemAudioCapture?.start();
        this.maybeBroadcastSckOutputRouteIgnored();
        this.googleSTT?.start();

        // Start Microphone
        this.microphoneCapture?.start();
        this.googleSTT_User?.start();

        // Start JIT RAG live indexing
        if (this.ragManager) {
          void this.ragManager.startLiveIndexing('live-meeting-current').catch(error => {
            console.warn('[Main] Live RAG indexing startup failed (non-fatal):', error);
          });
        }

        // Watch for default-output route changes so the CoreAudio Tap follows
        // the user when they swap output devices mid-meeting (AirPods plug,
        // headphones, virtual cable). No-op if the user picked a specific
        // output or if the native binary lacks the getDefaultOutputDeviceId
        // export.
        this.startDefaultOutputWatcher();

        if (this._verboseLogging) {
          const requestedInput = metadata?.audio?.inputDeviceId || 'default';
          const requestedOutput = metadata?.audio?.outputDeviceId || 'default';
          const backend = this.systemAudioCapture?.getBackendName() || 'uninitialized';
          const sysRate = this.systemAudioCapture?.getSampleRate() || 48000;
          const micRate = this.microphoneCapture?.getSampleRate() || 48000;
          console.log(`[Main][debug] Audio pipeline: input=${requestedInput} output=${requestedOutput} backend=${backend} sysRate=${sysRate}Hz micRate=${micRate}Hz`);
        }
        console.log('[Main] Audio pipeline started successfully.');
      } catch (err) {
        console.error('[Main] Error initializing audio pipeline:', err);
        // Notify UI so user knows microphone/audio failed to start
        const message = (err as Error).message || 'Audio pipeline failed to start';
        this.isMeetingActive = false;
        this.adaptivePreloadManager.notifyMeetingStopped();
        this.broadcastMeetingState();
        this.windowHelper.setWindowMode('launcher');
        try {
          this.systemAudioCapture?.stop();
          this.microphoneCapture?.stop();
          this.googleSTT?.stop();
          this.googleSTT_User?.stop();
          this.stopDefaultOutputWatcher();
        } catch (cleanupError) {
          console.warn('[Main] Partial audio startup cleanup failed:', cleanupError);
        }
        this.broadcast('meeting-audio-error', message);
        this.broadcast('meeting-start-status', { phase: 'failed', message });
      }
    }, 0); // Defer to next event loop tick — ensures IPC response reaches renderer before audio init
  }

  public async endMeeting(): Promise<void> {
    console.log('[Main] Ending Meeting...');
    console.log(
      `[Main] Meeting usability before stop: micTranscript=${this._meetingHasMicTranscript} anyTranscript=${this._meetingHasAnyTranscript}`,
    );

    // Phase 6 — meeting_stop telemetry. Emit BEFORE any teardown so a crash
    // in stop logic still records the stop event.
    try {
      const { telemetryService } = require('./services/telemetry/TelemetryService');
      const { ModesManager } = require('./services/ModesManager');
      const am = ModesManager.getInstance().getActiveMode();
      telemetryService.track({
        name: 'meeting_stop',
        modeId: am?.id,
        properties: { modeTemplateType: am?.templateType },
      });
    } catch { /* non-fatal */ }

    // Reset Mouse Passthrough so the next meeting overlay starts fresh and focusable
    if (this.overlayMousePassthrough) {
      this.setOverlayMousePassthrough(false);
    }

    // ─── UX STATE FLIP — SYNCHRONOUS ───────────────────────────────────────
    // Flip the UX-facing meeting flag to false RIGHT NOW and broadcast. The
    // launcher's "Meeting ongoing" pill subscribes to meeting-state-changed,
    // so this guarantees the pill reverts to "Start Natively" the moment the
    // user clicks Stop — no green→blue flash if they click Start again before
    // the 250 ms STT drain finishes. The transcript handler keys off
    // `_isDraining` instead so trailing finals are still accepted.
    this.isMeetingActive = false;
    this._isDraining = true;
    this.broadcastMeetingState();

    // ─── WINDOW SWAP ───────────────────────────────────────────────────────
    // Swap to the launcher BEFORE any audio teardown. The native monitor.stop()
    // calls below are scheduled via setImmediate; libuv runs setImmediate
    // callbacks on the very next tick AFTER this handler returns and BEFORE
    // the next IPC message is processed. So if we did the window swap after
    // (or relied on a follow-up setWindowMode IPC), the user would stare at
    // the frozen overlay for 100–600 ms while the DSP/CoreAudio Tap/SCK
    // threads joined. Calling switchToLauncher() here gets the show/hide
    // commands to the OS compositor before the main thread blocks.
    this.windowHelper.setWindowMode('launcher');

    // ─── CLEAR THE OVERLAY TREE WHILE IT IS HIDDEN ─────────────────────────
    // The overlay BrowserWindow is PERSISTENT — created once with show:false
    // and thereafter only hide()/show()'d; its React tree is never unmounted
    // between meetings. The line above just hid it. If we don't clear it now,
    // the previous meeting's messages + expanded width survive into the next
    // meeting and are briefly VISIBLE the instant startMeeting() show()s the
    // window again — then torn down ON SCREEN (chat-list unmount + height
    // recompute + the shellWidth→OS-resize shrink) when the start-side
    // session-reset finally lands a few frames after show(). That on-screen
    // teardown is the "old UI flashes, then a choppy collapse" the user sees.
    //
    // Clearing HERE — after the window is hidden, with a whole meeting of idle
    // time before the next show() — means the overlay's mounted state is
    // already the clean collapsed baseline by the next meeting, so its FIRST
    // visible frame is clean and there is nothing to resize/tear down on
    // screen. The renderer's onSessionReset handler does the full synchronous
    // clear (messages, shellWidth→collapsed, code-expansion refs/timers); the
    // only change is that it now runs while hidden instead of while visible.
    //
    // Safe: the overlay is already hidden above and shows nothing post-stop —
    // trailing transcript finals (_isDraining), meeting save, and the
    // title/summary all run against the DB / other windows, never this tree.
    this.getWindowHelper().getOverlayWindow()?.webContents.send('session-reset');

    // ─── SYNCHRONOUS: things the user expects "right now" on Stop click ────
    // Captures are deferred-stop wrappers (see SystemAudioCapture.stop /
    // MicrophoneCapture.stop) — they flip the JS-side isRecording flag
    // immediately so no new audio reaches STT, but defer the blocking native
    // teardown to setImmediate. Returns within ~1ms.
    this.systemAudioCapture?.stop();
    this.microphoneCapture?.stop();

    // Stop the default-output watcher — no point polling CoreAudio while
    // there's no active capture to rebind.
    this.stopDefaultOutputWatcher();

    // Tell STT to mark the audio stream as ended; trailing finals will arrive
    // over the next ~150ms while we're already returning to the renderer.
    this.googleSTT?.finalize?.();
    this.googleSTT_User?.finalize?.();

    // ─── BACKGROUND: STT drain + meeting save + RAG embed ────────────────
    // Note: `isMeetingActive` was already flipped to false synchronously above
    // (so the launcher UI updates instantly). `_isDraining` is true while
    // providers flush trailing finals, so the transcript handler keeps
    // accepting the user's last sentence. We expose the in-flight teardown as
    // `_pendingTeardown` so a fast start→stop→start sequence awaits this
    // completion in startMeeting() before booting a new session on the
    // (still-shared) STT instances.
    const ragManager = this.ragManager;
    this._pendingTeardown = (async () => {
      try {
        // 0. Revert to Default Model. Moved into BG: getDefaultModel() and the
        //    provider list reads touch disk, and the 'model-changed' broadcast
        //    re-renders all open windows — both block the main thread/renderer
        //    during the Stop-click critical path. Doing it here means the
        //    revert lands ~250 ms after Stop, by which point the launcher is
        //    already painted and the overlay is hidden, so the user never
        //    sees a stutter.
        try {
          const { CredentialsManager } = require('./services/CredentialsManager');
          const cm = CredentialsManager.getInstance();
          const defaultModel = cm.getDefaultModel();
          const all = [...(cm.getCurlProviders() || []), ...(cm.getCustomProviders() || [])];
          console.log(`[Main] Reverting model to default: ${defaultModel}`);
          this.processingHelper.getLLMHelper().setModel(defaultModel, all);
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) win.webContents.send('model-changed', defaultModel);
          });
        } catch (e) {
          console.error('[Main] Failed to revert model:', e);
        }

        // 1. Provider-aware grace window for STT trailing finals. Cloud
        //    providers keep the old short wait; local Whisper can need longer
        //    on Intel CPUs because the final pass runs in a worker.
        await this.drainSttFinalsForMeetingStop();

        // 2. Retain one matching local-model lease before the channel leases stop.
        this.adaptivePreloadManager.notifyMeetingStopped();

        // 3. Tear down STT sockets now that finals have arrived.
        this.googleSTT?.stop();
        this.googleSTT_User?.stop();

        // 4. Snapshot transcript + persist placeholder + queue title/summary LLM.
        //    intelligenceManager.stopMeeting itself runs LLM in background.
        const meetingId = await this.intelligenceManager.stopMeeting();

        // 5. RAG cleanup — same logic as before, just inside the BG IIFE.
        if (meetingId) {
          if (ragManager) {
            await ragManager.stopLiveIndexing();
            console.log('[Main] Live RAG indexing stopped.');
          }
          await this.processCompletedMeetingForRAG(meetingId);
          if (ragManager && !this.isMeetingActive) {
            ragManager.deleteMeetingData('live-meeting-current');
            console.log('[Main] JIT RAG provisional chunks cleaned up.');
          } else if (this.isMeetingActive) {
            console.log('[Main] New meeting started during cleanup — skipping live-meeting-current deletion.');
          }
        } else {
          if (ragManager) {
            await ragManager.stopLiveIndexing().catch(() => {});
            if (!this.isMeetingActive) ragManager.deleteMeetingData('live-meeting-current');
          }
        }
      } catch (err) {
        console.error('[Main] Background meeting teardown failed:', err);
      } finally {
        this._isDraining = false;
      }
    })();
    // endMeeting returns NOW — the IPC handler resolves and the renderer's
    // "Stop" button transitions instantly. Total endMeeting wall-clock time
    // is now bounded by the synchronous block above (~1–5ms typical).
  }

  private async drainSttFinalsForMeetingStop(): Promise<void> {
    const providers = [this.googleSTT, this.googleSTT_User].filter(Boolean) as STTProvider[];
    await Promise.all(providers.map(async (provider) => {
      try {
        await provider.drainFinals();
      } catch (err) {
        console.warn('[Main] STT drainFinals failed; continuing meeting save:', err);
      }
    }));
  }

  private async processCompletedMeetingForRAG(meetingId: string): Promise<void> {
    if (!this.ragManager) return;

    try {
      // Use the explicit meetingId passed from endMeeting() — deterministic, never
      // picks up a concurrently started meeting the way getRecentMeetings(1) could.
      const meeting = DatabaseManager.getInstance().getMeetingDetails(meetingId);
      if (!meeting || !meeting.transcript || meeting.transcript.length === 0) return;

      // Convert transcript to RAG format
      const segments = meeting.transcript.map(t => ({
        speaker: t.speaker,
        text: t.text,
        timestamp: t.timestamp
      }));

      // Generate summary from detailedSummary if available
      let summary: string | undefined;
      if (meeting.detailedSummary) {
        summary = [
          ...(meeting.detailedSummary.keyPoints || []),
          ...(meeting.detailedSummary.actionItems || []).map(a => `Action: ${a}`)
        ].join('. ');
      }

      const result = await this.ragManager.processMeeting(meeting.id, segments, summary);
      console.log(`[AppState] RAG processed meeting ${meeting.id}: ${result.chunkCount} chunks`);

    } catch (error) {
      console.error('[AppState] Failed to process meeting for RAG:', error);
    }
  }

  private setupIntelligenceEvents(): void {
    const mainWindow = this.getMainWindow.bind(this)

    // Sprint 9: time-batched IPC token sends.
    //
    // Each LLM streaming token previously fired one webContents.send → one
    // structured-clone serialization → one IPC message. For a 400-token
    // answer at 100 tok/s that's 400 IPC messages over 4 seconds. With
    // Groq at 200+ tok/s the rate gets uncomfortable.
    //
    // Coalesce per-tick: a token arriving in the current libuv iteration
    // adds to a per-kind buffer. The first add schedules a setImmediate
    // flush that drains all buffers in one webContents.send per kind
    // (carrying an items array). Net: ~3-5× fewer IPC messages on hot
    // streams with no perceptible latency cost (sub-frame).
    //
    // The old per-token channels (intelligence-suggested-answer-token, etc.)
    // are NO LONGER USED for these 5 streams. The single
    // 'intelligence-token-batch' channel replaces them. The old channel
    // names + preload bridges are kept (defense-in-depth, no callers).
    type BatchKind = 'suggested_answer' | 'refined_answer' | 'recap' | 'clarify' | 'follow_up_questions';
    const tokenBatches = new Map<BatchKind, any[]>();
    let batchFlushScheduled = false;
    const flushBatchesNow = () => {
      const win = mainWindow();
      if (!win) { tokenBatches.clear(); return; }
      for (const [kind, items] of tokenBatches.entries()) {
        if (items.length > 0) {
          win.webContents.send('intelligence-token-batch', { kind, items });
        }
      }
      tokenBatches.clear();
    };
    const scheduleBatchFlush = () => {
      if (batchFlushScheduled) return;
      batchFlushScheduled = true;
      setImmediate(() => {
        batchFlushScheduled = false;
        flushBatchesNow();
      });
    };
    const queueBatch = (kind: BatchKind, item: any) => {
      let arr = tokenBatches.get(kind);
      if (!arr) { arr = []; tokenBatches.set(kind, arr); }
      arr.push(item);
      scheduleBatchFlush();
    };
    // ORDER: every final-answer handler must call this BEFORE its own send so
    // the renderer sees (..., last tokens, final answer) and not (..., final
    // answer, trailing tokens) — the latter would clobber the just-finalized
    // row with appended text from a pending setImmediate batch.
    const flushBatchesBeforeFinal = flushBatchesNow;

    // Forward intelligence events to renderer
    this.intelligenceManager.on('assist_update', (insight: string) => {
      // Send to both if both exist, though mostly overlay needs it
      const helper = this.getWindowHelper();
      helper.getLauncherWindow()?.webContents.send('intelligence-assist-update', { insight });
      helper.getOverlayWindow()?.webContents.send('intelligence-assist-update', { insight });
    })

    // Phase 3 — Cluely-style dynamic action card. Forward to all open windows
    // (launcher + overlay) so whichever surface the user has up shows the card.
    this.intelligenceManager.on('dynamic_action_emitted', (action: any) => {
      const helper = this.getWindowHelper();
      const shownAction = this.intelligenceManager.markDynamicActionShown(action.id) ?? action;
      try {
        const { getContextQualityDiagnosticsCollector } = require('./services/eval/ContextQualityDiagnostics');
        getContextQualityDiagnosticsCollector().recordDynamicActionLifecycleEvent({
          event: 'shown',
          actionId: shownAction.id,
          parentActionId: shownAction.parentActionId,
          actionType: shownAction.type,
          modeId: shownAction.modeId,
          modeTemplateType: shownAction.modeTemplateType,
          outputType: shownAction.productContract.outputType,
          riskState: shownAction.productContract.riskState,
          status: shownAction.status,
        });
      } catch { /* diagnostics must not affect window forwarding */ }
      helper.getLauncherWindow()?.webContents.send('intelligence-dynamic-action', { action: shownAction });
      helper.getOverlayWindow()?.webContents.send('intelligence-dynamic-action', { action: shownAction });
      // Phase 6 — telemetry: log detection (sanitized: NO transcript text, NO
      // evidence body — only ids, type, mode, confidence). The TelemetryService
      // sanitizer also strips transcript-shaped fields defensively.
      try {
        const { telemetryService } = require('./services/telemetry/TelemetryService');
        const { lifecycleEventToTelemetryName } = require('./services/dynamic-actions/DynamicActionLifecycle');
        telemetryService.track({
          name: lifecycleEventToTelemetryName('shown'),
          sessionId: shownAction?.sessionId,
          modeId: shownAction?.modeId,
          status: shownAction?.status,
          properties: {
            actionId: shownAction?.id,
            ...(shownAction?.parentActionId ? { parentActionId: shownAction.parentActionId } : {}),
            actionType: shownAction?.type,
            modeTemplateType: shownAction?.modeTemplateType,
            outputType: shownAction?.productContract?.outputType,
            riskState: shownAction?.productContract?.riskState,
          },
        });
        telemetryService.track({
          name: 'dynamic_action_detected',
          sessionId: shownAction?.sessionId,
          modeId: shownAction?.modeId,
          properties: {
            actionId: shownAction?.id,
            actionType: shownAction?.type,
            modeTemplateType: shownAction?.modeTemplateType,
            confidence: shownAction?.confidence,
            priority: shownAction?.priority,
          },
        });
      } catch { /* non-fatal */ }
    })

    this.intelligenceManager.on('suggested_answer', (answer: string, question: string, confidence: number, requestId?: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-suggested-answer', { answer, question, confidence, requestId })
      }

    })

    this.intelligenceManager.on('suggested_answer_token', (token: string, question: string, confidence: number, requestId?: string) => {
      // Sprint 9: batch instead of per-token webContents.send.
      queueBatch('suggested_answer', { token, question, confidence, requestId });
    })

    // Sprint 7: dedicated negotiation-coaching channel. Engine emits this
    // INSTEAD of suggested_answer / suggested_answer_token when it detects
    // the coaching sentinel, so the renderer no longer needs JSON.parse-
    // every-token detection.
    this.intelligenceManager.on('negotiation_coaching', (payload: unknown) => {
      // Sprint 9: flush any pending batched tokens first so the renderer
      // sees them before the coaching card swap.
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-negotiation-coaching', { payload })
      }
    })

    this.intelligenceManager.on('dynamic_action_gate_availability', (arbitrationStatuses: string[]) => {
      const availability = dynamicActionAvailabilityFromArbitrations(arbitrationStatuses);
      if (!availability) return;
      const helper = this.getWindowHelper();
      helper.getLauncherWindow()?.webContents.send('intelligence-dynamic-action-availability', availability);
      helper.getOverlayWindow()?.webContents.send('intelligence-dynamic-action-availability', availability);
    })

    this.intelligenceManager.on('refined_answer_token', (token: string, intent: string) => {
      // Sprint 9: batch.
      queueBatch('refined_answer', { token, intent });
    })

    this.intelligenceManager.on('refined_answer', (answer: string, intent: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-refined-answer', { answer, intent })
      }

    })

    this.intelligenceManager.on('recap', (summary: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-recap', { summary })
      }
    })

    this.intelligenceManager.on('recap_token', (token: string) => {
      // Sprint 9: batch.
      queueBatch('recap', { token });
    })

    this.intelligenceManager.on('clarify', (clarification: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-clarify', { clarification })
      }
    })

    this.intelligenceManager.on('clarify_token', (token: string) => {
      // Sprint 9: batch.
      queueBatch('clarify', { token });
    })

    this.intelligenceManager.on('follow_up_questions_update', (questions: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-follow-up-questions-update', { questions })
      }
    })

    this.intelligenceManager.on('follow_up_questions_token', (token: string) => {
      // Sprint 9: batch.
      queueBatch('follow_up_questions', { token });
    })

    this.intelligenceManager.on('manual_answer_started', () => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-manual-started')
      }
    })

    this.intelligenceManager.on('manual_answer_result', (answer: string, question: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-manual-result', { answer, question })
      }

    })

    this.intelligenceManager.on('mode_changed', (mode: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-mode-changed', { mode })
      }
    })

    this.intelligenceManager.on('error', (error: Error, mode: string, requestId?: string) => {
      console.error(`[IntelligenceManager] Error in ${mode}:`, error)
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-error', { error: error.message, mode, requestId })
      }
    })
  }





  public updateGoogleCredentials(keyPath: string): void {
    console.log(`[AppState] Updating Google Credentials to: ${keyPath}`);
    // Set global environment variable so new instances pick it up
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;

    if (this.googleSTT) {
      this.googleSTT.setCredentials(keyPath);
    }

    if (this.googleSTT_User) {
      this.googleSTT_User.setCredentials(keyPath);
    }
  }

  public setRecognitionLanguage(key: string): void {
    console.log(`[AppState] Setting recognition language to: ${key}`);
    const { CredentialsManager } = require('./services/CredentialsManager');
    CredentialsManager.getInstance().setSttLanguage(key);

    const sttProvider = CredentialsManager.getInstance().getSttProvider();
    const effectiveKey = normalizeRecognitionLanguageForProvider(sttProvider, key);
    this.logSttRuntimeDiagnostics('set-recognition-language', 'user', key);
    this.logSttRuntimeDiagnostics('set-recognition-language', 'interviewer', key);

    this.googleSTT?.setRecognitionLanguage(effectiveKey);
    this.googleSTT_User?.setRecognitionLanguage(effectiveKey);
    this.processingHelper.getLLMHelper().setSttLanguage(effectiveKey);
  }

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState()
    }
    return AppState.instance
  }

  // Getters and Setters
  public getMainWindow(): BrowserWindow | null {
    return this.windowHelper.getMainWindow()
  }

  public getWindowHelper(): WindowHelper {
    return this.windowHelper
  }

  public getIntelligenceManager(): IntelligenceManager {
    return this.intelligenceManager
  }

  public getThemeManager(): ThemeManager {
    return this.themeManager
  }

  public getRAGManager(): RAGManager | null {
    return this.ragManager;
  }

  public getKnowledgeOrchestrator(): any {
    return this.knowledgeOrchestrator;
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
    this.screenshotHelper.setView(view)
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public getProblemInfo(): any {
    return this.problemInfo
  }

  public setProblemInfo(problemInfo: any): void {
    this.problemInfo = problemInfo
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotHelper.getScreenshotQueue()
  }

  public getExtraScreenshotQueue(): string[] {
    return this.screenshotHelper.getExtraScreenshotQueue()
  }

  // Window management methods
  public setupOllamaIpcHandlers(): void {
    ipcMain.handle('get-ollama-models', async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout for detection

        const response = await fetch('http://localhost:11434/api/tags', {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          // data.models is an array of objects: { name: "llama3:latest", ... }
          return data.models.map((m: any) => m.name);
        }
        return [];
      } catch (error) {
        // console.warn("Ollama detection failed:", error);
        return [];
      }
    });

    this.intelligenceManager.on('skill_watcher_suggestion_created', (suggestion: any) => {
      this.broadcast('skill-watcher-suggestion-created', { suggestion });
    });
  }

  public createWindow(): void {
    this.windowHelper.createWindow()
  }

  public hideMainWindow(): void {
    this.windowHelper.hideMainWindow()
  }

  public showMainWindow(inactive?: boolean): void {
    if (this.windowHelper) {
      this.windowHelper.showMainWindow(inactive)
    }
  }

  public toggleMainWindow(): void {
    console.log(
      "Screenshots: ",
      this.screenshotHelper.getScreenshotQueue().length,
      "Extra screenshots: ",
      this.screenshotHelper.getExtraScreenshotQueue().length
    )

    const mode = this.windowHelper.getCurrentWindowMode();

    if (mode === 'launcher') {
      // In launcher mode, just physically hide/show the window
      this.windowHelper.toggleMainWindow();
    } else {
      // In overlay mode, physically hide/show the window like launcher mode does.
      // Previously this sent a 'toggle-expand' IPC which only expands/collapses the
      // UI but does NOT actually show a hidden window — leaving no recovery path in
      // stealth mode (no dock, no tray). Now both modes behave identically.
      this.windowHelper.toggleMainWindow();
    }
  }

  public setWindowDimensions(width: number, height: number): void {
    this.windowHelper.setWindowDimensions(width, height)
  }

  public clearQueues(): void {
    this.screenshotHelper.clearQueues()

    // Clear problem info
    this.problemInfo = null

    // Reset view to initial state
    this.setView("queue")
  }

  private createScreenshotCaptureSession(
    captureKind: ScreenshotCaptureKind,
    restoreFocus: boolean
  ): ScreenshotCaptureSession {
    const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
    const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();

    return {
      captureKind,
      wasMainWindowVisible: this.windowHelper.isVisible(),
      windowMode: this.windowHelper.getCurrentWindowMode(),
      wasSettingsVisible: !!settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible(),
      wasModelSelectorVisible: !!modelSelectorWindow && !modelSelectorWindow.isDestroyed() && modelSelectorWindow.isVisible(),
      overlayBounds: this.windowHelper.getLastOverlayBounds(),
      overlayDisplayId: this.windowHelper.getLastOverlayDisplayId(),
      restoreWithoutFocus: process.platform === 'darwin' || !restoreFocus
    };
  }

  private getDisplayById(displayId: number | null): Electron.Display | undefined {
    if (displayId === null) return undefined;
    return screen.getAllDisplays().find(display => display.id === displayId);
  }

  private getTargetDisplayForFullScreenshot(session: ScreenshotCaptureSession): Electron.Display {
    if (session.windowMode === 'overlay' && session.overlayBounds) {
      return screen.getDisplayMatching(session.overlayBounds);
    }

    const lastOverlayDisplay = this.getDisplayById(session.overlayDisplayId);
    if (lastOverlayDisplay) {
      return lastOverlayDisplay;
    }

    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  private hideWindowsForScreenshot(session: ScreenshotCaptureSession): void {
    if (session.wasModelSelectorVisible) {
      this.modelSelectorWindowHelper.hideWindow();
    }

    if (session.wasSettingsVisible) {
      this.settingsWindowHelper.closeWindow();
    }

    if (session.wasMainWindowVisible) {
      this.hideMainWindow();
    }
  }

  private restoreWindowsAfterScreenshot(session: ScreenshotCaptureSession): void {
    const activate = !session.restoreWithoutFocus;
    const shouldRestoreMainWindow = session.wasMainWindowVisible;

    if (shouldRestoreMainWindow) {
      if (session.windowMode === 'overlay') {
        this.windowHelper.switchToOverlay(!activate);
      } else {
        this.windowHelper.switchToLauncher(!activate);
      }
    }

    if (session.wasSettingsVisible) {
      const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        const { x, y } = settingsWindow.getBounds();
        this.settingsWindowHelper.showWindow(x, y, { activate });
      }
    }

    if (session.wasModelSelectorVisible) {
      const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();
      if (modelSelectorWindow && !modelSelectorWindow.isDestroyed()) {
        const { x, y } = modelSelectorWindow.getBounds();
        this.modelSelectorWindowHelper.showWindow(x, y, { activate });
      }
    }
  }

  private async withScreenshotCaptureSession<T>(
    captureKind: ScreenshotCaptureKind,
    restoreFocus: boolean,
    capture: (session: ScreenshotCaptureSession) => Promise<T>
  ): Promise<T> {
    if (!this.getMainWindow()) {
      throw new Error("No main window available");
    }

    if (this.screenshotCaptureInProgress) {
      throw new Error("Screenshot capture already in progress");
    }

    const session = this.createScreenshotCaptureSession(captureKind, restoreFocus);
    this.screenshotCaptureInProgress = true;

    try {
      this.hideWindowsForScreenshot(session);
      // setOpacity(0) makes the window invisible to the compositor immediately
      // (within the current frame). hide() removes it from the event dispatch
      // tree synchronously. One compositor frame flush (~16ms) is enough for
      // macOS to stop including the window in the next capture frame. We wait
      // 80ms to give the GPU render server one full v-sync cycle + overhead,
      // which consistently avoids the black-frame artifact without the
      // excessive 150ms latency the old value imposed.
      await new Promise(resolve => setTimeout(resolve, process.platform === 'darwin' ? 80 : 40));
      return await capture(session);
    } finally {
      try {
        this.restoreWindowsAfterScreenshot(session);
      } finally {
        this.screenshotCaptureInProgress = false;
      }
    }
  }

  // Screenshot management methods
  public async takeScreenshot(restoreFocus: boolean = true): Promise<string> {
    return this.withScreenshotCaptureSession('full', restoreFocus, (session) =>
      this.screenshotHelper.takeScreenshot(this.getTargetDisplayForFullScreenshot(session))
    )
  }

  public async takeSelectiveScreenshot(restoreFocus: boolean = true): Promise<string> {
    return this.withScreenshotCaptureSession('selective', restoreFocus, async () => {
      let captureArea: Electron.Rectangle | undefined;

      if (process.platform === 'win32' || process.platform === 'darwin') {
        captureArea = await this.cropperWindowHelper.showCropper();

        if (!captureArea) {
          throw new Error("Selection cancelled");
        }
      }

      return this.screenshotHelper.takeSelectiveScreenshot(captureArea)
    })
  }

  public async getImagePreview(filepath: string): Promise<string> {
    return this.screenshotHelper.getImagePreview(filepath)
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.screenshotHelper.deleteScreenshot(path)
  }

  // New methods to move the window
  public moveWindowLeft(): void {
    this.windowHelper.moveWindowLeft()
  }

  public moveWindowRight(): void {
    this.windowHelper.moveWindowRight()
  }
  public moveWindowDown(): void {
    this.windowHelper.moveWindowDown()
  }
  public moveWindowUp(): void {
    this.windowHelper.moveWindowUp()
  }

  public centerAndShowWindow(): void {
    this.windowHelper.centerAndShowWindow()
  }

  public createTray(): void {
    this.showTray();
  }

  public showTray(): void {
    if (this.tray) return;

    // Try to find a template image first for macOS
    const resourcesPath = app.isPackaged ? process.resourcesPath : app.getAppPath();

    // Potential paths for tray icon
    const templatePath = path.join(resourcesPath, 'assets', 'iconTemplate.png');
    const defaultIconPath = app.isPackaged
      ? path.join(resourcesPath, 'src/components/icon.png')
      : path.join(app.getAppPath(), 'src/components/icon.png');

    let iconToUse = defaultIconPath;

    // Check if template exists (sync check is fine for startup/rare toggle)
    try {
      if (require('fs').existsSync(templatePath)) {
        iconToUse = templatePath;
        console.log('[Tray] Using template icon:', templatePath);
      } else {
        // Also check src/components for dev
        const devTemplatePath = path.join(app.getAppPath(), 'src/components/iconTemplate.png');
        if (require('fs').existsSync(devTemplatePath)) {
          iconToUse = devTemplatePath;
          console.log('[Tray] Using dev template icon:', devTemplatePath);
        } else {
          console.log('[Tray] Template icon not found, using default:', defaultIconPath);
        }
      }
    } catch (e) {
      console.error('[Tray] Error checking for icon:', e);
    }

    const trayIcon = nativeImage.createFromPath(iconToUse).resize({ width: 16, height: 16 });
    // IMPORTANT: specific template settings for macOS if needed, but 'Template' in name usually suffices
    trayIcon.setTemplateImage(iconToUse.endsWith('Template.png'));

    this.tray = new Tray(trayIcon)
    this.tray.setToolTip('CueUp') // This tooltip might also need update if we change global shortcut, but global shortcut is removed.
    this.updateTrayMenu();

    // Double-click to show window
    this.tray.on('double-click', () => {
      this.centerAndShowWindow()
    })
  }

  public updateTrayMenu() {
    if (!this.tray) return;

    const keybindManager = KeybindManager.getInstance();
    const screenshotAccel = keybindManager.getKeybind('general:take-screenshot') || 'CommandOrControl+H';

    console.log('[Main] updateTrayMenu called. Screenshot Accelerator:', screenshotAccel);

    // Update tooltip for verification
    this.tray.setToolTip('CueUp');

    const displayScreenshot = formatAcceleratorForPlatform(screenshotAccel);
    // We can also get the toggle visibility shortcut if desired
    const toggleKb = keybindManager.getKeybind('general:toggle-visibility');
    const toggleAccel = toggleKb || 'CommandOrControl+B';
    const displayToggle = formatAcceleratorForPlatform(toggleAccel);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示 CueUp',
        click: () => {
          this.centerAndShowWindow()
        }
      },
      {
        label: `切换窗口 (${displayToggle})`,
        click: () => {
          this.toggleMainWindow()
        }
      },
      {
        type: 'separator'
      },
      {
        label: `截取屏幕 (${displayScreenshot})`,
        accelerator: screenshotAccel,
        click: async () => {
          try {
            const screenshotPath = await this.takeScreenshot()
            const preview = await this.getImagePreview(screenshotPath)
            const mainWindow = this.getMainWindow()
            if (mainWindow) {
              mainWindow.webContents.send("screenshot-taken", {
                path: screenshotPath,
                preview
              })
            }
          } catch (error) {
            console.error("Error taking screenshot from tray:", error)
          }
        }
      },
      {
        type: 'separator'
      },
      {
        label: '退出',
        accelerator: quitAcceleratorForPlatform(),
        click: () => {
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  public hideTray(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  public setHasDebugged(value: boolean): void {
    this.hasDebugged = value
  }

  public getHasDebugged(): boolean {
    return this.hasDebugged
  }

  // --- Mouse Passthrough (Adapted from public PR #113 — verify premium interaction) ---
  private overlayMousePassthrough: boolean = false;

  public setOverlayMousePassthrough(state: boolean): void {
    if (this.overlayMousePassthrough === state) return;

    console.log(`[Overlay] setOverlayMousePassthrough(${state}) called`);

    this.overlayMousePassthrough = state;
    this.windowHelper.syncOverlayInteractionPolicy();

    // Immediately revalidate global shortcuts after the window interaction-policy
    // changes.  The OS can silently drop Carbon/IOKit hotkey registrations when
    // window focusability or visibility changes; revalidating surgically
    // re-registers any that were lost without clobbering the others.
    KeybindManager.getInstance().revalidateShortcuts();

    this._broadcastToAllWindows('overlay-mouse-passthrough-changed', state);
  }

  public toggleOverlayMousePassthrough(): boolean {
    const next = !this.overlayMousePassthrough;
    this.setOverlayMousePassthrough(next);
    return next;
  }

  public getOverlayMousePassthrough(): boolean {
    return this.overlayMousePassthrough;
  }

  public getVerboseLogging(): boolean {
    return this._verboseLogging;
  }

  public setVerboseLogging(enabled: boolean): void {
    this._verboseLogging = enabled;
    setVerboseLoggingFlag(enabled);
    SettingsManager.getInstance().set('verboseLogging', enabled);
    console.log(`[AppState] verboseLogging set to ${enabled}`);
    // Notify all renderer windows so they can start/stop forwarding their console output
    this.broadcast('verbose-logging-changed', enabled);
  }

  // Helper: broadcast an IPC event to all windows
  private _broadcastToAllWindows(channel: string, ...args: any[]): void {
    const windows = [
      this.windowHelper.getMainWindow(),
      this.windowHelper.getLauncherWindow(),
      this.windowHelper.getOverlayWindow(),
      this.settingsWindowHelper.getSettingsWindow(),
      this.modelSelectorWindowHelper.getWindow(),
    ];
    const sent = new Set<number>();
    for (const win of windows) {
      if (win && !win.isDestroyed() && !sent.has(win.id)) {
        sent.add(win.id);
        win.webContents.send(channel, ...args);
      }
    }
  }
}

// Application initialization

async function initializeApp() {
  sttQualityAcceptanceContext = resolveSttQualityAcceptanceContext();
  if (sttQualityAcceptanceContext.enabled && sttQualityAcceptanceContext.userDataDir) {
    app.setPath('userData', sttQualityAcceptanceContext.userDataDir);
  }

  // 1. Enforce single instance — prevent duplicate dock icons from leftover processes.
  // In development mode with hot-reload this is still safe because electron is restarted
  // by the build step, not re-launched by concurrently while the old process is alive.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.log('[Main] Another instance is already running. Exiting this instance.');
    // Use app.exit(0) — app.quit() before whenReady can be deferred or no-op'd
    // (it tries to close all windows first, but none exist yet), leaving the
    // duplicate process alive long enough to register a second tray icon on
    // macOS Tahoe + Spotlight launches. exit() terminates immediately and
    // cannot be intercepted by before-quit handlers.
    app.exit(0);
    return;
  }

  // When a duplicate launch is attempted (e.g. user invokes Spotlight again
  // while Natively is running), focus and recenter the existing window so the
  // launch is visibly handled instead of silently absorbed.
  app.on('second-instance', () => {
    try {
      const appState = AppState.getInstance();
      appState.centerAndShowWindow();
    } catch (err) {
      console.error('[Main] second-instance handler failed:', err);
    }
  });

  // 2. Wait for app to be ready
  await app.whenReady()
  migrateLegacyUserDataForCueUpBranding()

  // 3. Initialize Managers
  // Phase 6 — bind TelemetryService to the Electron userData path. The
  // singleton was constructed with cwd-relative paths at module-load time
  // (before app.whenReady), so we reconfigure here. Honors the user's
  // telemetry-enabled setting (default: on, local-only JSONL).
  try {
    const { telemetryService } = require('./services/telemetry/TelemetryService');
    const userDataPath = app.getPath('userData');
    const telemetryEnabledSetting = SettingsManager.getInstance().get('telemetryEnabled');
    telemetryService.configure({
      userDataPath,
      enabled: telemetryEnabledSetting !== false, // default true
      localEnabled: true,
    });
    telemetryService.track({ name: 'app_start', properties: { platform: process.platform } });
  } catch (err) {
    console.warn('[Init] TelemetryService configure threw (non-fatal):', err);
  }

  const macOSVersion =
    typeof (process as any).getSystemVersion === 'function'
      ? (process as any).getSystemVersion()
      : 'unknown';
  console.log(
    `[Init] Runtime platform=${process.platform} arch=${process.arch} ` +
      `electron=${process.versions.electron ?? 'unknown'} node=${process.versions.node} ` +
      `macOS=${macOSVersion} packaged=${app.isPackaged}`,
  );

  // Initialize CredentialsManager and load keys explicitly
  // This fixes the issue where keys (especially in production) aren't loaded in time for RAG/LLM
  const { CredentialsManager } = require('./services/CredentialsManager');
  const credentialsManagerSingleton = CredentialsManager.getInstance();
  credentialsManagerSingleton.init();
  (globalThis as any).__credentialsManagerSingleton = credentialsManagerSingleton;

  // 4. Initialize State
  const appState = AppState.getInstance()

  // Explicitly load credentials into helpers
  appState.processingHelper.loadStoredCredentials();

  // Seed the un-deletable General mode once at startup. Idempotent.
  try {
    const { ModesManager } = require('./services/ModesManager');
    ModesManager.getInstance().ensureSeeded();
  } catch (err) {
    console.warn('[Init] ModesManager.ensureSeeded threw (non-fatal):', err);
  }

  // Initialize IPC handlers before window creation
  initializeIpcHandlers(appState)

  // 5. Initialize IPC handlers before window creation
  initializeIpcHandlers(appState)

  // Start the Ollama lifecycle manager
  OllamaManager.getInstance().init().catch(console.error);

  // NOTE: CredentialsManager.init() and loadStoredCredentials() are already called
  // above before this block — do NOT call them again here to avoid double key-load.

  // Load stored Google Service Account path (for Speech-to-Text)
  // Fall back to GOOGLE_APPLICATION_CREDENTIALS env var (set in terminal but not Spotlight)
  const storedServiceAccountPath = CredentialsManager.getInstance().getGoogleServiceAccountPath()
    || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (storedServiceAccountPath) {
    console.log("[Init] Loading stored Google Service Account path");
    appState.updateGoogleCredentials(storedServiceAccountPath);
    // Persist env-var path so Spotlight launches also work going forward
    if (!CredentialsManager.getInstance().getGoogleServiceAccountPath()) {
      CredentialsManager.getInstance().setGoogleServiceAccountPath(storedServiceAccountPath);
    }
  }

  console.log("App is ready")

  // PERF: pre-construct STT provider objects so the meeting-start critical
  // path doesn't pay for class init + listener wiring. Runs after all
  // credentials are loaded (so the provider can read its API key) and is
  // non-blocking — failures are logged and retried at meeting start.
  try {
    appState.prewarmSttProviders();
    appState.scheduleAdaptiveLocalSttPreload();
  } catch (err) {
    console.warn('[Init] STT pre-warm threw (non-fatal):', err);
  }

  appState.createWindow()

  // Always create the tray as a recovery path — the user needs a way to restore a
  // hidden window (no tray would otherwise leave the window unrecoverable after a hide).
  appState.showTray();
  // Register global shortcuts using KeybindManager
  KeybindManager.getInstance().registerGlobalShortcuts()

  // System sleep/wake handling. macOS invalidates CoreAudio AggregateDevice
  // handles on sleep — without this the Process Tap silently stops delivering
  // buffers on resume and the user sits in front of a frozen transcript with
  // no idea why. Fire restartCapturesAfterResume on resume; it's a no-op if
  // no meeting is active. The 'lock-screen' event isn't useful here (the OS
  // doesn't tear down audio on lock) so we don't subscribe to it.
  try {
    const { powerMonitor } = require('electron') as typeof import('electron');
    powerMonitor.on('resume', () => {
      console.log('[Main] powerMonitor: system resumed from sleep.');
      appState.restartCapturesAfterResume().catch((err) =>
        console.error('[Main] restartCapturesAfterResume threw:', err)
      );
    });
    powerMonitor.on('suspend', () => {
      console.log('[Main] powerMonitor: system suspending. Captures will be recreated on resume if a meeting is active.');
    });
  } catch (err) {
    console.warn('[Main] powerMonitor unavailable — sleep/wake recovery disabled:', err);
  }

  // macOS Screen Recording status check.
  //
  // Do not call desktopCapturer.getSources() here. That protected API triggers
  // the system Screen Recording TCC dialog, which makes every cold launch feel
  // like the app is forcing the user into Privacy & Security. Screen capture
  // permission should be requested lazily when the user starts a meeting, takes
  // a screenshot, or explicitly opens the permission/repair flow.
  if (process.platform === 'darwin') {
    setTimeout(async () => {
      try {
        const screenStatus = systemPreferences.getMediaAccessStatus('screen');
        console.log(`[Init] Screen recording permission status at startup: ${screenStatus}`);

        if (!app.isPackaged) {
          console.log('[Init] Ignoring screen recording permission check in development mode');
          return;
        }

        if (screenStatus === 'not-determined') {
          console.log('[Init] Screen recording permission is not determined; deferring prompt until first screen/system-audio use.');
        } else if (screenStatus === 'denied') {
          console.warn('[Init] Screen recording was previously denied — notifying UI banner without probing screen sources.');
          const { BrowserWindow } = require('electron');
          BrowserWindow.getAllWindows().forEach((win: Electron.BrowserWindow) => {
            if (!win.isDestroyed()) {
              win.webContents.send(
                'system-audio-permission-denied',
                formatPermissionMessage('screen-recording-denied')
              );
            }
          });
        } else {
          // 'granted' or 'restricted' — nothing to do.
          console.log(`[Init] Screen recording permission already resolved: ${screenStatus}`);
        }
      } catch (e) {
        console.warn('[Init] Startup screen recording permission check failed:', e);
      }
    }, 800);
  }

  // Recover unprocessed meetings (persistence check)
  appState.getIntelligenceManager().recoverUnprocessedMeetings().catch(err => {
    console.error('[Main] Failed to recover unprocessed meetings:', err);
  });

  // Note: We do NOT force dock show here anymore, respecting stealth mode.

  app.on("activate", () => {
    console.log("App activated")
    if (process.platform === 'darwin') {
      // Do NOT call dock.show() while a meeting is running.
      if (!appState.getIsMeetingActive()) {
        app.dock.show();
      }
    }

    // If no window exists, create it
    if (appState.getMainWindow() === null) {
      appState.createWindow()
    } else {
      // If the window exists but is hidden, clicking the dock icon should restore it
      if (!appState.isVisible()) {
        appState.toggleMainWindow();
      }
    }
  })

  // Quit when all windows are closed, except on macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  // Scrub API keys from memory on quit to minimize exposure window
  app.on("before-quit", (event) => {
    console.log("App is quitting, cleaning up resources...");
    appState.setQuitting(true);
    void appState.disposeIdleResources();

    // ROUND 2 FIX (#9): synchronously stop the CGEventTap worker thread
    // BEFORE V8 starts tearing down. The tap callback holds an
    // Arc<ThreadsafeFunction> that calls into napi from a non-V8 thread;
    // if V8 is mid-teardown when the callback runs, napi's release path
    // crashes. stop() joins the worker, guaranteeing no in-flight callbacks
    // remain by the time we return.
    //
    // Dispose CropperWindowHelper to clean up IPC listeners and prevent memory leaks
    // This is critical to prevent resource leaks and ensure proper cleanup
    if (appState?.cropperWindowHelper) {
      appState.cropperWindowHelper.dispose();
    }

    // Kill Ollama if we started it
    OllamaManager.getInstance().stop();

    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().scrubMemory();
      appState.processingHelper.getLLMHelper().scrubKeys();
      console.log('[Main] Credentials scrubbed from memory on quit');
    } catch (e) {
      console.error('[Main] Failed to scrub credentials on quit:', e);
    }

    // Clean up screenshot queues to prevent residual PNG files on disk
    try {
      const { ScreenshotHelper } = require('./ScreenshotHelper');
      // Clear screenshot queues - this deletes all queued screenshot files
      const screenshotHelper = new ScreenshotHelper();
      screenshotHelper.clearQueues();
      console.log('[Main] Screenshot queues cleared on quit');
    } catch (e) {
      console.error('[Main] Failed to clear screenshot queues on quit:', e);
    }
  })



  // app.dock?.hide() // REMOVED: User wants Dock icon visible
  app.commandLine.appendSwitch("disable-background-timer-throttling")
}

// Start the application
initializeApp().catch(console.error)
