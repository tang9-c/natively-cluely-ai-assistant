import { useEffect, useState } from 'react';
import type { OnboardingSnapshot } from '../../../shared/onboarding';
export default function FirstMeetingHint({ suppressed = false }: { suppressed?: boolean }) {
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null), [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const accept = (incoming: OnboardingSnapshot) => { if (active) setSnapshot(current => !current || incoming.stateRevision > current.stateRevision ? incoming : current); };
    const off = window.electronAPI.onOnboardingStateChanged(accept);
    void window.electronAPI.getOnboardingState().then(result => { if (result.success) accept(result.snapshot); }).catch(() => {});
    return () => { active = false; off(); };
  }, []);
  if (suppressed || !snapshot || snapshot.progress.origin !== 'fresh' || (!snapshot.meeting.isActive && !snapshot.meeting.isStarting) || snapshot.meeting.phase === 'failed') return null;
  const { meeting, progress } = snapshot;
  const hint = meeting.hasTranscript ? 'answer' : 'transcript';
  if (progress.meetingHintsDismissed[hint]) return null;
  const status = meeting.hasTranscript ? '已收到转写' : meeting.phase === 'audio_started' ? '音频已启动，等待转写' : meeting.phase === 'entered' ? '已进入会议，正在连接音频…' : '正在进入会议';
  return <div data-testid="first-meeting-hint" className="no-drag mx-4 mb-2 rounded-lg border border-border-subtle bg-bg-elevated/90 px-3 py-2 text-xs text-text-primary">
    <p role="status" className={`font-medium ${meeting.hasTranscript ? 'text-status-success' : 'text-status-info'}`}>{status}</p>
    <div className="mt-1 flex items-center justify-between gap-3"><p className="text-text-secondary">{hint === 'answer' ? '需要辅助时，点击回答或输入问题。' : '会议开始后，转写会显示在现有转写区域；可使用转写入口自行展开。'}</p>
      <button className="shrink-0 rounded px-2 py-1 hover:bg-bg-item-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary" onClick={async () => {
        const result = await window.electronAPI.updateOnboardingProgress({ type: 'dismiss-hint', hint });
        if (result.success) setSnapshot(current => !current || result.snapshot.stateRevision > current.stateRevision ? result.snapshot : current); else setError(true);
      }}>知道了</button></div>
    {error && <p role="alert" className="mt-1 text-status-error">未能保存提示状态，请重试。</p>}
  </div>;
}
