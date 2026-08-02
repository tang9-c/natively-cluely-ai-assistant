import type {
  DynamicActionModeEvent as ElectronDynamicActionModeEvent,
  DynamicActionPayload,
} from '@/types/electron';
import { AnimatePresence } from 'framer-motion';
import { CloudOff } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DynamicActionAvailabilityEvent } from '../../../shared/dynamicActionAvailability';
import { DynamicActionCard, type DynamicActionCardStatus } from './DynamicActionCard';

const AUTO_TRIGGER_DELAY_MS = 5000;
const AUTO_TRIGGER_MIN_CONFIDENCE = 0.9;
const AVAILABILITY_STATUS_TTL_MS = 30_000;

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
  actionId: action.id,
  parentActionId: action.parentActionId,
  actionType: action.type,
  sourceIntent: action.sourceIntent,
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
  productContract: {
    outputType: action.productContract.outputType,
    contextNeedDecision: action.productContract.contextNeedDecision,
  },
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
  const [availability, setAvailability] = useState<DynamicActionAvailabilityEvent | null>(null);
  const actionsRef = useRef(actions);
  const autoTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const dismissRemovalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const availabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      if (action.status === 'dismissed') {
        clearAutoTimer(action.id);
        triggeringIdsRef.current.delete(action.id);
        clearDismissRemovalTimer(action.id);
        setActions((prev) => prev.filter((item) => item.id !== action.id));
        return;
      }
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
    const clearAvailabilityTimer = () => {
      if (availabilityTimerRef.current) {
        clearTimeout(availabilityTimerRef.current);
        availabilityTimerRef.current = null;
      }
    };
    const off = window.electronAPI?.onIntelligenceDynamicActionAvailability?.((event) => {
      clearAvailabilityTimer();
      if (event.status === 'available') {
        setAvailability(null);
        return;
      }
      setAvailability(event);
      availabilityTimerRef.current = setTimeout(() => {
        availabilityTimerRef.current = null;
        setAvailability(null);
      }, AVAILABILITY_STATUS_TTL_MS);
    });
    return () => {
      clearAvailabilityTimer();
      off?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      autoTimersRef.current.forEach((timer) => clearTimeout(timer));
      autoTimersRef.current.clear();
      dismissRemovalTimersRef.current.forEach((timer) => clearTimeout(timer));
      dismissRemovalTimersRef.current.clear();
      if (availabilityTimerRef.current) clearTimeout(availabilityTimerRef.current);
      availabilityTimerRef.current = null;
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
  const availabilityCopy = availability?.status === 'local_fallback'
    ? {
        title: '云端服务繁忙，部分明确提示已切换为受限本地判断',
        detail: '会议与转录继续正常，服务恢复后将自动重试',
      }
    : availability?.status === 'selected_model_unavailable'
      ? {
          title: '当前所选模型暂不可用，智能卡片无法判断',
          detail: '会议与转录继续正常，请检查当前模型后重试',
        }
      : availability?.status === 'selected_model_not_configured'
        ? {
            title: '请在 AI 提供商中配置并选择可用模型',
            detail: '会议与转录继续正常，配置完成后将自动重试',
          }
        : availability?.status === 'scope_denied'
          ? {
              title: '当前所选模型不允许使用转录内容',
              detail: '请在 AI 提供商的数据范围中允许“转写内容”',
            }
          : {
              title: '云端服务繁忙，智能卡片暂不可用',
              detail: '会议与转录继续正常，服务恢复后将自动重试',
            };

  if (visible.length === 0 && !availability) return null;

  return (
    <div
      className="flex flex-col gap-1.5 px-3 pt-1 pb-1 w-full"
      data-testid="dynamic-action-bar"
      aria-label="建议操作"
    >
      {availability && (
        <div
          role="status"
          aria-live="polite"
          data-testid="dynamic-action-availability"
          className="flex items-start gap-2 rounded-md border border-amber-400/25 bg-amber-400/10 px-2.5 py-2 text-amber-800 shadow-sm dark:text-amber-200"
        >
          <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />
          <div className="min-w-0 text-[11px] leading-snug">
            <div className="font-semibold">
              {availabilityCopy.title}
            </div>
            <div className="mt-0.5 opacity-75">
              {availabilityCopy.detail}
            </div>
          </div>
        </div>
      )}
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
