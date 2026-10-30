import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnboardingSnapshot, OnboardingStateResult } from '../../../shared/onboarding';
import type { OnboardingFormGuard } from '../../hooks/useOnboarding';
import { onboardingErrorText } from '../../utils/onboardingActions';
const control = 'mt-2 w-full rounded-lg border border-border-muted bg-bg-elevated px-3 py-2 text-sm text-text-primary';
const button = 'rounded-lg border border-border-muted px-3 py-2 text-xs hover:bg-bg-item-active disabled:opacity-40';
export default function PermissionsStep({ snapshot, refresh, registerFormGuard }: {
  snapshot: OnboardingSnapshot; refresh(): Promise<OnboardingStateResult>; registerFormGuard(form: OnboardingFormGuard): () => void;
}) {
  const api = window.electronAPI;
  const [inputs, setInputs] = useState<{ id: string; name: string }[]>([]), [outputs, setOutputs] = useState<typeof inputs>([]);
  const [input, setInput] = useState(localStorage.getItem('preferredInputDeviceId') || 'default');
  const [output, setOutput] = useState(localStorage.getItem('preferredOutputDeviceId') || 'default');
  const [saved, setSaved] = useState({ input, output });
  const [permissions, setPermissions] = useState<Awaited<ReturnType<typeof api.checkPermissions>> | null>(null);
  const [error, setError] = useState<string | null>(null), [testing, setTesting] = useState(false), [level, setLevel] = useState(0);
  const [fallback, setFallback] = useState<string | null>(null), [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false), [readError, setReadError] = useState<string | null>(null);
  const [readComplete, setReadComplete] = useState(false);
  const readGeneration = useRef(0);
  const operation = useRef<string | null>(null);
  const busy = pending || snapshot.meeting.isActive || snapshot.meeting.isStarting;
  const stop = useCallback(() => {
    const id = operation.current; operation.current = null; setTesting(false); setLevel(0);
    if (id) void api.stopAudioTest(id);
  }, [api]);
  const read = useCallback(async () => {
    const generation = ++readGeneration.current;
    setRefreshing(true); setReadError(null); setReadComplete(false);
    try {
      const [i, o, p] = await Promise.all([api.getInputDevices(), api.getOutputDevices(), api.checkPermissions()]);
      if (generation !== readGeneration.current) return;
      const result = await refresh();
      if (generation !== readGeneration.current) return;
      if (!result.success) throw new Error('Readiness refresh failed');
      setInputs(i); setOutputs(o); setPermissions(p); setReadComplete(true);
    } catch {
      if (generation === readGeneration.current) setReadError('无法读取设备或权限，请刷新重试。');
    } finally { if (generation === readGeneration.current) setRefreshing(false); }
  }, [api, refresh]);
  useEffect(() => {
    void read(); window.addEventListener('focus', read);
    const offLevel = api.onAudioTestLevel(value => { if (operation.current) setLevel(Math.max(0, Math.min(1, value))); });
    const offState = api.onAudioTestState(state => {
      if (state.operationId !== operation.current) return;
      if (state.status !== 'running') { operation.current = null; setTesting(false); if (state.errorCode) setError(onboardingErrorText(state.errorCode)); }
    });
    return () => { readGeneration.current++; window.removeEventListener('focus', read); offLevel(); offState(); stop(); };
  }, [api, read, stop]);
  useEffect(() => { if (snapshot.meeting.isActive || snapshot.meeting.isStarting) stop(); }, [snapshot.meeting.isActive, snapshot.meeting.isStarting, stop]);
  const save = async () => {
    if (busy) return false;
    try {
      localStorage.setItem('preferredInputDeviceId', input); localStorage.setItem('preferredOutputDeviceId', output);
      setSaved({ input, output }); await refresh(); return true;
    } catch { setError(onboardingErrorText('storage_failed')); return false; }
  };
  useEffect(() => registerFormGuard({ isDirty: () => input !== saved.input || output !== saved.output, save,
    discard: () => { setInput(saved.input); setOutput(saved.output); stop(); } }), [input, output, saved, busy, registerFormGuard]);
  const check = async () => {
    if (testing) { stop(); return; }
    const id = crypto.randomUUID(); operation.current = id; setTesting(true); setFallback(null); setError(null);
    try {
      const result = await api.startAudioTest(input === 'default' ? undefined : input, id);
      if (operation.current !== id) return;
      if (!result.success) { stop(); setError(onboardingErrorText(result.errorCode)); }
      else if (result.usedDefaultFallback) setFallback(result.actualDeviceId);
    } catch { if (operation.current === id) { stop(); setError('电平检查未能启动，请重试。'); } }
  };
  const isMac = permissions?.platform === 'darwin';
  const systemAudio = snapshot.checks.systemAudio;
  const systemAudioAuthorized = ['verified', 'previously_verified'].includes(systemAudio.status)
    || (systemAudio.status === 'pending_runtime' && systemAudio.evidenceSource === 'system' && !systemAudio.errorCode);
  const unavailable = input !== 'default' && !inputs.some(device => device.id === input);
  return <section className="space-y-5">
    <div><h1 tabIndex={-1} className="text-2xl font-medium">权限与设备</h1><p className="mt-2 text-sm text-text-secondary">让 CueUp 听到你和会议中的其他人。</p></div>
    <fieldset disabled={busy} className="space-y-4 rounded-xl border border-border-muted p-4">
      <legend className="px-1 text-sm font-medium">麦克风 · 必需</legend>
      <p className={`text-xs ${permissions?.microphone === 'restricted' ? 'text-status-error' : snapshot.checks.microphone.status === 'verified' ? 'text-status-success' : 'text-text-secondary'}`}>{permissions?.microphone === 'restricted' ? '系统限制了麦克风访问，请联系设备管理员。' : snapshot.checks.microphone.status === 'verified' ? '权限已开启' : '会议开始时确认麦克风权限'}</p>
      {permissions?.microphone !== 'granted' && permissions?.microphone !== 'restricted' && <button className={button} onClick={async () => {
        setPending(true); try { if (!await api.requestMicPermission()) setError('麦克风授权被拒绝，请在系统设置中开启。'); await read(); } catch { setError(onboardingErrorText('permission_denied')); } finally { setPending(false); }
      }}>允许访问麦克风</button>}
      {isMac && <button className={button} onClick={() => void api.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')}>打开麦克风设置</button>}
      <label className="block text-sm">输入设备<select aria-label="输入设备" className={control} value={input} onChange={e => { stop(); setFallback(null); setInput(e.target.value); }}>
        <option value="default">系统默认</option>{unavailable && <option value={input}>已保存设备（不可用）</option>}{inputs.filter(d => d.id !== 'default').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select></label>
      {unavailable && <p role="alert" className="text-xs text-status-error">已保存的输入设备已断开，请重新选择。</p>}
      <button className={button} onClick={() => void check()}>{testing ? '停止检查' : '检查电平'}</button>
      {testing && <div className="space-y-2"><meter aria-label="声音输入电平" min={0} max={1} value={level} className="h-2 w-full" /><p className="text-xs text-text-secondary">仅检查输入音量，不录制、不转写。没有电平时请检查静音或说话。</p></div>}
      {fallback && <p className="text-xs text-status-warning">当前检查的是系统默认设备。<button className="ml-2 underline" onClick={() => { stop(); setInput(fallback); setFallback(null); }}>改用该设备</button></p>}
      <label className="block text-sm">输出设备<select aria-label="输出设备" className={control} value={output} onChange={e => { stop(); setOutput(e.target.value); }}>
        <option value="default">系统默认</option>{output !== 'default' && !outputs.some(d => d.id === output) && <option value={output}>已保存设备（不可用）</option>}{outputs.filter(d => d.id !== 'default').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select></label>
      <button className={button} onClick={() => void save()}>保存设备</button>
    </fieldset>
    <div className="space-y-3 rounded-xl border border-border-muted p-4"><h2 className="text-sm font-medium">会议中的其他人</h2>
      <p className="text-xs text-text-secondary">{isMac ? 'macOS 的系统音频授权取决于采集方式，屏幕与系统音频录制、仅系统音频录制的权限可能不同。' : '会议开始时确认系统音频。请检查输出设备与系统权限。'} 截图理解在使用该功能时检查授权。</p>
      {isMac && <button className={button} onClick={() => void api.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')}>打开系统音频设置</button>}
      <p data-testid="onboarding-system-audio-permission" className={`text-xs leading-relaxed ${systemAudio.errorCode === 'permission_denied' ? 'text-status-warning' : systemAudio.errorCode ? 'text-status-error' : 'text-status-info'}`}>
        {systemAudioAuthorized ? '系统授权已开启，实际捕获将在会议开始时确认。'
          : systemAudio.errorCode === 'permission_denied' ? '应用当前读取的屏幕录制权限未开启。若系统设置已开启，请退出并重新打开应用后刷新；仅系统音频录制的授权将在开始会议时由实际采集确认。暂时可能只能转写你的声音。'
          : systemAudio.errorCode === 'device_missing' ? '输出设备不可用，请重新选择设备并刷新。'
          : '尚未确认系统音频授权，开始会议时将检查实际采集，并可能显示系统授权提示。'}
      </p>
      {systemAudio.errorCode === 'permission_denied' && <button disabled={busy} className={button} onClick={async () => {
        const result = await api.updateOnboardingProgress({ type: 'acknowledge-system-audio-limitation' });
        if (!result.success) setError(onboardingErrorText(result.errorCode)); else await refresh();
      }}>{snapshot.progress.acceptedSystemAudioLimitation ? '已了解系统音频限制' : '了解限制，继续设置'}</button>}
      {isMac && (permissions?.systemAudioHealth?.staleGrantSuspected || permissions?.microphoneHealth?.staleGrantSuspected) && <button className={button} disabled={busy} onClick={async () => {
        if (!window.confirm('将重置本应用的权限记录，完成后需要重新授权并重启。继续？')) return;
        const result = await api.repairTccPermission('both'); if (!result.success) setError('权限修复失败，请重试。'); else if (result.requiresRestart && window.confirm('权限记录已修复，现在重启应用？')) await api.restartAfterTccRepair();
      }}>修复权限记录</button>}
    </div>
    <button className={button} disabled={refreshing} onClick={() => void read()}>{refreshing ? '正在刷新…' : '刷新设备与权限'}</button>
    <p role="status" aria-live="polite" className="text-xs text-text-secondary">{refreshing ? '正在读取设备与权限…' : readComplete ? '设备与权限已刷新' : ''}</p>
    {readError && <p role="alert" className="text-xs text-status-error">{readError}</p>}
    {error && <p role="alert" className="text-xs text-status-error">{error}</p>}
  </section>;
}
