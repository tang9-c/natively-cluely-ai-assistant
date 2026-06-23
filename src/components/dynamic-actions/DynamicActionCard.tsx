import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Zap, ChevronRight } from 'lucide-react'
import type { DynamicActionPayload } from '@/types/electron'

interface Props {
  action: DynamicActionPayload
  isPrimary: boolean
  onAccept: (action: DynamicActionPayload) => void
  onDismiss: (actionId: string) => void
}

const INTENT_LABELS: Record<string, string> = {
  general_assistance_request: '回应请求',
  general_summarize: '总结请求',
  general_explain: '概念解释',
  pricing_objection: '价格异议',
  buying_signal: '推进信号',
  price_pushback: '价格异议',
  pricing_request: '询价请求',
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

// Single dynamic action card. Compact, glass-styled, dismissible.
// Primary card (highest priority) gets a subtle accent + shortcut hint.
// Cards are intentionally lightweight — clicking accept fires the parent
// callback which is responsible for kicking off the answer stream so the
// card itself stays presentation-only.
export const DynamicActionCard: React.FC<Props> = ({ action, isPrimary, onAccept, onDismiss }) => {
  const [busy, setBusy] = useState(false)
  const evidence = action.evidenceRefs?.[0]
  const evidenceText = evidence?.text?.trim() ?? ''
  const evidenceSnippet = evidenceText.length > 90
    ? `${evidenceText.slice(0, 90).trimEnd()}…`
    : evidenceText

  const confidencePct = Math.round((action.confidence ?? 0) * 100)
  const detectedIntent = INTENT_LABELS[action.sourceIntent ?? action.type] ?? action.label

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className={[
        'group relative flex items-stretch gap-2 px-2.5 py-2 rounded-[12px]',
        'border backdrop-blur-md no-drag select-none',
        isPrimary
          ? 'border-blue-400/40 bg-blue-500/8 hover:bg-blue-500/12'
          : 'border-white/10 bg-white/5 hover:bg-white/8',
        'transition-colors duration-150 cursor-pointer',
      ].join(' ')}
      onClick={async () => {
        if (busy) return
        setBusy(true)
        try {
          await onAccept(action)
        } finally {
          setBusy(false)
        }
      }}
      title={action.description ?? action.label}
      data-testid={`dynamic-action-card-${action.id}`}
    >
      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-white/8 shrink-0">
        <Zap className={`w-3.5 h-3.5 ${isPrimary ? 'text-blue-300' : 'text-white/70'}`} />
      </div>

      <div className="flex flex-col flex-1 min-w-0 leading-tight">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[10px] font-medium text-blue-200/75 shrink-0">检测到</span>
          <span className="text-[12px] font-semibold overlay-text-primary truncate">{detectedIntent}</span>
          {confidencePct > 0 && (
            <span className="text-[10px] tabular-nums text-white/40 shrink-0">{confidencePct}%</span>
          )}
          {(action.evidenceCount ?? 0) > 1 && (
            <span className="text-[10px] tabular-nums text-white/35 shrink-0">{action.evidenceCount}条证据</span>
          )}
        </div>
        <span className="text-[10.5px] text-white/50 truncate">{action.label}</span>
        {evidenceSnippet && (
          <span className="text-[10.5px] text-white/55 truncate">"{evidenceSnippet}"</span>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {isPrimary && (
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium text-white/60 bg-white/8 border border-white/10">
            Tab
          </kbd>
        )}
        <ChevronRight className="w-3.5 h-3.5 text-white/40 group-hover:text-white/70 transition-colors" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss(action.id)
          }}
          className="ml-0.5 p-1 rounded-full text-white/30 hover:text-white/70 hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
          title="忽略"
          aria-label={`Dismiss ${action.label}`}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  )
}
