import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Zap } from 'lucide-react'
import type { DynamicActionPayload } from '@/types/electron'

export type DynamicActionCardStatus = 'idle' | 'countdown' | 'generating' | 'cancelled'

interface Props {
  action: DynamicActionPayload
  isPrimary: boolean
  status?: DynamicActionCardStatus
  countdownSeconds?: number
  onAccept: (action: DynamicActionPayload) => void | Promise<void>
  onDismiss: (actionId: string) => void
}

const INTENT_LABELS: Record<string, string> = {
  general_assistance_request: '回应请求',
  general_summarize: '总结请求',
  general_explain: '概念解释',
  pricing_objection: '价格异议',
  buying_signal: '推进信号',
  price_pushback: '价格异议',
  pricing_request: '邮件草稿',
  budget_probe: '预算试探',
  competitor_mention: '竞品比较',
  roi_question: 'ROI 询问',
  final_offer: '最终报价',
  discovery_question: '需求探索',
  candidate_concern: '候选人顾虑',
  strong_fit_signal: '强匹配信号',
  candidate_experience_probe: '经验追问',
  action_item: '行动项',
  decision_point: '决策确认',
  risk: '风险',
  blocker_check: '阻塞风险',
  owner_deadline_check: '负责人和截止时间',
  behavioral_question: '行为面试题',
  intro_pitch: '自我介绍',
  company_motivation: '求职动机',
  weakness_question: '优缺点问题',
  formula: '公式',
  worked_example: '例题讲解',
  concept: '概念解释',
  concept_explanation: '概念解释',
  coding_question: '技术问题',
  coding_problem: '编程题',
  screen_coding_problem: '屏幕代码题',
  complexity_analysis: '复杂度分析',
  system_design_prompt: '系统设计题',
}

// Single dynamic action card. Compact, glass-styled, dismissible, and explicit:
// users can accept with the card, the primary CTA, or Tab on the primary card.
export const DynamicActionCard: React.FC<Props> = ({
  action,
  isPrimary,
  status = 'idle',
  countdownSeconds,
  onAccept,
  onDismiss,
}) => {
  const [busy, setBusy] = useState(false)
  const evidence = action.evidenceRefs?.[0]
  const evidenceText = evidence?.text?.trim() ?? ''
  const evidenceSnippet = evidenceText.length > 90
    ? `${evidenceText.slice(0, 90).trimEnd()}…`
    : evidenceText

  const confidencePct = Math.round((action.confidence ?? 0) * 100)
  const detectedIntent = INTENT_LABELS[action.sourceIntent ?? action.type] ?? action.label
  const isGenerating = busy || status === 'generating'
  const isCountdown = status === 'countdown'
  const statusText = isGenerating
    ? '正在生成'
    : isCountdown
      ? `${Math.max(1, countdownSeconds ?? 5)} 秒后自动生成`
      : status === 'cancelled'
        ? '已取消'
        : '检测到行动项'
  const buttonLabel = isGenerating ? '正在生成' : isCountdown ? '立即生成' : '生成回答'

  const accept = async () => {
    if (isGenerating || status === 'cancelled') return
    setBusy(true)
    try {
      await onAccept(action)
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className={[
        'group relative flex items-stretch gap-2.5 px-2.5 py-2 rounded-[12px]',
        'border backdrop-blur-md no-drag select-none shadow-lg shadow-black/15',
        isPrimary
          ? 'border-sky-300/65 bg-slate-950/78 hover:bg-slate-950/84'
          : 'border-white/24 bg-slate-950/68 hover:bg-slate-950/76',
        'transition-colors duration-150 cursor-pointer',
      ].join(' ')}
      onClick={() => {
        void accept()
      }}
      title={action.description ?? action.label}
      data-testid={`dynamic-action-card-${action.id}`}
    >
      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-sky-400/22 border border-sky-200/30 shrink-0">
        <Zap className={`w-3.5 h-3.5 ${isPrimary ? 'text-sky-100' : 'text-sky-200'}`} />
      </div>

      <div className="flex flex-col flex-1 min-w-0 leading-tight">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[10px] font-semibold text-sky-100 shrink-0">{statusText}</span>
          <span className="text-[12px] font-semibold overlay-text-primary truncate">{detectedIntent}</span>
          {confidencePct > 0 && (
            <span className="text-[10px] tabular-nums text-white/80 shrink-0">{confidencePct}%</span>
          )}
          {(action.evidenceCount ?? 0) > 1 && (
            <span className="text-[10px] tabular-nums text-white/72 shrink-0">{action.evidenceCount}条证据</span>
          )}
        </div>
        <span className="text-[10.5px] text-white/78 truncate">{action.label}</span>
        {evidenceSnippet && (
          <span className="text-[10.5px] text-white/74 truncate">"{evidenceSnippet}"</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isPrimary && (
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold text-white/88 bg-white/14 border border-white/24">
            Tab 生成
          </kbd>
        )}
        <button
          type="button"
          disabled={isGenerating || status === 'cancelled'}
          onClick={(e) => {
            e.stopPropagation()
            void accept()
          }}
          className="inline-flex h-7 items-center justify-center rounded-md border border-sky-200/45 bg-sky-500 px-2.5 text-[11px] font-semibold text-white shadow-sm shadow-sky-950/25 transition-colors hover:bg-sky-400 disabled:cursor-default disabled:border-sky-200/25 disabled:bg-sky-700 disabled:text-white/82"
          aria-label={`${buttonLabel}: ${action.label}`}
        >
          {buttonLabel}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss(action.id)
          }}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-white/24 bg-white/14 px-2 text-[11px] font-medium text-white/86 transition-colors hover:bg-white/22 hover:text-white"
          title={isCountdown ? '取消' : '忽略'}
          aria-label={`Dismiss ${action.label}`}
        >
          <X className="w-3 h-3" />
          <span>{isCountdown ? '取消' : '忽略'}</span>
        </button>
      </div>
    </motion.div>
  )
}
