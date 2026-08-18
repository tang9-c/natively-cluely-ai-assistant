import { app, BrowserWindow, Menu, screen } from 'electron';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { resolveOverlayMouseInteractionPolicy } from '../shared/overlayMouseInteractionPolicy';
import { AppState } from './main';
import { KeybindManager } from './services/KeybindManager';
import { applyNativeStealthIfEnabled } from './utils/nativeStealth';

const isEnvDev = process.env.NODE_ENV === 'development';
const isPackaged = app.isPackaged;
const inAppBundle = process.execPath.includes('.app/') || process.execPath.includes('.app\\');

console.log(
  `[WindowHelper] isEnvDev: ${isEnvDev}, isPackaged: ${isPackaged}, inAppBundle: ${inAppBundle}`,
);

// Force production mode if running as packaged app or inside app bundle
const isDev = isEnvDev && !isPackaged;

const startUrl = isDev
  ? 'http://localhost:5180'
  : `file://${path.join(__dirname, '../../dist/index.html')}`;

export class WindowHelper {
  private launcherWindow: BrowserWindow | null = null;
  private overlayWindow: BrowserWindow | null = null;
  private isWindowVisible: boolean = false;
  // Position/Size tracking for Launcher
  private launcherPosition: { x: number; y: number } | null = null;
  private launcherSize: { width: number; height: number } | null = null;
  private overlayBounds: Electron.Rectangle | null = null;
  private overlayRendererReady = false;
  private pendingOverlayShowInactive: boolean | null = null;
  private overlayReadyRecoveryTimer: NodeJS.Timeout | null = null;
  private overlayAutomaticInteractive = process.platform !== 'win32';
  private lastAppliedIgnoreMouseEvents: boolean | null = null;
  // Track current window mode (persists even when overlay is hidden via Cmd+B)
  private currentWindowMode: 'launcher' | 'overlay' = 'launcher';

  private appState: AppState;
  private opacityTimeout: NodeJS.Timeout | null = null;

  // Constants
  private static readonly OVERLAY_DEFAULT_WIDTH = 600;
  private static readonly OVERLAY_MIN_HEIGHT = 216;
  // Vertical offset for the meeting overlay's initial position, expressed as
  // a fraction of the screen's work-area height. 0.035 places the top edge
  // ~37 px below the work-area top on a 1055-tall display — comfortably
  // below the menu bar with visible breathing room.
  private static readonly OVERLAY_DEFAULT_TOP_RATIO = 0.035;

  // Movement variables (apply to active window)
  private step: number = 20;

  constructor(appState: AppState) {
    this.appState = appState;
  }

  private logOverlayState(label: string): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) {
      console.log('[WindowHelper] Overlay state:', {
        label,
        exists: false,
        currentWindowMode: this.currentWindowMode,
        isWindowVisible: this.isWindowVisible,
        platform: process.platform,
        arch: process.arch,
      });
      return;
    }

    try {
      console.log('[WindowHelper] Overlay state:', {
        label,
        bounds: this.overlayWindow.getBounds(),
        contentSize: this.overlayWindow.getContentSize(),
        visible: this.overlayWindow.isVisible(),
        opacity: this.overlayWindow.getOpacity(),
        focusable: this.overlayWindow.isFocusable(),
        alwaysOnTop: this.overlayWindow.isAlwaysOnTop(),
        automaticInteractive: this.overlayAutomaticInteractive,
        ignoreMouseEvents: this.lastAppliedIgnoreMouseEvents,
        currentWindowMode: this.currentWindowMode,
        isWindowVisible: this.isWindowVisible,
        platform: process.platform,
        arch: process.arch,
      });
    } catch (err) {
      console.warn('[WindowHelper] Failed to log overlay state:', err);
    }
  }

  private isAppleSiliconMac(): boolean {
    if (process.platform !== 'darwin') return false;
    if (process.arch === 'arm64') return true;

    try {
      const translated = execFileSync('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (translated === '1') return true;
    } catch {
      // sysctl.proc_translated is absent on non-Rosetta macOS.
    }

    try {
      const supportsArm64 = execFileSync('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return supportsArm64 === '1';
    } catch {
      return false;
    }
  }

  private logOverlayDimensionClamp(
    label: string,
    requested: { width: number; height: number },
    applied: { width: number; height: number },
    minimumHeight: number,
    maxAllowedHeight: number,
    currentBounds: Electron.Rectangle,
    currentContentSize: number[],
  ): void {
    if (requested.width === applied.width && requested.height === applied.height) return;

    console.log('[WindowHelper] Overlay dimensions clamped:', {
      label,
      requested,
      applied,
      minimumHeight,
      maxAllowedHeight,
      currentBounds,
      currentContentSize,
      platform: process.platform,
      arch: process.arch,
    });
  }

  private getDisplayWorkArea(bounds?: Electron.Rectangle): Electron.Rectangle {
    if (bounds) {
      return screen.getDisplayMatching(bounds).workArea;
    }
    if (this.overlayBounds) {
      return screen.getDisplayMatching(this.overlayBounds).workArea;
    }
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      return screen.getDisplayMatching(this.overlayWindow.getBounds()).workArea;
    }
    return screen.getPrimaryDisplay().workArea;
  }

  private reloadOverlayRenderer(reason: string, inactive: boolean): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) {
      console.error(`[WindowHelper] Cannot reload overlay renderer (${reason}): overlay window is missing`);
      return;
    }

    console.warn(`[WindowHelper] Reloading overlay renderer after ${reason}`);
    this.overlayRendererReady = false;
    this.pendingOverlayShowInactive = inactive;
    this.overlayWindow.loadURL(`${startUrl}?window=overlay`).catch((e) => {
      console.error('[WindowHelper] Failed to reload Overlay URL:', e);
    });
  }

  private scheduleOverlayReadyRecovery(inactive: boolean): void {
    if (this.overlayReadyRecoveryTimer) {
      clearTimeout(this.overlayReadyRecoveryTimer);
    }

    this.overlayReadyRecoveryTimer = setTimeout(() => {
      this.overlayReadyRecoveryTimer = null;
      if (!this.overlayRendererReady) {
        this.reloadOverlayRenderer('renderer-ready-timeout', inactive);
      }
    }, 1500);
  }

  private verifyOverlayVisibleAfterShow(reason: string): void {
    setTimeout(() => {
      if (!this.overlayWindow || this.overlayWindow.isDestroyed()) {
        return;
      }

      const bounds = this.overlayWindow.getBounds();
      const isTooSmall = bounds.width < 240 || bounds.height < WindowHelper.OVERLAY_MIN_HEIGHT;
      const isTransparent = this.overlayWindow.getOpacity() < 0.95;
      const isHidden = !this.overlayWindow.isVisible();

      if (!isHidden && !isTooSmall && !isTransparent) {
        return;
      }

      const workArea = this.getDisplayWorkArea(bounds);
      const repairedBounds = {
        x: Math.max(
          workArea.x,
          Math.min(bounds.x, workArea.x + workArea.width - WindowHelper.OVERLAY_DEFAULT_WIDTH),
        ),
        y: Math.max(
          workArea.y,
          Math.min(bounds.y, workArea.y + workArea.height - WindowHelper.OVERLAY_MIN_HEIGHT),
        ),
        width: Math.max(bounds.width, WindowHelper.OVERLAY_DEFAULT_WIDTH),
        height: Math.max(bounds.height, WindowHelper.OVERLAY_MIN_HEIGHT),
      };

      this.overlayWindow.setBounds(repairedBounds);
      this.overlayWindow.setOpacity(1);
      if (process.platform === 'win32') {
        this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
      this.overlayWindow.showInactive();
      this.isWindowVisible = true;
      this.logOverlayState(`switchToOverlay-recovered-${reason}`);
    }, 250);
  }

  public setWindowDimensions(width: number, height: number): void {
    const activeWindow = this.getMainWindow(); // Gets currently focused/relevant window
    if (!activeWindow || activeWindow.isDestroyed()) return;

    const [currentX, currentY] = activeWindow.getPosition();
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workAreaSize;
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const newWidth = Math.min(width, maxAllowedWidth);
    const newHeight = Math.ceil(height);
    const maxX = workArea.width - newWidth;
    const newX = Math.min(Math.max(currentX, 0), maxX);

    activeWindow.setBounds({
      x: newX,
      y: currentY,
      width: newWidth,
      height: newHeight,
    });

    // Update internal tracking if it's launcher
    if (activeWindow === this.launcherWindow) {
      this.launcherSize = { width: newWidth, height: newHeight };
      this.launcherPosition = { x: newX, y: currentY };
    }
  }

  // Dedicated method for overlay window resizing - decoupled from launcher
  public setOverlayDimensions(width: number, height: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const currentBounds = this.overlayWindow.getBounds();
    const currentContentSize = this.overlayWindow.getContentSize();
    const currentX = currentBounds.x;
    const currentY = currentBounds.y;
    const workArea = this.getDisplayWorkArea(currentBounds);
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const maxAllowedHeight = Math.floor(workArea.height * 0.9);
    const newWidth = Math.min(Math.max(width, 300), maxAllowedWidth); // min 300, max 90%
    const minimumHeight = width >= WindowHelper.OVERLAY_DEFAULT_WIDTH
      ? WindowHelper.OVERLAY_MIN_HEIGHT
      : 1;
    const newHeight = Math.min(Math.max(height, minimumHeight), maxAllowedHeight); // min visible expanded overlay, max 90%
    this.logOverlayDimensionClamp(
      'setOverlayDimensions',
      { width, height },
      { width: newWidth, height: newHeight },
      minimumHeight,
      maxAllowedHeight,
      currentBounds,
      currentContentSize,
    );
    const maxX = workArea.x + workArea.width - newWidth;
    const maxY = workArea.y + workArea.height - newHeight;
    const newX = Math.min(Math.max(currentX, workArea.x), maxX);
    const newY = Math.min(Math.max(currentY, workArea.y), maxY);

    if (
      Math.abs(newWidth - currentContentSize[0]) <= 1 &&
      Math.abs(newHeight - currentContentSize[1]) <= 1 &&
      newX === currentBounds.x &&
      newY === currentBounds.y
    ) {
      return;
    }

    this.overlayWindow.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
    this.overlayBounds = this.overlayWindow.getBounds();
  }

  // Variant of setOverlayDimensions that keeps the horizontal CENTER of the
  // window fixed across width changes. Used by code-expansion animations so
  // the shell (mx-auto centered) doesn't appear to jump sideways when the
  // window grows: window grows symmetrically (X shifts -widthDelta/2), and
  // mx-auto compensates by reducing margin equally — net visual movement = 0.
  public setOverlayDimensionsCentered(width: number, height: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const currentBounds = this.overlayWindow.getBounds();
    const currentContentSize = this.overlayWindow.getContentSize();
    const workArea = this.getDisplayWorkArea(currentBounds);
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const maxAllowedHeight = Math.floor(workArea.height * 0.9);
    const newWidth = Math.min(Math.max(width, 300), maxAllowedWidth);
    const minimumHeight = width >= WindowHelper.OVERLAY_DEFAULT_WIDTH
      ? WindowHelper.OVERLAY_MIN_HEIGHT
      : 1;
    const newHeight = Math.min(Math.max(height, minimumHeight), maxAllowedHeight);
    this.logOverlayDimensionClamp(
      'setOverlayDimensionsCentered',
      { width, height },
      { width: newWidth, height: newHeight },
      minimumHeight,
      maxAllowedHeight,
      currentBounds,
      currentContentSize,
    );

    // Compute X so the content's horizontal center stays put across the resize.
    const widthDelta = newWidth - currentContentSize[0];
    const desiredX = currentBounds.x - Math.floor(widthDelta / 2);

    const maxX = workArea.x + workArea.width - newWidth;
    const newX = Math.min(Math.max(desiredX, workArea.x), maxX);
    const maxY = workArea.y + workArea.height - newHeight;
    const newY = Math.min(Math.max(currentBounds.y, workArea.y), maxY);

    if (
      Math.abs(newWidth - currentContentSize[0]) <= 1 &&
      Math.abs(newHeight - currentContentSize[1]) <= 1 &&
      newX === currentBounds.x &&
      newY === currentBounds.y
    ) {
      return;
    }

    // Atomic frame change: a single setBounds avoids the 1-frame split where
    // the OS window has the new size but the old origin (or vice versa), which
    // is what causes the shell to visibly slide and snap during code-expansion.
    this.overlayWindow.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
    this.overlayBounds = this.overlayWindow.getBounds();
  }

  public createWindow(): void {
    if (this.launcherWindow !== null) return; // Already created

    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    // Fixed dimensions per user request
    const width = 1200;
    const height = 800;

    // Calculate centered X, and top-centered Y (5% from top)
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    // Ensure y is at least workArea.y (don't go offscreen top)
    const topMargin = Math.round(workArea.height * 0.05);
    const y = Math.round(workArea.y + topMargin);

    // --- 1. Create Launcher Window ---
    const isMac = process.platform === 'darwin';

    const launcherSettings: Electron.BrowserWindowConstructorOptions = {
      width: width,
      height: height,
      x: x,
      y: y,
      minWidth: 600,
      minHeight: 400,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        scrollBounce: true,
        webSecurity: !isDev, // DEBUG: Disable web security only in dev
      },
      show: false, // DEBUG: Force show -> Fixed white screen, now relies on ready-to-show
      // Platform-specific frame settings
      ...(isMac
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
        : { frame: false, titleBarOverlay: false, autoHideMenuBar: true }),
      ...(isMac
        ? { vibrancy: 'under-window' as const, visualEffectState: 'followWindow' as const }
        : {}),
      transparent: isMac,
      hasShadow: true,
      backgroundColor: isMac ? '#00000000' : '#000000',
      focusable: true,
      resizable: true,
      movable: true,
      center: true,
      icon: (() => {
        const isMac = process.platform === 'darwin';
        const isWin = process.platform === 'win32';
        if (isMac) {
          return app.isPackaged
            ? path.join(process.resourcesPath, 'cueup.icns')
            : path.resolve(__dirname, '../../assets/cueup.icns');
        } else if (isWin) {
          return app.isPackaged
            ? path.join(process.resourcesPath, 'assets/icons/win/icon.ico')
            : path.resolve(__dirname, '../../assets/icons/win/icon.ico');
        } else {
          return app.isPackaged
            ? path.join(process.resourcesPath, 'icon.png')
            : path.resolve(__dirname, '../../assets/icon.png');
        }
      })(),
    };

    console.log(`[WindowHelper] Icon Path: ${launcherSettings.icon}`);
    console.log(`[WindowHelper] Start URL: ${startUrl}`);

    try {
      this.launcherWindow = new BrowserWindow(launcherSettings);
      console.log('[WindowHelper] BrowserWindow created successfully');
    } catch (err) {
      console.error('[WindowHelper] Failed to create BrowserWindow:', err);
      return;
    }

    this.launcherWindow
      .loadURL(`${startUrl}?window=launcher`)
      .then(() => console.log('[WindowHelper] loadURL success'))
      .catch((e) => {
        console.error('[WindowHelper] Failed to load URL:', e);
      });

    this.launcherWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error(`[WindowHelper] did-fail-load: ${errorCode} ${errorDescription}`);
    });

    // if (isDev) {
    //   this.launcherWindow.webContents.openDevTools({ mode: 'detach' }); // DEBUG: Open DevTools
    // }

    // --- 2. Create Overlay Window (Hidden initially) ---
    // Always start centered on the primary display so the OS (macOS NSUserDefaults /
    // Windows DWM) cannot restore the previous session's cached window position.
    // The in-memory `overlayBounds` is already null here, so `switchToOverlay()`
    // will also fall back to centered logic — but providing explicit x/y in the
    // constructor is the only reliable guard against OS-level position persistence.
    const overlayDefaultX = Math.floor(
      workArea.x + (workArea.width - WindowHelper.OVERLAY_DEFAULT_WIDTH) / 2,
    );
    const overlayDefaultY = Math.floor(
      workArea.y + workArea.height * WindowHelper.OVERLAY_DEFAULT_TOP_RATIO,
    );

    const overlaySettings: Electron.BrowserWindowConstructorOptions = {
      width: WindowHelper.OVERLAY_DEFAULT_WIDTH,
      height: 1,
      x: overlayDefaultX,
      y: overlayDefaultY,
      minWidth: 300,
      minHeight: 1,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        scrollBounce: true,
      },
      show: false,
      frame: false, // Frameless
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      focusable: true,
      resizable: false, // Enforce automatic resizing only
      movable: true,
      skipTaskbar: true, // Don't show separately in dock/taskbar
      hasShadow: false, // Prevent shadow from adding perceived size/artifacts
      // macOS NSPanel + nonactivating: lets the overlay become the key window
      // (and receive keystrokes for the chat input) without activating Natively
      // in the dock / menu bar / screen-share, so the user's foreground app
      // stays "in front." Required for the chat:focusInput stealth-typing path.
      // Windows/Linux fall back to a regular focusable window.
      ...(isMac ? { type: 'panel' as const } : {}),
    };

    this.overlayWindow = new BrowserWindow(overlaySettings);
    this.syncOverlayInteractionPolicy();

    if (process.platform === 'darwin') {
      this.overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.overlayWindow.setHiddenInMissionControl(true);
      this.overlayWindow.setAlwaysOnTop(true, 'floating');

      // Apply Spotlight/Alfred-grade stealth attributes that Electron does not
      // expose: becomesKeyOnlyIfNeeded (clicks on buttons / surfaces don't
      // promote the panel to key window → user's foreground app keeps key
      // state in the dock, menu bar, screen-share, focus-followers),
      // hidesOnDeactivate=NO, and the right collectionBehavior. Without this,
      // ANY click on the overlay (button, input, anywhere) activates Natively
      // and dims the user's foreground app — even with type:'panel' set.
      //
      // DEFERRED to `ready-to-show`: getNativeWindowHandle() returns the
      // NSView pointer immediately after `new BrowserWindow`, but the view's
      // [NSView window] may briefly be nil before Electron finishes attaching
      // the view to its NSWindow. Calling now races and the Rust side returns
      // "NSView has no associated NSWindow" → silent fallback to plain panel.
      // ready-to-show fires AFTER the NSWindow is attached and the renderer
      // has performed its first paint, so the window is guaranteed live.
      //
      // Optional: requires the rebuilt native module (npm run build:native).
      // If the binary predates this method we silently skip; clicks will still
      // soft-activate the panel as before but type:'panel' alone keeps the
      // dock icon out of the way. Existing users see no regression.
      this.overlayWindow.once('ready-to-show', () => {
        if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
        // Apple Silicon, including Intel builds running under Rosetta, has shown a
        // WindowServer state where Electron reports the overlay visible with valid
        // bounds, but the user cannot see or recover it. Keep the stable Electron
        // panel behavior there until the native stealth path has a silicon-specific fix.
        const result = applyNativeStealthIfEnabled(this.overlayWindow, {
          label: 'WindowHelper',
          skipOnAppleSilicon: true,
          isAppleSiliconMac: () => this.isAppleSiliconMac(),
        });
        if (result.status === 'skipped') {
          this.logOverlayState('overlay-ready-to-show-native-stealth-skipped');
          return;
        }
        if (result.status === 'applied') {
          this.logOverlayState('overlay-ready-to-show-after-stealth');
          return;
        }
        if (result.status === 'unavailable') {
          this.logOverlayState('overlay-ready-to-show-stealth-unavailable');
          return;
        }
        if (result.status === 'error') {
          this.logOverlayState('overlay-ready-to-show-stealth-error');
        }
      });
    } else if (process.platform === 'win32') {
      // 'floating' level (HWND_TOPMOST baseline) is not enough to render above
      // fullscreen browser windows (F11). 'screen-saver' uses a higher TOPMOST
      // priority that wins against window-mode fullscreen apps. macOS uses
      // visibleOnFullScreen above; Windows has no equivalent flag, so the level
      // itself is what controls fullscreen visibility. See issue #167.
      this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    this.overlayWindow.webContents.on('did-finish-load', () => {
      this.overlayRendererReady = true;
      if (this.overlayReadyRecoveryTimer) {
        clearTimeout(this.overlayReadyRecoveryTimer);
        this.overlayReadyRecoveryTimer = null;
      }
      console.log('[WindowHelper] Overlay renderer loaded');
      if (this.pendingOverlayShowInactive !== null) {
        const inactive = this.pendingOverlayShowInactive;
        this.pendingOverlayShowInactive = null;
        this.switchToOverlay(inactive);
      }
    });

    this.overlayWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error(`[WindowHelper] Overlay did-fail-load: ${errorCode} ${errorDescription}`);
      this.overlayRendererReady = false;
      this.scheduleOverlayReadyRecovery(this.pendingOverlayShowInactive ?? true);
    });

    this.overlayWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[WindowHelper] Overlay render-process-gone:', details);
      this.overlayRendererReady = false;
      this.scheduleOverlayReadyRecovery(this.pendingOverlayShowInactive ?? true);
    });

    this.overlayWindow.loadURL(`${startUrl}?window=overlay`).catch((e) => {
      console.error('[WindowHelper] Failed to load Overlay URL:', e);
    });

    // --- 3. Startup Sequence ---
    this.launcherWindow.once('ready-to-show', () => {
      this.switchToLauncher();
      this.isWindowVisible = true;
    });

    this.setupWindowListeners();
  }

  private setupWindowListeners(): void {
    if (!this.launcherWindow) return;

    // Suppress Windows system context menu on right-click (title bar)
    this.launcherWindow.on('system-context-menu', (e, point) => {
      e.preventDefault();
      this.showContextMenu(this.launcherWindow!, point);
    });

    this.launcherWindow.on('move', () => {
      if (this.launcherWindow) {
        const bounds = this.launcherWindow.getBounds();
        this.launcherPosition = { x: bounds.x, y: bounds.y };
        this.appState.settingsWindowHelper.reposition(bounds);
      }
    });

    this.launcherWindow.on('resize', () => {
      if (this.launcherWindow) {
        const bounds = this.launcherWindow.getBounds();
        this.launcherSize = { width: bounds.width, height: bounds.height };
        this.appState.settingsWindowHelper.reposition(bounds);
      }
    });

    // On Windows/Linux: intercept close and hide to tray instead of quitting,
    // unless the app is actually quitting (e.g. from tray "Quit" menu).
    if (process.platform !== 'darwin') {
      this.launcherWindow.on('close', (e) => {
        if (!this.appState.isQuitting()) {
          e.preventDefault();
          this.launcherWindow?.hide();
          this.isWindowVisible = false;
        }
      });

      // Sync maximize state to renderer so WindowControls stays in sync (Windows/Linux only)
      this.launcherWindow.on('maximize', () => {
        this.launcherWindow?.webContents.send('window-maximized-changed', true);
      });
      this.launcherWindow.on('unmaximize', () => {
        this.launcherWindow?.webContents.send('window-maximized-changed', false);
      });
    }

    this.launcherWindow.on('closed', () => {
      this.launcherWindow = null;
      // If launcher closes, we should probably quit app or close overlay
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.close();
      }
      this.overlayWindow = null;
      this.isWindowVisible = false;
    });

    // Listen for overlay close (e.g. Cmd+W). Never truly destroy it — either
    // hide it (during a meeting) or switch back to launcher (between meetings).
    if (this.overlayWindow) {
      this.overlayWindow.on('move', () => {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayBounds = this.overlayWindow.getBounds();
        }
      });

      this.overlayWindow.on('resize', () => {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayBounds = this.overlayWindow.getBounds();
        }
      });

      this.overlayWindow.on('system-context-menu', (e, point) => {
        e.preventDefault();
        this.showContextMenu(this.overlayWindow!, point);
      });

      // Re-assert always-on-top on blur (Windows only). Screen-sharing tools
      // (Zoom, Lark, Teams, etc.) hook the DWM compositor and can demote even
      // HWND_TOPMOST windows below their shared content layer. Re-applying the
      // 'screen-saver' level on every blur keeps the overlay above the share
      // surface. Skipped on macOS — re-asserting setAlwaysOnTop there triggers
      // [NSApp activate], which steals focus from the underlying app. See #130.
      if (process.platform === 'win32') {
        this.overlayWindow.on('blur', () => {
          if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
          if (!this.overlayWindow.isVisible()) return;
          this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        });
      }

      this.overlayWindow.on('close', (e) => {
        if (this.overlayWindow?.isVisible()) {
          e.preventDefault();
          if (this.appState.getIsMeetingActive()) {
            // Meeting running — just hide the overlay; user can resume from the
            // launcher's "Meeting ongoing" button which calls setWindowMode('overlay').
            this.hideOverlay();
          } else {
            this.switchToLauncher();
          }
        }
      });
    }
  }

  // Helper to get whichever window should be treated as "Main" for IPC
  public getMainWindow(): BrowserWindow | null {
    if (this.currentWindowMode === 'overlay' && this.overlayWindow) {
      return this.overlayWindow;
    }
    return this.launcherWindow;
  }

  // Specific getters if needed
  public getLauncherWindow(): BrowserWindow | null {
    return this.launcherWindow;
  }
  public getOverlayWindow(): BrowserWindow | null {
    return this.overlayWindow;
  }
  public getCurrentWindowMode(): 'launcher' | 'overlay' {
    return this.currentWindowMode;
  }

  // Clears the remembered overlay position so the next switchToOverlay() call
  // opens at the default centered position (called on new meeting start).
  public resetOverlayPosition(): void {
    this.overlayBounds = null;
    console.log('[WindowHelper] Overlay position reset to default for next meeting.');
  }

  public getLastOverlayBounds(): Electron.Rectangle | null {
    // If no in-memory bounds exist, return null to signify no user-initiated movement.
    if (this.overlayBounds) return { ...this.overlayBounds };
    return null;
  }

  public getLastOverlayDisplayId(): number | null {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return null;
    const bounds = this.overlayWindow.getBounds();
    return screen.getDisplayMatching(bounds).id;
  }

  public isVisible(): boolean {
    return this.isWindowVisible;
  }

  public isMainWindowMaximized(): boolean {
    const win = this.launcherWindow;
    return !!win && !win.isDestroyed() && win.isMaximized();
  }

  public hideMainWindow(): void {
    // Do NOT call setOpacity(0) before hide() on macOS — it causes WindowServer to
    // re-register the app as a regular window, breaking the panel's stealth behavior
    // (fixed in v2.0.8, regressed when opacity was re-added for screenshot flash).
    // Screenshot capture already waits 80ms after hide() for compositor flush.
    this.resetOverlayAutomaticInteraction();
    if (process.platform === 'win32') {
      this.launcherWindow?.setOpacity(0);
      this.overlayWindow?.setOpacity(0);
    }
    this.launcherWindow?.hide();
    this.overlayWindow?.hide();
    this.isWindowVisible = false;
  }

  private resetOverlayAutomaticInteraction(): void {
    if (process.platform !== 'win32') return;
    this.overlayAutomaticInteractive = false;
    this.syncOverlayInteractionPolicy();
  }

  public setOverlayAutomaticInteractive(interactive: boolean): void {
    if (process.platform !== 'win32') return;
    if (this.overlayAutomaticInteractive === interactive) return;

    this.overlayAutomaticInteractive = interactive;
    this.syncOverlayInteractionPolicy();
  }

  // Apply the resolved manual/automatic click-through policy to the native overlay.
  public syncOverlayInteractionPolicy(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const manualPassthrough = this.appState.getOverlayMousePassthrough();
    const policy = resolveOverlayMouseInteractionPolicy({
      platform: process.platform,
      manualPassthrough,
      automaticInteractive: this.overlayAutomaticInteractive,
    });
    if (this.lastAppliedIgnoreMouseEvents === policy.ignoreMouseEvents) return;

    if (policy.ignoreMouseEvents) {
      this.overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      this.overlayWindow.setIgnoreMouseEvents(false);
      this.overlayWindow.setFocusable(true);
    }
    this.lastAppliedIgnoreMouseEvents = policy.ignoreMouseEvents;
    console.log('[WindowHelper] Overlay mouse interaction policy changed', {
      manualPassthrough,
      automaticInteractive: this.overlayAutomaticInteractive,
      ignoreMouseEvents: policy.ignoreMouseEvents,
    });
  }

  // Show overlay directly without going through full switchToOverlay flow.
  // Used by IPC handlers to show the overlay independently.
  public showOverlay(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    this.resetOverlayAutomaticInteraction();
    // Restore opacity in case it was zeroed by hideMainWindow() before a screenshot.
    this.overlayWindow.setOpacity(1);

    // Re-assert z-order on Windows before showing — same DWM demotion risk as
    // switchToOverlay(). Must come before show()/showInactive() so the window
    // lands at the correct level on first paint (issue #136).
    if (process.platform === 'win32') {
      this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    if (this.appState.getOverlayMousePassthrough()) {
      // In passthrough/stealth mode: appear on screen without stealing OS focus.
      // The underlying app (Zoom, browser, etc.) must keep focus.
      this.overlayWindow.showInactive();
    } else {
      // Normal interactive mode: show and focus so the user can click/type.
      this.overlayWindow.showInactive();
      // Bring to front without a full app-activate (avoids dock bounce on macOS).
      // setAlwaysOnTop is already set at creation; a focus() call alone is safe.
      this.overlayWindow.focus();
    }
  }

  // Hide overlay directly without switching to launcher.
  // Used by IPC handlers to hide the overlay independently.
  public hideOverlay(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.hide();
      this.isWindowVisible = false;
    }
  }

  public showMainWindow(inactive?: boolean): void {
    // Show the window corresponding to the current mode
    if (this.currentWindowMode === 'overlay') {
      this.switchToOverlay(inactive);
    } else {
      this.switchToLauncher(inactive);
    }
  }

  public toggleMainWindow(): void {
    if (this.isWindowVisible) {
      this.hideMainWindow();
    } else {
      // Always show without stealing focus — Natively is a ghost overlay.
      // The user is in another app; show the window on top but leave OS focus alone.
      // They can click the window to focus it if they need to type.
      this.showMainWindow(true);
    }
  }

  public toggleOverlayWindow(): void {
    this.toggleMainWindow();
  }

  public centerAndShowWindow(): void {
    if (this.currentWindowMode === 'overlay') {
      this.switchToOverlay();
    } else {
      this.switchToLauncher();
      this.launcherWindow?.center();
    }
  }

  // --- Swapping Logic ---

  public switchToOverlay(inactive?: boolean): void {
    console.log(`[WindowHelper] Switching to OVERLAY (inactive: ${!!inactive})`);
    const shouldResetAutomaticInteraction =
      this.currentWindowMode !== 'overlay' || !this.overlayWindow?.isVisible();

    if (this.overlayWindow && !this.overlayWindow.isDestroyed() && !this.overlayRendererReady) {
      this.pendingOverlayShowInactive = !!inactive;
      this.scheduleOverlayReadyRecovery(!!inactive);
      console.warn('[WindowHelper] Overlay renderer not ready; deferring show until did-finish-load');
      return;
    }

    this.currentWindowMode = 'overlay';
    KeybindManager.getInstance().setMode('overlay'); // Adapted from public PR #123 — verify premium interaction

    // Tell the overlay renderer to expand to full size (e.g. after being minimised)
    this.overlayWindow?.webContents.send('ensure-expanded');

    // Show Overlay FIRST
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      if (shouldResetAutomaticInteraction) {
        this.resetOverlayAutomaticInteraction();
      }
      const currentBounds = this.overlayWindow.getBounds();
      const savedBounds = this.overlayBounds
        ? {
            ...this.overlayBounds,
            height: Math.max(this.overlayBounds.height, WindowHelper.OVERLAY_MIN_HEIGHT),
          }
        : null;
      const workArea = this.getDisplayWorkArea(savedBounds ?? currentBounds);
      const maxAllowedWidth = Math.floor(workArea.width * 0.9);
      const maxAllowedHeight = Math.floor(workArea.height * 0.9);
      const targetBounds = savedBounds
        ? {
            x: Math.min(
              Math.max(savedBounds.x, workArea.x),
              workArea.x + workArea.width - Math.min(savedBounds.width, maxAllowedWidth),
            ),
            y: Math.min(
              Math.max(savedBounds.y, workArea.y),
              workArea.y + workArea.height - Math.min(savedBounds.height, maxAllowedHeight),
            ),
            width: Math.min(savedBounds.width, maxAllowedWidth),
            height: Math.min(savedBounds.height, maxAllowedHeight),
          }
        : {
            x: Math.floor(workArea.x + (workArea.width - WindowHelper.OVERLAY_DEFAULT_WIDTH) / 2),
            y: Math.floor(workArea.y + workArea.height * WindowHelper.OVERLAY_DEFAULT_TOP_RATIO),
            width: WindowHelper.OVERLAY_DEFAULT_WIDTH,
            height: Math.max(
              Math.min(currentBounds.height, maxAllowedHeight),
              WindowHelper.OVERLAY_MIN_HEIGHT,
            ),
          };

      this.overlayWindow.setBounds(targetBounds);
      this.overlayBounds = this.overlayWindow.getBounds();

      // Restore opacity (may have been zeroed pre-screenshot by hideMainWindow)
      this.overlayWindow.setOpacity(1);
      // Re-assert z-order BEFORE show on Windows — DWM processes setAlwaysOnTop
      // synchronously, so calling it before show() ensures the window lands at the
      // correct z-level on first paint. Calling it after focus() would leave a brief
      // window where the HWND is focused at the wrong z-level (issue #136).
      // Skipped on macOS — calling setAlwaysOnTop triggers [NSApp activate] which
      // steals focus from Zoom/browser even when showInactive() was used.
      if (process.platform === 'win32') {
        this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
      if (inactive) this.overlayWindow.showInactive();
      else this.overlayWindow.show();
      // Only grab focus for explicit user-initiated shows (not shortcut/ghost shows)
      if (!inactive) this.overlayWindow.focus();
      this.isWindowVisible = true;
      this.logOverlayState('switchToOverlay-after-show');
      this.verifyOverlayVisibleAfterShow(inactive ? 'inactive' : 'active');
    }

    // Hide Launcher SECOND
    if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
      this.launcherWindow.hide();
    }
  }

  public switchToLauncher(inactive?: boolean): void {
    console.log(`[WindowHelper] Switching to LAUNCHER (inactive: ${!!inactive})`);
    this.currentWindowMode = 'launcher';
    KeybindManager.getInstance().setMode('launcher'); // Adapted from public PR #123 — verify premium interaction

    // Show Launcher FIRST
    if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
      // Restore opacity (may have been zeroed pre-screenshot by hideMainWindow)
      this.launcherWindow.setOpacity(1);
      if (inactive) this.launcherWindow.showInactive();
      else this.launcherWindow.show();
      if (!inactive) this.launcherWindow.focus();
      this.isWindowVisible = true;
    }

    // Hide Overlay SECOND
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.resetOverlayAutomaticInteraction();
      this.overlayWindow.hide();
    }
  }

  // Simplified setWindowMode that just calls switchers
  public setWindowMode(mode: 'launcher' | 'overlay', inactive?: boolean): void {
    if (mode === 'launcher') {
      this.switchToLauncher(inactive);
    } else {
      this.switchToOverlay(inactive);
    }
  }

  // --- Window Movement (Applies to Overlay mostly, but generalized to active) ---
  private moveActiveWindow(dx: number, dy: number): void {
    const win = this.getMainWindow();
    if (!win) return;

    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  }

  public moveWindowRight(): void {
    this.moveActiveWindow(this.step, 0);
  }
  public moveWindowLeft(): void {
    this.moveActiveWindow(-this.step, 0);
  }
  public moveWindowDown(): void {
    this.moveActiveWindow(0, this.step);
  }
  public moveWindowUp(): void {
    this.moveActiveWindow(0, -this.step);
  }

  private showContextMenu(win: BrowserWindow, point: { x: number; y: number }): void {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: '开发者控制台',
        click: () => {
          win.webContents.toggleDevTools();
        },
      },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'forceReload' },
      { type: 'separator' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win, x: point.x, y: point.y });
  }

  public minimizeWindow(): void {
    const win = this.launcherWindow;
    if (!win || win.isDestroyed()) return;
    if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
    win.minimize();
  }

  public maximizeWindow(): void {
    const win = this.launcherWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }

  public closeWindow(): void {
    const win = this.launcherWindow;
    if (!win || win.isDestroyed()) return;
    if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
    // On Windows/Linux the 'close' event listener intercepts this
    // and hides to tray unless the app is actually quitting.
    win.close();
  }
}
