import type {
  DynamicActionModeEvent as ElectronDynamicActionModeEvent,
  DynamicActionPayload,
} from '@/types/electron';
import { AnimatePresence } from 'framer-motion';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DynamicActionCard, type DynamicActionCardStatus } from './DynamicActionCard';

const AUTO_TRIGGER_DELAY_MS = 5000;
const AUTO_TRIGGER_MIN_CONFIDENCE = 0.9;

type DynamicActionGenerationOptions = {
  source: 'dynamic_action';
  persist: true;
  triggerSource: 'manual' | 'auto_countdown';
  modeEvent: DynamicActionModeEvent;
};

type DynamicActionModeEvent = ElectronDynamicActionModeEvent;

type DynamicActionView = DynamicActionPayload & {
  uiStatus?: DynamicActionCardStatus;
  autoTriggerAt?: number;
};

const isSemiAutoAction = (action: DynamicActionPayload): boolean =>
  action.autoTriggerEligible === true &&
  action.autoSurfacePolicy === 'auto' &&
  action.confidence >= AUTO_TRIGGER_MIN_CONFIDENCE;

const buildDynamicActionModeEvent = (action: DynamicActionPayload): DynamicActionModeEvent => ({
  modeTemplateType: action.modeTemplateType,
  intent: action.sourceIntent || action.type,
  confidence: action.confidence,
  latestTurn: action.latestTurn,
  emotion: action.emotion,
  emotionSource: action.emotionSource,
  language: action.language,
  keyEntities: action.keyEntities,
  retrievalQuery: action.retrievalQuery,
  autoSurfacePolicy: action.autoSurfacePolicy,
  promptInstruction: action.promptInstruction,
  answerShape: action.answerStyle?.format,
});

interface Props {
  // Called when the user accepts (or hits Tab on the primary). Parent should
  // kick off the live answer stream using action.promptInstruction.
  onAcceptAction: (action: DynamicActionPayload, options: DynamicActionGenerationOptions) => Promise<void>;
  // Optional: max actions to keep visible. Cluely-style cap at 3.
  maxVisible?: number;
  // Optional: how long actions stay visible without user interaction (ms).
  // Server side already expires; this is the renderer-side cap.
  staleAfterMs?: number;
}

// DynamicActionBar — Cluely-style live action card row.
// Subscribes to intelligence-dynamic-action events from the main process,
// dedupes by id, expires stale cards, and renders up to maxVisible cards.
// Tab keypress accepts the primary (highest-priority) card.
export const DynamicActionBar: React.FC<Props> = ({
  onAcceptAction,
  maxVisible = 3,
  staleAfterMs = 60_000,
}) => {
  const [actions, setActions] = useState<DynamicActionView[]>([]);
  const actionsRef = useRef(actions);
  const autoTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const dismissRemovalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const triggeringIdsRef = useRef<Set<string>>(new Set());
  actionsRef.current = actions;

  const clearAutoTimer = useCallback((id: string) => {
    const timer = autoTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      autoTimersRef.current.delete(id);
    }
  }, []);

  const clearDismissRemovalTimer = useCallback((id: string) => {
    const timer = dismissRemovalTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissRemovalTimersRef.current.delete(id);
    }
  }, []);

  const accept = useCallback(
    async (action: DynamicActionPayload, triggerSource: 'manual' | 'auto_countdown' = 'manual') => {
      if (triggeringIdsRef.current.has(action.id)) return;
      triggeringIdsRef.current.add(action.id);
      clearAutoTimer(action.id);
      clearDismissRemovalTimer(action.id);
      setActions((prev) =>
        prev.map((a) => (a.id === action.id ? { ...a, uiStatus: 'generating' } : a)),
      );
      try {
        await window.electronAPI?.acceptDynamicAction?.(action.id, { triggerSource });
        await onAcceptAction(action, {
          source: 'dynamic_action',
          persist: true,
          triggerSource,
          modeEvent: buildDynamicActionModeEvent(action),
        });
        await window.electronAPI?.completeDynamicAction?.(action.id);
        setActions((prev) => prev.filter((a) => a.id !== action.id));
      } catch {
        await window.electronAPI?.failDynamicActionGeneration?.(action.id).catch(() => undefined);
        setActions((prev) =>
          prev.map((a) => (a.id === action.id ? { ...a, uiStatus: 'failed' } : a)),
        );
        triggeringIdsRef.current.delete(action.id);
        return;
      }
    },
    [clearAutoTimer, clearDismissRemovalTimer, onAcceptAction],
  );

  const scheduleAutoTrigger = useCallback(
    (action: DynamicActionView) => {
      if (!isSemiAutoAction(action) || autoTimersRef.current.has(action.id)) return;
      const timer = setTimeout(() => {
        autoTimersRef.current.delete(action.id);
        const current = actionsRef.current.find((a) => a.id === action.id);
        if (!current || current.uiStatus === 'cancelled') return;
        void accept(current, 'auto_countdown');
      }, AUTO_TRIGGER_DELAY_MS);
      autoTimersRef.current.set(action.id, timer);
    },
    [accept],
  );

  const handleIncoming = useCallback(
    (action: DynamicActionPayload) => {
      const isAuto = isSemiAutoAction(action);
      const actionView: DynamicActionView = isAuto
        ? {
            ...action,
            uiStatus: 'countdown',
            autoTriggerAt: Date.now() + AUTO_TRIGGER_DELAY_MS,
          }
        : {
            ...action,
            uiStatus: 'candidate',
          };
      setActions((prev) => {
        // Dedupe by id (engine has already deduped at backend, but renderer
        // may receive late-arriving duplicates after a window restore).
        if (prev.some((a) => a.id === action.id)) return prev;
        // Sort by priority desc, then createdAt desc (newer first when tied).
        const next = [...prev, actionView]
          .filter((a) => Date.now() - a.createdAt < staleAfterMs)
          .sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
        return next.slice(0, maxVisible * 2); // keep a small buffer past the visible cap
      });
      if (isAuto) scheduleAutoTrigger(actionView);
    },
    [staleAfterMs, maxVisible, scheduleAutoTrigger],
  );

  const dismiss = useCallback((id: string) => {
    clearAutoTimer(id);
    triggeringIdsRef.current.delete(id);
    clearDismissRemovalTimer(id);
    setActions((prev) =>
      prev.map((a) => (a.id === id ? { ...a, uiStatus: 'cancelled' } : a)),
    );
    const removalTimer = setTimeout(() => {
      dismissRemovalTimersRef.current.delete(id);
      setActions((prev) => prev.filter((a) => a.id !== id));
    }, 650);
    dismissRemovalTimersRef.current.set(id, removalTimer);
    window.electronAPI?.dismissDynamicAction?.(id).catch(() => {
      /* swallow */
    });
  }, [clearAutoTimer, clearDismissRemovalTimer]);

  // Subscribe to push from main process
  useEffect(() => {
    const off = window.electronAPI?.onIntelligenceDynamicAction?.((data) => {
      if (data?.action) handleIncoming(data.action);
    });
    return () => {
      try {
        off?.();
      } catch {
        /* ignore */
      }
    };
  }, [handleIncoming]);

  useEffect(() => {
    return () => {
      autoTimersRef.current.forEach((timer) => clearTimeout(timer));
      autoTimersRef.current.clear();
      dismissRemovalTimersRef.current.forEach((timer) => clearTimeout(timer));
      dismissRemovalTimersRef.current.clear();
      triggeringIdsRef.current.clear();
    };
  }, []);

  // Keyboard: Tab accepts primary
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const visible = actionsRef.current.slice(0, maxVisible);
      if (visible.length === 0) return;
      // Don't hijack Tab if focus is in an editable element — the user is typing.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
      }
      e.preventDefault();
      void accept(visible[0]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accept, maxVisible]);

  useEffect(() => {
    if (!actions.some((a) => a.uiStatus === 'countdown')) return;
    const t = setInterval(() => {
      setActions((prev) => prev.map((action) => {
        if (action.uiStatus !== 'countdown' || !action.autoTriggerAt) return action;
        if (action.autoTriggerAt <= Date.now()) {
          return { ...action, uiStatus: 'generating' };
        }
        return { ...action };
      }));
    }, 1_000);
    return () => clearInterval(t);
  }, [actions]);

  // Periodic stale prune (cheap) — only run when actions exist
  useEffect(() => {
    if (actions.length === 0) return;
    const t = setInterval(() => {
      setActions((prev) => {
        if (prev.length === 0) return prev;
        const fresh = prev.filter((a) => Date.now() - a.createdAt < staleAfterMs);
        const freshIds = new Set(fresh.map((a) => a.id));
        prev.forEach((a) => {
          if (!freshIds.has(a.id)) clearAutoTimer(a.id);
        });
        return fresh;
      });
    }, 5_000);
    return () => clearInterval(t);
  }, [staleAfterMs, actions.length, clearAutoTimer]);

  const visible = useMemo(() => actions.slice(0, maxVisible), [actions, maxVisible]);

  if (visible.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-1.5 px-3 pt-1 pb-1 w-full"
      data-testid="dynamic-action-bar"
      aria-label="建议操作"
    >
      <AnimatePresence initial={false}>
        {visible.map((a, i) => (
          <DynamicActionCard
            key={a.id}
            action={a}
            isPrimary={i === 0}
            status={a.uiStatus}
            countdownSeconds={
              a.autoTriggerAt ? Math.ceil(Math.max(0, a.autoTriggerAt - Date.now()) / 1000) : undefined
            }
            onAccept={accept}
            onDismiss={dismiss}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};
