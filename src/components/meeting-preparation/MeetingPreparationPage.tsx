import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleStop,
  FileText,
  Loader2,
  Mic2,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  HistoryCandidate,
  MeetingContext,
  MeetingPreparationRecord,
  MeetingPreparationTemplateType,
  ModeRecommendation,
  PreparationOperation,
} from '../../../shared/meetingPreparation';

interface MeetingPreparationPageProps {
  onBack: () => void;
  onOpenResearch: () => void;
  onOpenSettings: (tab?: string) => void;
  onStartMeeting: () => Promise<boolean> | boolean;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';
type Step = 1 | 2 | 3;
type ConfirmationView = 'details' | 'mode';

interface AvailableMode {
  id: string;
  name: string;
  templateType: MeetingPreparationTemplateType;
}

const emptyEvidence = () => ({
  knowledgeRequirements: [] as string[],
  supported: [] as string[],
  missing: [] as string[],
  limitations: [] as string[],
  citations: [],
  handlingScript: '',
  followupQuestions: [] as string[],
});

const formatDuration = (seconds: number): string =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

const statusLabel: Record<string, string> = {
  sufficient: '资料充分',
  partial: '部分准备',
  missing: '资料缺失',
  not_needed: '无需内部资料',
};

export const MeetingPreparationPage: React.FC<MeetingPreparationPageProps> = ({
  onBack,
  onOpenResearch,
  onOpenSettings,
  onStartMeeting,
}) => {
  const [record, setRecord] = useState<MeetingPreparationRecord | null>(null);
  const [records, setRecords] = useState<MeetingPreparationRecord[]>([]);
  const [availableModes, setAvailableModes] = useState<AvailableMode[]>([]);
  const [historyCandidates, setHistoryCandidates] = useState<HistoryCandidate[]>([]);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [confirmationView, setConfirmationView] = useState<ConfirmationView>('details');
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [activeOperation, setActiveOperation] = useState<PreparationOperation | null>(null);
  const [evidenceChecking, setEvidenceChecking] = useState(false);
  const [checkingQuestionId, setCheckingQuestionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showRecords, setShowRecords] = useState(false);
  const recordRef = useRef<MeetingPreparationRecord | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dictationBaseRef = useRef('');
  const dictationOriginalRef = useRef('');
  const skipAutosaveRef = useRef(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const recordsMenuRef = useRef<HTMLDivElement | null>(null);
  const recordsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(true);
  const pendingQuestionFocusRef = useRef<string | null>(null);

  const showConfirmationView = useCallback((view: ConfirmationView) => {
    setConfirmationView(view);
    requestAnimationFrame(() => mainRef.current?.scrollTo({ top: 0 }));
  }, []);

  const acceptRecord = useCallback((next: MeetingPreparationRecord) => {
    recordRef.current = next;
    skipAutosaveRef.current = true;
    setRecord(next);
    setRecords((current) => [next, ...current.filter((item) => item.id !== next.id)]);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      window.electronAPI.meetingPreparationList(),
      window.electronAPI.modesGetAll(),
    ]).then(async ([existing, modes]) => {
      if (!mounted) return;
      setAvailableModes(modes.filter(
        (mode): mode is (typeof modes)[number] & { templateType: MeetingPreparationTemplateType } =>
          mode.templateType === 'sales'
          || mode.templateType === 'fde'
          || mode.templateType === 'recruiting'
          || mode.templateType === 'team-meet',
      ));
      setRecords(existing);
      const current = await window.electronAPI.meetingPreparationSave({ rawInput: '', inputMethod: 'text' });
      if (!mounted) return;
      acceptRecord(current);
      setStep(1);
      setConfirmationView('details');
    }).catch(() => {
      if (mounted) setError('无法载入会议准备，请稍后重试。');
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [acceptRecord]);

  const updateRecord = useCallback((updater: (current: MeetingPreparationRecord) => MeetingPreparationRecord) => {
    setRecord((current) => {
      if (!current) return current;
      const next = updater(current);
      recordRef.current = next;
      return next;
    });
  }, []);

  const addQuestion = () => {
    const questionId = `question_manual_${Date.now()}`;
    pendingQuestionFocusRef.current = questionId;
    updateRecord((current) => ({
      ...current,
      questions: [
        ...current.questions,
        {
          id: questionId,
          sortOrder: current.questions.length,
          question: '',
          keyMomentType: 'custom',
          rationale: [],
          evidenceStatus: null,
          evidence: emptyEvidence(),
          checkedAt: null,
        },
      ],
    }));
  };

  const saveNow = useCallback(async (): Promise<MeetingPreparationRecord | null> => {
    const current = recordRef.current;
    if (!current) return null;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    try {
      const saved = await window.electronAPI.meetingPreparationSave({
        id: current.id,
        status: current.status,
        rawInput: current.rawInput,
        inputMethod: current.inputMethod,
        meetingContext: current.meetingContext,
        selectedModeId: current.selectedModeId,
        linkedMeetingId: current.linkedMeetingId,
        result: current.result,
        questions: current.questions,
      });
      acceptRecord(saved);
      setSaveStatus('saved');
      return saved;
    } catch {
      setSaveStatus('failed');
      return null;
    }
  }, [acceptRecord]);

  useEffect(() => {
    if (!record || loading) return;
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(() => { void saveNow(); }, 400);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [record, loading, saveNow]);

  useEffect(() => {
    if (saveStatus !== 'failed') return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveStatus]);

  useEffect(() => {
    if (!showRecords) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!recordsMenuRef.current?.contains(event.target as Node)) setShowRecords(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowRecords(false);
      recordsTriggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showRecords]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onMeetingPreparationDictationTranscript((payload) => {
      const combined = [dictationBaseRef.current.trim(), payload.text.trim()].filter(Boolean).join('\n');
      updateRecord((current) => ({ ...current, rawInput: combined, inputMethod: 'voice' }));
      if (payload.final) dictationBaseRef.current = combined;
    });
    return () => {
      unsubscribe();
      void window.electronAPI.meetingPreparationDictationCancel();
    };
  }, [updateRecord]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => setRecordingSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  const context = record?.meetingContext;
  const isEditingLocked = activeOperation !== null || evidenceChecking;
  const isOperationLocked = activeOperation !== null;
  const selectedMode = availableModes.find((mode) => mode.id === record?.selectedModeId);

  const updateContext = (patch: Partial<MeetingContext>) => {
    updateRecord((current) => ({
      ...current,
      meetingContext: current.meetingContext ? { ...current.meetingContext, ...patch } : null,
    }));
  };

  const runOperation = async <T,>(operation: PreparationOperation, work: () => Promise<T>): Promise<T | null> => {
    if (activeOperation) return null;
    setActiveOperation(operation);
    setError('');
    try {
      return await work();
    } catch {
      setError('操作没有完成，原内容已保留。请重试。');
      return null;
    } finally {
      setActiveOperation(null);
    }
  };

  const parseInput = async () => {
    if (!record?.rawInput.trim()) {
      setError('请先用文字或语音描述这场会议。');
      return;
    }
    await runOperation('parse', async () => {
      const saved = await saveNow();
      if (!saved) throw new Error('save_failed');
      const response = await window.electronAPI.meetingPreparationParseInput({
        id: saved.id,
        rawInput: saved.rawInput,
      });
      if (!response.success) throw new Error(response.error);
      const updated = await window.electronAPI.meetingPreparationSave({
        ...saved,
        meetingContext: response.result,
      });
      acceptRecord(updated);
      showConfirmationView('details');
      setStep(2);
    });
  };

  const prepareContext = async () => {
    if (!record?.meetingContext) return;
    await runOperation('prepare_context', async () => {
      const saved = await saveNow();
      if (!saved?.meetingContext) throw new Error('save_failed');
      const response = await window.electronAPI.meetingPreparationPrepareContext({
        id: saved.id,
        context: saved.meetingContext,
      });
      if (!response.success) throw new Error(response.error);
      setHistoryCandidates(response.result.historyCandidates);
      setHistoryUnavailable(response.result.historyUnavailable);
      const latest = await window.electronAPI.meetingPreparationGet(saved.id);
      if (latest) acceptRecord(latest);
      showConfirmationView('mode');
    });
  };

  const runProgressiveEvidenceChecks = async (baseRecord: MeetingPreparationRecord): Promise<void> => {
    const pendingQuestionIds = baseRecord.questions
      .filter((question) => question.evidenceStatus === null && !question.evidence.checkError)
      .map((question) => question.id);
    if (pendingQuestionIds.length === 0) return;

    if (mountedRef.current) {
      setShowRecords(false);
      setEvidenceChecking(true);
    }
    try {
      for (const questionId of pendingQuestionIds) {
        if (mountedRef.current) setCheckingQuestionId(questionId);
        try {
          const response = await window.electronAPI.meetingPreparationRecheckQuestion({
            preparationId: baseRecord.id,
            questionId,
          });
          if (!response.success) continue;
          if (mountedRef.current && recordRef.current?.id === response.result.id) {
            acceptRecord(response.result);
          }
        } catch {
          continue;
        }
      }
    } finally {
      if (mountedRef.current) {
        setCheckingQuestionId(null);
        setEvidenceChecking(false);
      }
    }
  };

  const generate = async () => {
    if (!record?.selectedModeId) {
      setError('请先确认推荐模式。');
      return;
    }
    await runOperation('generate', async () => {
      const saved = await saveNow();
      if (!saved) throw new Error('save_failed');
      const response = await window.electronAPI.meetingPreparationGenerate(saved.id);
      if (!response.success) throw new Error(response.error);
      acceptRecord(response.result);
      setStep(3);
      void runProgressiveEvidenceChecks(response.result);
    });
  };

  const recheckQuestion = async (questionId: string) => {
    if (!record) return;
    await runOperation('recheck', async () => {
      const saved = await saveNow();
      if (!saved) throw new Error('save_failed');
      const response = await window.electronAPI.meetingPreparationRecheckQuestion({
        preparationId: saved.id,
        questionId,
      });
      if (!response.success) throw new Error(response.error);
      acceptRecord(response.result);
    });
  };

  const startDictation = async () => {
    if (!record || isEditingLocked) return;
    dictationOriginalRef.current = record.rawInput;
    dictationBaseRef.current = record.rawInput;
    setRecordingSeconds(0);
    const result = await window.electronAPI.meetingPreparationDictationStart();
    if (!result.success) {
      setError(result.error === 'audio_session_busy' ? '麦克风正在被其他会话使用，请改用文字输入。' : '语音输入不可用，请改用文字输入。');
      return;
    }
    setIsRecording(true);
  };

  const stopDictation = async () => {
    await window.electronAPI.meetingPreparationDictationStop();
    setIsRecording(false);
  };

  const cancelDictation = async () => {
    await window.electronAPI.meetingPreparationDictationCancel();
    updateRecord((current) => ({ ...current, rawInput: dictationOriginalRef.current }));
    setIsRecording(false);
  };

  const cancelOperation = async () => {
    if (!record || !activeOperation) return;
    await window.electronAPI.meetingPreparationCancelOperation(record.id);
  };

  const chooseMode = (mode: AvailableMode) => {
    updateRecord((current) => {
      const prior = current.result.modeRecommendation;
      const recommendation: ModeRecommendation = {
        modeId: mode.id,
        templateType: mode.templateType,
        label: mode.name,
        reason: prior?.modeId === mode.id ? prior.reason : '用户选择',
        focus: prior?.modeId === mode.id ? prior.focus : '',
      };
      return {
        ...current,
        selectedModeId: mode.id,
        result: { ...current.result, modeRecommendation: recommendation },
      };
    });
  };

  const openRecord = (next: MeetingPreparationRecord) => {
    acceptRecord(next);
    setStep(next.status === 'ready' ? 3 : next.meetingContext ? 2 : 1);
    showConfirmationView(next.result.modeRecommendation ? 'mode' : 'details');
    setHistoryCandidates([]);
    setShowRecords(false);
  };

  const createRecord = async () => {
    const created = await window.electronAPI.meetingPreparationSave({ rawInput: '', inputMethod: 'text' });
    acceptRecord(created);
    setStep(1);
    showConfirmationView('details');
    setHistoryCandidates([]);
    setShowRecords(false);
  };

  const deleteRecord = async (id: string) => {
    await window.electronAPI.meetingPreparationDelete(id);
    const remaining = records.filter((item) => item.id !== id);
    setRecords(remaining);
    if (record?.id !== id) return;
    if (remaining[0]) openRecord(remaining[0]);
    else await createRecord();
  };

  const leave = async () => {
    if (saveStatus === 'failed') {
      setError('草稿尚未保存，请先重试保存。');
      return;
    }
    if (!evidenceChecking) await saveNow();
    onBack();
  };

  const openResearch = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    await saveNow();
    onOpenResearch();
  };

  const startPreparedMeeting = async () => {
    if (!record) return;
    const applied = await window.electronAPI.meetingPreparationApplyMode(record.id);
    if (!applied.success) {
      setError('推荐模式不可用，请重新确认模式。');
      return;
    }
    await onStartMeeting();
  };

  const stepNames = useMemo(() => ['描述会议', '确认信息与模式', '查看准备结果'], []);

  if (loading || !record) {
    return <div className="flex h-full items-center justify-center text-text-secondary"><Loader2 className="mr-2 animate-spin" />正在载入会议准备…</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-primary" data-testid="meeting-preparation-page">
      <div className="shrink-0 border-b border-border-subtle bg-bg-secondary/80 px-8 py-5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => { void leave(); }} disabled={isOperationLocked} aria-label="返回" className="rounded-full p-2 text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary disabled:opacity-40">
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-400"><Sparkles size={13} />会议准备</div>
              <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.03em]">会议作战准备卡</h1>
            </div>
          </div>
          <div ref={recordsMenuRef} className="relative flex items-center gap-3">
            <span className={`text-[11px] ${saveStatus === 'failed' ? 'text-red-400' : 'text-text-tertiary'}`}>
              {saveStatus === 'saving' ? '保存中' : saveStatus === 'saved' ? '已保存' : saveStatus === 'failed' ? '保存失败' : ''}
            </span>
            <button ref={recordsTriggerRef} type="button" disabled={isEditingLocked} aria-expanded={showRecords} aria-controls="recent-preparations-menu" aria-haspopup="menu" onClick={() => setShowRecords((value) => !value)} className="flex items-center gap-2 rounded-full border border-border-subtle bg-bg-elevated px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-40">
              最近准备 <ChevronDown size={13} className={`transition-transform ${showRecords ? 'rotate-180' : ''}`} />
            </button>
            {showRecords && (
              <div id="recent-preparations-menu" role="menu" className="absolute right-0 top-11 z-30 max-h-[min(70vh,32rem)] w-80 overflow-y-auto rounded-2xl border border-border-subtle bg-bg-elevated p-2 shadow-2xl custom-scrollbar">
                <button type="button" onClick={() => { void createRecord(); }} className="mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] text-sky-400 hover:bg-sky-500/10"><Plus size={14} />准备一场新会议</button>
                {records.map((item) => (
                  <div key={item.id} className="group flex items-center rounded-xl hover:bg-bg-item-surface">
                    <button type="button" onClick={() => openRecord(item)} className="min-w-0 flex-1 px-3 py-2 text-left">
                      <div className="truncate text-[12px] font-medium text-text-primary">{item.meetingContext?.topic.value || item.rawInput || '未命名会议'}</div>
                      <div className="mt-0.5 text-[10px] text-text-tertiary">{new Date(item.updatedAt).toLocaleString()}</div>
                    </button>
                    <button type="button" aria-label="删除准备" onClick={() => { void deleteRecord(item.id); }} className="mr-2 rounded-lg p-1.5 text-text-tertiary opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mx-auto mt-5 grid max-w-3xl grid-cols-3 gap-2">
          {stepNames.map((name, index) => {
            const value = (index + 1) as Step;
            const active = value === step;
            const complete = value < step;
            return (
              <div key={name} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] ${active ? 'bg-sky-500/15 text-sky-300' : complete ? 'text-emerald-400' : 'text-text-tertiary'}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${active ? 'border-sky-400' : complete ? 'border-emerald-400' : 'border-border-muted'}`}>{complete ? <Check size={11} /> : value}</span>
                {name}
              </div>
            );
          })}
        </div>
      </div>

      <main ref={mainRef} className="flex-1 overflow-y-auto px-8 py-7 custom-scrollbar">
        <div className="mx-auto max-w-4xl">
          {error && (
            <div className="mb-5 flex items-center justify-between rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[12px] text-red-300">
              <span className="flex items-center gap-2"><AlertCircle size={15} />{error}</span>
              <button type="button" aria-label="关闭错误" onClick={() => setError('')}><X size={14} /></button>
            </div>
          )}

          {step === 1 && (
            <section className="grid gap-5 lg:grid-cols-[1fr_250px]">
              <div className="rounded-[24px] border border-border-subtle bg-bg-elevated p-6">
                <h2 className="text-[18px] font-semibold">描述会议</h2>
                <p className="mt-1 text-[12px] leading-5 text-text-secondary">说清楚客户、对象、目标和背景即可，AI 会拆成可编辑字段。</p>
                <textarea
                  aria-label="会议描述"
                  value={record.rawInput}
                  disabled={isEditingLocked}
                  readOnly={isRecording}
                  onChange={(event) => updateRecord((current) => ({ ...current, rawInput: event.target.value, inputMethod: 'text' }))}
                  placeholder="例如：明天下午和启明机器人研发总监做产品技术交流，希望了解集成条件并准备机器人行业案例。"
                  className="mt-5 min-h-[220px] w-full resize-none rounded-2xl border border-border-subtle bg-bg-primary p-4 text-[14px] text-text-primary leading-6 outline-none transition-colors placeholder:text-text-tertiary focus:border-sky-400/60 read-only:cursor-default read-only:border-violet-400/30 disabled:opacity-60"
                />
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-[11px] text-text-tertiary">最多 20,000 字 · 文字和语音权重相同</span>
                  <button type="button" onClick={() => { void parseInput(); }} disabled={isOperationLocked || isRecording || !record.rawInput.trim()} className="flex items-center gap-2 rounded-full bg-sky-500 px-5 py-2.5 text-[12px] font-semibold text-white disabled:opacity-40">
                    {activeOperation === 'parse' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    拆解会议信息
                  </button>
                </div>
              </div>
              <aside className="rounded-[24px] border border-border-subtle bg-gradient-to-b from-violet-500/10 to-bg-elevated p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300"><Mic2 size={19} /></div>
                <h3 className="mt-4 text-[15px] font-semibold">直接说一段话</h3>
                <p className="mt-2 text-[12px] leading-5 text-text-secondary">识别内容会同步显示在左侧。停止后仍可修改转写文本，再让 AI 拆解。</p>
                {isRecording ? (
                  <div className="mt-6 space-y-3">
                    <div className="flex items-center gap-2 text-[12px] text-red-300"><span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />录音中 {formatDuration(recordingSeconds)}</div>
                    <button type="button" onClick={() => { void stopDictation(); }} className="flex w-full items-center justify-center gap-2 rounded-full bg-red-500 px-4 py-2.5 text-[12px] font-semibold text-white"><CircleStop size={14} />停止听写</button>
                    <button type="button" onClick={() => { void cancelDictation(); }} className="w-full rounded-full border border-border-subtle px-4 py-2 text-[11px] text-text-secondary">取消并恢复原文</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => { void startDictation(); }} disabled={isOperationLocked} className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-violet-600 px-4 py-2.5 text-[12px] font-semibold text-white shadow-lg shadow-violet-500/20 transition-colors hover:bg-violet-700 disabled:opacity-40"><Mic2 size={14} />开始语音输入</button>
                )}
              </aside>
            </section>
          )}

          {step === 2 && context && (
            <section className="space-y-5">
              {confirmationView === 'details' ? (
                <div className="rounded-[24px] border border-border-subtle bg-bg-elevated p-6">
                  <div className="flex items-start justify-between gap-5">
                    <div><h2 className="text-[18px] font-semibold">确认会议信息</h2><p className="mt-1 text-[12px] text-text-secondary">修正 AI 拆解结果后，再让 AI 推荐模式和可关联的历史会议。</p></div>
                    <button type="button" onClick={() => setStep(1)} disabled={isEditingLocked} className="text-[11px] text-text-secondary hover:text-text-primary">返回修改描述</button>
                  </div>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="text-[11px] text-text-secondary">主题<input aria-label="主题" disabled={isEditingLocked} value={context.topic.value} onChange={(event) => updateContext({ topic: { value: event.target.value, state: 'confirmed' } })} className="mt-1.5 w-full rounded-xl border border-border-subtle bg-bg-primary px-3 py-2.5 text-[13px] text-text-primary outline-none focus:border-sky-400/60" /></label>
                    <label className="text-[11px] text-text-secondary">客户<input aria-label="客户" disabled={isEditingLocked} value={context.customer.value} onChange={(event) => updateContext({ customer: { value: event.target.value, state: 'confirmed' } })} className="mt-1.5 w-full rounded-xl border border-border-subtle bg-bg-primary px-3 py-2.5 text-[13px] text-text-primary outline-none focus:border-sky-400/60" /></label>
                    <label className="text-[11px] text-text-secondary">参会人<input aria-label="参会人" disabled={isEditingLocked} value={context.participants.map((item) => [item.name, item.role].filter(Boolean).join(' ')).join('、')} onChange={(event) => updateContext({ participants: event.target.value.split(/[、,，]/).map((role) => ({ name: '', role: role.trim() })).filter((item) => item.role) })} className="mt-1.5 w-full rounded-xl border border-border-subtle bg-bg-primary px-3 py-2.5 text-[13px] text-text-primary outline-none focus:border-sky-400/60" /></label>
                    <label className="text-[11px] text-text-secondary">目标<input aria-label="目标" disabled={isEditingLocked} value={context.goal.value} onChange={(event) => updateContext({ goal: { value: event.target.value, state: 'confirmed' } })} className="mt-1.5 w-full rounded-xl border border-border-subtle bg-bg-primary px-3 py-2.5 text-[13px] text-text-primary outline-none focus:border-sky-400/60" /></label>
                    <label className="text-[11px] text-text-secondary md:col-span-2">议程<textarea aria-label="议程" disabled={isEditingLocked} value={context.agenda.join('\n')} onChange={(event) => updateContext({ agenda: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} className="mt-1.5 min-h-20 w-full rounded-xl border border-border-subtle bg-bg-primary px-3 py-2.5 text-[13px] text-text-primary outline-none focus:border-sky-400/60" /></label>
                    <label className="text-[11px] text-text-secondary md:col-span-2">背景<textarea aria-label="背景" disabled={isEditingLocked} value={context.background} onChange={(event) => updateContext({ background: event.target.value })} className="mt-1.5 min-h-20 w-full rounded-xl border border-border-subtle bg-bg-primary px-3 py-2.5 text-[13px] text-text-primary outline-none focus:border-sky-400/60" /></label>
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-4 border-t border-border-subtle pt-5">
                    <a href="#company-research" onClick={openResearch} className="flex items-center gap-1.5 text-[12px] text-sky-400 hover:text-sky-300">前往公司研究 <ArrowRight size={13} /></a>
                    <button type="button" onClick={() => { void prepareContext(); }} disabled={isEditingLocked} className="flex items-center gap-2 rounded-full bg-sky-500 px-5 py-2.5 text-[12px] font-semibold text-white disabled:opacity-40">{activeOperation === 'prepare_context' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}确认并推荐模式</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-[24px] border border-border-subtle bg-bg-elevated p-5">
                    <div className="flex items-start justify-between gap-5">
                      <div><h2 className="text-[18px] font-semibold">选择模式与历史会议</h2><p className="mt-1 text-[12px] text-text-secondary">会议信息已确认。选择模式和历史会议后即可生成准备结果。</p></div>
                      <button type="button" onClick={() => showConfirmationView('details')} disabled={isEditingLocked} className="text-[11px] text-sky-400 hover:text-sky-300">返回修改信息</button>
                    </div>
                    <div className="mt-4 rounded-2xl border border-border-subtle bg-bg-primary/60 px-4 py-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">已确认的会议信息</div>
                      <dl className="mt-3 grid gap-x-5 gap-y-3 md:grid-cols-3">
                        {[
                          ['主题', context.topic.value],
                          ['客户', context.customer.value],
                          ['参会人', context.participants.map((item) => [item.name, item.role].filter(Boolean).join(' ')).join('、')],
                          ['目标', context.goal.value],
                          ['议程', context.agenda.join('；')],
                          ['背景', context.background],
                        ].map(([label, value]) => (
                          <div key={label} className="min-w-0">
                            <dt className="text-[10px] text-text-tertiary">{label}</dt>
                            <dd className="mt-0.5 truncate text-[11px] text-text-secondary" title={value || '未提供'}>{value || '未提供'}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </div>

                  {record.result.modeRecommendation && (
                    <div className="grid gap-5 lg:grid-cols-2">
                      <div className="rounded-[24px] border border-sky-400/20 bg-sky-500/10 p-5">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-400">AI 推荐</div>
                        <h3 className="mt-2 text-[18px] font-semibold">推荐模式：{record.result.modeRecommendation.label}</h3>
                        <p className="mt-2 text-[12px] leading-5 text-text-secondary">{record.result.modeRecommendation.reason}</p>
                        <div className="mt-4 flex gap-2">
                          {availableModes.map((mode) => (
                            <button key={mode.id} type="button" disabled={isEditingLocked} onClick={() => chooseMode(mode)} className={`rounded-full px-4 py-2 text-[11px] font-semibold ${record.selectedModeId === mode.id ? 'bg-sky-500 text-white' : 'border border-border-subtle text-text-secondary'}`}>{mode.name}</button>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-[24px] border border-border-subtle bg-bg-elevated p-5">
                        <div className="flex items-center justify-between"><h3 className="text-[14px] font-semibold">关联一次历史会议（可选）</h3>{historyUnavailable && <span className="text-[10px] text-amber-400">历史暂不可用</span>}</div>
                        <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border-subtle px-3 py-2 text-[11px] text-text-secondary"><input type="radio" name="history" checked={!record.linkedMeetingId} onChange={() => updateRecord((current) => ({ ...current, linkedMeetingId: null }))} />不关联，作为新会议</label>
                          {historyCandidates.map((candidate) => (
                            <label key={candidate.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-subtle px-3 py-2"><input className="mt-1" type="radio" name="history" checked={record.linkedMeetingId === candidate.id} onChange={() => updateRecord((current) => ({ ...current, linkedMeetingId: candidate.id }))} /><span className="min-w-0"><span className="block truncate text-[11px] font-medium text-text-primary">{candidate.title}</span><span className="mt-0.5 block text-[10px] text-text-tertiary">{candidate.matchReason} · {new Date(candidate.date).toLocaleDateString()}</span></span></label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {record.result.modeRecommendation && (
                    <div className="flex justify-end"><button type="button" onClick={() => { void generate(); }} disabled={isEditingLocked || !selectedMode} className="flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-violet-500 px-6 py-3 text-[12px] font-semibold text-white shadow-lg shadow-sky-500/15 disabled:opacity-40">{activeOperation === 'generate' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}生成准备结果</button></div>
                  )}
                </>
              )}
            </section>
          )}

          {step === 3 && (
            <section className="space-y-5">
              <div className="flex items-start justify-between gap-5 rounded-[24px] border border-sky-400/20 bg-gradient-to-r from-sky-500/12 to-violet-500/10 p-6">
                <div><div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-400">准备完成</div><h2 className="mt-2 text-[22px] font-semibold">{record.meetingContext?.topic.value || '会议作战准备卡'}</h2><p className="mt-2 text-[12px] text-text-secondary">{record.result.modeRecommendation ? `推荐模式：${record.result.modeRecommendation.label} · ${record.result.modeRecommendation.focus}` : '已生成会议准备结果'}</p></div>
                <button type="button" onClick={() => { showConfirmationView('mode'); setStep(2); }} disabled={isEditingLocked} className="flex items-center gap-1.5 rounded-full border border-border-subtle px-3 py-2 text-[11px] text-text-secondary"><RotateCcw size={13} />返回调整</button>
              </div>

              {record.result.historySummary.length > 0 && (
                <div className="rounded-[24px] border border-border-subtle bg-bg-elevated p-5"><h3 className="text-[14px] font-semibold">上次谈了什么</h3><ul className="mt-3 space-y-2 text-[12px] leading-5 text-text-secondary">{record.result.historySummary.map((item) => <li key={item} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-sky-400" />{item}</li>)}</ul></div>
              )}

              {record.result.commitments.length > 0 && (
                <div className="rounded-[24px] border border-border-subtle bg-bg-elevated p-5"><h3 className="text-[14px] font-semibold">尚待确认的承诺</h3><div className="mt-3 space-y-2">{record.result.commitments.map((commitment, index) => <div key={`${commitment.text}-${index}`} className="flex items-center justify-between gap-4 rounded-xl bg-bg-primary px-3 py-2"><span className="text-[12px] text-text-secondary">{commitment.text}</span><select aria-label={`承诺状态 ${index + 1}`} disabled={isEditingLocked} value={commitment.status} onChange={(event) => updateRecord((current) => ({ ...current, result: { ...current.result, commitments: current.result.commitments.map((item, itemIndex) => itemIndex === index ? { ...item, status: event.target.value as typeof item.status } : item) } }))} className="rounded-lg border border-border-subtle bg-bg-elevated px-2 py-1 text-[10px]"><option value="needs_confirmation">待确认</option><option value="pending">未兑现</option><option value="completed">已兑现</option><option value="not_needed">无需跟进</option></select></div>)}</div></div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold">可能被问到的问题</h3>
                  <button type="button" disabled={isEditingLocked} onClick={addQuestion} className="flex items-center gap-1 text-[11px] text-sky-400 disabled:opacity-30"><Plus size={13} />添加问题</button>
                </div>
                {record.questions.map((question, index) => (
                  <article key={question.id} data-testid="preparation-question" className="rounded-[24px] border border-border-subtle bg-bg-elevated p-5">
                    <div className="flex items-start gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-semibold text-sky-300">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <textarea ref={(node) => { if (!node || pendingQuestionFocusRef.current !== question.id) return; pendingQuestionFocusRef.current = null; node.focus({ preventScroll: true }); node.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} aria-label={`预测问题 ${index + 1}`} disabled={isEditingLocked} value={question.question} onChange={(event) => updateRecord((current) => ({ ...current, questions: current.questions.map((item) => item.id === question.id ? { ...item, question: event.target.value } : item) }))} className="min-h-12 w-full resize-none bg-transparent text-[14px] font-medium leading-5 outline-none" />
                        <div className="mt-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] ${question.evidenceStatus === 'sufficient' ? 'bg-emerald-500/12 text-emerald-400' : question.evidenceStatus === 'missing' ? 'bg-red-500/12 text-red-400' : question.evidenceStatus === null ? 'bg-amber-500/12 text-amber-400' : 'bg-sky-500/12 text-sky-400'}`}>{question.evidence.checkError ? '检查失败' : question.id === checkingQuestionId ? '检查中' : statusLabel[question.evidenceStatus || ''] || '等待检查'}</span>{question.rationale.map((item) => <span key={item} className="text-[10px] text-text-tertiary">{item}</span>)}</div>
                      </div>
                      <button type="button" disabled={isEditingLocked} aria-label="删除问题" onClick={() => updateRecord((current) => ({ ...current, questions: current.questions.filter((item) => item.id !== question.id).map((item, sortOrder) => ({ ...item, sortOrder })) }))} className="rounded-lg p-1.5 text-text-tertiary hover:bg-red-500/10 hover:text-red-400"><Trash2 size={14} /></button>
                    </div>
                    {(question.evidence.supported.length > 0 || question.evidence.missing.length > 0 || question.evidence.handlingScript) && <div className="mt-4 grid gap-3 border-t border-border-subtle pt-4 md:grid-cols-2">{question.evidence.supported.length > 0 && <div><div className="text-[10px] font-semibold text-emerald-400">有证据支持</div><p className="mt-1 text-[11px] leading-5 text-text-secondary">{question.evidence.supported.join('；')}</p></div>}{question.evidence.missing.length > 0 && <div><div className="text-[10px] font-semibold text-red-400">仍缺资料</div><p className="mt-1 text-[11px] leading-5 text-text-secondary">{question.evidence.missing.join('；')}</p></div>}{question.evidence.handlingScript && <div className="md:col-span-2 rounded-xl bg-bg-primary px-3 py-2 text-[11px] leading-5 text-text-secondary"><span className="font-semibold text-text-primary">承接话术：</span>{question.evidence.handlingScript}</div>}</div>}
                    {question.evidence.citations.length > 0 && <details className="mt-3 text-[11px] text-text-secondary"><summary className="cursor-pointer text-sky-400">查看可信来源（{question.evidence.citations.length}）</summary><div className="mt-2 space-y-1">{question.evidence.citations.map((citation) => <div key={`${citation.sourceId}-${citation.chunkId}`} className="rounded-lg bg-bg-primary px-3 py-2">{citation.title} · Chunk {citation.chunkId}</div>)}</div></details>}
                    <div className="mt-4 flex items-center justify-end gap-2"><button type="button" onClick={() => onOpenSettings('knowledge')} className="rounded-full border border-border-subtle px-3 py-1.5 text-[10px] text-text-secondary">补充资料</button><button type="button" disabled={isEditingLocked || !question.question.trim()} onClick={() => { void recheckQuestion(question.id); }} className="flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-[10px] text-sky-300 disabled:opacity-40">{activeOperation === 'recheck' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}重新检查</button></div>
                  </article>
                ))}
              </div>

              <div className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-border-subtle bg-bg-primary/90 py-4 backdrop-blur-xl"><span className="text-[11px] text-text-tertiary">准备结果不会注入会中回答；只应用已确认模式。</span><button type="button" disabled={activeOperation !== null} onClick={() => { void startPreparedMeeting(); }} className="flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-[12px] font-semibold text-white shadow-lg shadow-emerald-500/20 disabled:opacity-40"><Check size={14} />使用推荐模式开始会议</button></div>
            </section>
          )}
        </div>
      </main>

      {activeOperation !== null && (
        <div className="absolute bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border-subtle bg-bg-elevated px-4 py-2 text-[11px] shadow-2xl"><Loader2 size={13} className="animate-spin text-sky-400" />AI 正在处理，期间暂不可修改<button type="button" onClick={() => { void cancelOperation(); }} className="text-red-400">取消</button></div>
      )}
    </div>
  );
};
