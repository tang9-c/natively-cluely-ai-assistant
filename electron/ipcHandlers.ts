// ipcHandlers.ts

import * as crypto from 'crypto';
import { app, BrowserWindow, dialog, ipcMain, shell, systemPreferences } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AudioDevices } from './audio/AudioDevices';
import { resolveSttLanguageCompatibility } from './audio/sttLanguageCompatibility';
import { DatabaseManager } from './db/DatabaseManager'; // Import Database Manager
import { AppState } from './main';
import {
  repairMacTccPermissions,
  resolveMacBundleIdentifier,
  resolveMacMicrophonePermissionHealth,
  resolveMacScreenPermissionHealth,
  resolveMacSystemAudioPermissionHealth,
} from './permissions/macPermissionHealth';
import { CodexCliService } from './services/CodexCliService';
import { SettingsManager, type AppSettings } from './services/SettingsManager';
import { SkillActivationManager, type ActivateSkillInput, type SkillActivationScope } from './services/SkillActivationManager';
import { SkillsManager } from './services/SkillsManager';

import { AI_RESPONSE_LANGUAGES, RECOGNITION_LANGUAGES } from './config/languages';
import { CHAT_MODE_PROMPT } from './llm/prompts';
import type { ModeEventContext } from './llm';
import type { ResearchProgress } from './services/research/types';
import { LlmInvalidFormatError } from './services/research/ResearchDossierBuilder';
import { getOpenAtLoginForPlatform, setOpenAtLoginForPlatform } from './utils/loginItemSettings';
import { redactForLog } from './utils/redactForLog';
import { ParserLLM } from './services/profile/parsers/ParserLLM';
import { CompanyNameExtractor } from './services/profile/extractors/CompanyNameExtractor';

function sanitizeModeEvent(modeEvent: unknown): ModeEventContext | undefined {
  if (!modeEvent || typeof modeEvent !== 'object') return undefined;

  const raw = modeEvent as Record<string, unknown>;
  const cleaned: ModeEventContext = {};
  const assignString = (key: keyof ModeEventContext) => {
    const value = raw[key];
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed) {
      (cleaned as Record<string, string>)[key] = trimmed.slice(0, 4000);
    }
  };

  for (const key of [
    'modeTemplateType',
    'intent',
    'latestTurn',
    'emotion',
    'emotionSource',
    'language',
    'retrievalQuery',
    'autoSurfacePolicy',
    'promptInstruction',
    'answerShape',
  ] as const) {
    assignString(key);
  }

  if (typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)) {
    cleaned.confidence = raw.confidence;
  }

  if (Array.isArray(raw.keyEntities)) {
    const keyEntities = raw.keyEntities
      .filter((entity): entity is string => typeof entity === 'string')
      .map((entity) => entity.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (keyEntities.length > 0) {
      cleaned.keyEntities = keyEntities;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export function initializeIpcHandlers(appState: AppState): void {
  const safeHandle = (
    channel: string,
    listener: (event: any, ...args: any[]) => Promise<any> | any,
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };

  /**
   * Wraps an async handler so that any thrown error is caught and returned
   * as `{ success: false, error: string }` instead of crashing the IPC channel.
   * Handlers that already manage their own return shape can opt out.
   */
  const withResult = <T extends any[]>(
    fn: (...args: T) => Promise<any> | any,
  ): ((...args: T) => Promise<any>) => {
    return async (...args: T) => {
      try {
        return await fn(...args);
      } catch (error: any) {
        console.error(`[IPC] ${fn.name || 'handler'} error:`, error);
        return { success: false, error: error?.message || 'unknown_error' };
      }
    };
  };

  /**
   * Broadcasts an event to all non-destroyed renderer windows.
   * Replaces the repetitive `BrowserWindow.getAllWindows().forEach(...)` pattern.
   */
  const broadcast = (eventName: string, ...args: any[]): void => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(eventName, ...args);
      }
    });
  };

  // --- NEW Test Helper ---
  safeHandle('test-release-fetch', async () => {
    try {
      console.log('[IPC] Manual Test Fetch triggered (forcing refresh)...');
      const { ReleaseNotesManager } = require('./update/ReleaseNotesManager');
      const notes = await ReleaseNotesManager.getInstance().fetchReleaseNotes('latest', true);

      if (notes) {
        console.log('[IPC] Notes fetched for:', notes.version);
        const info = {
          version: notes.version || 'latest',
          files: [] as any[],
          path: '',
          sha512: '',
          releaseName: notes.summary,
          releaseNotes: notes.fullBody,
          parsedNotes: notes,
        };
        // Send to renderer
        appState.getMainWindow()?.webContents.send('update-available', info);
        return { success: true };
      }
      return { success: false, error: 'No notes returned' };
    } catch (err: any) {
      console.error('[IPC] test-release-fetch failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('get-recognition-languages', async () => {
    return RECOGNITION_LANGUAGES;
  });

  safeHandle('get-ai-response-languages', async () => {
    return AI_RESPONSE_LANGUAGES;
  });

  safeHandle('set-ai-response-language', async (_, language: string) => {
    // Validate: must be a non-empty string
    if (!language || typeof language !== 'string' || !language.trim()) {
      console.warn('[IPC] set-ai-response-language: invalid or empty language received, ignoring.');
      return { success: false, error: 'Invalid language value' };
    }
    const sanitizedLanguage = language.trim();
    const { CredentialsManager } = require('./services/CredentialsManager');
    // Persist to disk
    CredentialsManager.getInstance().setAiResponseLanguage(sanitizedLanguage);
    // Update live in-memory LLMHelper (same instance used by IntelligenceEngine)
    const llmHelper = appState.processingHelper?.getLLMHelper?.();
    if (llmHelper) {
      llmHelper.setAiResponseLanguage(sanitizedLanguage);
      console.log(`[IPC] AI response language updated to: ${sanitizedLanguage}`);
    } else {
      console.warn(
        '[IPC] set-ai-response-language: processingHelper or LLMHelper not ready, language saved to disk only.',
      );
    }
    return { success: true };
  });

  safeHandle('get-stt-language', async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getSttLanguage();
  });

  safeHandle('get-stt-language-compatibility', async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    const cm = CredentialsManager.getInstance();
    const sm = SettingsManager.getInstance();
    return resolveSttLanguageCompatibility({
      provider: cm.getSttProvider(),
      requestedLanguageKey: cm.getSttLanguage(),
      localWhisper: {
        enabled: !!sm.get('localWhisperPerChannelEnabled'),
        globalModelId: sm.get('localWhisperModel') ?? '',
        micModelId: sm.get('localWhisperModelMic') ?? '',
        systemModelId: sm.get('localWhisperModelSystem') ?? '',
      },
    });
  });

  safeHandle('get-ai-response-language', async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getAiResponseLanguage();
  });
  safeHandle(
    'update-content-dimensions',
    async (event, { width, height }: { width: number; height: number }) => {
      if (!width || !height) return;

      const senderWebContents = event.sender;
      const settingsWin = appState.settingsWindowHelper.getSettingsWindow();
      const overlayWin = appState.getWindowHelper().getOverlayWindow();
      const launcherWin = appState.getWindowHelper().getLauncherWindow();

      if (
        settingsWin &&
        !settingsWin.isDestroyed() &&
        settingsWin.webContents.id === senderWebContents.id
      ) {
        appState.settingsWindowHelper.setWindowDimensions(settingsWin, width, height);
      } else if (
        overlayWin &&
        !overlayWin.isDestroyed() &&
        overlayWin.webContents.id === senderWebContents.id
      ) {
        // NativelyInterface logic - Resize ONLY the overlay window using dedicated method
        appState.getWindowHelper().setOverlayDimensions(width, height);
      } else if (
        launcherWin &&
        !launcherWin.isDestroyed() &&
        launcherWin.webContents.id === senderWebContents.id
      ) {
        // EC-05 fix: launcher window resize events were previously silently ignored.
        // Log them so that if the launcher ever sends this IPC it's visible in logs.
        console.log(
          `[IPC] update-content-dimensions: launcher window resize request ${width}x${height} (ignored — launcher has fixed dimensions)`,
        );
      }
    },
  );

  // Centered variant: keeps horizontal center fixed during width changes.
  // Used by code-expansion animations to prevent the top pill from sliding sideways.
  safeHandle(
    'update-content-dimensions-centered',
    async (event, { width, height }: { width: number; height: number }) => {
      if (!width || !height) return;
      const senderWebContents = event.sender;
      const overlayWin = appState.getWindowHelper().getOverlayWindow();
      if (
        overlayWin &&
        !overlayWin.isDestroyed() &&
        overlayWin.webContents.id === senderWebContents.id
      ) {
        appState.getWindowHelper().setOverlayDimensionsCentered(width, height);
      }
    },
  );

  safeHandle('set-window-mode', async (event, mode: 'launcher' | 'overlay', inactive?: boolean) => {
    appState.getWindowHelper().setWindowMode(mode, inactive);
    return { success: true };
  });

  safeHandle('delete-screenshot', async (event, filePath: string) => {
    // Guard: only allow deletion of files within the app's own userData directory
    const userDataDir = app.getPath('userData');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn('[IPC] delete-screenshot: path outside userData rejected:', filePath);
      return { success: false, error: 'Path not allowed' };
    }
    return appState.deleteScreenshot(resolved);
  });

  safeHandle('take-screenshot', async () => {
    try {
      const screenshotPath = await appState.takeScreenshot();
      const preview = await appState.getImagePreview(screenshotPath);
      return { path: screenshotPath, preview };
    } catch (error) {
      // console.error("Error taking screenshot:", error)
      throw error;
    }
  });

  safeHandle('take-selective-screenshot', async () => {
    try {
      const screenshotPath = await appState.takeSelectiveScreenshot();
      const preview = await appState.getImagePreview(screenshotPath);
      return { path: screenshotPath, preview };
    } catch (error) {
      // EC-04 fix: cast unknown error to Error before accessing .message
      if ((error as Error).message === 'Selection cancelled') {
        return { cancelled: true };
      }
      throw error;
    }
  });

  safeHandle('get-screenshots', async () => {
    // console.log({ view: appState.getView() })
    try {
      let previews = [];
      if (appState.getView() === 'queue') {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path),
          })),
        );
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path),
          })),
        );
      }
      // previews.forEach((preview: any) => console.log(preview.path))
      return previews;
    } catch (error) {
      // console.error("Error getting screenshots:", error)
      throw error;
    }
  });

  safeHandle('toggle-window', async () => {
    appState.toggleMainWindow();
  });

  safeHandle('show-window', async (event, inactive?: boolean) => {
    // Default show main window (Launcher usually)
    appState.showMainWindow(inactive);
  });

  safeHandle('hide-window', async () => {
    appState.hideMainWindow();
  });

  safeHandle('show-overlay', async () => {
    appState.getWindowHelper().showOverlay();
  });

  safeHandle('hide-overlay', async () => {
    appState.getWindowHelper().hideOverlay();
  });

  safeHandle('get-meeting-active', async () => {
    return appState.getIsMeetingActive();
  });

  safeHandle('reset-queues', async () => {
    try {
      appState.clearQueues();
      // console.log("Screenshot queues have been cleared.")
      return { success: true };
    } catch (error: any) {
      // console.error("Error resetting queues:", error)
      return { success: false, error: error.message };
    }
  });

  // Generate suggestion from transcript - Natively-style text-only reasoning
  safeHandle('generate-suggestion', async (event, context: string, lastQuestion: string) => {
    try {
      const suggestion = await appState.processingHelper
        .getLLMHelper()
        .generateSuggestion(context, lastQuestion);
      return { suggestion };
    } catch (error: any) {
      // console.error("Error generating suggestion:", error)
      throw error;
    }
  });

  safeHandle('finalize-mic-stt', async () => {
    appState.finalizeMicSTT();
  });

  // IPC handler for analyzing image from file path
  safeHandle('analyze-image-file', async (event, filePath: string) => {
    // Guard: only allow reading files within the app's own userData directory
    const userDataDir = app.getPath('userData');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn('[IPC] analyze-image-file: path outside userData rejected:', filePath);
      throw new Error('Path not allowed');
    }
    try {
      const result = await appState.processingHelper.getLLMHelper().analyzeImageFiles([resolved]);
      return result;
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle(
    'gemini-chat',
    async (
      event,
      message: string,
      imagePaths?: string[],
      context?: string,
      options?: { skipSystemPrompt?: boolean },
    ) => {
      try {
        const result = await appState.processingHelper
          .getLLMHelper()
          .chatWithGemini(message, imagePaths, context, options?.skipSystemPrompt);

        console.log(`[IPC] gemini - chat response received`, { length: result?.length ?? 0 });

        // Don't process empty responses
        if (!result || result.trim().length === 0) {
          console.warn('[IPC] Empty response from LLM, not updating IntelligenceManager');
          return "I apologize, but I couldn't generate a response. Please try again.";
        }

        // Sync with IntelligenceManager so Follow-Up/Recap work
        const intelligenceManager = appState.getIntelligenceManager();

        // 1. Add user question to context (as 'user')
        // CRITICAL: Skip refinement check to prevent auto-triggering follow-up logic
        // The user's manual question is a NEW input, not a refinement of previous answer.
        intelligenceManager.addTranscript(
          {
            text: message,
            speaker: 'user',
            timestamp: Date.now(),
            final: true,
          },
          true,
        );

        // 2. Add assistant response and set as last message
        console.log(`[IPC] Updating IntelligenceManager with assistant message...`);
        intelligenceManager.addAssistantMessage(result);
        console.log(`[IPC] Updated IntelligenceManager.Last message`, {
          length: intelligenceManager.getLastAssistantMessage()?.length ?? 0,
        });

        // Log Usage
        intelligenceManager.logUsage('chat', message, result);

        return result;
      } catch (error: any) {
        // console.error("Error in gemini-chat handler:", error);
        throw error;
      }
    },
  );

  // Streaming IPC Handler
  // SECURITY FIX (P0-1): Monotonic stream ID prevents interleaved tokens from concurrent stream requests.
  // Each new invocation increments the ID; any in-flight iteration bails as soon as it detects
  // that a newer stream has taken over.
  let _chatStreamId = 0;

  // Matches narrow identity/meta probes only. Kept tight so coding/normal asks don't trip it.
  // Prevents the small fast-mode model from over-firing the "I'm Natively" canned reply
  // (which used to escape the prompt's hard rule for any ambiguous input).
  const IDENTITY_PROBE_RE =
    /^\s*(who\s+(are|r)\s+(you|u|this|natively)|what\s+(are|r)\s+(you|u)|are\s+you\s+(chatgpt|gpt[-\s]?\d?|claude|gemini|llama|an?\s+(ai|bot|llm|model|assistant))|what('?s|\s+is)\s+your\s+(name|model)|which\s+(ai|model|llm)\s+are\s+you|who\s+(made|built|created|developed|trained)\s+(you|this|natively)|what\s+model\s+(are\s+you|do\s+you\s+use)|introduce\s+yourself)\s*\??\s*$/i;
  const CREATOR_PROBE_RE =
    /^\s*(who\s+(made|built|created|developed|trained)\s+(you|this|natively))\s*\??\s*$/i;

  safeHandle(
    'gemini-chat-stream',
    async (
      event,
      message: string,
      imagePaths?: string[],
      context?: string,
      options?: { skipSystemPrompt?: boolean; ignoreKnowledgeMode?: boolean },
    ) => {
      try {
        console.log('[IPC] gemini-chat-stream started using LLMHelper.streamChat');
        const llmHelper = appState.processingHelper.getLLMHelper();

        // Claim a new stream ID — any prior stream will detect this and stop emitting.
        const myStreamId = ++_chatStreamId;

        const intelligenceManager = appState.getIntelligenceManager();

        // Identity probe short-circuit — bypasses the LLM entirely so small models can't
        // reframe the canned reply or misfire it on coding asks (the original bug).
        // Regex is `^...$` anchored, so non-probe questions cannot match.
        if (!imagePaths?.length && typeof message === 'string') {
          const identityHit = CREATOR_PROBE_RE.test(message)
            ? 'I was developed by Evin John.'
            : IDENTITY_PROBE_RE.test(message)
              ? "I'm Natively, an AI assistant."
              : null;
          if (identityHit) {
            intelligenceManager.addTranscript(
              { text: message, speaker: 'user', timestamp: Date.now(), final: true },
              true,
            );
            // Guard against a newer chat stream having taken over while we were computing
            // the canned reply — matches the protection the LLM path uses around its token
            // loop. Prevents cross-stream UI bleed.
            if (_chatStreamId !== myStreamId) {
              console.log(
                `[IPC] gemini-chat-stream ${myStreamId} (identity probe) superseded by ${_chatStreamId}, skipping emit.`,
              );
              return null;
            }
            event.sender.send('gemini-stream-token', identityHit);
            event.sender.send('gemini-stream-done');
            intelligenceManager.addAssistantMessage(identityHit);
            intelligenceManager.logUsage('chat', message, identityHit);
            return null;
          }
        }

        // Capture rolling context BEFORE adding the new user message — otherwise the
        // 100s window would echo back the user's just-typed message as both context and
        // question, confusing small models (the "20-char context" log line was just an echo).
        let autoContextSnapshot: string | undefined;
        if (!context) {
          try {
            const snap = intelligenceManager.getFormattedContext(100);
            if (snap && snap.trim().length > 0) autoContextSnapshot = snap;
          } catch (ctxErr) {
            console.warn('[IPC] Failed to capture pre-turn context:', ctxErr);
          }
        }

        // Now add USER message to IntelligenceManager (after context snapshot)
        intelligenceManager.addTranscript(
          {
            text: message,
            speaker: 'user',
            timestamp: Date.now(),
            final: true,
          },
          true,
        );

        let fullResponse = '';

        if (!context && autoContextSnapshot) {
          context = autoContextSnapshot;
          console.log(
            `[IPC] Auto-injected 100s context for gemini-chat-stream (${context.length} chars)`,
          );
        }

        // Use CHAT_MODE_PROMPT for general chat — bypasses the interview-copilot
        // framing in HARD_SYSTEM_PROMPT/ASSIST_MODE_PROMPT that was causing coding
        // questions to be answered with "At Aetherbot AI, I was responsible for..."
        // (resume hijack via CONTEXT_INTELLIGENCE_LAYER's "you ARE the user").
        const systemPromptOverride: string | undefined = options?.skipSystemPrompt
          ? ''
          : CHAT_MODE_PROMPT;

        try {
          // USE streamChat which handles routing
          const stream = llmHelper.streamChat(
            message,
            imagePaths,
            context,
            systemPromptOverride,
            options?.ignoreKnowledgeMode,
          );

          for await (const token of stream) {
            // Bail if a newer stream has taken over (user triggered a new request)
            if (_chatStreamId !== myStreamId) {
              console.log(
                `[IPC] gemini-chat-stream ${myStreamId} superseded by ${_chatStreamId}, stopping.`,
              );
              return null;
            }
            event.sender.send('gemini-stream-token', token);
            fullResponse += token;
          }

          // Final check: only send done if we are still the active stream
          if (_chatStreamId === myStreamId) {
            event.sender.send('gemini-stream-done');

            // Update IntelligenceManager with ASSISTANT message after completion
            if (fullResponse.trim().length > 0) {
              intelligenceManager.addAssistantMessage(fullResponse);
              // Log Usage for streaming chat
              intelligenceManager.logUsage('chat', message, fullResponse);
            }
          }
        } catch (streamError: any) {
          console.error('[IPC] Streaming error:', streamError);
          if (_chatStreamId === myStreamId) {
            event.sender.send(
              'gemini-stream-error',
              streamError.message || 'Unknown streaming error',
            );
          }
        }

        return null; // Return null as data is sent via events
      } catch (error: any) {
        console.error('[IPC] Error in gemini-chat-stream setup:', error);
        throw error;
      }
    },
  );

  safeHandle('quit-app', () => {
    app.quit();
  });

  safeHandle('quit-and-install-update', async () => {
    try {
      console.log('[IPC] Quit and install update requested');
      await appState.quitAndInstallUpdate();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] quit-and-install-update failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('delete-meeting', async (_, id: string) => {
    return DatabaseManager.getInstance().deleteMeeting(id);
  });

  safeHandle('check-for-updates', async () => {
    try {
      console.log('[IPC] Manual update check requested');
      await appState.checkForUpdates();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] check-for-updates failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('download-update', async () => {
    try {
      console.log('[IPC] Download update requested');
      appState.downloadUpdate();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] download-update failed:', err);
      return { success: false, error: err.message };
    }
  });

  // Window movement handlers
  safeHandle('move-window-left', async () => {
    appState.moveWindowLeft();
  });

  safeHandle('move-window-right', async () => {
    appState.moveWindowRight();
  });

  safeHandle('move-window-up', async () => {
    appState.moveWindowUp();
  });

  safeHandle('move-window-down', async () => {
    appState.moveWindowDown();
  });

  safeHandle('center-and-show-window', async () => {
    appState.centerAndShowWindow();
  });

  // Window Controls
  safeHandle('window-minimize', async () => {
    appState.getWindowHelper().minimizeWindow();
  });

  safeHandle('window-maximize', async () => {
    appState.getWindowHelper().maximizeWindow();
  });

  safeHandle('window-close', async () => {
    appState.getWindowHelper().closeWindow();
  });

  safeHandle('window-is-maximized', async () => {
    return appState.getWindowHelper().isMainWindowMaximized();
  });

  // Settings Window
  safeHandle('toggle-settings-window', (event, { x, y } = {}) => {
    appState.settingsWindowHelper.toggleWindow(x, y);
  });

  // Open the launcher's SettingsOverlay on a specific tab (callable from any window)
  safeHandle('settings:open-tab', (_, tab: string) => {
    const launcherWin = appState.getWindowHelper().getLauncherWindow();
    if (launcherWin && !launcherWin.isDestroyed()) {
      launcherWin.webContents.send('settings:open-tab', tab);
      launcherWin.show();
      launcherWin.focus();
    }
  });

  safeHandle('modes:open-manager', () => {
    const launcherWin = appState.getWindowHelper().getLauncherWindow();
    appState.getWindowHelper().setWindowMode('launcher');
    if (launcherWin && !launcherWin.isDestroyed()) {
      launcherWin.webContents.send('modes:open-manager');
      launcherWin.show();
      launcherWin.focus();
    }
  });

  safeHandle('close-settings-window', () => {
    appState.settingsWindowHelper.closeWindow();
  });

  // Adapted from public PR #113 — verify premium interaction
  safeHandle('set-overlay-mouse-passthrough', async (_, enabled: boolean) => {
    appState.setOverlayMousePassthrough(enabled);
    return { success: true };
  });

  safeHandle('toggle-overlay-mouse-passthrough', async () => {
    const enabled = appState.toggleOverlayMousePassthrough();
    return { success: true, enabled };
  });

  safeHandle('get-overlay-mouse-passthrough', async () => {
    return appState.getOverlayMousePassthrough();
  });

  safeHandle('set-open-at-login', async (_, openAtLogin: boolean) => {
    setOpenAtLoginForPlatform(app, openAtLogin);
    return { success: true };
  });

  safeHandle('get-open-at-login', async () => {
    return getOpenAtLoginForPlatform(app);
  });

  // ── Generic Settings Handlers ──────────────────────────────────────────────
  // Replaces repetitive get-X / set-X pairs for simple SettingsManager passthroughs.
  // Each entry: [channelSuffix, settingsKey, options]
  //   - validator: optional (value) => boolean | string (error message)
  //   - broadcastEvent: optional event name to fire after successful set
  //   - getter: optional custom getter function
  //   - setter: optional custom setter function
  const SETTINGS_REGISTRY: Array<{
    suffix: string;
    key: keyof AppSettings;
    validator?: (v: any) => true | string;
    broadcastEvent?: string;
    getter?: () => any;
    setter?: (v: any) => void;
  }> = [
    { suffix: 'verbose-logging', key: 'verboseLogging', getter: () => appState.getVerboseLogging(), setter: (v) => appState.setVerboseLogging(v) },
    {
      suffix: 'meeting-retention',
      key: 'meetingRetention',
      validator: (v) => ['forever', '7d', '30d', 'never'].includes(v) || 'invalid_retention',
      broadcastEvent: 'meeting-retention-changed',
    },
    {
      suffix: 'provider-data-scopes',
      key: 'providerDataScopes',
      validator: (v) => {
        if (!v || typeof v !== 'object') return 'invalid_scopes';
        const allowed = new Set(['transcript', 'screenshots', 'reference_files', 'profile_history', 'embeddings', 'post_call_summary']);
        for (const k of Object.keys(v)) if (!allowed.has(k)) return 'invalid_scopes';
        return true;
      },
      broadcastEvent: 'provider-data-scopes-changed',
    },
    {
      suffix: 'screen-understanding-mode',
      key: 'screenUnderstandingMode',
      validator: (v) => ['vision_first', 'vision_only', 'private_vision'].includes(v) || 'invalid_mode',
      broadcastEvent: 'screen-understanding-mode-changed',
      getter: () => SettingsManager.getInstance().getScreenUnderstandingMode(),
      setter: (v) => SettingsManager.getInstance().setScreenUnderstandingMode(v),
    },
    {
      suffix: 'technical-interview-vision-first',
      key: 'technicalInterviewVisionFirst',
      validator: (v) => typeof v === 'boolean' || 'invalid_value',
      broadcastEvent: 'technical-interview-vision-first-changed',
      getter: () => SettingsManager.getInstance().getTechnicalInterviewVisionFirst(),
    },
    {
      suffix: 'local-intent-enhancement-enabled',
      key: 'localIntentEnhancementEnabled',
      validator: (v) => typeof v === 'boolean' || 'invalid_value',
      broadcastEvent: 'local-intent-enhancement-enabled-changed',
      getter: () => SettingsManager.getInstance().getLocalIntentEnhancementEnabled(),
    },
    {
      suffix: 'speaker-separation-mode',
      key: 'speakerSeparationMode',
      validator: (v) => ['auto', 'off'].includes(v) || 'invalid_mode',
      broadcastEvent: 'speaker-separation-mode-changed',
      getter: () => SettingsManager.getInstance().getSpeakerSeparationMode(),
      setter: (v) => SettingsManager.getInstance().setSpeakerSeparationMode(v),
    },
  ];

  for (const reg of SETTINGS_REGISTRY) {
    safeHandle(`settings:get:${reg.suffix}`, async () => {
      if (reg.getter) return reg.getter();
      return SettingsManager.getInstance().get(reg.key) ?? null;
    });

    safeHandle(`settings:set:${reg.suffix}`, async (_, value: any) => {
      if (reg.validator) {
        const ok = reg.validator(value);
        if (ok !== true) return { success: false, error: ok };
      }
      if (reg.setter) {
        reg.setter(value);
      } else {
        SettingsManager.getInstance().set(reg.key, value);
      }
      if (reg.broadcastEvent) {
        broadcast(reg.broadcastEvent, value);
      }
      return { success: true };
    });
  }

  // Legacy aliases — map old direct channels to the new generic settings channels
  safeHandle('get-verbose-logging', async () => appState.getVerboseLogging());
  safeHandle('set-verbose-logging', async (_, enabled: boolean) => {
    appState.setVerboseLogging(enabled);
    return { success: true };
  });
  safeHandle('get-meeting-retention', async () =>
    SettingsManager.getInstance().get('meetingRetention') ?? 'forever',
  );
  safeHandle('set-meeting-retention', async (_, retention: 'forever' | '7d' | '30d' | 'never') => {
    if (!['forever', '7d', '30d', 'never'].includes(retention)) {
      return { success: false, error: 'invalid_retention' };
    }
    SettingsManager.getInstance().set('meetingRetention', retention);
    broadcast('meeting-retention-changed', retention);
    return { success: true };
  });
  safeHandle('get-provider-data-scopes', async () =>
    SettingsManager.getInstance().get('providerDataScopes') ?? {},
  );
  safeHandle('set-provider-data-scopes', async (_, scopes: Record<string, boolean>) => {
    if (!scopes || typeof scopes !== 'object') {
      return { success: false, error: 'invalid_scopes' };
    }
    const allowedKeys = new Set([
      'transcript', 'screenshots', 'reference_files',
      'profile_history', 'embeddings', 'post_call_summary',
    ]);
    const sanitized: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(scopes)) {
      if (allowedKeys.has(key) && typeof value === 'boolean') {
        sanitized[key] = value;
      }
    }
    SettingsManager.getInstance().set('providerDataScopes', sanitized as any);
    broadcast('provider-data-scopes-changed', sanitized);
    return { success: true };
  });
  safeHandle('get-screen-understanding-mode', async () =>
    SettingsManager.getInstance().getScreenUnderstandingMode(),
  );
  safeHandle(
    'set-screen-understanding-mode',
    async (_, mode: 'vision_first' | 'vision_only' | 'private_vision') => {
      if (!['vision_first', 'vision_only', 'private_vision'].includes(mode)) {
        return { success: false, error: 'invalid_mode' };
      }
      SettingsManager.getInstance().setScreenUnderstandingMode(mode);
      broadcast('screen-understanding-mode-changed', mode);
      return { success: true };
    },
  );
  safeHandle('get-technical-interview-vision-first', async () =>
    SettingsManager.getInstance().getTechnicalInterviewVisionFirst(),
  );
  safeHandle('set-technical-interview-vision-first', async (_, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'invalid_value' };
    }
    SettingsManager.getInstance().set('technicalInterviewVisionFirst', enabled);
    broadcast('technical-interview-vision-first-changed', enabled);
    return { success: true };
  });
  safeHandle('get-local-intent-enhancement-enabled', async () =>
    SettingsManager.getInstance().getLocalIntentEnhancementEnabled(),
  );
  safeHandle('set-local-intent-enhancement-enabled', async (_, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'invalid_value' };
    }
    SettingsManager.getInstance().set('localIntentEnhancementEnabled', enabled);
    broadcast('local-intent-enhancement-enabled-changed', enabled);
    return { success: true };
  });
  safeHandle('get-speaker-separation-mode', async () =>
    SettingsManager.getInstance().getSpeakerSeparationMode(),
  );
  safeHandle('set-speaker-separation-mode', async (_, mode: 'auto' | 'off') => {
    if (!['auto', 'off'].includes(mode)) {
      return { success: false, error: 'invalid_mode' };
    }
    SettingsManager.getInstance().setSpeakerSeparationMode(mode);
    broadcast('speaker-separation-mode-changed', mode);
    return { success: true };
  });
  safeHandle('get-technical-interview-direct-vision', async () =>
    SettingsManager.getInstance().getTechnicalInterviewVisionFirst(),
  );
  safeHandle('set-technical-interview-direct-vision', async (_, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'invalid_value' };
    }
    SettingsManager.getInstance().set('technicalInterviewVisionFirst', enabled);
    broadcast('technical-interview-vision-first-changed', enabled);
    return { success: true };
  });

  safeHandle('get-log-file-path', async () => {
    try {
      return path.join(app.getPath('documents'), 'natively_debug.log');
    } catch {
      return null;
    }
  });

  safeHandle('open-log-file', async () => {
    try {
      const logPath = path.join(app.getPath('documents'), 'natively_debug.log');
      // Ensure the file exists before opening
      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, '');
      }
      await shell.openPath(logPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Fire-and-forget: renderer forwards its console output to the main-process log file.
  // Only written when verbose logging is enabled.
  ipcMain.on('forward-log-to-file', (_event, level: string, msg: string) => {
    if (!appState.getVerboseLogging()) return;
    const tag =
      level === 'error' ? '[RENDERER-ERROR]' : level === 'warn' ? '[RENDERER-WARN]' : '[RENDERER]';
    console.log(`${tag} ${msg}`);
  });

  safeHandle('get-arch', async () => {
    return process.arch;
  });

  safeHandle('get-os-version', async () => {
    const platform = process.platform;
    if (platform === 'darwin') {
      const darwinMajor = parseInt(os.release().split('.')[0] || '0', 10);
      // Darwin 25+ = macOS 26+ (calendar-year scheme), Darwin 20-24 = macOS 11-15
      const macosMajor =
        darwinMajor >= 25 ? darwinMajor + 1 : darwinMajor >= 20 ? darwinMajor - 9 : null;
      return macosMajor ? `macOS ${macosMajor}` : `macOS ${os.release()}`;
    }
    if (platform === 'win32') {
      const release = os.release();
      // Windows 11 build starts at 22000
      const majorBuild = parseInt(release.split('.')[2] || '0', 10);
      return majorBuild >= 22000 ? `Windows 11` : `Windows 10`;
    }
    return os.type();
  });

  // LLM Model Management Handlers
  safeHandle('get-current-llm-config', async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel(),
        isOllama: llmHelper.isUsingOllama(),
      };
    } catch (error: any) {
      // console.error("Error getting current LLM config:", error);
      throw error;
    }
  });

  safeHandle('get-available-ollama-models', async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const models = await llmHelper.getOllamaModels();
      return models;
    } catch (error: any) {
      // console.error("Error getting Ollama models:", error);
      throw error;
    }
  });

  safeHandle('switch-to-ollama', async (_, model?: string, url?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToOllama(model, url);
      return { success: true };
    } catch (error: any) {
      // console.error("Error switching to Ollama:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('force-restart-ollama', async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const success = await llmHelper.forceRestartOllama();
      return { success };
    } catch (error: any) {
      console.error('Error force restarting Ollama:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('switch-to-gemini', async (_, apiKey?: string, modelId?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToGemini(apiKey, modelId);

      // Persist API key if provided
      if (apiKey) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        CredentialsManager.getInstance().setGeminiApiKey(apiKey);
      }

      return { success: true };
    } catch (error: any) {
      // console.error("Error switching to Gemini:", error);
      return { success: false, error: error.message };
    }
  });

  // ── Generic LLM API Key Setters ────────────────────────────────────────────
  // Replaces copy-pasted set-X-api-key handlers for providers that follow the same pattern:
  //   1. Persist key in CredentialsManager
  //   2. Update LLMHelper immediately
  //   3. resetEngine() + initializeLLMs() (CQ-06 fix)
  const LLM_KEY_REGISTRY: Array<{
    channel: string;
    credMethod: string;
    llmMethod: string;
    postSave?: (apiKey: string) => void;
  }> = [
    { channel: 'set-gemini-api-key', credMethod: 'setGeminiApiKey', llmMethod: 'setApiKey' },
    { channel: 'set-groq-api-key', credMethod: 'setGroqApiKey', llmMethod: 'setGroqApiKey' },
    { channel: 'set-openai-api-key', credMethod: 'setOpenaiApiKey', llmMethod: 'setOpenaiApiKey' },
    { channel: 'set-claude-api-key', credMethod: 'setClaudeApiKey', llmMethod: 'setClaudeApiKey' },
    {
      channel: 'set-doubao-llm-api-key',
      credMethod: 'setDoubaoLlmApiKey',
      llmMethod: 'setDoubaoApiKey',
      postSave: (apiKey: string) => {
        const ragManager = appState.getRAGManager();
        if (ragManager) {
          console.log('[IPC] Re-initializing RAG embedding pipeline with Doubao key');
          const { CredentialsManager } = require('./services/CredentialsManager');
          ragManager.initializeEmbeddings({
            openaiKey: CredentialsManager.getInstance().getOpenaiApiKey() || process.env.OPENAI_API_KEY || undefined,
            geminiKey: CredentialsManager.getInstance().getGeminiApiKey() || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || undefined,
            doubaoKey: apiKey || process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY || undefined,
            ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
            providerDataScopes: (() => { try { const { SettingsManager } = require('./services/SettingsManager'); return SettingsManager.getInstance().get('providerDataScopes'); } catch { return undefined; } })()
          });
        }
      },
    },
  ];

  for (const reg of LLM_KEY_REGISTRY) {
    safeHandle(reg.channel, async (_, apiKey: string) => {
      try {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const cm = CredentialsManager.getInstance();
        (cm as any)[reg.credMethod](apiKey);

        const llmHelper = appState.processingHelper.getLLMHelper();
        (llmHelper as any)[reg.llmMethod](apiKey);

        reg.postSave?.(apiKey);

        // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
        appState.getIntelligenceManager().resetEngine();
        appState.getIntelligenceManager().initializeLLMs();
        broadcast('credentials-changed');

        return { success: true };
      } catch (error: any) {
        console.error(`[IPC] ${reg.channel} error:`, error);
        return { success: false, error: error.message };
      }
    });
  }

  // ── Usage cache (60-second TTL, keyed by API key) ──────────────────────────
  const _usageCache = new Map<string, { data: any; ts: number }>();
  const USAGE_CACHE_TTL_MS = 60_000;

  safeHandle('set-natively-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const prevSttProvider = cm.getSttProvider();
      cm.setNativelyApiKey(apiKey);

      // Update LLMHelper immediately (same pattern as other provider keys)
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setNativelyKey(apiKey || null);

      // Sync the model into LLMHelper and notify the UI whenever the effective default changed
      const defaultModel = cm.getDefaultModel();
      const providers = [...(cm.getCurlProviders() || []), ...(cm.getCustomProviders() || [])];
      llmHelper.setModel(defaultModel, providers);
      broadcast('model-changed', defaultModel);

      // If setNativelyApiKey auto-promoted the STT provider to 'natively', reconfigure
      // the audio pipeline immediately — without this, the in-memory pipeline still uses
      // the old STT provider (e.g. Google) until the app restarts.
      const newSttProvider = cm.getSttProvider();
      if (newSttProvider !== prevSttProvider) {
        console.log(
          `[IPC] set-natively-api-key: STT provider changed ${prevSttProvider} → ${newSttProvider}, reconfiguring pipeline`,
        );
        await appState.reconfigureSttProvider();
      }

      return { success: true };
    } catch (error: any) {
      console.error('Error saving Natively API key:', error);
      return { success: false, error: error.message };
    } finally {
      // Always bust the cache when the key changes so the next usage fetch is fresh
      _usageCache?.clear();
    }
  });

  safeHandle('get-natively-usage', async () => {
    // Hoisted out of try so the catch block's stale-cache lookup can reach it.
    let key: string | undefined;
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      key = CredentialsManager.getInstance().getNativelyApiKey();
      if (!key) return { ok: false, error: 'no_key' };

      // Return cached value if it's still fresh
      const cached = _usageCache.get(key);
      if (cached && Date.now() - cached.ts < USAGE_CACHE_TTL_MS) {
        return cached.data;
      }

      const res = await fetch('https://api.natively.software/v1/usage', {
        headers: { 'x-natively-key': key },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as any;
        return { ok: false, error: body.error || 'request_failed', status: res.status };
      }
      const data = (await res.json()) as any;
      const result = { ok: true, ...data };

      // Cache the successful response
      _usageCache.set(key, { data: result, ts: Date.now() });
      return result;
    } catch (error: any) {
      // On transient DNS/network failure, serve stale cache rather than showing an error.
      // Railway uses 1s TTL on DNS records, so a momentary resolver hiccup causes ENOTFOUND
      // even when the server is up. Stale quota data is far better than a broken UI.
      const stale = key ? _usageCache.get(key) : undefined;
      if (stale) return { ...stale.data, stale: true };
      return { ok: false, error: error.message || 'network_error' };
    }
  });

  // Allow other handlers to force-invalidate the usage cache (e.g. after key change)
  safeHandle('invalidate-natively-usage-cache', () => {
    _usageCache.clear();
    return { ok: true };
  });


  // Custom Provider Handlers
  safeHandle('get-custom-providers', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      // Merge new Curl Providers with legacy Custom Providers
      // New ones take precedence if IDs conflict (though unlikely as UUIDs)
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      return [...curlProviders, ...legacyProviders];
    } catch (error: any) {
      console.error('Error getting custom providers:', error);
      return [];
    }
  });

  safeHandle('save-custom-provider', async (_, provider: unknown) => {
    try {
      // SECURITY FIX (P1-2): Validate provider payload shape before persisting.
      // Prevents malformed/malicious renderer data from polluting CredentialsManager.
      if (
        typeof provider !== 'object' ||
        provider === null ||
        typeof (provider as any).id !== 'string' ||
        typeof (provider as any).name !== 'string' ||
        typeof (provider as any).curlCommand !== 'string'
      ) {
        console.error('[IPC] save-custom-provider: invalid payload shape', typeof provider);
        return { success: false, error: 'Invalid provider payload' };
      }

      const curlCmd: string = (provider as any).curlCommand;
      // Require {{TEXT}} so the app always has a defined injection point for the user prompt.
      // We do NOT require the string to start with 'curl' — curlCommand is a template field,
      // not necessarily a raw CLI string, and over-constraining it would break valid providers.
      if (!curlCmd.includes('{{TEXT}}')) {
        return {
          success: false,
          error: 'curlCommand must contain {{TEXT}} placeholder for the prompt',
        };
      }

      const { CredentialsManager } = require('./services/CredentialsManager');
      // Save as CurlProvider (supports responsePath)
      CredentialsManager.getInstance().saveCurlProvider(provider);
      return { success: true };
    } catch (error: any) {
      console.error('Error saving custom provider:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('delete-custom-provider', async (_, id: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      // Try deleting from both storages to be safe
      CredentialsManager.getInstance().deleteCurlProvider(id);
      CredentialsManager.getInstance().deleteCustomProvider(id);
      return { success: true };
    } catch (error: any) {
      console.error('Error deleting custom provider:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('switch-to-custom-provider', async (_, providerId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      // BUG-05 fix: providers may be in either the curl or legacy custom store —
      // merge both when looking up by id so neither store is silently ignored.
      const provider = [...(cm.getCurlProviders() || []), ...(cm.getCustomProviders() || [])].find(
        (p: any) => p.id === providerId,
      );

      if (!provider) {
        throw new Error('Provider not found');
      }

      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToCustom(provider);

      // Re-init IntelligenceManager (optional, but good for consistency)
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error('Error switching to custom provider:', error);
      return { success: false, error: error.message };
    }
  });

  // Get stored API keys (masked for UI display)
  safeHandle('get-stored-credentials', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const creds = CredentialsManager.getInstance().getAllCredentials();

      // Return masked versions for security (just indicate if set)
      const hasKey = (key?: string) => !!(key && key.trim().length > 0);
      const masked = (key?: string) => (hasKey(key) ? '•'.repeat(24) : '');

      return {
        hasGeminiKey: hasKey(creds.geminiApiKey),
        hasGroqKey: hasKey(creds.groqApiKey),
        hasOpenaiKey: hasKey(creds.openaiApiKey),
        hasClaudeKey: hasKey(creds.claudeApiKey),
        hasDoubaoKey: hasKey(creds.doubaoLlmApiKey),
        hasNativelyKey: hasKey(creds.nativelyApiKey),
        geminiKey: masked(creds.geminiApiKey),
        groqKey: masked(creds.groqApiKey),
        openaiKey: masked(creds.openaiApiKey),
        claudeKey: masked(creds.claudeApiKey),
        doubaoKey: masked(creds.doubaoLlmApiKey),
        googleServiceAccountPath: creds.googleServiceAccountPath || null,
        sttProvider: creds.sttProvider || 'none',
        groqSttModel: creds.groqSttModel || 'whisper-large-v3-turbo',
        hasSttGroqKey: hasKey(creds.groqSttApiKey),
        hasSttOpenaiKey: hasKey(creds.openAiSttApiKey),
        hasDeepgramKey: hasKey(creds.deepgramApiKey),
        hasElevenLabsKey: hasKey(creds.elevenLabsApiKey),
        hasAzureKey: hasKey(creds.azureApiKey),
        azureRegion: creds.azureRegion || 'eastus',
        hasIbmWatsonKey: hasKey(creds.ibmWatsonApiKey),
        ibmWatsonRegion: creds.ibmWatsonRegion || 'us-south',
        hasSonioxKey: hasKey(creds.sonioxApiKey),
        // STT Doubao key - separate from LLM Doubao key
        hasSttDoubaoKey: hasKey(creds.doubaoApiKey),
        // STT key values — returned so the settings UI can pre-populate input fields.
        // SECURITY FIX (P0): Return masked keys only, never raw API keys.
        // The hasSttGroqKey boolean tells UI if key exists — no raw key needed.
        sttGroqKey: creds.groqSttApiKey ? `sk-...${creds.groqSttApiKey.slice(-4)}` : '',
        sttOpenaiKey: creds.openAiSttApiKey ? `sk-...${creds.openAiSttApiKey.slice(-4)}` : '',
        sttDeepgramKey: creds.deepgramApiKey ? `sk-...${creds.deepgramApiKey.slice(-4)}` : '',
        sttElevenLabsKey: creds.elevenLabsApiKey ? `sk-...${creds.elevenLabsApiKey.slice(-4)}` : '',
        sttAzureKey: creds.azureApiKey ? `sk-...${creds.azureApiKey.slice(-4)}` : '',
        sttIbmKey: creds.ibmWatsonApiKey ? `sk-...${creds.ibmWatsonApiKey.slice(-4)}` : '',
        sttSonioxKey: creds.sonioxApiKey ? `sk-...${creds.sonioxApiKey.slice(-4)}` : '',
        sttDoubaoKey: creds.doubaoApiKey ? `sk-...${creds.doubaoApiKey.slice(-4)}` : '',
        openAiSttBaseUrl: creds.openAiSttBaseUrl || '',
        hasTavilyKey: hasKey(creds.tavilyApiKey),
        // Dynamic Model Discovery - preferred models
        geminiPreferredModel: creds.geminiPreferredModel || undefined,
        groqPreferredModel: creds.groqPreferredModel || undefined,
        openaiPreferredModel: creds.openaiPreferredModel || undefined,
        claudePreferredModel: creds.claudePreferredModel || undefined,
        doubaoPreferredModel: creds.doubaoPreferredModel || undefined,
        doubaoEmbeddingModel: creds.doubaoEmbeddingModel || undefined,
      };
    } catch (error: any) {
      // SECURITY FIX (P0): Error fallback returns masked keys, not raw strings
      return {
        hasGeminiKey: false,
        hasGroqKey: false,
        hasOpenaiKey: false,
        hasClaudeKey: false,
        hasDoubaoKey: false,
        hasNativelyKey: false,
        geminiKey: '',
        groqKey: '',
        openaiKey: '',
        claudeKey: '',
        doubaoKey: '',
        googleServiceAccountPath: null,
        sttProvider: 'none',
        groqSttModel: 'whisper-large-v3-turbo',
        hasSttGroqKey: false,
        hasSttOpenaiKey: false,
        hasDeepgramKey: false,
        hasElevenLabsKey: false,
        hasAzureKey: false,
        azureRegion: 'eastus',
        hasIbmWatsonKey: false,
        ibmWatsonRegion: 'us-south',
        hasSonioxKey: false,
        hasSttDoubaoKey: false,
        hasTavilyKey: false,
        sttGroqKey: '',
        sttOpenaiKey: '',
        sttDeepgramKey: '',
        sttElevenLabsKey: '',
        sttAzureKey: '',
        sttIbmKey: '',
        sttSonioxKey: '',
      };
    }
  });

  // ==========================================
  // Dynamic Model Discovery Handlers
  // ==========================================

  safeHandle(
    'fetch-provider-models',
    async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'doubao', apiKey: string) => {
      try {
        // Fall back to stored key if no key was explicitly provided
        let key = apiKey?.trim();
        if (!key) {
          const { CredentialsManager } = require('./services/CredentialsManager');
          const cm = CredentialsManager.getInstance();
          if (provider === 'gemini') key = cm.getGeminiApiKey();
          else if (provider === 'groq') key = cm.getGroqApiKey();
          else if (provider === 'openai') key = cm.getOpenaiApiKey();
          else if (provider === 'claude') key = cm.getClaudeApiKey();
          else if (provider === 'doubao') key = cm.getDoubaoLlmApiKey();
        }

        if (!key) {
          return { success: false, error: 'No API key available. Please save a key first.' };
        }

        const { fetchProviderModels } = require('./utils/modelFetcher');
        const models = await fetchProviderModels(provider, key);
        return { success: true, models };
      } catch (error: any) {
        console.error(`[IPC] Failed to fetch ${provider} models:`, error);
        const msg =
          error?.response?.data?.error?.message || error.message || 'Failed to fetch models';
        return { success: false, error: msg };
      }
    },
  );

  safeHandle(
    'set-provider-preferred-model',
    async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'doubao', modelId: string) => {
      try {
        const { CredentialsManager } = require('./services/CredentialsManager');
        CredentialsManager.getInstance().setPreferredModel(provider, modelId);
      } catch (error: any) {
        console.error(`[IPC] Failed to set preferred model for ${provider}:`, error);
      }
    },
  );

  // ==========================================
  // STT Provider Management Handlers
  // ==========================================

  safeHandle(
    'set-stt-provider',
    async (
      _,
      provider:
        | 'none'
        | 'google'
        | 'groq'
        | 'openai'
        | 'deepgram'
        | 'elevenlabs'
        | 'azure'
        | 'ibmwatson'
        | 'soniox'
        | 'doubao'
        | 'doubao-auc'
        | 'natively'
        | 'local-whisper'
        | 'local-sensevoice',
    ) => {
      try {
        const { CredentialsManager } = require('./services/CredentialsManager');
        CredentialsManager.getInstance().setSttProvider(provider);

        // Reconfigure the audio pipeline to use the new STT provider
        await appState.reconfigureSttProvider();

        // Notify all windows so the settings UI reflects the change immediately
        broadcast('credentials-changed');

        return { success: true };
      } catch (error: any) {
        console.error('Error setting STT provider:', error);
        return { success: false, error: error.message };
      }
    },
  );

  safeHandle('get-stt-provider', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      return CredentialsManager.getInstance().getSttProvider();
    } catch (error: any) {
      return 'none';
    }
  });

  safeHandle('set-groq-stt-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttApiKey(apiKey);
      broadcast('credentials-changed');
      return { success: true };
    } catch (error: any) {
      console.error('Error saving Groq STT API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-openai-stt-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenAiSttApiKey(apiKey);
      broadcast('credentials-changed');
      return { success: true };
    } catch (error: any) {
      console.error('Error saving OpenAI STT API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-openai-stt-base-url', async (_, url: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenAiSttBaseUrl(url);
      // Reconfigure the active pipeline so the new endpoint is used immediately,
      // matching the behavior of azure/ibmwatson region setters.
      await appState.reconfigureSttProvider();
      broadcast('credentials-changed');
      return { success: true };
    } catch (error: any) {
      console.error('Error saving OpenAI STT base URL:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-deepgram-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setDeepgramApiKey(apiKey);
      broadcast('credentials-changed');
      return { success: true };
    } catch (error: any) {
      console.error('Error saving Deepgram API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-groq-stt-model', async (_, model: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttModel(model);

      // Reconfigure the audio pipeline to use the new model
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error('Error setting Groq STT model:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-elevenlabs-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setElevenLabsApiKey(apiKey);
      broadcast('credentials-changed');
      return { success: true };
    } catch (error: any) {
      console.error('Error saving ElevenLabs API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-azure-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setAzureApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error('Error saving Azure API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-azure-region', async (_, region: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setAzureRegion(region);

      // Reconfigure the pipeline since region changes the endpoint URL
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error('Error setting Azure region:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-ibmwatson-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setIbmWatsonApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error('Error saving IBM Watson API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-soniox-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setSonioxApiKey(apiKey);
      broadcast('credentials-changed');
      return { success: true };
    } catch (error: any) {
      console.error('Error saving Soniox API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-doubao-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setDoubaoApiKey(apiKey);
      broadcast('credentials-changed');
      return { success: true };
    } catch (error: any) {
      console.error('Error saving Doubao API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-doubao-embedding-model', async (_, model: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setDoubaoEmbeddingModel(model);
      // Reinitialize RAG pipeline to pick up the new embedding model
      const ragManager = appState.getRAGManager();
      if (ragManager) {
        ragManager.initializeEmbeddings({
          openaiKey: CredentialsManager.getInstance().getOpenaiApiKey() || process.env.OPENAI_API_KEY || undefined,
          geminiKey: CredentialsManager.getInstance().getGeminiApiKey() || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || undefined,
          doubaoKey: CredentialsManager.getInstance().getDoubaoLlmApiKey() || process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY || undefined,
          doubaoEmbeddingModel: model.trim() || undefined,
          ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
          providerDataScopes: (() => { try { const { SettingsManager } = require('./services/SettingsManager'); return SettingsManager.getInstance().get('providerDataScopes'); } catch { return undefined; } })()
        });
      }
      return { success: true };
    } catch (error: any) {
      console.error('Error saving Doubao embedding model:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-ibmwatson-region', async (_, region: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setIbmWatsonRegion(region);

      // Reconfigure the pipeline since region changes the endpoint URL
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error('Error setting IBM Watson region:', error);
      return { success: false, error: error.message };
    }
  });

  // Helper to sanitize error messages (remove API key references)
  const sanitizeErrorMessage = (msg: string): string => {
    // Remove patterns like ": sk-***...***" or ": sdasdada***...dwwC"
    return msg.replace(/:\s*[a-zA-Z0-9*]+\*+[a-zA-Z0-9*]+\.?$/g, '').trim();
  };

  // Shared test logic for STT providers. Used by both the user-input flow
  // (test-stt-connection: caller supplies the key) and the saved-key flow
  // (test-saved-stt-connection: handler reads the key from CredentialsManager).
  type SttTestProvider =
    | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson'
    | 'soniox' | 'doubao' | 'doubao-auc';

  const runSttConnectionTest = async (
    provider: SttTestProvider,
    apiKey: string,
    region?: string,
  ): Promise<{ success: boolean; error?: string }> => {
    console.log(`[IPC] Received test - stt - connection request for provider: ${provider} `);
    try {
        if (provider === 'deepgram') {
          const WebSocket = require('ws');
          const token = apiKey.trim();
          return await new Promise<{ success: boolean; error?: string }>((resolve) => {
            const url =
              'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1';
            const ws = new WebSocket(url, {
              headers: { Authorization: `Token ${token}` },
            });

            const timeout = setTimeout(() => {
              ws.close();
              console.error('[IPC] Deepgram test failed: Connection timed out');
              resolve({ success: false, error: 'Connection timed out' });
            }, 15000);

            ws.on('open', () => {
              clearTimeout(timeout);
              try {
                ws.send(JSON.stringify({ type: 'CloseStream' }));
              } catch {}
              ws.close();
              resolve({ success: true });
            });

            ws.on('unexpected-response', (request: any, response: any) => {
              clearTimeout(timeout);
              const status = response.statusCode;
              let body = '';
              response.on('data', (chunk: Buffer) => {
                body += chunk.toString();
              });
              response.on('end', () => {
                const errMsg = `Unexpected server response: ${status} - ${body}`;
                console.error(`[IPC] Deepgram test failed: ${errMsg}`);
                resolve({ success: false, error: errMsg });
              });
            });

            ws.on('error', (err: any) => {
              clearTimeout(timeout);
              console.error(`[IPC] Deepgram test error: ${err.message}`);
              resolve({ success: false, error: err.message || 'Connection failed' });
            });
          });
        }

        if (provider === 'soniox') {
          // Test Soniox via WebSocket connection.
          // With a valid key, Soniox accepts the config and then silently waits for audio —
          // it never sends a response message. With an invalid key it immediately sends an
          // error message and closes. So the strategy is:
          //   • If we receive an error message → fail
          //   • If the connection errors at the WS level → fail
          //   • If 2.5 s pass after sending the config with no error → success
          const WebSocket = require('ws');
          return await new Promise<{ success: boolean; error?: string }>((resolve) => {
            let resolved = false;
            const done = (result: { success: boolean; error?: string }) => {
              if (resolved) return;
              resolved = true;
              try {
                ws.close();
              } catch {}
              resolve(result);
            };

            const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');

            // Hard connect timeout — server unreachable
            const connectTimeout = setTimeout(() => {
              done({ success: false, error: 'Connection timed out' });
            }, 10000);

            ws.on('open', () => {
              clearTimeout(connectTimeout);
              ws.send(
                JSON.stringify({
                  api_key: apiKey,
                  model: 'stt-rt-v4',
                  audio_format: 'pcm_s16le',
                  sample_rate: 16000,
                  num_channels: 1,
                }),
              );
              // Give Soniox 2.5 s to reject the key; silence means the key is valid
              setTimeout(() => done({ success: true }), 2500);
            });

            ws.on('message', (msg: any) => {
              try {
                const res = JSON.parse(msg.toString());
                if (res.error_code) {
                  done({ success: false, error: `${res.error_code}: ${res.error_message}` });
                }
                // Non-error message is unexpected but treat as success
              } catch {
                // Unparseable message — treat as success
              }
            });

            ws.on('error', (err: any) => {
              clearTimeout(connectTimeout);
              done({ success: false, error: err.message || 'Connection failed' });
            });

            ws.on('close', (code: number) => {
              // Abnormal close before we resolved means the server rejected us
              if (!resolved && code !== 1000) {
                done({ success: false, error: `Server closed connection (code ${code})` });
              }
            });
          });
        }

        const axios = require('axios');
        const FormData = require('form-data');

        // Generate a tiny silent WAV (0.5s of silence at 16kHz mono 16-bit)
        const numSamples = 8000;
        const pcmData = Buffer.alloc(numSamples * 2);
        const wavHeader = Buffer.alloc(44);
        wavHeader.write('RIFF', 0);
        wavHeader.writeUInt32LE(36 + pcmData.length, 4);
        wavHeader.write('WAVE', 8);
        wavHeader.write('fmt ', 12);
        wavHeader.writeUInt32LE(16, 16);
        wavHeader.writeUInt16LE(1, 20);
        wavHeader.writeUInt16LE(1, 22);
        wavHeader.writeUInt32LE(16000, 24);
        wavHeader.writeUInt32LE(32000, 28);
        wavHeader.writeUInt16LE(2, 32);
        wavHeader.writeUInt16LE(16, 34);
        wavHeader.write('data', 36);
        wavHeader.writeUInt32LE(pcmData.length, 40);
        const testWav = Buffer.concat([wavHeader, pcmData]);

        if (provider === 'elevenlabs') {
          // ElevenLabs: Use /v1/voices to validate the API key (minimal scope required).
          // Scoped keys may lack speech_to_text or user_read but still be usable once permissions are added.
          try {
            await axios.get('https://api.elevenlabs.io/v1/voices', {
              headers: { 'xi-api-key': apiKey },
              timeout: 10000,
            });
          } catch (elErr: any) {
            const elStatus = elErr?.response?.data?.detail?.status;
            // If the error is "invalid_api_key", the key itself is wrong — fail.
            // Any other error (missing permission, etc.) means the key IS valid, just possibly scoped.
            if (elStatus === 'invalid_api_key') {
              throw elErr;
            }
            // Key is valid but scoped — pass with a warning
            console.log(
              '[IPC] ElevenLabs key is valid but may have restricted scopes. Saving key.',
            );
          }
        } else if (provider === 'azure') {
          // Azure: raw binary with subscription key
          const azureRegion = region || 'eastus';
          await axios.post(
            `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`,
            testWav,
            {
              headers: { 'Ocp-Apim-Subscription-Key': apiKey, 'Content-Type': 'audio/wav' },
              timeout: 15000,
            },
          );
        } else if (provider === 'ibmwatson') {
          // IBM Watson: raw binary with Basic auth
          const ibmRegion = region || 'us-south';
          await axios.post(
            `https://api.${ibmRegion}.speech-to-text.watson.cloud.ibm.com/v1/recognize`,
            testWav,
            {
              headers: {
                Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}`,
                'Content-Type': 'audio/wav',
              },
              timeout: 15000,
            },
          );
        } else if (provider === 'doubao-auc') {
          // Doubao AUC: JSON body with Base64 audio
          // New console API uses single X-Api-Key header (no more AppId|AccessKey)
          const audioBase64 = testWav.toString('base64');
          const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

          const authHeaders: Record<string, string> = {
            'X-Api-Key': apiKey.trim(),
            'X-Api-Resource-Id': 'volc.seedasr.auc',
            'Content-Type': 'application/json',
            'X-Api-Request-Id': requestId,
            'X-Api-Sequence': '-1',
          };
          console.log('[IPC] Testing Doubao AUC with X-Api-Key prefix:', apiKey.substring(0, 8) + '...');
          console.log('[IPC]   Request ID:', requestId);

          try {
            const response = await axios.post(
              'https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/submit',
              {
                user: { uid: 'cluely-test' },
                audio: {
                  data: audioBase64,
                  format: 'wav',
                  codec: 'raw',
                  rate: 16000,
                  bits: 16,
                  channel: 1,
                },
                request: {
                  model_name: 'bigmodel',
                  enable_itn: true,
                  enable_punc: true,
                },
              },
              {
                headers: authHeaders,
                timeout: 15000,
              },
            );

            console.log('[IPC] Doubao AUC test response:', {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          } catch (testErr: any) {
            console.error('[IPC] Doubao AUC test detailed error:', {
              status: testErr?.response?.status,
              statusText: testErr?.response?.statusText,
              data: testErr?.response?.data,
              headers: testErr?.response?.headers,
            });
            throw testErr;
          }
        } else {
          // Groq / OpenAI: multipart FormData
          let openAiEndpoint = 'https://api.openai.com/v1/audio/transcriptions';
          if (provider === 'openai') {
            // If a custom OpenAI-compatible base URL is configured, test against it.
            const { CredentialsManager } = require('./services/CredentialsManager');
            const customBase = (
              CredentialsManager.getInstance().getOpenAiSttBaseUrl() || ''
            ).trim();
            if (customBase) {
              const trimmed = customBase.replace(/\/+$/, '');
              openAiEndpoint = /\/v\d+$/.test(trimmed)
                ? `${trimmed}/audio/transcriptions`
                : `${trimmed}/v1/audio/transcriptions`;
            }
          }
          let endpoint: string;
          let model: string;
          if (provider === 'groq') {
            endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
            model = 'whisper-large-v3-turbo';
          } else if (provider === 'doubao') {
            endpoint = 'https://ark.cn-beijing.volces.com/api/v3/audio/transcriptions';
            model = 'volc.seedasr.sauc.duration';
          } else {
            endpoint = openAiEndpoint;
            model = 'whisper-1';
          }

          const form = new FormData();
          form.append('file', testWav, { filename: 'test.wav', contentType: 'audio/wav' });
          form.append('model', model);

          await axios.post(endpoint, form, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              ...form.getHeaders(),
            },
            timeout: 15000,
          });
        }

        return { success: true };
      } catch (error: any) {
        const respData = error?.response?.data;
        const rawMsg =
          respData?.error?.message ||
          respData?.detail?.message ||
          respData?.message ||
          error.message ||
          'Connection failed';
        const msg = sanitizeErrorMessage(rawMsg);
        console.error(`[IPC] STT connection test failed for ${provider}:`, {
          message: msg,
          status: error?.response?.status,
          data: respData,
        });
        return { success: false, error: msg };
      }
  };

  safeHandle(
    'test-stt-connection',
    async (
      _,
      provider: SttTestProvider,
      apiKey: string,
      region?: string,
    ) => runSttConnectionTest(provider, apiKey, region),
  );

  // Test the STT key that is already persisted in CredentialsManager (not the input
  // field). Used by the settings UI's Test Connection button, which is the user's way
  // to verify "is my saved key still valid?" without re-typing it. The Save flow still
  // uses test-stt-connection with the user-supplied input.
  safeHandle(
    'test-saved-stt-connection',
    async (_, provider: SttTestProvider, region?: string) => {
      try {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const cm = CredentialsManager.getInstance();
        const savedKey =
          provider === 'groq' ? cm.getGroqSttApiKey()
          : provider === 'openai' ? cm.getOpenAiSttApiKey()
          : provider === 'deepgram' ? cm.getDeepgramApiKey()
          : provider === 'elevenlabs' ? cm.getElevenLabsApiKey()
          : provider === 'azure' ? cm.getAzureApiKey()
          : provider === 'ibmwatson' ? cm.getIbmWatsonApiKey()
          : provider === 'soniox' ? cm.getSonioxApiKey()
          : provider === 'doubao' ? cm.getDoubaoApiKey()
          : provider === 'doubao-auc' ? cm.getDoubaoAucApiKey()
          : undefined;
        if (!savedKey) {
          return { success: false, error: 'no_saved_key' };
        }
        return await runSttConnectionTest(provider, savedKey, region);
      } catch (error: any) {
        const respData = error?.response?.data;
        const rawMsg =
          respData?.error?.message ||
          respData?.detail?.message ||
          respData?.message ||
          error.message ||
          'Connection failed';
        return { success: false, error: sanitizeErrorMessage(rawMsg) };
      }
    },
  );

  // ==========================================
  // Local Whisper STT Handlers
  // ==========================================

  const activeWhisperDownloads = new Set<string>();

  safeHandle('local-whisper-get-models', async () => {
    try {
      const { getAvailableModels } = require('./audio/whisper/modelManager');
      const models = getAvailableModels();
      const activeModelId = SettingsManager.getInstance().get('localWhisperModel') ?? '';
      return { models, activeModelId };
    } catch (e: any) {
      console.error('[IPC] local-whisper-get-models error:', e.message);
      return { models: [], activeModelId: '' };
    }
  });

  safeHandle('local-whisper-set-model', async (_, modelId: string) => {
    try {
      SettingsManager.getInstance().set('localWhisperModel', modelId);
      broadcast('credentials-changed');
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Per-channel model overrides (mic / system audio). When enabled, the two
  // STT instances pick their own model via these slots. When disabled, both
  // fall back to localWhisperModel (the existing global setting).
  safeHandle('local-whisper-get-channel-config', async () => {
    const sm = SettingsManager.getInstance();
    return {
      enabled: !!sm.get('localWhisperPerChannelEnabled'),
      micModelId: sm.get('localWhisperModelMic') ?? '',
      systemModelId: sm.get('localWhisperModelSystem') ?? '',
      globalModelId: sm.get('localWhisperModel') ?? '',
    };
  });

  safeHandle(
    'local-whisper-set-channel-config',
    async (_, cfg: { enabled?: boolean; micModelId?: string; systemModelId?: string }) => {
      try {
        const sm = SettingsManager.getInstance();
        if (typeof cfg?.enabled === 'boolean') sm.set('localWhisperPerChannelEnabled', cfg.enabled);
        if (typeof cfg?.micModelId === 'string') sm.set('localWhisperModelMic', cfg.micModelId);
        if (typeof cfg?.systemModelId === 'string')
          sm.set('localWhisperModelSystem', cfg.systemModelId);
        broadcast('credentials-changed');
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
  );

  safeHandle('local-whisper-delete-model', async (_, modelId: string) => {
    try {
      const { deleteModel } = require('./audio/whisper/modelManager');
      deleteModel(modelId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  safeHandle('local-whisper-start-download', async (event, modelId: string) => {
    if (activeWhisperDownloads.has(modelId)) {
      return { success: false, error: 'already-downloading' };
    }
    activeWhisperDownloads.add(modelId);
    try {
      const { Worker } = require('worker_threads');
      const { buildWorkerInitMessage } = require('./audio/whisper/inferenceConfig');
      const { resolveWhisperWorkerPath } = require('./audio/whisper/workerPathResolver');
      const workerPath = resolveWhisperWorkerPath();
      const w = new Worker(workerPath);
      const sender = event.sender;
      w.on('message', (msg: any) => {
        if (sender.isDestroyed()) return;
        if (msg.type === 'progress') {
          sender.send('local-whisper-download-progress', { modelId, progress: msg.progress });
        } else if (msg.type === 'ready') {
          activeWhisperDownloads.delete(modelId);
          sender.send('local-whisper-download-complete', { modelId });
          w.terminate();
        } else if (msg.type === 'error') {
          activeWhisperDownloads.delete(modelId);
          sender.send('local-whisper-download-error', { modelId, error: msg.message });
          w.terminate();
        }
      });
      w.on('error', (err: Error) => {
        activeWhisperDownloads.delete(modelId);
        if (!sender.isDestroyed()) {
          sender.send('local-whisper-download-error', { modelId, error: err.message });
        }
      });
      w.postMessage(buildWorkerInitMessage(modelId));
      return { success: true };
    } catch (e: any) {
      activeWhisperDownloads.delete(modelId);
      return { success: false, error: e.message };
    }
  });

  // --- Local ONNX Model Management ---
  const {
    getLocalModels,
    startLocalModelDownload,
    deleteLocalModel,
    setDownloadCallbacks,
  } = require('./services/LocalModelManager');

  // Broadcast helpers for download events
  const broadcastModelProgress = (modelId: string, progress: number) => {
    broadcast('local-models-download-progress', { modelId, progress });
  };
  const broadcastModelComplete = (modelId: string) => {
    broadcast('local-models-download-complete', { modelId });
  };
  const broadcastModelError = (modelId: string, error: string) => {
    broadcast('local-models-download-error', { modelId, error });
  };

  setDownloadCallbacks(broadcastModelProgress, broadcastModelComplete, broadcastModelError);

  safeHandle('local-models-get-list', async () => {
    return { models: getLocalModels() };
  });

  safeHandle('local-models-start-download', async (_event, modelId: string) => {
    // Fire-and-forget download; status updates via broadcast events
    startLocalModelDownload(modelId).catch(() => {});
    return { success: true };
  });

  safeHandle('local-models-delete-model', async (_event, modelId: string) => {
    return deleteLocalModel(modelId);
  });

  safeHandle('local-whisper-preload', async (_, modelId: string) => {
    try {
      const { modelPreloader } = require('./audio/whisper/modelPreloader');
      const { isModelCached } = require('./audio/whisper/modelManager');
      const { resolveInferenceConfig } = require('./audio/whisper/inferenceConfig');
      const { SettingsManager } = require('./services/SettingsManager');
      const id =
        modelId ||
        SettingsManager.getInstance().get('localWhisperModel') ||
        'Xenova/whisper-base';
      // Pass active dtype so the cache check verifies the SPECIFIC ONNX
      // files (e.g. encoder_model.onnx for fp32) are present — not just
      // "directory non-empty". Otherwise a v2-cached _quantized.onnx-only
      // directory would be reported "available" but trigger a 142MB
      // background fetch on first start().
      const { dtype } = resolveInferenceConfig();
      if (!isModelCached(id, dtype)) {
        return { success: false, reason: 'model-not-cached' };
      }
      modelPreloader.preload(id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  safeHandle('local-whisper-get-hardware', () => {
    const { detectHardware } = require('./audio/whisper/hardwareDetect');
    return detectHardware();
  });

  // ==========================================
  // Local SenseVoice STT Handlers
  // ==========================================

  const activeSenseVoiceDownloads = new Set<string>();

  safeHandle('local-sensevoice-get-models', async () => {
    try {
      const { getAvailableSenseVoiceModels, SENSEVOICE_DEFAULT_MODEL_ID } = require('./audio/sensevoice/modelManager');
      return {
        models: getAvailableSenseVoiceModels(),
        activeModelId: SENSEVOICE_DEFAULT_MODEL_ID,
      };
    } catch (e: any) {
      console.error('[IPC] local-sensevoice-get-models error:', e.message);
      return { models: [], activeModelId: '' };
    }
  });

  safeHandle('local-sensevoice-delete-model', async (_, modelId: string) => {
    try {
      const { deleteSenseVoiceModel } = require('./audio/sensevoice/modelManager');
      deleteSenseVoiceModel(modelId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  safeHandle('local-sensevoice-start-download', async (event, modelId: string) => {
    if (activeSenseVoiceDownloads.has(modelId)) {
      return { success: false, error: 'already-downloading' };
    }
    activeSenseVoiceDownloads.add(modelId);
    const sender = event.sender;
    try {
      const { downloadSenseVoiceModel } = require('./audio/sensevoice/modelDownloader');
      downloadSenseVoiceModel(modelId, (progress: number) => {
        if (!sender.isDestroyed()) {
          sender.send('local-sensevoice-download-progress', { modelId, progress });
        }
      })
        .then(() => {
          activeSenseVoiceDownloads.delete(modelId);
          if (!sender.isDestroyed()) {
            sender.send('local-sensevoice-download-complete', { modelId });
          }
        })
        .catch((err: Error) => {
          activeSenseVoiceDownloads.delete(modelId);
          if (!sender.isDestroyed()) {
            sender.send('local-sensevoice-download-error', { modelId, error: err.message });
          }
        });
      return { success: true };
    } catch (e: any) {
      activeSenseVoiceDownloads.delete(modelId);
      if (!sender.isDestroyed()) {
        sender.send('local-sensevoice-download-error', { modelId, error: e.message });
      }
      return { success: false, error: e.message };
    }
  });

  safeHandle('local-sensevoice-preload', async (_, modelId: string) => {
    try {
      const { isSenseVoiceModelCached } = require('./audio/sensevoice/modelManager');
      if (!isSenseVoiceModelCached(modelId)) {
        return { success: false, reason: 'model-not-cached' };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  safeHandle(
    'test-llm-connection',
    async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'doubao', apiKey?: string) => {
      console.log(`[IPC] Received test-llm-connection request for provider: ${provider}`);
      try {
        if (!apiKey || !apiKey.trim()) {
          const { CredentialsManager } = require('./services/CredentialsManager');
          const creds = CredentialsManager.getInstance();
          if (provider === 'gemini') apiKey = creds.getGeminiApiKey();
          else if (provider === 'groq') apiKey = creds.getGroqApiKey();
          else if (provider === 'openai') apiKey = creds.getOpenaiApiKey();
          else if (provider === 'claude') apiKey = creds.getClaudeApiKey();
          else if (provider === 'doubao') apiKey = creds.getDoubaoLlmApiKey();
        }

        if (!apiKey || !apiKey.trim()) {
          return { success: false, error: 'No API key provided' };
        }

        const axios = require('axios');
        let response;

        if (provider === 'gemini') {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent`;
          response = await axios.post(
            url,
            {
              contents: [{ parts: [{ text: 'Hello' }] }],
            },
            {
              headers: { 'x-goog-api-key': apiKey },
              timeout: 15000,
            },
          );
        } else if (provider === 'groq') {
          response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
              model: 'llama-3.3-70b-versatile',
              messages: [{ role: 'user', content: 'Hello' }],
            },
            {
              headers: { Authorization: `Bearer ${apiKey}` },
              timeout: 15000,
            },
          );
        } else if (provider === 'openai') {
          response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: 'Hello' }],
            },
            {
              headers: { Authorization: `Bearer ${apiKey}` },
              timeout: 15000,
            },
          );
        } else if (provider === 'claude') {
          response = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
              model: 'claude-sonnet-4-6',
              max_tokens: 10,
              messages: [{ role: 'user', content: 'Hello' }],
            },
            {
              headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              timeout: 15000,
            },
          );
        } else if (provider === 'doubao') {
          response = await axios.post(
            'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
            {
              model: 'doubao-seed-2-0-lite-260215',
              messages: [{ role: 'user', content: 'Hello' }],
              max_tokens: 10,
            },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              timeout: 15000,
            },
          );
        }

        if (response && (response.status === 200 || response.status === 201)) {
          return { success: true };
        } else {
          return { success: false, error: 'Request failed with status ' + response?.status };
        }
      } catch (error: any) {
        // CRITICAL: do NOT log the raw axios error — it includes the request config
        // with the Authorization header (full API key) and is dumped verbatim by
        // Node's util.inspect. Strip to a safe shape before logging.
        const safeInfo = {
          provider,
          status: error?.response?.status,
          statusText: error?.response?.statusText,
          code: error?.code,
          message: error?.message,
          responseError: error?.response?.data?.error?.message || error?.response?.data?.message,
        };
        console.error('LLM connection test failed:', safeInfo);
        const rawMsg =
          error?.response?.data?.error?.message ||
          error?.response?.data?.message ||
          (error.response?.data?.error?.type
            ? `${error.response.data.error.type}: ${error.response.data.error.message}`
            : error.message) ||
          'Connection failed';
        const msg = sanitizeErrorMessage(rawMsg);
        return { success: false, error: msg };
      }
    },
  );

  safeHandle('get-groq-fast-text-mode', () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return { enabled: llmHelper.getGroqFastTextMode() };
    } catch (error: any) {
      return { enabled: false };
    }
  });

  // Set Groq Fast Text Mode
  safeHandle('set-groq-fast-text-mode', (_, enabled: boolean) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqFastTextMode(enabled);

      const { SettingsManager } = require('./services/SettingsManager');
      SettingsManager.getInstance().set('groqFastTextMode', enabled);

      broadcast('groq-fast-text-changed', enabled);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('get-codex-cli-config', () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return llmHelper.getCodexCliConfig();
    } catch {
      return CodexCliService.normalizeConfig({});
    }
  });

  safeHandle('set-codex-cli-config', (_, config: any) => {
    try {
      const normalized = CodexCliService.normalizeConfig(config || {});
      const sm = SettingsManager.getInstance();
      sm.set('codexCliEnabled', normalized.enabled);
      sm.set('codexCliPath', normalized.path);
      sm.set('codexCliModel', normalized.model);
      sm.set('codexCliFastModel', normalized.fastModel);
      sm.set('codexCliTimeoutMs', normalized.timeoutMs);
      sm.set('codexCliSandboxMode', normalized.sandboxMode);
      appState.processingHelper.getLLMHelper().setCodexCliConfig(normalized);
      return { success: true, config: normalized };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('test-codex-cli', async (_, config?: any) => {
    try {
      const current = appState.processingHelper.getLLMHelper().getCodexCliConfig();
      const normalized = CodexCliService.normalizeConfig({ ...current, ...(config || {}) });
      const result = await CodexCliService.validateExecutable(normalized.path);
      // If auto-detection found a different working path, persist it so
      // subsequent chat calls don't re-ENOENT.
      if (result.success && result.resolvedPath && result.resolvedPath !== normalized.path) {
        const updated = CodexCliService.normalizeConfig({
          ...normalized,
          path: result.resolvedPath,
        });
        const sm = SettingsManager.getInstance();
        sm.set('codexCliPath', updated.path);
        appState.processingHelper.getLLMHelper().setCodexCliConfig(updated);
        return { success: true, resolvedPath: result.resolvedPath, config: updated };
      }
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-model', async (_, modelId: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      // Get all providers (Curl + Custom)
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];

      llmHelper.setModel(modelId, allProviders);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      // Broadcast to all windows so NativelyInterface can update its selector (session-only update)
      broadcast('model-changed', modelId);

      return { success: true };
    } catch (error: any) {
      console.error('Error setting model:', error);
      return { success: false, error: error.message };
    }
  });

  // Persist default model (from Settings) + update runtime + broadcast to all windows
  safeHandle('set-default-model', async (_, modelId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      cm.setDefaultModel(modelId);

      // Also update the runtime model
      const llmHelper = appState.processingHelper.getLLMHelper();
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];
      llmHelper.setModel(modelId, allProviders);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      // Broadcast to all windows so NativelyInterface can update its selector
      broadcast('model-changed', modelId);

      return { success: true };
    } catch (error: any) {
      console.error('Error setting default model:', error);
      return { success: false, error: error.message };
    }
  });

  // Read the persisted default model
  safeHandle('get-default-model', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      return { model: cm.getDefaultModel() };
    } catch (error: any) {
      console.error('Error getting default model:', error);
      return { model: 'gemini-3.1-flash-lite-preview' };
    }
  });

  // --- Model Selector Window IPC ---

  safeHandle('show-model-selector', (_, coords: { x: number; y: number }) => {
    appState.modelSelectorWindowHelper.showWindow(coords.x, coords.y);
  });

  safeHandle('hide-model-selector', () => {
    appState.modelSelectorWindowHelper.hideWindow();
  });

  safeHandle('toggle-model-selector', (_, coords: { x: number; y: number }) => {
    appState.modelSelectorWindowHelper.toggleWindow(coords.x, coords.y);
  });

  // ROUND 3 FIX (#4): click-outside close for ModelSelector. With panel-
  // nonactivating + becomesKeyOnlyIfNeeded, the on('blur') auto-close in
  // ModelSelectorWindowHelper fires unreliably (panel may never become key
  // → never receives blur). The overlay's renderer fires this IPC on every
  // mousedown that isn't on the toggle button itself; if the model selector
  // is open, we close it. No-op when closed (toggleWindow handled the open).
  safeHandle('model-selector:close-if-open', () => {
    const win = appState.modelSelectorWindowHelper.getWindow();
    if (win && !win.isDestroyed() && win.isVisible()) {
      appState.modelSelectorWindowHelper.hideWindow();
    }
  });

  // Native Audio Service Handlers
  // Native Audio handlers removed as part of migration to driverless architecture
  safeHandle('native-audio-status', async () => {
    // Always return true or pseudo-status since it's "driverless"
    return { connected: true };
  });

  safeHandle('get-input-devices', async () => {
    return AudioDevices.getInputDevices();
  });

  safeHandle('get-output-devices', async () => {
    return AudioDevices.getOutputDevices();
  });

  safeHandle('start-audio-test', async (event, deviceId?: string) => {
    await appState.startAudioTest(deviceId);
    return { success: true };
  });

  safeHandle('stop-audio-test', async () => {
    appState.stopAudioTest();
    return { success: true };
  });

  safeHandle('set-recognition-language', async (_, key: string) => {
    appState.setRecognitionLanguage(key);
    broadcast('credentials-changed');
    return { success: true };
  });

  // ==========================================
  // Meeting Lifecycle Handlers
  // ==========================================

  safeHandle('start-meeting', async (event, metadata?: any) => {
    try {
      await appState.startMeeting(metadata);
      return { success: true };
    } catch (error: any) {
      console.error('Error starting meeting:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('end-meeting', async () => {
    try {
      await appState.endMeeting();
      return { success: true };
    } catch (error: any) {
      console.error('Error ending meeting:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('get-recent-meetings', async () => {
    // Fetch from SQLite (limit 50)
    return DatabaseManager.getInstance().getRecentMeetings(50);
  });

  safeHandle('get-meeting-details', async (event, id) => {
    // Helper to fetch full details
    return DatabaseManager.getInstance().getMeetingDetails(id);
  });

  safeHandle('update-meeting-title', async (_, { id, title }: { id: string; title: string }) => {
    return DatabaseManager.getInstance().updateMeetingTitle(id, title);
  });

  safeHandle('update-meeting-summary', async (_, { id, updates }: { id: string; updates: any }) => {
    return DatabaseManager.getInstance().updateMeetingSummary(id, updates);
  });

  safeHandle('seed-demo', async () => {
    DatabaseManager.getInstance().seedDemoMeeting();

    // Ensure RAG embeddings exist for the demo meeting.
    // Use ensureDemoMeetingProcessed so we skip if already embedded
    // (avoids re-clearing 14 queue items on every app launch once processed).
    const ragManager = appState.getRAGManager();
    if (ragManager && ragManager.isReady()) {
      ragManager.ensureDemoMeetingProcessed().catch(console.error);
    }

    return { success: true };
  });

  safeHandle('flush-database', async () => {
    const result = DatabaseManager.getInstance().clearAllData();
    return { success: result };
  });

  safeHandle('open-external', async (event, url: string) => {
    try {
      if (typeof url !== 'string') {
        console.warn('[IPC] Blocked invalid open-external request', { reason: 'non-string' });
        return;
      }

      const parsed = new URL(url);
      const allowedWebUrl =
        parsed.protocol === 'https:' &&
        parsed.hostname === 'mail.google.com' &&
        parsed.pathname === '/mail/';
      // x-apple.systempreferences is a macOS-only URI scheme. Allowing it on
      // Windows let renderer regressions hand Windows shell an unknown
      // protocol → Microsoft Store popup (issue #252). Gate the allowlist on
      // the actual platform so the IPC layer is the last line of defense.
      const allowedSystemSettingsUrl =
        parsed.protocol === 'x-apple.systempreferences:' && process.platform === 'darwin';

      if (allowedWebUrl || allowedSystemSettingsUrl) {
        await shell.openExternal(url);
      } else {
        console.warn('[IPC] Blocked open-external request', {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
        });
      }
    } catch {
      console.warn('[IPC] Invalid URL in open-external');
    }
  });

  // ==========================================
  // Intelligence Mode Handlers
  // ==========================================

  // MODE 1: Assist (Passive observation)
  safeHandle('generate-assist', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const insight = await intelligenceManager.runAssistMode();
      return { insight };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 2: What Should I Say (Primary auto-answer)
  //
  // VISION-FIRST: image paths are validated and forwarded to IntelligenceManager
  // which routes them through the vision provider fallback chain.
  // LEGACY OCR PATH DISABLED: the previous build called ScreenContextService.captureScreenFromPath
  // here to run Tesseract OCR before answering. That path is now removed from the runtime —
  // Natively answers from the image directly via a vision-capable provider. Do not re-introduce
  // OCR here unless a future explicit OCR-only mode is reintroduced.
  safeHandle(
    'generate-what-to-say',
    async (
      _,
      question?: string,
      imagePaths?: string[],
      options?: { promptInstruction?: string; uploadedMaterialContext?: string; persist?: boolean; source?: string; modeEvent?: ModeEventContext },
    ) => {
      try {
        let screenContext: any;
        let screenContextStatus: 'not_available' | 'available' | 'failed' = 'not_available';
        let visionProviderUsed: string | undefined;
        let visionModelUsed: string | undefined;
        let visionAttempts: number | undefined;
        let visionFailureReason: string | undefined;
        const startedAt = Date.now();
        const answerId = `ans_${startedAt}_${crypto.randomBytes(6).toString('hex')}`;
        const citations: any[] = [];
        const degradedReasons: string[] = [];
        const contextBudgetDegradedReasons: string[] = [];

        const validatedImagePaths: string[] | undefined = imagePaths?.length ? [] : undefined;

        // SECURITY (P0): Validate image paths if provided from renderer
        if (imagePaths && imagePaths.length > 0) {
          if (
            !Array.isArray(imagePaths) ||
            imagePaths.length > 5 ||
            imagePaths.some(
              (imagePath) => typeof imagePath !== 'string' || imagePath.trim().length === 0,
            )
          ) {
            console.warn('[IPC] generate-what-to-say: malformed image path payload rejected');
            return {
              answer: null,
              question: question || 'unknown',
              screenContextStatus,
              error: 'Invalid image path payload',
            };
          }

          const { app } = require('electron');
          const { validateImagePath } = require('./utils/curlUtils');
          const userDataDir = app.getPath('userData');

          for (const imagePath of imagePaths) {
            const validation = validateImagePath(imagePath, userDataDir);
            if (!validation.isValid) {
              console.warn(
                `[IPC] generate-what-to-say: invalid image path rejected: ${validation.reason}`,
              );
              return {
                answer: null,
                question: question || 'unknown',
                screenContextStatus,
                error: `Invalid image path: ${validation.reason}`,
              };
            }
            validatedImagePaths!.push(imagePath);
          }

          // Vision-first: run the ScreenUnderstandingService so the image is hashed, optimized,
          // and routed through the vision provider fallback chain. The structured result becomes
          // the screenContext that PromptAssembler consumes.
          try {
            const {
              getScreenUnderstandingService,
            } = require('./services/screen/ScreenUnderstandingService');
            const { CredentialsManager } = require('./services/CredentialsManager');
            const sus = getScreenUnderstandingService();
            const settings = SettingsManager.getInstance();
            const credentials = CredentialsManager.getInstance();
            const providerScopes = settings.get('providerDataScopes') || {};
            const localVisionAvailable = credentials.anyLocalVisionProviderConfigured?.() ?? false;
            if (providerScopes.screenshots === false) {
              console.warn(
                localVisionAvailable
                  ? '[ScopeFallback] screenshots denied for cloud; routing to Ollama'
                  : '[ScopeFallback] screenshots denied; Ollama unavailable, omitting from context',
              );
            }

            const sur = await sus.understand({
              modeId: 'what-to-say',
              transcript: question,
              userAction: 'what_to_say',
              qualityMode: 'balanced',
              imagePaths: validatedImagePaths,
              screenUnderstandingMode: settings.getScreenUnderstandingMode(),
              technicalInterviewVisionFirst: settings.getTechnicalInterviewVisionFirst(),
              providerPolicy: {
                localOnly: settings.getScreenUnderstandingMode() === 'private_vision',
                allowScreenshots: providerScopes.screenshots !== false,
                visionAvailable: credentials.anyVisionProviderConfigured?.() ?? true,
                localVisionAvailable,
              },
            });

            screenContext = sur.status === 'available' ? sur : undefined;
            screenContextStatus =
              sur.status === 'available'
                ? 'available'
                : sur.status === 'failed'
                  ? 'failed'
                  : 'not_available';
            visionProviderUsed = sur.providerUsed;
            visionModelUsed = sur.modelUsed;
            visionAttempts = Array.isArray(sur.attempts) ? sur.attempts.length : undefined;
            visionFailureReason = sur.failureReason;
          } catch (sErr: any) {
            screenContextStatus = 'failed';
            console.warn('[IPC] generate-what-to-say: ScreenUnderstandingService failed', {
              errorClass: sErr?.name || 'Error',
            });
          }
        }

        let promptInstruction = typeof options?.promptInstruction === 'string'
          ? options.promptInstruction
          : undefined;
        let uploadedMaterialContext = typeof options?.uploadedMaterialContext === 'string'
          ? options.uploadedMaterialContext
          : undefined;
        try {
          const searchQuery = typeof question === 'string' && question.trim()
            ? question.trim()
            : sanitizeModeEvent(options?.modeEvent)?.retrievalQuery;
          if (searchQuery) {
            const ragManager = appState.getRAGManager();
            const { KnowledgeMaterialService } = require('./services/knowledge/KnowledgeMaterialService');
            const materialService = new KnowledgeMaterialService(DatabaseManager.getInstance(), ragManager?.getEmbeddingPipeline?.());
            const materialHits = await materialService.search(searchQuery, { limit: 4 });
            if (materialHits.length > 0) {
              citations.push(...materialHits.map((hit: any) => ({
                sourceType: hit.sourceType,
                sourceId: hit.sourceId,
                chunkId: hit.chunkId,
                score: hit.score,
                title: hit.title,
              })));
              const materialBlock = materialHits
                .map((hit: any, index: number) => `[${index + 1}] ${hit.title}\n${hit.parentText}`)
                .join('\n\n');
              uploadedMaterialContext = `<uploaded_material_context>\nUse these uploaded materials only when relevant. Citeable source ids are tracked outside the prompt; do not invent unseen sources.\n${materialBlock}\n</uploaded_material_context>`;
            } else {
              degradedReasons.push('no_relevant_uploaded_material');
            }
          }
        } catch (materialError: any) {
          degradedReasons.push('uploaded_material_rag_failed');
          console.warn('[IPC] generate-what-to-say: material RAG failed', { errorClass: materialError?.name || 'Error' });
        }

        const intelligenceManager = appState.getIntelligenceManager();
        // Question and imagePaths are now optional - IntelligenceManager infers from transcript
        const answer = await intelligenceManager.runWhatShouldISay(
          question,
          0.8,
          validatedImagePaths,
          {
            skipCooldown: process.env.NODE_ENV === 'test',
            screenContext,
            promptInstruction: promptInstruction ?? (typeof options?.promptInstruction === 'string'
              ? options.promptInstruction
              : undefined),
            uploadedMaterialContext,
            persist: options?.persist === false ? false : undefined,
            source:
              typeof options?.source === 'string'
                ? options.source
                : undefined,
            modeEvent: sanitizeModeEvent(options?.modeEvent),
            contextDegradedReasons: contextBudgetDegradedReasons,
          },
        );
        if (screenContextStatus === 'failed') degradedReasons.push('screen_context_failed');
        for (const reason of contextBudgetDegradedReasons) {
          if (!degradedReasons.includes(reason)) degradedReasons.push(reason);
        }
        const llmHelper = appState.processingHelper?.getLLMHelper?.();
        const contextTrace = DatabaseManager.getInstance().saveAnswerContextTrace({
          answerId,
          answerType: 'what_to_say',
          surface: typeof options?.source === 'string' ? options.source : 'overlay',
          provider: llmHelper?.getCurrentProvider?.() ?? null,
          model: llmHelper?.getCurrentModel?.() ?? null,
          latencyMs: Date.now() - startedAt,
          contextUsed: {
            currentTranscript: true,
            shortTermHistory: true,
            uploadedDocumentRag: citations.some((citation) => citation.sourceType === 'uploaded_material'),
            historicalMeetings: false,
            longTermMemory: false,
            enterpriseKnowledge: false,
            screenContext: screenContextStatus === 'available',
          },
          citations,
          degradedReason: degradedReasons.length > 0 ? degradedReasons.join(',') : null,
        });
        return {
          answerId,
          answer,
          question: question || 'inferred from context',
          contextTrace,
          degradedReason: degradedReasons.length > 0 ? degradedReasons.join(',') : undefined,
          citations,
          screenContextStatus,
          visionProviderUsed,
          visionModelUsed,
          visionAttempts,
          visionFailureReason,
          imageCount: validatedImagePaths?.length || 0,
          usedImageInput: Boolean(validatedImagePaths?.length),
        };
      } catch (error: any) {
        console.error('[IPC] generate-what-to-say error:', error);
        return {
          answer: null,
          question: question || 'unknown',
          error: error?.message || 'unknown_error',
        };
      }
    },
  );

  safeHandle('generate-clarify', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const result = await intelligenceManager.runClarify();
      if (result.ok === false) {
        // `result` is narrowed to the failure variant. We still re-bind to
        // a const to keep the body of the switch readable.
        const failure = result;
        let message: string;
        switch (failure.reason) {
          case 'no_llm':
            message = 'Clarify 模型未初始化。请打开 Settings → AI Providers 检查当前模型是否已配置可用的 API Key,然后重试。';
            break;
          case 'aborted':
            message = '上一次的澄清请求还在生成中,已被新的请求取消。请稍候再试。';
            break;
          case 'empty':
            message = 'Clarify 模型未返回内容,可能是网络问题或上游限流。请稍后重试。';
            break;
          case 'error':
            message = `Clarify 请求失败:${failure.detail ?? '未知错误'}`;
            break;
        }
        console.warn('[IPC] generate-clarify failed:', failure.reason, failure.detail ?? '');
        const win = appState.getMainWindow();
        win?.webContents.send('intelligence-error', {
          error: message,
          mode: 'clarify',
        });
        return { clarification: null, reason: failure.reason };
      }
      return { clarification: result.clarification };
    } catch (error: any) {
      throw error;
    }
  });

  // Shared helper: validate, then run images through the vision-first ImageOptimizer
  // so downstream provider calls send compressed JPEG payloads instead of raw retina PNGs.
  // Falls back to the original paths if optimization fails — image input is more important
  // than payload size, so a Sharp failure must not block the request.
  async function optimizeImagesForVision(
    paths: string[],
    handlerLabel: string,
    profile: 'fast' | 'balanced' | 'technical' | 'best' = 'technical',
  ): Promise<string[]> {
    if (paths.length === 0) return paths;
    try {
      const { getImageOptimizer } = require('./services/screen/ImageOptimizer');
      const optimizer = getImageOptimizer();
      const optimized: string[] = [];
      for (const p of paths) {
        try {
          const out = await optimizer.optimize(p, { profile, provider: 'openai', cacheKey: p });
          optimized.push(out.path);
        } catch (err: any) {
          console.warn(
            `[IPC] ${handlerLabel}: image optimization failed for ${p}, using original`,
            { errorClass: err?.name },
          );
          optimized.push(p);
        }
      }
      return optimized;
    } catch {
      return paths;
    }
  }

  safeHandle('generate-code-hint', async (_, imagePaths?: string[], problemStatement?: string) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const screenshotQueue = appState.getScreenshotQueue();
      const resolvedImagePaths: string[] =
        imagePaths && imagePaths.length > 0 ? imagePaths : screenshotQueue;

      // SECURITY (P0): Validate image paths if provided from renderer
      if (imagePaths && imagePaths.length > 0) {
        const { app } = require('electron');
        const { validateImagePath } = require('./utils/curlUtils');
        const userDataDir = app.getPath('userData');

        for (const imagePath of imagePaths) {
          const validation = validateImagePath(imagePath, userDataDir);
          if (!validation.isValid) {
            console.warn(
              `[IPC] generate-code-hint: invalid image path rejected: ${validation.reason}`,
            );
            return { error: `Invalid image path: ${validation.reason}`, hint: null };
          }
        }
      }

      console.log(
        `[IPC] generate-code-hint: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'})`,
      );

      // VISION-FIRST: optimize the screenshot(s) with Sharp before they reach the LLM,
      // using the 'technical' profile so code text stays sharp at 1536px.
      const optimizedPaths = await optimizeImagesForVision(
        resolvedImagePaths,
        'generate-code-hint',
        'technical',
      );

      const intelligenceManager = appState.getIntelligenceManager();
      const hint = await intelligenceManager.runCodeHint(
        optimizedPaths.length > 0 ? optimizedPaths : undefined,
        problemStatement,
      );
      return { hint };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle('generate-brainstorm', async (_, imagePaths?: string[], problemStatement?: string) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const screenshotQueue = appState.getScreenshotQueue();
      const resolvedImagePaths: string[] =
        imagePaths && imagePaths.length > 0 ? imagePaths : screenshotQueue;

      // SECURITY (P0): Validate image paths if provided from renderer
      if (imagePaths && imagePaths.length > 0) {
        const { app } = require('electron');
        const { validateImagePath } = require('./utils/curlUtils');
        const userDataDir = app.getPath('userData');

        for (const imagePath of imagePaths) {
          const validation = validateImagePath(imagePath, userDataDir);
          if (!validation.isValid) {
            console.warn(
              `[IPC] generate-brainstorm: invalid image path rejected: ${validation.reason}`,
            );
            return { error: `Invalid image path: ${validation.reason}`, script: null };
          }
        }
      }

      console.log(
        `[IPC] generate-brainstorm: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'})`,
      );

      // VISION-FIRST: balanced profile (1280px) — brainstorm doesn't need code-sharp text.
      const optimizedPaths = await optimizeImagesForVision(
        resolvedImagePaths,
        'generate-brainstorm',
        'balanced',
      );

      const intelligenceManager = appState.getIntelligenceManager();
      const script = await intelligenceManager.runBrainstorm(
        optimizedPaths.length > 0 ? optimizedPaths : undefined,
        problemStatement,
      );
      return { script };
    } catch (error: any) {
      throw error;
    }
  });

  // Dynamic Action Button Mode (Recap vs Brainstorm)
  safeHandle('get-action-button-mode', () => {
    const { SettingsManager } = require('./services/SettingsManager');
    const sm = SettingsManager.getInstance();
    return sm.get('actionButtonMode') ?? 'recap';
  });

  safeHandle('set-action-button-mode', (_, mode: 'recap' | 'brainstorm') => {
    const { SettingsManager } = require('./services/SettingsManager');
    const sm = SettingsManager.getInstance();
    sm.set('actionButtonMode', mode);

    broadcast('action-button-mode-changed', mode);

    return { success: true };
  });

  // MODE 3: Recap (Summary)
  safeHandle('generate-recap', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const summary = await intelligenceManager.runRecap();
      return { summary };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 5: Manual Answer (Fallback)
  safeHandle('submit-manual-question', async (_, question: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.runManualAnswer(question);
      return { answer, question };
    } catch (error: any) {
      throw error;
    }
  });

  // Get current intelligence context
  safeHandle('get-intelligence-context', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      return {
        context: intelligenceManager.getFormattedContext(),
        lastAssistantMessage: intelligenceManager.getLastAssistantMessage(),
        activeMode: intelligenceManager.getActiveMode(),
      };
    } catch (error: any) {
      throw error;
    }
  });

  // Reset intelligence state
  safeHandle('reset-intelligence', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.reset();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Phase 3 — Dynamic Actions IPC. Accept/dismiss/list. The action emission
  // direction is push-only (intelligence-dynamic-action channel from main →
  // renderer); these handlers are the renderer → main control plane.
  safeHandle('dynamic-action:accept', async (_, actionId: string) => {
    try {
      if (typeof actionId !== 'string' || !actionId) {
        return { success: false, error: 'invalid_action_id' };
      }
      const intelligenceManager = appState.getIntelligenceManager();
      const action = intelligenceManager.acceptDynamicAction(actionId);
      if (!action) return { success: false, error: 'not_found' };
      // Phase 6 — telemetry on accept (no transcript, no evidence body).
      try {
        const { telemetryService } = require('./services/telemetry/TelemetryService');
        telemetryService.track({
          name: 'dynamic_action_accepted',
          sessionId: action.sessionId,
          modeId: action.modeId,
          properties: {
            actionId: action.id,
            actionType: action.type,
            modeTemplateType: action.modeTemplateType,
          },
        });
      } catch {
        /* non-fatal */
      }
      // Caller (renderer) is expected to follow up with a normal Ask-AI call
      // using action.promptInstruction. We return the action so the renderer
      // can populate the answer prompt without a second round-trip.
      return { success: true, action };
    } catch (error: any) {
      return { success: false, error: error?.message ?? 'internal_error' };
    }
  });

  safeHandle('dynamic-action:dismiss', async (_, actionId: string) => {
    try {
      if (typeof actionId !== 'string' || !actionId) {
        return { success: false, error: 'invalid_action_id' };
      }
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.dismissDynamicAction(actionId);
      // Phase 6 — telemetry on dismiss.
      try {
        const { telemetryService } = require('./services/telemetry/TelemetryService');
        telemetryService.track({ name: 'dynamic_action_dismissed', properties: { actionId } });
      } catch {
        /* non-fatal */
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message ?? 'internal_error' };
    }
  });

  safeHandle('dynamic-action:list', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      return { success: true, actions: intelligenceManager.getActiveDynamicActions() };
    } catch (error: any) {
      return { success: false, error: error?.message ?? 'internal_error', actions: [] };
    }
  });

  safeHandle(
    'test-inject-transcript',
    async (_, segment: { speaker: string; text: string; timestamp?: number; final?: boolean }) => {
      try {
        if (process.env.NODE_ENV !== 'test') return { success: false, error: 'test_only' };
        const intelligenceManager = appState.getIntelligenceManager();
        intelligenceManager.addTranscript(
          {
            speaker: segment.speaker,
            text: segment.text,
            timestamp: segment.timestamp ?? Date.now(),
            final: segment.final ?? true,
          },
          true,
        );
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  );

  safeHandle('test-get-mode-context', async () => {
    try {
      if (process.env.NODE_ENV !== 'test') return { success: false, error: 'test_only' };
      const { ModesManager } = require('./services/ModesManager');
      const manager = ModesManager.getInstance();
      return {
        success: true,
        block: manager.buildActiveModeContextBlock(),
        suffix: manager.getActiveModeSystemPromptSuffix(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Service Account Selection
  safeHandle('select-service-account', async () => {
    try {
      const result: any = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }

      const filePath = result.filePaths[0];

      // Update backend state immediately
      appState.updateGoogleCredentials(filePath);

      // Persist the path for future sessions
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGoogleServiceAccountPath(filePath);

      return { success: true, path: filePath };
    } catch (error: any) {
      console.error('Error selecting service account:', error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Theme System Handlers
  // ==========================================

  safeHandle('theme:get-mode', () => {
    const tm = appState.getThemeManager();
    return {
      mode: tm.getMode(),
      resolved: tm.getResolvedTheme(),
    };
  });

  safeHandle('theme:set-mode', (_, mode: 'system' | 'light' | 'dark') => {
    appState.getThemeManager().setMode(mode);
    return { success: true };
  });

  // ==========================================
  // RAG (Retrieval-Augmented Generation) Handlers
  // ==========================================

  // Store active query abort controllers for cancellation
  const activeRAGQueries = new Map<string, AbortController>();

  // Query meeting with RAG (meeting-scoped)
  safeHandle(
    'rag:query-meeting',
    async (event, { meetingId, query }: { meetingId: string; query: string }) => {
      const ragManager = appState.getRAGManager();

      if (!ragManager || !ragManager.isReady()) {
        // Fallback to regular chat if RAG not available
        console.log('[RAG] Not ready, falling back to regular chat');
        return { fallback: true };
      }

      // For completed meetings, check if post-meeting RAG is processed.
      // For live meetings with JIT indexing, let RAGManager.queryMeeting() decide.
      if (
        !ragManager.isMeetingProcessed(meetingId) &&
        !ragManager.isLiveIndexingActive(meetingId)
      ) {
        console.log(
          `[RAG] Meeting ${meetingId} not processed and no JIT indexing, falling back to regular chat`,
        );
        return { fallback: true };
      }

      const abortController = new AbortController();
      const queryKey = `meeting-${meetingId}`;
      activeRAGQueries.set(queryKey, abortController);

      try {
        const stream = ragManager.queryMeeting(meetingId, query, abortController.signal);

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;
          event.sender.send('rag:stream-chunk', { meetingId, chunk });
        }

        event.sender.send('rag:stream-complete', { meetingId });
        return { success: true };
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          const msg = error.message || '';
          // If specific RAG failures, return fallback to use transcript window
          if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
            console.log(`[RAG] Query failed with '${msg}', falling back to regular chat`);
            return { fallback: true };
          }

          console.error('[RAG] Query error:', error);
          event.sender.send('rag:stream-error', { meetingId, error: msg });
        }
        return { success: false, error: error.message };
      } finally {
        activeRAGQueries.delete(queryKey);
      }
    },
  );

  // Query live meeting with JIT RAG
  safeHandle('rag:query-live', async (event, { query }: { query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }

    // Check if JIT indexing is active AND has at least one embedded chunk.
    // isLiveIndexingActive() only tells us the indexer is running — it may have
    // received segments but not yet produced queryable embeddings. Calling
    // queryMeeting() with zero chunks throws NO_MEETING_EMBEDDINGS, adding
    // ~300ms of wasted try/catch overhead before the fallback fires.
    if (!ragManager.isLiveIndexingActive('live-meeting-current') || !ragManager.hasLiveChunks()) {
      return { fallback: true };
    }

    const abortController = new AbortController();
    // Date.now() alone collides when two queries fire in the same ms — the
    // second `set` would overwrite the first AbortController, the first
    // stream would become un-cancellable, and the `finally` `delete` would
    // evict the wrong entry. UUID guarantees uniqueness.
    // (Note: rag:cancel-query only matches `meeting-` and `global` prefixes,
    // so `live-` keys aren't cancellable through that path — pre-existing
    // behaviour, not regressed by this change.)
    const queryKey = `live-${crypto.randomUUID()}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryMeeting('live-meeting-current', query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send('rag:stream-chunk', { live: true, chunk });
      }

      event.sender.send('rag:stream-complete', { live: true });
      return { success: true };
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || '';
        // If JIT RAG failed (no embeddings yet, no relevant context), fallback to regular chat
        if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
          console.log(`[RAG] JIT query failed with '${msg}', falling back to regular live chat`);
          return { fallback: true };
        }
        console.error('[RAG] Live query error:', error);
        event.sender.send('rag:stream-error', { live: true, error: msg });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Query global (cross-meeting search)
  safeHandle('rag:query-global', async (event, { query }: { query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }

    const abortController = new AbortController();
    // See live-${...} comment above for why Date.now() alone is unsafe.
    const queryKey = `global-${crypto.randomUUID()}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryGlobal(query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send('rag:stream-chunk', { global: true, chunk });
      }

      event.sender.send('rag:stream-complete', { global: true });
      return { success: true };
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        event.sender.send('rag:stream-error', { global: true, error: error.message });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Cancel active RAG query
  safeHandle(
    'rag:cancel-query',
    async (_, { meetingId, global }: { meetingId?: string; global?: boolean }) => {
      const queryKey = global ? 'global' : `meeting-${meetingId}`;

      // Cancel any matching key
      for (const [key, controller] of activeRAGQueries) {
        if (key.startsWith(queryKey) || (global && key.startsWith('global'))) {
          controller.abort();
          activeRAGQueries.delete(key);
        }
      }

      return { success: true };
    },
  );

  // Check if meeting has RAG embeddings
  safeHandle('rag:is-meeting-processed', async (_, meetingId: string) => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      return ragManager.isMeetingProcessed(meetingId);
    } catch (error: any) {
      console.error('[IPC rag:is-meeting-processed] Error:', error);
      return false;
    }
  });

  safeHandle('rag:reindex-incompatible-meetings', async () => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      await ragManager.reindexIncompatibleMeetings();
      return { success: true };
    } catch (error: any) {
      console.error('[IPC rag:reindex-incompatible-meetings] Error:', error);
      return { success: false, error: error.message };
    }
  });

  // Get RAG queue status
  safeHandle('rag:get-queue-status', async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { pending: 0, processing: 0, completed: 0, failed: 0 };
    return ragManager.getQueueStatus();
  });

  // Retry pending embeddings
  safeHandle('rag:retry-embeddings', async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { success: false };
    await ragManager.retryPendingEmbeddings();
    return { success: true };
  });

  safeHandle('track-answer-quality-event', async (_, input: {
    answerId: string;
    eventType: 'shown' | 'copied' | 'accepted' | 'ignored' | 'regenerated';
    surface?: string;
    metadata?: Record<string, unknown>;
  }) => {
    if (!input?.answerId || !input?.eventType) {
      return { success: false, error: 'invalid_quality_event' };
    }
    return DatabaseManager.getInstance().trackAnswerQualityEvent(input);
  });

  safeHandle('get-context-health', async () => {
    const ragManager = appState.getRAGManager();
    const db = DatabaseManager.getInstance();
    const { KnowledgeMaterialService } = require('./services/knowledge/KnowledgeMaterialService');
    const materialService = new KnowledgeMaterialService(db, ragManager?.getEmbeddingPipeline?.());
    const ragQueue = ragManager?.getQueueStatus?.() ?? { pending: 0, processing: 0, completed: 0, failed: 0 };
    const materialHealth = materialService.getHealth();
    return {
      ragReady: Boolean(ragManager?.isReady?.()),
      embeddingReady: Boolean(ragManager?.getEmbeddingPipeline?.().isReady?.()),
      ragQueue,
      materialCount: materialHealth.materialCount,
      materialQueue: materialHealth.queue,
    };
  });

  safeHandle('knowledge:select-materials', async () => {
    try {
      const result: any = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '资料文件', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown'] }],
      });
      if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
      return { success: true, filePaths: result.filePaths };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('knowledge:upload-materials', async (_, filePaths: string[]) => {
    try {
      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        return { success: false, materials: [], errors: [{ filePath: '', error: 'no_files_selected' }] };
      }
      const ragManager = appState.getRAGManager();
      const { KnowledgeMaterialService } = require('./services/knowledge/KnowledgeMaterialService');
      const service = new KnowledgeMaterialService(DatabaseManager.getInstance(), ragManager?.getEmbeddingPipeline?.());
      const result = await service.uploadFiles(filePaths);
      return { success: result.materials.length > 0, ...result };
    } catch (error: any) {
      return { success: false, materials: [], errors: [{ filePath: '', error: error.message || 'unknown_error' }] };
    }
  });

  safeHandle('knowledge:list-materials', async () => {
    try {
      const { KnowledgeMaterialService } = require('./services/knowledge/KnowledgeMaterialService');
      const service = new KnowledgeMaterialService(DatabaseManager.getInstance(), appState.getRAGManager()?.getEmbeddingPipeline?.());
      return { success: true, materials: service.listMaterials() };
    } catch (error: any) {
      return { success: false, materials: [], error: error.message };
    }
  });

  safeHandle('knowledge:delete-material', async (_, id: string) => {
    try {
      const { KnowledgeMaterialService } = require('./services/knowledge/KnowledgeMaterialService');
      const service = new KnowledgeMaterialService(DatabaseManager.getInstance(), appState.getRAGManager()?.getEmbeddingPipeline?.());
      service.deleteMaterial(id);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('knowledge:reindex-material', async (_, id: string) => {
    try {
      const { KnowledgeMaterialService } = require('./services/knowledge/KnowledgeMaterialService');
      const service = new KnowledgeMaterialService(DatabaseManager.getInstance(), appState.getRAGManager()?.getEmbeddingPipeline?.());
      const material = await service.reindexMaterial(id);
      return { success: true, material };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Profile Engine IPC Handlers
  // ==========================================

  safeHandle('profile:upload-resume', async (_, filePath: string) => {
    try {
      console.log(`[IPC] profile:upload-resume called with: ${filePath}`);
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return {
          success: false,
          error: 'Knowledge engine not initialized. Please ensure API keys are configured.',
        };
      }
      const { DocType } = require('./services/profile/types');
      const result = await orchestrator.ingestDocument(filePath, DocType.RESUME);
      return result;
    } catch (error: any) {
      console.error('[IPC] profile:upload-resume error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:get-status', async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { hasProfile: false, profileMode: false };
      }
      // Map new KnowledgeStatus back to legacy UI shape temporarily
      const status = orchestrator.getStatus();
      return {
        hasProfile: status.hasResume,
        profileMode: status.activeMode,
        name: status.resumeSummary?.name,
        role: status.resumeSummary?.role,
        totalExperienceYears: status.resumeSummary?.totalExperienceYears,
      };
    } catch (error: any) {
      return { hasProfile: false, profileMode: false };
    }
  });

  safeHandle('profile:set-mode', async (_, enabled: boolean) => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      orchestrator.setKnowledgeMode(enabled);

      const { SettingsManager } = require('./services/SettingsManager');
      SettingsManager.getInstance().set('knowledgeMode', enabled);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:delete', async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const { DocType } = require('./services/profile/types');
      orchestrator.deleteDocumentsByType(DocType.RESUME);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:get-profile', async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return null;
      return orchestrator.getProfileData();
    } catch (error: any) {
      return null;
    }
  });

  safeHandle('profile:select-file', async () => {
    try {
      const result: any = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: '简历文件', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown'] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { cancelled: true };
      }

      return { success: true, filePath: result.filePaths[0] };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:get-active-scenario', async () => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const { ScenarioRegistry } = require('./services/profile/scenarios/registry');
      const modesManager = ModesManager.getInstance();
      modesManager.ensureSeeded?.();
      const mode = modesManager.getActiveMode()
        ?? modesManager.getModes().find((candidate: any) => candidate.templateType === 'general');
      const registry = ScenarioRegistry.createDefault();
      const resolution = registry.resolveByTemplateType(mode?.templateType);
      const adapter = registry.get(resolution.scenarioType);
      return {
        success: true,
        scenario: {
          ...resolution,
          modeId: mode?.id ?? null,
          modeName: mode?.name ?? adapter.label,
          displayName: adapter.label,
          supportedDocSubtypes: adapter.supportedDocSubtypes,
          cards: adapter.cards,
          adapter: {
            label: adapter.label,
            supportedDocSubtypes: adapter.supportedDocSubtypes,
            cards: adapter.cards,
          },
        },
      };
    } catch (error: any) {
      console.error('[IPC] profile:get-active-scenario error:', redactForLog([error]));
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:list-documents', async (_, params?: { modeId?: string }) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const modesManager = ModesManager.getInstance();
      modesManager.ensureSeeded?.();
      const mode = params?.modeId
        ? modesManager.getModes().find((m: any) => m.id === params.modeId)
        : modesManager.getActiveMode()
          ?? modesManager.getModes().find((candidate: any) => candidate.templateType === 'general');
      if (!mode) return { success: true, documents: [] };
      const db = DatabaseManager.getInstance();
      const metadataRows = db.getModeReferenceFileMetadataForMode(mode.id);
      const metadataByFileId = new Map(metadataRows.map((row: any) => [row.reference_file_id, row]));
      const documents = modesManager.getReferenceFiles(mode.id).map((file: any) => {
        const metadata = metadataByFileId.get(file.id) ?? null;
        return {
          ...file,
          metadata,
          scenarioType: metadata?.scenario_type,
          scenario_type: metadata?.scenario_type,
          docSubtype: metadata?.doc_subtype,
          doc_subtype: metadata?.doc_subtype,
        };
      });
      return { success: true, documents };
    } catch (error: any) {
      console.error('[IPC] profile:list-documents error:', redactForLog([error]));
      return { success: false, documents: [], error: error.message };
    }
  });

  safeHandle('profile:upload-document', async (_, params: { filePath: string; docSubtype: string }) => {
    try {
      if (!params?.filePath || !params?.docSubtype) {
        return { success: false, error: 'invalid_document_upload' };
      }
      const { ModesManager } = require('./services/ModesManager');
      const { ScenarioRegistry } = require('./services/profile/scenarios/registry');
      const { DocumentTextExtractor } = require('./services/profile/DocumentTextExtractor');
      const modesManager = ModesManager.getInstance();
      modesManager.ensureSeeded?.();
      const mode = modesManager.getActiveMode()
        ?? modesManager.getModes().find((candidate: any) => candidate.templateType === 'general');
      if (!mode) return { success: false, error: 'No active mode selected' };
      const rawText = await DocumentTextExtractor.extract(params.filePath);
      const fileName = path.basename(params.filePath);
      const added = modesManager.addReferenceFile({ modeId: mode.id, fileName, content: rawText });
      const referenceFileId = added.id;
      const registry = ScenarioRegistry.createDefault();
      const resolution = registry.resolveByTemplateType(mode.templateType);

      let parsedJson: string | undefined;
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper) {
        try {
          const extractor = new CompanyNameExtractor(new ParserLLM(llmHelper));
          const companyName = await extractor.extract(rawText, params.docSubtype);
          if (companyName) {
            parsedJson = JSON.stringify({ companyName });
          }
        } catch (extractionError: any) {
          console.warn('[IPC] profile:upload-document company extraction failed:', extractionError.message);
        }
      }

      DatabaseManager.getInstance().upsertModeReferenceFileMetadata({
        referenceFileId,
        scenarioType: resolution.scenarioType,
        docSubtype: params.docSubtype,
        fileHash: crypto.createHash('sha256').update(rawText).digest('hex'),
        parsedJson,
      });
      return { success: true, id: referenceFileId };
    } catch (error: any) {
      console.error('[IPC] profile:upload-document error:', redactForLog([error]));
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:update-document-subtype', async (_, params: { referenceFileId: string; docSubtype: string }) => {
    try {
      if (!params?.referenceFileId || !params?.docSubtype) {
        return { success: false, error: 'invalid_document_metadata' };
      }
      const { ModesManager } = require('./services/ModesManager');
      const { ScenarioRegistry } = require('./services/profile/scenarios/registry');
      const modesManager = ModesManager.getInstance();
      modesManager.ensureSeeded?.();
      const mode = modesManager.getActiveMode()
        ?? modesManager.getModes().find((candidate: any) => candidate.templateType === 'general');
      if (!mode) return { success: false, error: 'No active mode selected' };
      const resolution = ScenarioRegistry.createDefault().resolveByTemplateType(mode.templateType);
      DatabaseManager.getInstance().upsertModeReferenceFileMetadata({
        referenceFileId: params.referenceFileId,
        scenarioType: resolution.scenarioType,
        docSubtype: params.docSubtype,
      });
      return { success: true };
    } catch (error: any) {
      console.error('[IPC] profile:update-document-subtype error:', redactForLog([error]));
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:delete-document', async (_, params: { referenceFileId: string }) => {
    try {
      if (!params?.referenceFileId) return { success: false, error: 'invalid_reference_file' };
      const { ModesManager } = require('./services/ModesManager');
      ModesManager.getInstance().deleteReferenceFile(params.referenceFileId);
      return { success: true };
    } catch (error: any) {
      console.error('[IPC] profile:delete-document error:', redactForLog([error]));
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:get-master-profile', async () => {
    try {
      return { success: true, profile: DatabaseManager.getInstance().getProfileMaster() };
    } catch (error: any) {
      console.error('[IPC] profile:get-master-profile error:', redactForLog([error]));
      return { success: false, profile: null, error: error.message };
    }
  });

  safeHandle('profile:update-master-profile', async (_, profile: any) => {
    try {
      DatabaseManager.getInstance().updateProfileMaster({
        displayName: profile?.displayName ?? null,
        headline: profile?.headline ?? null,
        summary: typeof profile?.summary === 'string' ? profile.summary.slice(0, 4000) : '',
        contactInfoJson: JSON.stringify(profile?.contactInfo ?? {}),
        experienceJson: JSON.stringify(Array.isArray(profile?.experience) ? profile.experience : []),
        skillsJson: JSON.stringify(Array.isArray(profile?.skills) ? profile.skills : []),
      });
      return { success: true };
    } catch (error: any) {
      console.error('[IPC] profile:update-master-profile error:', redactForLog([error]));
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // JD & Research IPC Handlers
  // ==========================================

  safeHandle('profile:upload-jd', async (_, filePath: string) => {
    try {
      console.log(`[IPC] profile:upload-jd called with: ${filePath}`);
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return {
          success: false,
          error: 'Knowledge engine not initialized. Please ensure API keys are configured.',
        };
      }
      const { DocType } = require('./services/profile/types');
      const result = await orchestrator.ingestDocument(filePath, DocType.JD);
      return result;
    } catch (error: any) {
      console.error('[IPC] profile:upload-jd error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:delete-jd', async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const { DocType } = require('./services/profile/types');
      orchestrator.deleteDocumentsByType(DocType.JD);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:clear-research-cache', async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, deleted: 0, error: 'Knowledge engine not initialized' };
      }
      const engine = orchestrator.getCompanyResearchEngine();
      const deleted = await engine.clearCache();
      return { success: true, deleted };
    } catch (error: any) {
      console.error('[ipcHandlers] profile:clear-research-cache failed:', redactForLog([error]));
      return { success: false, deleted: 0, error: error?.message ?? 'unknown error' };
    }
  });

  safeHandle('profile:test-tavily-key', async (_: unknown, key: string) => {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, query: 'test', max_results: 1 }),
      });
      if (res.status === 401 || res.status === 403) {
        return { valid: false, reason: 'invalid_key' };
      }
      if (res.status === 429) return { valid: true, quotaLow: true };
      return { valid: res.ok };
    } catch (err: any) {
      return { valid: false, reason: 'network_error', message: err?.message };
    }
  });

  safeHandle(
    'profile:research-company',
    async (
      _: unknown,
      companyName: string,
      options: { forceRefresh?: boolean; requestId?: string } = {},
    ) => {
      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (!orchestrator) {
          return {
            success: false,
            errorCode: 'DB_ERROR',
            error: 'Knowledge engine not initialized',
          };
        }

        const { requestId } = options;
        const onProgress = requestId
          ? (p: ResearchProgress) => {
              broadcast('research-progress-changed', {
                requestId,
                stage: p.stage,
                message: p.message,
              });
            }
          : undefined;

        return await orchestrator.runCompanyResearch(companyName, {
          ...options,
          onProgress,
        });
      } catch (err: any) {
        console.error('[ipcHandlers] profile:research-company failed:', redactForLog([err]));
        if (err instanceof LlmInvalidFormatError) {
          return {
            success: false,
            errorCode: 'LLM_INVALID_FORMAT',
            error: err?.message ?? 'AI 返回的报告格式不正确',
          };
        }
        return {
          success: false,
          errorCode: 'DB_ERROR',
          error: 'Internal error: ' + (err?.message ?? 'unknown'),
        };
      }
    },
  );

  safeHandle('profile:generate-negotiation', async (_: unknown, _force: boolean = false) => {
    // On-demand negotiation script generation is not yet implemented.
    return {
      success: false,
      error:
        'Negotiation script generation is not yet available. This feature is queued for a future release.',
    };
  });

  safeHandle('profile:get-negotiation-state', async () => {
    // Negotiation tracker is not yet implemented.
    return {
      success: false,
      state: null,
      isActive: false,
      error:
        'Negotiation tracking is not yet available. This feature is queued for a future release.',
    };
  });

  safeHandle('profile:reset-negotiation', async () => {
    // Negotiation session reset is a no-op while the tracker is not
    // implemented. Return success so the renderer can clear any local state.
    return { success: true };
  });

  // ==========================================
  // Profile Custom Notes
  // ==========================================

  safeHandle('profile:get-notes', async () => {
    try {
      const content = DatabaseManager.getInstance().getCustomNotes();
      return { success: true, content };
    } catch (error: any) {
      return { success: false, content: '', error: error.message };
    }
  });

  safeHandle('profile:save-notes', async (_, content: string) => {
    try {
      // Enforce a max length of 4000 chars to prevent prompt bloat
      const trimmed = typeof content === 'string' ? content.slice(0, 4000) : '';
      DatabaseManager.getInstance().saveCustomNotes(trimmed);

      // Propagate to orchestrator (premium path) and LLMHelper (all-provider path)
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (orchestrator?.setCustomNotes) orchestrator.setCustomNotes(trimmed);

      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper?.setCustomNotes) llmHelper.setCustomNotes(trimmed);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:get-persona', async () => {
    try {
      const content = DatabaseManager.getInstance().getPersona();
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper?.setPersonaPrompt) llmHelper.setPersonaPrompt(content);
      return { success: true, content };
    } catch (error: any) {
      return { success: false, content: '', error: error.message };
    }
  });

  safeHandle('profile:save-persona', async (_, content: string) => {
    try {
      if (typeof content !== 'string') return { success: false, error: 'invalid_persona' };
      const trimmed = content.trim().slice(0, 4000);
      DatabaseManager.getInstance().savePersona(trimmed);

      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper?.setPersonaPrompt) llmHelper.setPersonaPrompt(trimmed);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Tavily Search API Credentials
  // ==========================================

  safeHandle('set-tavily-api-key', async (_, apiKey: string) => {
    try {
      if (apiKey && !apiKey.startsWith('tvly-')) {
        return { success: false, error: 'Invalid Tavily API key. Keys must start with "tvly-".' };
      }
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setTavilyApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Overlay Opacity (Stealth Mode)
  // ==========================================

  safeHandle('set-overlay-opacity', async (_, opacity: number) => {
    // Clamp to valid range
    const clamped = Math.min(1.0, Math.max(0.35, opacity));
    // Broadcast to all renderer windows so the overlay picks it up in real-time
    broadcast('overlay-opacity-changed', clamped);
  });

  // ── Permissions ──────────────────────────────────────────────
  safeHandle('permissions:check', async () => {
    if (process.platform === 'darwin') {
      const mic = systemPreferences.getMediaAccessStatus('microphone');
      const screen = systemPreferences.getMediaAccessStatus('screen');
      const screenHealth = await resolveMacScreenPermissionHealth('permissions ipc check');
      const systemAudioHealth = await resolveMacSystemAudioPermissionHealth('permissions ipc check');
      const microphoneHealth = resolveMacMicrophonePermissionHealth();
      return { microphone: mic, screen, platform: 'darwin', screenHealth, systemAudioHealth, microphoneHealth };
    }
    // Windows/Linux: no TCC — permissions handled by OS at install/first-use time
    return {
      microphone: 'granted',
      screen: 'granted',
      platform: process.platform,
      screenHealth: await resolveMacScreenPermissionHealth('permissions ipc check'),
      systemAudioHealth: await resolveMacSystemAudioPermissionHealth('permissions ipc check'),
      microphoneHealth: resolveMacMicrophonePermissionHealth(),
    };
  });

  safeHandle('permissions:request-mic', async () => {
    if (process.platform !== 'darwin') return true;
    try {
      return await systemPreferences.askForMediaAccess('microphone');
    } catch {
      return false;
    }
  });

  safeHandle('permissions:repair-tcc', async (_, scope: 'screen' | 'microphone' | 'both') => {
    const bundleId = process.platform === 'darwin' ? resolveMacBundleIdentifier() : null;
    const commandsPreview =
      bundleId && process.platform === 'darwin'
        ? [
            ...(scope === 'screen' || scope === 'both'
              ? [`tccutil reset ScreenCapture ${bundleId}`, `tccutil reset AudioCapture ${bundleId}`]
              : []),
            ...(scope === 'microphone' || scope === 'both'
              ? [`tccutil reset Microphone ${bundleId}`]
              : []),
          ]
        : [];
    const result = await repairMacTccPermissions(scope);
    return {
      ...result,
      bundleId: result.bundleId || bundleId,
      commandsPreview,
    };
  });

  safeHandle('permissions:restart-after-repair', async () => {
    app.relaunch();
    setImmediate(() => app.exit(0));
    return { success: true };
  });

  // ==========================================
  // Modes IPC Handlers
  // ==========================================

  safeHandle('modes:get-all', async () => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      mgr.ensureSeeded();
      const modes = mgr.getModes();
      // Attach reference file counts
      return modes.map((m: any) => ({
        ...m,
        referenceFileCount: mgr.getReferenceFiles(m.id).length,
      }));
    } catch (e: any) {
      console.error('[IPC] modes:get-all error:', e);
      return [];
    }
  });

  safeHandle('modes:get-active', async () => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      return ModesManager.getInstance().getActiveMode();
    } catch (e: any) {
      console.error('[IPC] modes:get-active error:', e);
      return null;
    }
  });

  safeHandle('modes:create', async (_, params: { name: string; templateType: string }) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mode = ModesManager.getInstance().createMode({
        name: params.name,
        templateType: params.templateType as any,
      });
      return { success: true, mode };
    } catch (e: any) {
      console.error('[IPC] modes:create error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle(
    'modes:update',
    async (
      _,
      id: string,
      updates: { name?: string; templateType?: string; customContext?: string; intentKeywords?: Array<{ intent: any; keywordsCsv: string }> },
    ) => {
      try {
        const { ModesManager } = require('./services/ModesManager');
        const mgr = ModesManager.getInstance();
        mgr.updateMode(id, updates);
        return { success: true };
      } catch (e: any) {
        console.error('[IPC] modes:update error:', e);
        return { success: false, error: e.message };
      }
    },
  );

  safeHandle('modes:reset-intent-keywords', async (_, id: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const intentKeywords = ModesManager.getInstance().resetModeIntentKeywords(id);
      return { success: true, intentKeywords };
    } catch (e: any) {
      console.error('[IPC] modes:reset-intent-keywords error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle('modes:delete', async (_, id: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      ModesManager.getInstance().deleteMode(id);
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] modes:delete error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle('modes:set-active', async (_, id: string | null) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      // BUG-MODE-BLEEDING fix: clear mode-specific session context BEFORE switching modes
      // so Interview mode resume/JD context doesn't bleed into the new mode's responses.
      try {
        const appStateIntMgr = appState.getIntelligenceManager();
        if (appStateIntMgr) appStateIntMgr.clearSessionContext();
      } catch {
        /* non-fatal — session may not exist during startup */
      }

      ModesManager.getInstance().setActiveMode(id);
      // Broadcast mode change to all windows so indicators update immediately
      const activeMode = id ? ModesManager.getInstance().getActiveMode() : null;
      const activeName = activeMode?.name ?? null;
      broadcast('mode-changed', { id, name: activeName });
      // Phase 3 — re-bind dynamic action engine so the new mode's trigger pack
      // takes effect immediately. New (sessionId, modeId) pair flushes the per-
      // session store inside DynamicActionEngine, killing any old-mode candidates.
      try {
        const appStateIntMgr = appState.getIntelligenceManager();
        if (appStateIntMgr && activeMode) {
          appStateIntMgr.setDynamicActionContext({
            sessionId: `session_${crypto.randomUUID()}`,
            modeId: activeMode.id,
            modeTemplateType: activeMode.templateType,
          });
        } else if (appStateIntMgr && !id) {
          appStateIntMgr.clearDynamicActionContext();
        }
      } catch {
        /* non-fatal */
      }
      // Phase 6 — mode_switched telemetry (no PII).
      try {
        const { telemetryService } = require('./services/telemetry/TelemetryService');
        telemetryService.track({
          name: 'mode_switched',
          modeId: activeMode?.id,
          properties: { modeTemplateType: activeMode?.templateType, cleared: !id },
        });
      } catch {
        /* non-fatal */
      }
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] modes:set-active error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle('modes:get-reference-files', async (_, modeId: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      return ModesManager.getInstance().getReferenceFiles(modeId);
    } catch (e: any) {
      console.error('[IPC] modes:get-reference-files error:', e);
      return [];
    }
  });

  safeHandle('modes:upload-reference-file', async (_, modeId: string) => {
    try {
      // Server-side allow-list. The dialog filter is a hint to users — never
      // trust it for validation, since the user can rename a file or the
      // filter can be bypassed by selecting "All Files" in the dialog UI.
      // Plain-text formats parse trivially; PDF and DOCX go through their
      // dedicated parsers below.
      const ALLOWED_EXTENSIONS = new Set([
        '.txt',
        '.md',
        '.markdown',
        '.json',
        '.csv',
        '.tsv',
        '.xml',
        '.html',
        '.htm',
        '.log',
        '.pdf',
        '.docx',
        '.doc',
      ]);
      // 10 MiB per file. Anything larger is almost always a database dump,
      // a media file, or a misclicked archive; the modes layer would just
      // truncate it to ~40 KB anyway via MAX_TOTAL_CHARS.
      const MAX_FILE_BYTES = 10 * 1024 * 1024;

      const result: any = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          {
            name: 'Text & Documents',
            extensions: ['txt', 'md', 'json', 'csv', 'xml', 'html', 'pdf', 'docx', 'doc'],
          },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePaths.length) {
        return { success: false, cancelled: true };
      }
      const filePath = result.filePaths[0];
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();

      if (!ALLOWED_EXTENSIONS.has(ext)) {
        // Friendly, actionable message — UI surfaces this to the user.
        return {
          success: false,
          error: `Unsupported file type "${ext || 'none'}". Supported formats: TXT, MD, JSON, CSV, XML, HTML, LOG, PDF, DOCX, DOC. For resumes and job descriptions, use Profile Intelligence under Settings instead.`,
        };
      }

      // Pre-flight stat. Use lstat so we don't auto-follow symlinks — a
      // symlink to /dev/zero or a network mount that lies about size would
      // otherwise hang the renderer-IPC reply forever via readFileSync.
      let stats: ReturnType<typeof fs.lstatSync>;
      try {
        stats = fs.lstatSync(filePath);
      } catch {
        return {
          success: false,
          error: 'Could not read the selected file. It may have moved or been deleted.',
        };
      }
      if (!stats.isFile()) {
        return {
          success: false,
          error:
            'Selected path is not a regular file (it may be a symlink, device, or directory). Pick a real document file.',
        };
      }
      if (stats.size > MAX_FILE_BYTES) {
        const mb = (stats.size / (1024 * 1024)).toFixed(1);
        return {
          success: false,
          error: `File is ${mb} MB; the maximum is 10 MB. Trim the file or split it into smaller reference documents.`,
        };
      }

      // Wrap the parser branches in a per-call timeout. pdf-parse and mammoth
      // have both hung historically on malformed input or zip-bomb DOCX —
      // 15 s is generous for a 10 MiB document.
      const PARSE_TIMEOUT_MS = 15_000;
      function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
        return Promise.race([
          p,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
          ),
        ]);
      }

      let content = '';
      try {
        if (ext === '.pdf') {
          const { PDFParse } = require('pdf-parse');
          const buffer = fs.readFileSync(filePath);
          const parser = new PDFParse({ data: buffer });
          const data: any = await withTimeout<any>(parser.getText(), PARSE_TIMEOUT_MS, 'PDF parse');
          content = data.text;
        } else if (ext === '.docx' || ext === '.doc') {
          const mammoth = require('mammoth');
          const result2: any = await withTimeout<any>(
            mammoth.extractRawText({ path: filePath }),
            PARSE_TIMEOUT_MS,
            'DOCX parse',
          );
          content = result2.value;
        } else {
          // Plain-text family. Read raw bytes first so we can detect text
          // encoding from a leading byte-order-mark before deciding whether
          // a null byte is binary noise or a legitimate UTF-16 zero-pad.
          const probe = fs.readFileSync(filePath, { encoding: null });
          if (probe.length === 0) {
            return { success: false, error: `"${fileName}" is empty.` };
          }
          // BOM-aware decode. UTF-16 files have many embedded null bytes; we
          // must NOT treat those as a binary-rename signal.
          if (probe.length >= 2 && probe[0] === 0xff && probe[1] === 0xfe) {
            content = probe.subarray(2).toString('utf16le');
          } else if (probe.length >= 2 && probe[0] === 0xfe && probe[1] === 0xff) {
            // UTF-16 BE → swap pairs then decode as utf16le.
            const swapped = Buffer.allocUnsafe(probe.length - 2);
            for (let i = 2; i + 1 < probe.length; i += 2) {
              swapped[i - 2] = probe[i + 1];
              swapped[i - 1] = probe[i];
            }
            content = swapped.toString('utf16le');
          } else if (
            probe.length >= 3 &&
            probe[0] === 0xef &&
            probe[1] === 0xbb &&
            probe[2] === 0xbf
          ) {
            content = probe.subarray(3).toString('utf8');
          } else {
            // No BOM. Sniff the first 2 KiB for a null byte — that's the
            // strongest signal of a renamed binary.
            const sniffWindow = probe.subarray(0, Math.min(2048, probe.length));
            if (sniffWindow.includes(0)) {
              return {
                success: false,
                error: `"${fileName}" looks like a binary file even though its extension is ${ext}. Re-save the file as plain text or pick a supported document format.`,
              };
            }
            content = probe.toString('utf8');
          }
        }
      } catch (parseErr: any) {
        // Parser-specific failures (timeout, malformed PDF, zip-bomb DOCX).
        // Log detail to main-process; return a generic message.
        console.error(
          '[IPC] modes:upload-reference-file parser error:',
          parseErr?.message ?? parseErr,
        );
        return {
          success: false,
          error: `Could not parse "${fileName}". The file may be corrupt, password-protected, or in an unsupported variant of ${ext}.`,
        };
      }

      if (!content || content.trim().length === 0) {
        return {
          success: false,
          error: `"${fileName}" parsed to empty text. The file may be password-protected, image-only, or corrupt.`,
        };
      }

      const { ModesManager } = require('./services/ModesManager');
      const file = ModesManager.getInstance().addReferenceFile({ modeId, fileName, content });
      return { success: true, file };
    } catch (e: any) {
      console.error('[IPC] modes:upload-reference-file error:', e);
      // Do not leak raw error.message to the renderer (may contain absolute
      // paths or library internals). Return a generic message; the detail is
      // already in the main-process log above.
      return {
        success: false,
        error: 'Could not read the selected file. Please try a different file or contact support.',
      };
    }
  });

  safeHandle('modes:delete-reference-file', async (_, id: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      ModesManager.getInstance().deleteReferenceFile(id);
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] modes:delete-reference-file error:', e);
      return { success: false, error: e.message };
    }
  });

  // ── Note Sections ──────────────────────────────────────────────

  safeHandle('modes:get-note-sections', async (_, modeId: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      return ModesManager.getInstance().getNoteSections(modeId);
    } catch (e: any) {
      console.error('[IPC] modes:get-note-sections error:', e);
      return [];
    }
  });

  safeHandle(
    'modes:add-note-section',
    async (_, modeId: string, title: string, description: string) => {
      try {
          const { ModesManager } = require('./services/ModesManager');
        const section = ModesManager.getInstance().addNoteSection({ modeId, title, description });
        return { success: true, section };
      } catch (e: any) {
        console.error('[IPC] modes:add-note-section error:', e);
        return { success: false, error: e.message };
      }
    },
  );

  safeHandle(
    'modes:update-note-section',
    async (_, id: string, updates: { title?: string; description?: string }) => {
      try {
          const { ModesManager } = require('./services/ModesManager');
        ModesManager.getInstance().updateNoteSection(id, updates);
        return { success: true };
      } catch (e: any) {
        console.error('[IPC] modes:update-note-section error:', e);
        return { success: false, error: e.message };
      }
    },
  );

  safeHandle('modes:delete-note-section', async (_, id: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      ModesManager.getInstance().deleteNoteSection(id);
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] modes:delete-note-section error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle('modes:remove-all-note-sections', async (_, modeId: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      ModesManager.getInstance().removeAllNoteSections(modeId);
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] modes:remove-all-note-sections error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle('skills:list', () => {
    try {
      return SkillsManager.getInstance().listSkills();
    } catch (e: any) {
      console.warn('[IPC] skills:list error:', e?.message || e);
      return [];
    }
  });

  safeHandle('skills:get-settings', () => {
    try {
      const settings = SettingsManager.getInstance();
      const defaultActiveSkillIds = settings.get('defaultActiveSkillIds');
      return {
        defaultActiveSkillIds: Array.isArray(defaultActiveSkillIds) ? defaultActiveSkillIds : [],
        skillsAutoTriggerEnabled: settings.get('skillsAutoTriggerEnabled') !== false,
      };
    } catch (e: any) {
      console.warn('[IPC] skills:get-settings error:', e?.message || e);
      return { defaultActiveSkillIds: [], skillsAutoTriggerEnabled: true };
    }
  });

  safeHandle('skills:set-settings', (_event, input: { defaultActiveSkillIds?: unknown; skillsAutoTriggerEnabled?: unknown }) => {
    try {
      const settings = SettingsManager.getInstance();
      const ids = Array.isArray(input?.defaultActiveSkillIds)
        ? input.defaultActiveSkillIds
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim().toLowerCase())
          .filter(Boolean)
        : [];

      settings.set('defaultActiveSkillIds', Array.from(new Set(ids)));
      settings.set('skillsAutoTriggerEnabled', input?.skillsAutoTriggerEnabled !== false);
      return { success: true };
    } catch (e: any) {
      console.warn('[IPC] skills:set-settings error:', e?.message || e);
      return { success: false, error: e?.message || 'failed to save skill settings' };
    }
  });

  safeHandle('skills:list-activations', () => {
    try {
      return SkillActivationManager.getInstance().listActivations();
    } catch (e: any) {
      console.warn('[IPC] skills:list-activations error:', e?.message || e);
      return [];
    }
  });

  safeHandle('skills:activate', (_event, input: ActivateSkillInput) => {
    try {
      return SkillActivationManager.getInstance().activateSkill(input);
    } catch (e: any) {
      console.warn('[IPC] skills:activate error:', e?.message || e);
      return { success: false, error: e?.message || 'failed to activate skill' };
    }
  });

  safeHandle('skills:deactivate', (_event, skillId: string, scope?: SkillActivationScope) => {
    try {
      return SkillActivationManager.getInstance().deactivateSkill(skillId, scope);
    } catch (e: any) {
      console.warn('[IPC] skills:deactivate error:', e?.message || e);
      return { success: false, error: e?.message || 'failed to deactivate skill' };
    }
  });

  safeHandle('skills:open-folder', async () => {
    try {
      return await SkillsManager.getInstance().openSkillsFolder();
    } catch (e: any) {
      console.warn('[IPC] skills:open-folder error:', e?.message || e);
      return { success: false, path: '', error: e?.message || 'failed to open skills folder' };
    }
  });
}
