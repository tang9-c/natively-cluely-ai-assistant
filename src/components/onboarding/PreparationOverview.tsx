import React from 'react';
import { getModelDisplayName } from '../../utils/modelUtils';
import { Check, ChevronRight, Circle, Loader2, TriangleAlert } from 'lucide-react';
import type { OnboardingCheck, OnboardingSnapshot, OnboardingStep } from '../../../shared/onboarding';
export const onboardingLabels: Record<OnboardingStep, string> = { overview: '设置概览', permissions: '权限与设备', speech: '语音识别', ai: 'AI 服务', ready: '开始会议' };
export function preparationRows(snapshot: OnboardingSnapshot) {
  return [
    { label: '麦克风与设备', step: 'permissions' as const, check: snapshot.checks.microphone.status === 'verified' || snapshot.checks.microphone.status === 'pending_runtime' ? snapshot.checks.inputDevice : snapshot.checks.microphone },
    { label: '语音识别', step: 'speech' as const, check: snapshot.checks.stt },
    { label: 'AI 服务', step: 'ai' as const, check: snapshot.checks.ai },
    { label: '系统音频', step: 'permissions' as const, check: snapshot.checks.systemAudio, limited: true },
  ];
}
const statusLabels: Record<OnboardingCheck['status'], string> = { missing: '待设置', checking: '正在检查', verified: '本次已确认', previously_verified: '上次验证通过',
  pending_runtime: '使用时确认', limited: '功能受限', failed: '需要处理', unsupported: '暂不能验证' };
export function requiredPreparationCount(snapshot: OnboardingSnapshot): number {
  return preparationRows(snapshot).filter(row => !row.limited && !(['verified', 'previously_verified'].includes(row.check.status) || (row.step === 'permissions' && row.check.status === 'pending_runtime'))).length;
}
export default function PreparationOverview({ snapshot, mode = 'overview', focus, onNavigate }: {
  snapshot: OnboardingSnapshot; mode?: 'overview' | 'ready'; focus?: OnboardingStep; onNavigate(step: OnboardingStep): void;
}) {
  const rows = preparationRows(snapshot).filter(row => !focus || row.step === focus);
  return <section className="space-y-5" aria-label="设置情况">
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">CUEUP / 初始设置</p>
      <h1 tabIndex={-1} className="text-2xl font-medium tracking-tight text-text-primary">{focus ? onboardingLabels[focus] : mode === 'ready' ? '设置检查' : `开始前，还需完成 ${requiredPreparationCount(snapshot)} 项设置`}</h1>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">此检查不会录音，也不会自动发送会议内容。</p>
    </div>
    <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-muted bg-bg-elevated/40">
      {rows.map(row => {
        const good = ['verified', 'previously_verified'].includes(row.check.status);
        const warning = ['failed', 'limited', 'unsupported'].includes(row.check.status);
        const statusColor = row.check.status === 'failed' ? 'text-status-error' : good
          ? row.check.status === 'verified' ? 'text-status-success' : 'text-status-info'
          : warning ? 'text-status-warning' : row.check.status === 'checking' ? 'text-status-info' : 'text-text-secondary';
        const Icon = row.check.status === 'checking' ? Loader2 : good ? Check : warning ? TriangleAlert : Circle;
        return <div key={row.label} className="flex items-center gap-3 px-4 py-4">
          <Icon size={17} className={`${statusColor} shrink-0 ${row.check.status === 'checking' ? 'motion-safe:animate-spin' : ''}`} />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium text-text-primary">{row.label}</p>
            <p className={`mt-1 break-all text-xs ${statusColor}`}>{row.check.status === 'missing' ? (row.check.configured ? '已配置，待验证' : '尚未配置') : statusLabels[row.check.status]}{row.check.provider ? ` · ${row.check.provider === 'natively' ? 'QCLOUD API' : row.check.provider}` : ''}{row.check.modelId ? ` · ${getModelDisplayName(row.check.modelId)}` : ''}</p>
            {row.check.checkedAt !== undefined && <p className="mt-1 text-xs text-text-tertiary">{new Date(row.check.checkedAt).toLocaleString()} · {row.check.depth === 'model_load' ? '模型加载' : row.check.depth === 'model_response' ? '模型响应' : '凭据访问'}</p>}
            {row.check.errorCode === 'scope_denied' && <p className="mt-1 text-xs text-status-warning">当前策略不允许 AI 使用会议内容。</p>}
            {row.check.errorCode === 'model_missing' && <p className="mt-1 text-xs text-text-secondary">模型尚未下载。</p>}
            {row.check.status === 'limited' && <p className="mt-1 text-xs leading-relaxed text-status-warning">可能无法转写会议中其他人的声音。</p>}
          </div>
          <button className="no-drag flex items-center gap-1 rounded-md px-2 py-2 text-xs text-text-secondary hover:bg-bg-item-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary" onClick={() => onNavigate(row.step)} aria-label={`查看${row.label}`}>查看 <ChevronRight size={13} /></button>
        </div>;
      })}
    </div>
    {!focus && <p className="text-xs leading-relaxed text-text-secondary">沿用你已保存的服务和设备。历史验证会保留时间，配置变化后需重新检查。</p>}
  </section>;
}
