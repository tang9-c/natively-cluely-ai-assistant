import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnboardingProgressAction, OnboardingSnapshot, OnboardingStep, OnboardingStateResult } from '../../shared/onboarding';
export interface OnboardingFormGuard { isDirty(): boolean; save(): Promise<boolean>; discard(): void }
export async function resolveOnboardingLeave(choice: 'save' | 'discard' | 'stay', guard?: OnboardingFormGuard): Promise<boolean> {
  if (choice === 'stay') return false;
  if (!guard || !guard.isDirty()) return true;
  if (choice === 'discard') { guard.discard(); return true; }
  try { return await guard.save(); } catch { return false; }
}
export function acceptOnboardingSnapshot(current: OnboardingSnapshot | null, incoming: OnboardingSnapshot): OnboardingSnapshot {
  return !current || incoming.stateRevision > current.stateRevision ? incoming : current;
}
const messages: Record<string, string> = {
  schema_unsupported: '初始设置版本较新，可继续使用应用。', storage_failed: '未能读取或保存设置进度，请重试。',
  forbidden: '此窗口无法修改设置进度。', invalid_request: '设置信息已变化，请刷新后重试。', busy: '会议或设备正在使用中，请稍后重试。',
};
function diagnosticMessage(snapshot: OnboardingSnapshot): string | null {
  return snapshot.diagnostics?.length ? '部分设置信息未能读取或保存，会议仍按实际状态运行。请重试检查。' : null;
}
function savedSelection() {
  return { inputDeviceId: localStorage.getItem('preferredInputDeviceId') || undefined,
    outputDeviceId: localStorage.getItem('preferredOutputDeviceId') || undefined };
}
export function useOnboarding(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  const snapshotRef = useRef<OnboardingSnapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [pending, setPending] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const guard = useRef<OnboardingFormGuard | undefined>(undefined);
  const resolvingLeave = useRef(false);
  const pendingLeave = useRef<(() => Promise<boolean>) | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const initialized = useRef(false);
  const incomingOpen = useRef<{ step?: OnboardingStep } | null>(null);
  const openHandler = useRef<(input: { step?: OnboardingStep }) => void>(() => {});
  const accept = useCallback((incoming: OnboardingSnapshot) => {
    const previous = snapshotRef.current;
    const next = acceptOnboardingSnapshot(previous, incoming);
    if (next !== snapshotRef.current) {
      snapshotRef.current = next; setSnapshot(next);
      if (next.meeting.phase === 'failed' && (previous?.meeting.phase !== 'failed' || previous.meeting.generation !== next.meeting.generation)) { setIsOpen(false); setShowWelcome(false); }
      if (diagnosticMessage(next)) setError(diagnosticMessage(next));
    }
  }, []);
  const applyResult = useCallback((result: OnboardingStateResult): boolean => {
    if (result.success) { accept(result.snapshot); setError(diagnosticMessage(result.snapshot)); return true; }
    setError(messages[result.errorCode] ?? '未能更新设置状态，请重试。');
    if (result.errorCode === 'schema_unsupported') setStatus('unsupported');
    return false;
  }, [accept]);
  const action = useCallback(async (input: OnboardingProgressAction): Promise<boolean> => {
    setPending(true);
    try { return applyResult(await window.electronAPI.updateOnboardingProgress(input)); }
    catch { setError(messages.storage_failed); return false; }
    finally { setPending(false); }
  }, [applyResult]);
  const refresh = useCallback(async (): Promise<OnboardingStateResult> => {
    try { const result = await window.electronAPI.getOnboardingState(savedSelection()); applyResult(result); return result; }
    catch { const result = { success: false as const, errorCode: 'storage_failed' as const, messageKey: 'onboarding.storage_failed' }; applyResult(result); return result; }
  }, [applyResult]);
  const leave = useCallback(async (operation: () => Promise<boolean>): Promise<boolean> => {
    if (guard.current?.isDirty()) { pendingLeave.current = operation; setConfirmLeave(true); return false; }
    return operation();
  }, []);
  const navigate = useCallback((step: OnboardingStep) => leave(async () => {
    if (!await action({ type: 'navigate', step })) return false;
    setShowWelcome(false); setIsOpen(true); return true;
  }), [action, leave]);
  const open = useCallback((input: { step?: OnboardingStep } = {}) => {
    if (!initialized.current || !snapshotRef.current) { incomingOpen.current = input; return; }
    void navigate(input.step ?? snapshotRef.current.progress.lastStep);
  }, [navigate]);
  openHandler.current = open;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    initialized.current = false;
    setStatus('loading');
    const api = window.electronAPI;
    if (!api?.getOnboardingState) { setStatus('error'); setError('无法读取设置状态，请重新打开应用。'); return; }
    // Subscribe first: initialization and snapshot refresh both broadcast state.
    const unsubscribe = api.onOnboardingStateChanged(accept);
    const unsubscribeOpen = api.onOpenOnboarding(input => openHandler.current(input));
    const initialize = async () => {
      try {
        let result = await api.getOnboardingState(savedSelection());
        if (!result.success && result.errorCode === 'initialization_required') {
          result = await api.updateOnboardingProgress({ type: 'initialize',
            legacySeenStartup: localStorage.getItem('natively_seen_startup_v1') === 'true',
            legacyPermissionsShown: !!localStorage.getItem('natively_perms_shown_v1') });
          if (result.success) result = await api.getOnboardingState(savedSelection());
        }
        if (cancelled) return;
        if (!applyResult(result)) { if (result.success || result.errorCode !== 'schema_unsupported') setStatus('error'); return; }
        const state = snapshotRef.current!;
        initialized.current = true;
        setStatus('ready');
        if (incomingOpen.current) {
          const input = incomingOpen.current; incomingOpen.current = null; openHandler.current(input);
        } else {
          const fresh = state.progress.origin === 'fresh' && state.progress.configurationCompletedAt === undefined && state.progress.deferredAt === undefined;
          setIsOpen(fresh);
          setShowWelcome(fresh && state.progress.lastStep === 'overview' && localStorage.getItem('natively_seen_startup_v1') !== 'true');
        }
      } catch { if (!cancelled) { setError(messages.storage_failed); setStatus('error'); } }
    };
    void initialize();
    const refresh = () => { void api.getOnboardingState(savedSelection()).then(result => { if (!cancelled) applyResult(result); }).catch(() => { if (!cancelled) setError(messages.storage_failed); }); };
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; unsubscribe(); unsubscribeOpen(); window.removeEventListener('focus', refresh); };
  }, [enabled, retryVersion, accept, applyResult]);
  return {
    snapshot, status, error, isOpen, showWelcome, pending, confirmLeave, action, navigate, open, refresh,
    openSettings: (openSettings: () => void) => leave(async () => { openSettings(); return true; }),
    retry: () => setRetryVersion(value => value + 1),
    begin: async () => {
      if (await action({ type: 'navigate', step: 'overview' })) {
        localStorage.setItem('natively_seen_startup_v1', 'true'); setShowWelcome(false); setIsOpen(true);
      }
    },
    defer: () => leave(async () => {
      if (!await action({ type: 'defer' })) return false;
      setIsOpen(false); setShowWelcome(false); return true;
    }),
    registerFormGuard: (form: OnboardingFormGuard) => { guard.current = form; return () => { if (guard.current === form) guard.current = undefined; }; },
    resolveLeave: async (choice: 'save' | 'discard' | 'stay') => {
      if (resolvingLeave.current) return;
      resolvingLeave.current = true; setPending(true);
      try {
        if (!await resolveOnboardingLeave(choice, guard.current)) {
          if (choice === 'save') setError('未能保存，请重试。');
          if (choice === 'stay') { pendingLeave.current = null; setConfirmLeave(false); }
          return;
        }
        const operation = pendingLeave.current; pendingLeave.current = null; setConfirmLeave(false); await operation?.();
      } finally { resolvingLeave.current = false; setPending(false); }
    },
  };
}
