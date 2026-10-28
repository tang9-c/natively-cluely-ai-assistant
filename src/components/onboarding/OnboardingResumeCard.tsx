import React, { useEffect, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import type { OnboardingSnapshot } from '../../../shared/onboarding';
import { requiredPreparationCount } from './PreparationOverview';
export default function OnboardingResumeCard({ snapshot, onContinue }: { snapshot: OnboardingSnapshot; onContinue(): void }) {
  const [collapsed, setCollapsed] = useState(false);
  const failed = snapshot.meeting.phase === 'failed';
  useEffect(() => { if (failed) setCollapsed(false); }, [failed, snapshot.meeting.generation]);
  if (collapsed || (snapshot.progress.firstMeetingEnteredAt !== undefined && !failed)) return null;
  const count = requiredPreparationCount(snapshot);
  return <aside className="no-drag flex items-center gap-3 rounded-xl border border-border-muted bg-bg-elevated px-4 py-3" aria-label="初始设置提示">
    <div className="min-w-0 flex-1"><p className="text-sm font-medium text-text-primary">{failed ? '会议启动遇到问题' : count ? `还需完成 ${count} 项设置` : '初始设置已就绪，可以开始会议'}</p>
      <p className="mt-1 text-xs text-text-secondary">{failed ? '检查设备与服务后，再从原入口开始会议。' : snapshot.progress.origin === 'existing' ? '保留你现有的配置，可随时查看设置情况。' : '沿用已有配置，继续完成声音与 AI 设置。'}</p></div>
    <button onClick={onContinue} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-accent-primary hover:bg-bg-item-active">{failed ? '返回设置' : '继续设置'} <ArrowRight size={13} /></button>
    <button aria-label="收起设置提示" onClick={() => setCollapsed(true)} className="shrink-0 rounded-md p-1.5 text-text-tertiary hover:bg-bg-item-active"><X size={14} /></button>
  </aside>;
}
