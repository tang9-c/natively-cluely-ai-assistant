import React, { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, LockKeyhole } from 'lucide-react';
import { derivePreparationDecision } from '../../../shared/onboarding';
import type { MeetingStartResult, OnboardingSnapshot, OnboardingStateResult, OnboardingStep } from '../../../shared/onboarding';
import { useState } from 'react';
import PermissionsStep from './PermissionsStep';
import SpeechStep from './SpeechStep';
import AiServiceStep from './AiServiceStep';
import type { OnboardingFormGuard } from '../../hooks/useOnboarding';
import { onboardingErrorText } from '../../utils/onboardingActions';
import PreparationOverview, { onboardingLabels } from './PreparationOverview';
const steps = ['overview', 'permissions', 'speech', 'ai', 'ready'] as const;
export default function OnboardingFlow({ snapshot, pending, error, confirmLeave, onNavigate, onDefer, onOpenSettings, onResolveLeave, refresh, registerFormGuard, onStartMeeting, renderStep }: {
  refresh(): Promise<OnboardingStateResult>; registerFormGuard(form: OnboardingFormGuard): () => void; onStartMeeting(): Promise<MeetingStartResult>;
  snapshot: OnboardingSnapshot; pending: boolean; error: string | null; confirmLeave: boolean;
  onNavigate(step: OnboardingStep): unknown; onDefer(): unknown; onOpenSettings(tab: string): void;
  onResolveLeave(choice: 'save' | 'discard' | 'stay'): unknown; renderStep?(step: OnboardingStep): React.ReactNode;
}) {
  const [localError, setLocalError] = useState<string | null>(null), [starting, setStarting] = useState(false);
  const [retention, setRetention] = useState('forever');
  const [deviceNames, setDeviceNames] = useState({ input: '系统默认', output: '系统默认' });
  const [provisioning, setProvisioning] = useState(false);
  const startLock = useRef(false);
  const download = useRef<{ modelId: string; revision: number; provider: string } | null>(null);
  useEffect(() => {
    const api = window.electronAPI;
    const complete = async (event: { modelId: string }) => {
      const operation = download.current;
      if (!operation || event.modelId !== operation.modelId) return;
      download.current = null;
      const current = await refresh();
      if (!current.success || current.snapshot.progress.configRevision.stt !== operation.revision || current.snapshot.checks.stt.provider !== operation.provider) return;
      const result = await api.validateOnboardingService({ target: 'stt', expectedRevision: operation.revision });
      if (!result.success) setLocalError(onboardingErrorText(result.errorCode));
      await refresh();
    };
    const failed = (event: { modelId: string }) => { if (event.modelId === download.current?.modelId) download.current = null; };
    const offComplete = api.onLocalSenseVoiceDownloadComplete(complete), offWhisperComplete = api.onLocalModelsDownloadComplete(complete);
    const offError = api.onLocalSenseVoiceDownloadError(failed), offWhisperError = api.onLocalModelsDownloadError(failed);
    return () => { offComplete(); offError(); offWhisperComplete(); offWhisperError(); };
  }, [refresh]);
  const beginDownload = async (modelId: string, revision: number, provider: string) => {
    download.current = { modelId, revision, provider };
    try { const result = await (provider === 'local-whisper' ? window.electronAPI.localModelsStartDownload(modelId) : window.electronAPI.localSenseVoiceStartDownload(modelId)); if (!result.success) download.current = null; return result.success; }
    catch { download.current = null; return false; }
  };
  const step = snapshot.progress.lastStep, index = steps.indexOf(step);
  const decision = derivePreparationDecision(snapshot);
  const sectionRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!confirmLeave) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button:last-child')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [confirmLeave]);
  useEffect(() => { sectionRef.current?.querySelector<HTMLElement>('h1')?.focus(); }, [step]);
  useEffect(() => {
    if (step !== 'ready') return;
    let active = true;
    const api = window.electronAPI;
    const read = async () => {
      try {
        const [policy, inputs, outputs] = await Promise.all([api.getMeetingRetention(), api.getInputDevices(), api.getOutputDevices()]);
        if (!active) return;
        setRetention(policy);
        const name = (devices: { id: string; name: string }[], id?: string) => !id || id === 'default' ? '系统默认' : devices.find(d => d.id === id)?.name || `${id}（请确认设备）`;
        setDeviceNames({ input: name(inputs, snapshot.devices.inputDeviceId), output: name(outputs, snapshot.devices.outputDeviceId) });
      } catch { if (active) setLocalError('无法读取设备或内容保留策略，请重试。'); }
    };
    void read(); window.addEventListener('focus', read);
    const off = api.onMeetingRetentionChanged(setRetention);
    return () => { active = false; off(); window.removeEventListener('focus', read); };
  }, [step, snapshot.devices.inputDeviceId, snapshot.devices.outputDeviceId]);
  const downloadRunning = snapshot.downloads.some(d => d.modelId === snapshot.checks.stt.modelId && d.status === 'running');
  const verified = (target: 'stt' | 'ai') => ['verified', 'previously_verified'].includes(snapshot.checks[target].status) && !snapshot.checks[target].errorCode;
  const permissionsReady = derivePreparationDecision(snapshot).recoveryStep !== 'permissions';
  const nextStep = step === 'permissions' ? 'speech' : step === 'speech' ? 'ai' : step === 'ai' ? 'ready' : null;
  const stepBlocked = step === 'permissions' ? !permissionsReady : step === 'speech' ? !verified('stt') && !downloadRunning : step === 'ai' ? !verified('ai') : false;
  const busy = pending || starting;
  const view = renderStep?.(step) ?? (step === 'permissions' ? <PermissionsStep snapshot={snapshot} refresh={refresh} registerFormGuard={registerFormGuard} />
    : step === 'speech' ? <SpeechStep snapshot={snapshot} refresh={refresh} registerFormGuard={registerFormGuard} onOpenSettings={onOpenSettings} onDownload={beginDownload} />
    : step === 'ai' ? <AiServiceStep provisioning={provisioning} onProvisioningChange={setProvisioning} snapshot={snapshot} refresh={refresh} registerFormGuard={registerFormGuard} onOpenSettings={onOpenSettings} /> : null);
  const start = async () => {
    if (startLock.current) return;
    startLock.current = true; setStarting(true); setLocalError(null);
    try {
      const result = await onStartMeeting();
      if (!result.success) { setLocalError(onboardingErrorText(result.errorCode)); if (result.recoveryStep) await onNavigate(result.recoveryStep); }
    } catch { setLocalError('会议未能开始，请检查配置后重试。'); }
    finally { startLock.current = false; setStarting(false); }
  };

  const next = decision.allowed ? 'ready' : decision.recoveryStep!;
  return <div data-testid="onboarding-flow" className="absolute inset-0 z-40 flex min-h-0 flex-col bg-bg-primary text-text-primary no-drag" role="region" aria-label="初始设置">
    <header className="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-3">
      <span className="font-celeb text-lg tracking-wide">CueUp <span className="ml-2 text-xs font-sans text-text-tertiary">初始设置</span></span>
      <button disabled={busy} onClick={() => void onDefer()} className="rounded-lg px-3 py-2 text-xs text-text-secondary hover:bg-bg-item-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary">稍后继续</button>
    </header>
    <div className="flex min-h-0 flex-1">
      <nav aria-label="初始设置步骤" className="w-32 shrink-0 space-y-1 overflow-y-auto border-r border-border-subtle p-2 sm:w-44 sm:p-3">
        {steps.map((value, i) => <button key={value} disabled={busy} aria-current={step === value ? 'step' : undefined}
          onClick={() => void onNavigate(value)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-3 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary ${step === value ? 'bg-bg-item-active font-semibold text-text-primary' : 'text-text-secondary hover:bg-bg-item-active/50'}`}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-muted text-[10px]">{i + 1}</span>{onboardingLabels[value]}</button>)}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main ref={sectionRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-7">
          <div className="mx-auto max-w-2xl">{view ?? <>
            <PreparationOverview snapshot={snapshot} mode={step === 'ready' ? 'ready' : 'overview'} onNavigate={onNavigate} />
            {step === 'ready' && <div className="mt-5 space-y-3 text-xs text-text-secondary">
              <p>输入：{deviceNames.input} · 输出：{deviceNames.output}</p>
              <p>会议内容保留：{{ forever: '永久', '7d': '7 天', '30d': '30 天', never: '不保存' }[retention] ?? retention} <button className="ml-2 underline" onClick={() => onOpenSettings('general')}>修改保留策略</button></p>
              <p>这将开始真实会议。会议可能使用已配置且策略允许的备用服务。</p>
              {snapshot.progress.acceptedSystemAudioLimitation && <p className="text-status-warning">你已了解系统音频限制；仍会按原流程尝试捕获并可能请求授权。</p>}
              <button disabled={busy} className="rounded-lg border border-border-muted px-3 py-2" onClick={() => void onDefer()}>{snapshot.meeting.isActive ? '返回首页' : '稍后开始'}</button>
            </div>}
          </>}
          {(error || localError) && <p role="alert" className="mt-4 rounded-lg border border-status-error-border bg-status-error-bg p-3 text-xs text-status-error">{error || localError}</p>}
          {snapshot.meeting.isActive && <p className="mt-4 flex items-center gap-2 text-xs text-text-secondary"><LockKeyhole size={13} />会议进行中，可查看设置情况。</p>}
          </div>
        </main>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle bg-bg-primary px-5 py-3">
          <button disabled={pending || index === 0} onClick={() => void onNavigate(steps[Math.max(0, index - 1)])} className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs text-text-secondary disabled:opacity-30"><ArrowLeft size={14} />上一步</button>
          {!(step === 'ai' && provisioning) && <button data-testid="onboarding-primary" disabled={busy || stepBlocked} onClick={() => void (step === 'ready' && (decision.allowed || snapshot.meeting.isActive) ? start() : onNavigate(nextStep ?? next))}
            className="flex items-center justify-center gap-2 rounded-lg bg-button-primary-bg hover:bg-button-primary-hover disabled:bg-button-primary-disabled-bg disabled:text-button-primary-disabled-text px-4 py-2.5 text-xs font-semibold text-button-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary disabled:opacity-100">
            {busy ? '正在处理…' : step === 'ready' && (decision.allowed || snapshot.meeting.isActive) ? snapshot.meeting.isActive ? '返回当前会议' : '开始会议' : step === 'speech' && downloadRunning ? '先配置 AI' : nextStep ? '继续' : step === 'overview' ? '继续设置' : '继续设置'}<ArrowRight size={14} /></button>}
        </footer>
      </div>
    </div>
    {confirmLeave && <div ref={dialogRef} onKeyDown={event => {
      if (event.key === 'Escape' && !pending) { event.preventDefault(); void onResolveLeave('stay'); }
      if (event.key !== 'Tab') return;
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!buttons?.length) { event.preventDefault(); return; }
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-5" role="alertdialog" aria-modal="true" aria-labelledby="onboarding-dirty-title">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border-muted bg-bg-primary p-5 shadow-xl">
        <h2 id="onboarding-dirty-title" className="text-base font-semibold">有尚未保存的修改</h2><p className="text-sm text-text-secondary">离开前保存这些修改？</p>
        <div className="flex flex-wrap gap-2">{([['save', '保存并离开'], ['discard', '放弃修改'], ['stay', '留在这里']] as const).map(([choice, label]) => <button key={choice} disabled={busy} onClick={() => void onResolveLeave(choice)} className="rounded-lg border border-border-muted px-3 py-2 text-xs hover:bg-bg-item-active">{label}</button>)}</div>
      </div>
    </div>}
  </div>;
}
