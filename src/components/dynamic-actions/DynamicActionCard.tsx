import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Zap } from 'lucide-react'
import type { DynamicActionPayload } from '@/types/electron'

export type DynamicActionCardStatus = 'candidate' | 'speaker_confirmation' | 'countdown' | 'generating' | 'cancelled' | 'expired' | 'failed'

interface Props {
  action: DynamicActionPayload
  isPrimary: boolean
  status?: DynamicActionCardStatus
  countdownSeconds?: number
  onAccept: (action: DynamicActionPayload) => void | Promise<void>
  onDismiss: (actionId: string) => void
  onConfirmSpeaker: (action: DynamicActionPayload, decision: 'confirm' | 'correct') => void | Promise<void>
}

const STATUS_LABELS: Record<DynamicActionCardStatus, string> = {
  candidate: '建议动作',
  speaker_confirmation: '说话人待确认',
  countdown: '秒后自动生成',
  generating: '正在生成',
  cancelled: '已取消',
  expired: '已过期',
  failed: '生成失败',
}

const OUTPUT_CTA_LABELS: Record<DynamicActionPayload['productContract']['outputType'], string> = {
  spoken_response: '生成回应',
  checklist: '生成清单',
  email_draft: '生成邮件',
  action_item: '记录行动项',
  decision_record: '记录决策',
}

const ctaLabelForOutputType = (outputType: DynamicActionPayload['productContract']['outputType']): string =>
  OUTPUT_CTA_LABELS[outputType] ?? '生成回应'

// Single dynamic action card. Compact, glass-styled, dismissible, and explicit:
// users can accept with the card, the primary CTA, or Tab on the primary card.
export const DynamicActionCard: React.FC<Props> = ({
  action,
  isPrimary,
  status = 'candidate',
  countdownSeconds,
  onAccept,
  onDismiss,
  onConfirmSpeaker,
}) => {
  const [busy, setBusy] = useState(false)
  const productContract = action.productContract
  const isGenerating = busy || status === 'generating'
  const isCountdown = status === 'countdown'
  const speakerConfirmation = action.speakerConfirmation
  const statusText = isCountdown
    ? `${Math.max(1, countdownSeconds ?? 5)} 秒后自动生成`
    : STATUS_LABELS[status]
  const buttonLabel = isGenerating ? '正在生成' : ctaLabelForOutputType(productContract.outputType)
  const speakerPrompt = speakerConfirmation?.speaker === 'interviewer'
    ? '可能是对方说的'
    : '可能是你说的'
  const speakerCorrectionLabel = speakerConfirmation?.speaker === 'interviewer'
    ? '这是我'
    : '这不是我'

  const accept = async () => {
    if (speakerConfirmation || isGenerating || status === 'cancelled' || status === 'expired') return
    setBusy(true)
    try {
      await onAccept(action)
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      data-dynamic-action-id={action.id}
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
        `transition-colors duration-150 ${speakerConfirmation ? 'cursor-default' : 'cursor-pointer'}`,
      ].join(' ')}
      onClick={() => {
        void accept()
      }}
      title={productContract.whyNow}
      data-testid={`dynamic-action-card-${action.id}`}
    >
      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-sky-400/22 border border-sky-200/30 shrink-0">
        <Zap className={`w-3.5 h-3.5 ${isPrimary ? 'text-sky-100' : 'text-sky-200'}`} />
      </div>

      <div className="flex flex-col flex-1 min-w-0 leading-tight">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[10px] font-semibold text-sky-100 shrink-0">{statusText}</span>
          {(action.evidenceCount ?? 0) > 1 && (
            <span className="text-[10px] tabular-nums text-white/72 shrink-0">{action.evidenceCount}条证据</span>
          )}
        </div>
        {speakerConfirmation ? (
          <>
            <span className="text-[12px] font-semibold overlay-text-primary truncate">{speakerPrompt}</span>
            <span className="text-[10.5px] text-white/78 truncate">“{speakerConfirmation.text}”</span>
          </>
        ) : (
          <span className="text-[12px] font-semibold overlay-text-primary truncate">{productContract.userAction}</span>
        )}
        <span className="text-[10.5px] text-white/78 truncate">{productContract.whyNow}</span>
        {productContract.evidenceSummary && (
          <span className="text-[10.5px] text-white/74 truncate">"{productContract.evidenceSummary}"</span>
        )}
        <span className="text-[10px] text-white/62 truncate">{productContract.outputPromise}</span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {speakerConfirmation ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void onConfirmSpeaker(action, 'confirm')
              }}
              className="inline-flex h-7 items-center justify-center rounded-md border border-sky-200/45 bg-sky-500 px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-sky-400"
              aria-label={`确认说话人：${speakerPrompt}`}
            >
              确认
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void onConfirmSpeaker(action, 'correct')
              }}
              className="inline-flex h-7 items-center justify-center rounded-md border border-white/24 bg-white/14 px-2 text-[11px] font-medium text-white/86 transition-colors hover:bg-white/22"
              aria-label={speakerCorrectionLabel}
            >
              {speakerCorrectionLabel}
            </button>
          </>
        ) : (
          <>
        {isPrimary && (
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold text-white/88 bg-white/14 border border-white/24">
            Tab 生成
          </kbd>
        )}
        <button
          type="button"
          disabled={isGenerating || status === 'cancelled' || status === 'expired'}
          onClick={(e) => {
            e.stopPropagation()
            void accept()
          }}
          className="inline-flex h-7 items-center justify-center rounded-md border border-sky-200/45 bg-sky-500 px-2.5 text-[11px] font-semibold text-white shadow-sm shadow-sky-950/25 transition-colors hover:bg-sky-400 disabled:cursor-default disabled:border-sky-200/25 disabled:bg-sky-700 disabled:text-white/82"
          aria-label={`${buttonLabel}: ${productContract.userAction}`}
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
          aria-label={`Dismiss ${productContract.userAction}`}
        >
          <X className="w-3 h-3" />
          <span>{isCountdown ? '取消' : '忽略'}</span>
        </button>
          </>
        )}
      </div>
    </motion.div>
  )
}
