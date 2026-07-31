import { animate, AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  Code,
  Copy,
  HelpCircle,
  Image,
  LayoutGrid,
  Lightbulb,
  Lock,
  MessageSquare,
  Mic,
  Monitor,
  Pencil,
  PointerOff,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  X,
  Zap,
} from 'lucide-react';
import React, {
  startTransition as reactStartTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
// import { ModelSelector } from './ui/ModelSelector'; // REMOVED
import 'katex/dist/katex.min.css';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { useShortcuts } from '../hooks/useShortcuts';
import { analytics, detectProviderType } from '../lib/analytics/analytics.service';
import { renderSafeStreamingMarkdown } from '../lib/streamingMarkdownSanitizer';
import { categorizeSttError } from '../lib/sttErrorMapper';
import type { MeetingInterfaceTheme } from '../lib/meetingInterfaceTheme';
import {
  getGlassOverlayAppearance,
  getOverlayAppearance,
  OVERLAY_OPACITY_DEFAULT,
} from '../lib/overlayAppearance';
import { NegotiationCoachingCard } from './NegotiationCoachingCard';
import { SENSEVOICE_EMOTION_LABELS, TRANSCRIPT_EMOTION_DEGREE_LABELS } from '../../shared/senseVoiceEmotion';
import type { TranscriptEmotion, TranscriptEmotionDegree } from '../../shared/senseVoiceEmotion';
import {
  buildLatestAnswerTrustExplanation,
  type CitationStatus,
} from '../../shared/realtimeAnswerTrustViewModel';
import type {
  AnswerCitation,
  AnswerContextTrace,
  AnswerSourceStatus,
  AnswerQualityEventType,
  ContextHealth,
  DynamicActionModeEvent,
  DynamicActionPayload,
  NativeAudioTranscriptPayload,
} from '../types/electron';
import { genMessageId } from '../utils/messageId';
import { getModelDisplayName } from '../utils/modelUtils';
import { getModifierSymbol, isMac } from '../utils/platformUtils';
import { DynamicActionBar } from './dynamic-actions/DynamicActionBar';
import GlassEffectLayer from './ui/GlassEffectLayer';
import RollingTranscript from './ui/RollingTranscript';
import TopPill from './ui/TopPill';

// PERF: hoisted plugin arrays. ReactMarkdown receives `remarkPlugins` and
// `rehypePlugins` as new array literals if defined inline at the call site —
// that defeats its internal render-bailout because plugin-array identity
// changes every render. Module-scope arrays are stable forever and shared
// across every ReactMarkdown render in this component.
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

const shouldFlushPreviousStream = (
  activeIntent: string | null,
  incomingIntent: string,
  activeMsgId: string | null,
): boolean => {
  if (!activeMsgId) return false;
  if (activeIntent == null) return false;
  return activeIntent !== incomingIntent;
};

interface Message {
  id: string;
  role: 'user' | 'system' | 'interviewer';
  text: string;
  isStreaming?: boolean;
  hasScreenshot?: boolean;
  screenshotPreview?: string;
  isCode?: boolean;
  intent?: string;
  isNegotiationCoaching?: boolean;
  negotiationCoachingData?: {
    tacticalNote: string;
    exactScript: string;
    showSilenceTimer: boolean;
    phase: string;
    theirOffer: number | null;
    yourTarget: number | null;
    currency: string;
  };
}

interface NativelyInterfaceProps {
  onEndMeeting?: () => void;
  overlayOpacity?: number;
  interfaceTheme?: MeetingInterfaceTheme;
  onOpenModes?: () => void;
}

type LatestAnswerLifecycle = {
  answerId: string;
  shownAt: number;
  surface: string;
  copied: boolean;
  accepted: boolean;
  regenerated: boolean;
};

import {
  DEFAULT_MODE_NAMES,
  getModeDisplayName,
  MODE_TEMPLATE_LABELS,
} from '../lib/modeTemplateMeta';

// PERF: HighlightedCode renders a single fenced code block. Hoisted to module
// scope and wrapped in React.memo so a parent re-render does not re-tokenize
// existing code blocks. SyntaxHighlighter (Prism) has no internal render
// bailout — without this, every streaming token re-runs Prism over every code
// block in history. The customStyle / lineNumberStyle objects are also at
// module scope so their referential identity stays stable too.
const HC_CUSTOM_STYLE = {
  margin: 0,
  borderRadius: 0,
  fontSize: '13px',
  lineHeight: '1.6',
  background: 'transparent',
  padding: '16px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;

interface HighlightedCodeProps {
  code: string;
  lang: string;
  isLightTheme: boolean;
  codeTheme: any;
  codeBlockClass: string;
  codeHeaderClass: string;
  codeHeaderTextClass: string;
  codeLineNumberColor: string;
  appearance: any;
}
const HighlightedCode = React.memo(
  function HighlightedCode({
    code,
    lang,
    codeTheme,
    codeBlockClass,
    codeHeaderClass,
    codeHeaderTextClass,
    codeLineNumberColor,
    appearance,
  }: HighlightedCodeProps) {
    return (
      <div
        className={`my-3 rounded-xl overflow-hidden border shadow-lg ${codeBlockClass}`}
        style={appearance.codeBlockStyle}
      >
        {/* Minimalist Apple Header */}
        <div
          className={`px-3 py-1.5 border-b ${codeHeaderClass}`}
          style={appearance.codeHeaderStyle}
        >
          <span
            className={`text-[10px] uppercase tracking-widest font-semibold font-mono ${codeHeaderTextClass}`}
          >
            {lang || 'CODE'}
          </span>
        </div>
        {/* No-wrap horizontal scroll: code line layout stays stable as the
                canvas grows/shrinks. Without this, wrapped lines re-flow at every
                spring tick, the block height jitters, and content below shifts. */}
        <div className="bg-transparent overflow-x-auto">
          <SyntaxHighlighter
            language={lang}
            style={codeTheme}
            customStyle={HC_CUSTOM_STYLE}
            wrapLongLines={false}
            showLineNumbers={true}
            lineNumberStyle={{
              minWidth: '2.5em',
              paddingRight: '1.2em',
              color: codeLineNumberColor,
              textAlign: 'right',
              fontSize: '11px',
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>
    );
  },
  (prev, next) =>
    // codeTheme / codeBlockClass / appearance are all theme-derived; checking
    // appearance (a useMemo'd ref) covers them transitively.
    prev.code === next.code && prev.lang === next.lang && prev.appearance === next.appearance,
);

// PERF: MessageRow renders one chat-message bubble. Module-scope + React.memo
// so a parent re-render does NOT re-render every prior message — only the
// streaming row whose `msg` reference actually changed gets reconciled.
//
// The combination of (this memo) + (HighlightedCode memo) + (rAF token
// coalescing) + (hoisted ReactMarkdown components) eliminates the streaming
// re-render storm: prior messages stay structurally identical between renders
// and bail out at this boundary, preserving their entire Markdown / code-block
// subtrees including expensive Prism tokenization.
//
// Stable-identity contract for the comparator to actually fire:
//   - msg: setMessages always returns a new array, but the per-message OBJECT
//     identity is preserved for non-changing rows (the streaming-row pattern
//     does `[...prev]` then mutates only `prev.length - 1`). So === on msg
//     correctly detects "this row is unchanged."
//   - appearance: useMemo'd in parent on [overlayOpacity, isLightTheme].
//   - onCopy / renderMessageText: useCallback'd in parent.
interface MessageRowProps {
  msg: Message;
  isLightTheme: boolean;
  appearance: any;
  onCopy: (text: string) => void;
  renderMessageText: (msg: Message) => React.ReactNode;
}
const formatProviderLabel = (provider?: string | null): string => {
  if (!provider) return 'not set';
  if (provider === 'qcloud-stt' || provider === 'natively') return 'QCLOUD API';
  if (provider === 'doubao-auc' || provider === 'doubao') return 'Doubao AUC';
  if (provider === 'local-sensevoice') return 'Local SenseVoice';
  if (provider === 'local-whisper') return 'Local Whisper';
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const MANUAL_VOICE_PROMPT_BY_MODE: Record<string, string> = {
  general: 'General: Answer the user’s spoken question directly and concisely for the current conversation.',
  sales: 'Sales: Help the user respond in a sales conversation. Stay grounded, avoid inventing pricing/case details, and suggest a concise next step when useful.',
  fde: 'FDE: Help the user clarify deployment, integration, permissions, data flow, rollout risk, and validation steps.',
  recruiting: 'Recruiting: Help the user ask or answer as a recruiting interviewer. Prefer evidence-based, fair, policy-safe wording.',
  'team-meet': 'Team Meet: Help the user turn discussion into decisions, owners, deadlines, blockers, or a concise meeting response.',
  'looking-for-work': 'Looking for work: Help the user answer as the candidate using credible first-person wording without inventing personal facts.',
  'technical-interview': 'Technical Interview: Help the user explain approach, constraints, complexity, edge cases, and tradeoffs.',
  lecture: 'Lecture: Help the user answer or ask about the lecture topic, definitions, examples, or key takeaways.',
};

const buildManualVoiceQuestionPrompt = (
  modeTemplateType?: string | null,
  hasAttachedScreenshots = false,
): string => {
  const modeInstruction =
    MANUAL_VOICE_PROMPT_BY_MODE[modeTemplateType || 'general'] ||
    MANUAL_VOICE_PROMPT_BY_MODE.general;
  const screenInstruction = hasAttachedScreenshots
    ? 'The user has attached screenshot context. Use it only when it is relevant to the spoken question.'
    : 'No screenshot is attached. Do not claim to see the screen.';

  return `${modeInstruction}
${screenInstruction}

Instructions:
1. Treat the user’s spoken text as an explicit question or command to the AI assistant.
2. Use the active mode above to choose the right role and level of detail.
3. Use available meeting context when helpful, but do not invent facts, numbers, policies, or commitments.
4. Provide a direct, concise answer the user can act on or say out loud.
5. Do not include phrases like "The question is..." - just answer directly.

Provide only the answer, nothing else.`;
};

const getSttSummary = (
  userStatus: 'connected' | 'reconnecting' | 'failed',
  userProvider: string,
  interviewerProvider: string,
  configuredProvider: string | null,
  notConfigured: boolean,
  hasUserTranscript: boolean,
  hasInterviewerTranscript: boolean,
  systemAudioIssue: string | null,
): { label: string; tone: 'ok' | 'warn' | 'error'; detail: string } => {
  const selectedProvider = configuredProvider && configuredProvider !== 'none' ? configuredProvider : '';
  const micLabel = userProvider
    ? formatProviderLabel(userProvider)
    : selectedProvider
      ? formatProviderLabel(selectedProvider)
      : hasUserTranscript ? 'active' : 'not set';
  const systemLabel = interviewerProvider
    ? formatProviderLabel(interviewerProvider)
    : hasInterviewerTranscript
      ? 'active'
      : systemAudioIssue
        ? '未捕获'
        : selectedProvider
          ? '等待中'
          : 'not set';
  const detail = `${micLabel} 麦克风 · ${systemLabel} 系统音频`;
  if (notConfigured && !hasUserTranscript) {
    return {
      label: '语音转写未配置',
      tone: 'error',
      detail: '请打开音频设置选择服务商',
    };
  }
  if (!userProvider && !selectedProvider && !hasUserTranscript) {
    return {
      label: '语音转写未配置',
      tone: 'error',
      detail: '请打开音频设置选择服务商',
    };
  }
  if (!userProvider && selectedProvider && !hasUserTranscript) {
    return {
      label: '语音转写启动中',
      tone: 'warn',
      detail: `状态：正在等待第一段麦克风转写；${detail}。如果长时间停留，请检查麦克风权限或 STT 配置。`,
    };
  }
  if (userStatus === 'failed') {
    return {
      label: '语音转写异常',
      tone: 'error',
      detail,
    };
  }
  if (userStatus === 'reconnecting') {
    return {
      label: '语音转写重连中',
      tone: 'warn',
      detail,
    };
  }
  if (systemAudioIssue || (!interviewerProvider && !hasInterviewerTranscript)) {
    return {
      label: '仅麦克风转写',
      tone: 'warn',
      detail,
    };
  }
  return {
    label: '语音转写正常',
    tone: 'ok',
    detail,
  };
};

const getStatusToneClass = (tone: 'ok' | 'warn' | 'error'): string => {
  if (tone === 'error') return 'overlay-status-error';
  if (tone === 'warn') return 'overlay-status-warn';
  return 'overlay-status-ok';
};

const DEGRADED_REASON_LABELS: Record<string, string> = {
  transcript_truncated: '当前转录已节选',
  assistant_history_truncated: '短期历史已节选',
  assistant_history_dropped: '短期历史未使用',
  meeting_history_truncated: '历史会议已节选',
  meeting_history_dropped: '历史会议未使用',
  uploaded_material_context_truncated: '上传资料已节选',
  uploaded_material_context_dropped: '上传资料未使用',
  uploaded_material_rag_failed: '上传资料检索失败，本次答案未使用上传资料',
  no_relevant_uploaded_material: '没有找到相关上传资料，本次答案仅使用会议上下文',
  screen_context_failed: '屏幕上下文不可用，本次答案未参考屏幕',
  screen_context_scope_blocked: '屏幕上下文被数据范围设置阻止',
  screen_context_no_vision_provider: '当前模型不支持屏幕图像，本次答案未参考屏幕',
  screen_context_truncated: '屏幕上下文已节选',
  screen_context_dropped: '屏幕上下文未使用',
  mode_context_truncated: '模式上下文已节选',
  mode_context_dropped: '模式上下文未使用',
  rag_unavailable: 'RAG 不可用',
  embedding_unavailable: 'Embedding 不可用',
  speaker_separation_unavailable: '说话人分离不可用，发言人归属可能不可靠',
  stt_user_failed: '你的麦克风转写失败',
  stt_interviewer_failed: '对方音频转写失败',
  context_scope_denied: '上下文被数据范围设置阻止',
  answer_trace_unavailable: '答案可信度追踪不可用',
};

const formatDegradedReasonForDisplay = (reason?: string | null): string | null => {
  if (!reason) return null;
  const labels = reason
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => DEGRADED_REASON_LABELS[item] ?? `上下文降级：${item}`);
  const uniqueLabels = [...new Set(labels)];
  return uniqueLabels.length > 0 ? uniqueLabels.join('、') : null;
};

function formatRealtimeAnswerStatusForDisplay(statusCode?: string, error?: string): string | null {
  switch (statusCode) {
    case undefined:
    case 'ok':
      return null;
    case 'partial-trace-unavailable':
      return '答案已生成，但可信度追踪暂不可用';
    case 'scope-rejected':
      return '当前 provider 不允许使用资料上下文，本次答案未使用上传资料';
    case 'permission-denied':
      return '权限不足，无法生成实时回答';
    case 'no-result':
      return '暂时没有生成可用回答';
    case 'retrieval-error':
      return '资料检索失败，本次答案未使用上传资料';
    case 'answer-trace-unavailable':
      return '答案可信度追踪不可用';
    case 'provider-error':
      return error ? `实时回答失败：${error}` : '实时回答失败，请稍后重试';
    case 'invalid-request':
      return '请求格式无效，无法生成实时回答';
    case 'no-context':
      return '当前没有足够上下文生成回答';
    default:
      return error ? `实时回答失败：${error}` : '实时回答失败';
  }
}

const MessageRow = React.memo(
  function MessageRow({
    msg,
    isLightTheme,
    appearance,
    onCopy,
    renderMessageText,
  }: MessageRowProps) {
    const isCodeMsg = msg.role === 'system' && (msg.isCode || msg.text.includes('```'));
    // bubbleMaxClass: user bubbles are tighter; system + code use the same width.
    const bubbleMaxClass =
      msg.role === 'user' ? 'max-w-[72%] px-[13.6px] py-[10.2px]' : 'max-w-[85%] px-4 py-3';
    return (
      <div className="w-full" {...(isCodeMsg ? { 'data-code-msg': 'true' } : {})}>
        <div
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up`}
        >
          <div
            className={`
              ${bubbleMaxClass} text-[14px] leading-relaxed relative group whitespace-pre-wrap
              ${
                msg.role === 'user'
                  ? isLightTheme
                    ? 'bg-blue-500/10 backdrop-blur-md border border-blue-500/20 text-blue-900 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium'
                    : 'bg-blue-600/20 backdrop-blur-md border border-blue-500/30 text-blue-100 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium'
                  : ''
              }
              ${msg.role === 'system' ? 'overlay-text-primary font-normal' : ''}
              ${msg.role === 'interviewer' ? 'overlay-text-muted italic pl-0 text-[13px]' : ''}
            `}
          >
            {msg.role === 'interviewer' && (
              <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium uppercase tracking-wider overlay-text-muted">
                面试官
                {msg.isStreaming && (
                  <span className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                )}
              </div>
            )}
            {msg.role === 'user' && msg.hasScreenshot && (
              <div
                className={`flex items-center gap-1 text-[10px] opacity-70 mb-1 border-b pb-1 ${isLightTheme ? 'border-black/10' : 'border-white/10'}`}
              >
                <Image className="w-2.5 h-2.5" />
                <span>已附带截图</span>
              </div>
            )}
            {msg.role === 'system' && !msg.isStreaming && (
              <button
                onClick={() => onCopy(msg.text)}
                className="absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
                title="复制到剪贴板"
                style={appearance.iconStyle}
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            )}
            {renderMessageText(msg)}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.msg === next.msg &&
    prev.isLightTheme === next.isLightTheme &&
    prev.appearance === next.appearance &&
    prev.renderMessageText === next.renderMessageText &&
    prev.onCopy === next.onCopy,
);

const NativelyInterface: React.FC<NativelyInterfaceProps> = ({
  onEndMeeting,
  overlayOpacity = OVERLAY_OPACITY_DEFAULT,
  interfaceTheme = 'default',
  onOpenModes,
}) => {
  const isLightTheme = useResolvedTheme() === 'light';
  const isGlassTheme = interfaceTheme === 'liquid-glass';
  const shellRef = React.useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const { shortcuts, isShortcutPressed } = useShortcuts();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [sttUserStatus, setSttUserStatus] = useState<'connected' | 'reconnecting' | 'failed'>(
    'connected',
  );
  const [sttUserError, setSttUserError] = useState<string>('');
  const [sttUserProvider, setSttUserProvider] = useState<string>('');
  const [selectedSttProvider, setSelectedSttProvider] = useState<string | null>(null);
  const [hasUserTranscript, setHasUserTranscript] = useState(false);
  const [sttInterviewerStatus, setSttInterviewerStatus] = useState<
    'connected' | 'reconnecting' | 'failed'
  >('connected');
  const [sttInterviewerError, setSttInterviewerError] = useState<string>('');
  const [sttInterviewerProvider, setSttInterviewerProvider] = useState<string>('');
  const [hasInterviewerTranscript, setHasInterviewerTranscript] = useState(false);
  const [systemAudioIssue, setSystemAudioIssue] = useState<string | null>(null);
  const [meetingStartStatus, setMeetingStartStatus] = useState<{
    phase: 'starting' | 'ready' | 'failed';
    message?: string;
  } | null>(null);
  const sttUserStatusRef = useRef<'connected' | 'reconnecting' | 'failed'>('connected');
  const micCaptureFailureRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [conversationContext, setConversationContext] = useState<string>('');
  const [isManualRecording, setIsManualRecording] = useState(false);
  const isRecordingRef = useRef(false); // Ref to track recording state (avoids stale closure)
  const [manualTranscript, setManualTranscript] = useState('');
  const manualTranscriptRef = useRef<string>('');
  const [showTranscript, setShowTranscript] = useState(() => {
    const stored = localStorage.getItem('natively_interviewer_transcript');
    return stored !== 'false';
  });
  const [autoScroll, setAutoScroll] = useState(() => {
    const stored = localStorage.getItem('natively_auto_scroll');
    return stored === 'true';
  });

  // Analytics State
  const requestStartTimeRef = useRef<number | null>(null);

  // Sync transcript setting
  useEffect(() => {
    const handleStorage = () => {
      const stored = localStorage.getItem('natively_interviewer_transcript');
      setShowTranscript(stored !== 'false');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Sync auto-scroll setting
  useEffect(() => {
    const handleStorage = () => {
      const stored = localStorage.getItem('natively_auto_scroll');
      setAutoScroll(stored === 'true');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Auto-scroll to bottom on every messages update when toggle is enabled.
  // 'auto' (instant) instead of 'smooth' is intentional: streaming tokens fire
  // this effect tens of times per second; smooth would restart the animation
  // each time and never reach bottom, producing visible chase/jitter.
  useEffect(() => {
    if (!autoScroll) return;
    if (messages.length === 0) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, autoScroll]);

  const [rollingTranscript, setRollingTranscript] = useState(''); // For interviewer rolling text bar
  const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false); // Track if actively speaking
  const [detectedEmotion, setDetectedEmotion] = useState<{
    emotion: TranscriptEmotion;
    emotionDegree?: TranscriptEmotionDegree;
    label: string;
    speaker: string;
    receivedAt: number;
  } | null>(null);
  const emotionClearTimerRef = useRef<number | null>(null);
  const [voiceInput, setVoiceInput] = useState(''); // Accumulated user voice input
  const voiceInputRef = useRef<string>(''); // Ref for capturing in async handlers
  const textInputRef = useRef<HTMLInputElement>(null); // Ref for input focus
  const isStealthRef = useRef<boolean>(false); // Tracks if the next window show should be inactive (no focus steal)
  // Latest-handler ref so the captured-key listener (mounted with [] deps)
  // calls the CURRENT handleManualSubmit closure — not the one captured at
  // first render, which reads inputValue="" and silently no-ops on submit.
  // Updated on every render below.
  const handleManualSubmitRef = useRef<() => void>(() => {});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rafDimUpdateRef = useRef<number | null>(null);
  const codeExpandedRef = useRef(false);
  const animationControlsRef = useRef<ReturnType<typeof animate> | null>(null);
  const showSenseVoiceEmotion = useCallback((transcript: NativeAudioTranscriptPayload) => {
    if (!transcript.emotion || !transcript.emotionSource) return;
    const label = SENSEVOICE_EMOTION_LABELS[transcript.emotion];
    if (!label) return;

    if (emotionClearTimerRef.current !== null) {
      window.clearTimeout(emotionClearTimerRef.current);
    }

    setDetectedEmotion({
      emotion: transcript.emotion,
      emotionDegree: transcript.emotionDegree,
      label,
      speaker: transcript.speaker === 'user' ? '你' : '面试官',
      receivedAt: Date.now(),
    });
    emotionClearTimerRef.current = window.setTimeout(() => {
      setDetectedEmotion(null);
      emotionClearTimerRef.current = null;
    }, 4000);
  }, []);
  // Stability gate for code-visibility transitions. Scroll fires at ~60Hz;
  // without this, fast scrolls cancel and restart the 0.7s tween repeatedly,
  // producing stutter (and sometimes a snap when start≈target). The pending
  // visibility must hold its new state for STABILITY_MS before we commit to
  // a transition.
  const stableVisibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVisibilityRef = useRef<boolean | null>(null);
  // Sticky-bottom across expand/contract. Captured at the start of each
  // transition: if the chat was scrolled to (or within 8 px of) the bottom,
  // the rAF loop pins scrollTop to bottom on every spring frame so the
  // bottom of the conversation stays visually pinned as scrollMaxH grows.
  // iMessage does the same when its window resizes.
  const wasAtBottomRef = useRef<boolean>(true);
  // Captures data from onCaptureAndProcess before the React state flush so
  // handleWhatToSay() can access it even in React 18 concurrent mode (where
  // a plain setTimeout(0) may fire before setAttachedContext flushes).
  const pendingCaptureRef = useRef<{ path: string; preview: string } | null>(null);

  // Latent Context State (Screenshots attached but not sent)
  const [attachedContext, setAttachedContext] = useState<Array<{ path: string; preview: string }>>(
    [],
  );

  // Settings State with Persistence
  const [hideChatHidesWidget, setHideChatHidesWidget] = useState(() => {
    const stored = localStorage.getItem('natively_hideChatHidesWidget');
    return stored ? stored === 'true' : true;
  });

  // Active mode name (shown as a badge near the Modes button)
  const [activeModeLabel, setActiveModeLabel] = useState<string | null>(null);
  const [modes, setModes] = useState<Array<{ id: string; name: string; templateType: string; isActive: boolean }>>([]);
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const [modeDropdownError, setModeDropdownError] = useState<string | null>(null);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const [llmProviderLabel, setLlmProviderLabel] = useState<string>('unknown');
  const [llmPrivacyLabel, setLlmPrivacyLabel] = useState<string>('Checking privacy route');
  const [screenContextStatus, setScreenContextStatus] = useState<
    'not_available' | 'available' | 'failed'
  >('not_available');
  const [latestUsedImageInput, setLatestUsedImageInput] = useState(false);
  // Vision-first provenance — populated from the generateWhatToSay response.
  const [latestVisionProviderUsed, setLatestVisionProviderUsed] = useState<string | undefined>(
    undefined,
  );
  const [latestVisionModelUsed, setLatestVisionModelUsed] = useState<string | undefined>(undefined);
  const [latestVisionFailureReason, setLatestVisionFailureReason] = useState<string | undefined>(
    undefined,
  );
  const [latestAnswerId, setLatestAnswerId] = useState<string | undefined>(undefined);
  const [latestAnswerTrace, setLatestAnswerTrace] = useState<AnswerContextTrace | null>(null);
  const [latestAnswerCitations, setLatestAnswerCitations] = useState<AnswerCitation[]>([]);
  const [latestDegradedReason, setLatestDegradedReason] = useState<string | undefined>(undefined);
  const [latestChatSourceStatus, setLatestChatSourceStatus] = useState<AnswerSourceStatus | null>(null);
  const [contextHealth, setContextHealth] = useState<ContextHealth | null>(null);
  const [latestCitationStatus, setLatestCitationStatus] = useState<CitationStatus>('none');
  const [citationPreviewMessage, setCitationPreviewMessage] = useState<string | null>(null);
  const latestAnswerLifecycleRef = useRef<LatestAnswerLifecycle | null>(null);
  const latestAnswerRequestIdRef = useRef(0);
  const activeRealtimeRequestIdRef = useRef<string | null>(null);
  const activeMode = modes.find((mode) => mode.isActive) ?? null;
  const activeModeDisplayLabel = activeMode
    ? getModeDisplayName(activeMode)
    : activeModeLabel;
  const llmRouteDisplayLabel =
    llmPrivacyLabel === '云端 LLM 路由'
      ? `云端：${llmProviderLabel}`
      : llmPrivacyLabel === '本地/私有路由'
        ? `本地/私有：${llmProviderLabel}`
        : llmPrivacyLabel === '自定义端点路由'
          ? `自定义端点：${llmProviderLabel}`
          : llmPrivacyLabel;

  useEffect(() => {
    // Load initial active mode name + mode list
    window.electronAPI
      ?.modesGetActive?.()
      .then((mode: { name: string } | null) => setActiveModeLabel(mode?.name ?? null))
      .catch(() => {});
    window.electronAPI
      ?.modesGetAll?.()
      .then((allModes: Array<{ id: string; name: string; templateType: string; isActive: boolean }>) =>
        setModes(allModes.map((m) => ({ id: m.id, name: m.name, templateType: m.templateType, isActive: m.isActive }))),
      )
      .catch(() => {});
    // Live-update whenever mode is activated/deactivated
    const unsub = window.electronAPI?.onModeChanged?.(
      (data: { id: string | null; name: string | null }) => {
        setActiveModeLabel(data.name);
        // Refresh active state in the local list
        setModes((prev) =>
          prev.map((m) => ({
            ...m,
            isActive: data.id ? m.id === data.id : false,
          })),
        );
      },
    );
    return () => unsub?.();
  }, []);

  const refreshContextHealth = useCallback(async () => {
    const health = await window.electronAPI?.getContextHealth?.().catch(() => null);
    if (health) {
      setContextHealth(health);
    }
  }, []);

  useEffect(() => {
    refreshContextHealth().catch(() => {});
  }, [refreshContextHealth]);

  // Close mode dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(event.target as Node)) {
        setIsModeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadLlmRoute = async () => {
      const config = await window.electronAPI?.getCurrentLlmConfig?.().catch(() => null);
      if (!mounted || !config) return;
      setLlmProviderLabel(formatProviderLabel(config.provider));
      setLlmPrivacyLabel(
        config.provider === 'ollama' || config.provider === 'codex-cli'
          ? '本地/私有路由'
          : config.provider === 'custom'
            ? '自定义端点路由'
            : '云端 LLM 路由',
      );
    };
    loadLlmRoute();
    const unsub = window.electronAPI?.onModelChanged?.(() => {
      loadLlmRoute();
    });
    return () => {
      mounted = false;
      unsub?.();
    };
  }, []);

  // Model Selection State
  const [currentModel, setCurrentModel] = useState<string>('gemini-3-flash-preview');

  // Dynamic Action Button Mode (Recap vs Brainstorm)
  const [actionButtonMode, setActionButtonMode] = useState<'recap' | 'brainstorm'>('recap');

  useEffect(() => {
    // Load persisted mode
    window.electronAPI
      ?.getActionButtonMode?.()
      ?.then((mode: 'recap' | 'brainstorm') => {
        if (mode) setActionButtonMode(mode);
      })
      .catch(() => {});

    // Listen for live changes from SettingsPopup / IPC
    const unsubscribe = window.electronAPI?.onActionButtonModeChanged?.(
      (mode: 'recap' | 'brainstorm') => {
        setActionButtonMode(mode);
      },
    );
    return () => {
      unsubscribe?.();
    };
  }, []);

  const codeTheme = isLightTheme ? oneLight : vscDarkPlus;
  const codeLineNumberColor = isLightTheme ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.2)';
  const appearance = useMemo(
    () =>
      isGlassTheme
        ? getGlassOverlayAppearance()
        : getOverlayAppearance(overlayOpacity, isLightTheme ? 'light' : 'dark'),
    [overlayOpacity, isLightTheme, isGlassTheme],
  );
  const overlayPanelClass = 'overlay-text-primary';
  const subtleSurfaceClass = 'overlay-subtle-surface';
  const codeBlockClass = 'overlay-code-block-surface';
  const codeHeaderClass = 'overlay-code-header-surface';
  const codeHeaderTextClass = 'overlay-text-muted';
  const quickActionClass = 'overlay-chip-surface overlay-text-interactive';
  const inputClass = `${isLightTheme ? 'focus:ring-black/10' : 'focus:ring-white/10'} overlay-input-surface overlay-input-text`;
  const controlSurfaceClass = 'overlay-control-surface overlay-text-interactive';

  // PERF: hoist ReactMarkdown `components` maps for every streaming intent
  // into a single useMemo so their identity is stable across renders. Each
  // inline <ReactMarkdown components={{...}}> would create a fresh object
  // literal per render — defeating ReactMarkdown's internal render-bailout.
  //
  // ALL message-intent branches stream tokens (per IntelligenceEngine emits):
  //   - standard:              plain system text bubbles (fallback render)
  //   - codeText:              text parts inside a code-bubble
  //   - whatToAnswerText:      `what_to_answer` card body (suggested_answer_token;
  //                            emerald theme)
  //   - recapText:             `recap` body (recap_token; indigo theme)
  //   - shortenText:           `shorten` body — IMPORTANT: shorten streams
  //                            via refined_answer_token with intent='shorten'
  //                            (IntelligenceEngine.ts); cyan theme.
  //
  // No intent is rendered with an inline `components={{...}}` literal.
  const mdComponents = useMemo(
    () => ({
      standard: {
        p: ({ node, ...props }: any) => (
          <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />
        ),
        strong: ({ node, ...props }: any) => (
          <strong className="font-bold opacity-100 overlay-text-strong" {...props} />
        ),
        em: ({ node, ...props }: any) => (
          <em className="italic opacity-90 overlay-text-secondary" {...props} />
        ),
        del: ({ node, ...props }: any) => (
          <span {...props} />
        ),
        ul: ({ node, ...props }: any) => (
          <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />
        ),
        ol: ({ node, ...props }: any) => (
          <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />
        ),
        li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
        code: ({ node, ...props }: any) => (
          <code
            className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono ${isLightTheme ? 'text-slate-800' : ''}`}
            {...props}
          />
        ),
        a: ({ node, ...props }: any) => (
          <a
            className="underline hover:opacity-80"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          />
        ),
      },
      codeText: {
        p: ({ node, ...props }: any) => (
          <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />
        ),
        strong: ({ node, ...props }: any) => (
          <strong className="font-bold overlay-text-strong" {...props} />
        ),
        em: ({ node, ...props }: any) => (
          <em className="italic overlay-text-secondary" {...props} />
        ),
        del: ({ node, ...props }: any) => (
          <span {...props} />
        ),
        ul: ({ node, ...props }: any) => (
          <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />
        ),
        ol: ({ node, ...props }: any) => (
          <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />
        ),
        li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
        h1: ({ node, ...props }: any) => (
          <h1 className="text-lg font-bold mb-2 mt-3 overlay-text-strong" {...props} />
        ),
        h2: ({ node, ...props }: any) => (
          <h2 className="text-base font-bold mb-2 mt-3 overlay-text-strong" {...props} />
        ),
        h3: ({ node, ...props }: any) => (
          <h3 className="text-sm font-bold mb-1 mt-2 overlay-text-primary" {...props} />
        ),
        code: ({ node, ...props }: any) => (
          <code
            className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono whitespace-pre-wrap ${isLightTheme ? 'text-violet-700' : 'text-purple-200'}`}
            {...props}
          />
        ),
        blockquote: ({ node, ...props }: any) => (
          <blockquote
            className={`border-l-2 pl-3 italic my-2 ${isLightTheme ? 'border-violet-500/30 text-slate-600' : 'border-purple-500/50 text-slate-400'}`}
            {...props}
          />
        ),
        a: ({ node, ...props }: any) => (
          <a
            className={`hover:underline ${isLightTheme ? 'text-blue-600 hover:text-blue-700' : 'text-blue-400 hover:text-blue-300'}`}
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          />
        ),
      },
      whatToAnswerText: {
        p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
        strong: ({ node, ...props }: any) => (
          <strong
            className={`font-bold ${isLightTheme ? 'text-emerald-700' : 'text-emerald-100'}`}
            {...props}
          />
        ),
        em: ({ node, ...props }: any) => (
          <em
            className={`italic ${isLightTheme ? 'text-emerald-700/80' : 'text-emerald-200/80'}`}
            {...props}
          />
        ),
        del: ({ node, ...props }: any) => (
          <span {...props} />
        ),
        ul: ({ node, ...props }: any) => (
          <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />
        ),
        ol: ({ node, ...props }: any) => (
          <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />
        ),
        li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
      },
      recapText: {
        p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
        strong: ({ node, ...props }: any) => (
          <strong
            className={`font-bold ${isLightTheme ? 'text-indigo-800' : 'text-indigo-100'}`}
            {...props}
          />
        ),
        del: ({ node, ...props }: any) => (
          <span {...props} />
        ),
        ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
        li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
      },
      shortenText: {
        p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
        strong: ({ node, ...props }: any) => (
          <strong
            className={`font-bold ${isLightTheme ? 'text-cyan-800' : 'text-cyan-100'}`}
            {...props}
          />
        ),
        del: ({ node, ...props }: any) => (
          <span {...props} />
        ),
        ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
        li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
      },
    }),
    [isLightTheme],
  );

  // ── Code-expansion spring ────────────────────────────────────────────────
  // Architecture: stable canvas, renderer-only animation.
  //
  // The OS window is pinned to STABLE_OVERLAY_WIDTH for the entire chat-
  // expanded session — its width never changes when code becomes visible or
  // hidden. The shell width animates 600 ↔ 780 purely in renderer CSS via a
  // Framer spring. mx-auto centers the shell against a STABLE 780 parent, so
  // its margin animates symmetrically (90 → 0 on expand, 0 → 90 on contract).
  //
  // Why this anchors the TopPill to its screen position:
  //   • OS window X never moves during code expand/contract (no IPC).
  //   • OS window content area is always 780 wide.
  //   • TopPill and shell sit in a flex column centered horizontally inside
  //     that stable canvas → TopPill's screen X is invariant of the spring.
  //   • OS window Y is preserved by setBounds → TopPill's screen Y is fixed.
  //   • Shell height growth is driven by content; ResizeObserver feeds height
  //     (only) to the OS, which extends downward (Y preserved).
  //
  // The 90px transparent gutters on each side when shellWidth == 600 are
  // invisible (window background is transparent) and click-through.
  const SHELL_WIDTH_COLLAPSED = 600;
  const SHELL_WIDTH_EXPANDED = 780;
  const STABLE_OVERLAY_WIDTH = SHELL_WIDTH_EXPANDED;
  const shellWidth = useMotionValue(SHELL_WIDTH_COLLAPSED);
  const scrollMaxH = useTransform(
    shellWidth,
    [SHELL_WIDTH_COLLAPSED, SHELL_WIDTH_EXPANDED],
    [320, 560],
  );

  // isExpanded mirror for closures inside refs/observers that must not
  // re-bind on every toggle.
  const isExpandedRef = useRef(true);

  useEffect(() => {
    // Load the persisted default model (not the runtime model)
    // Each new meeting starts with the default from settings
    if (window.electronAPI?.getDefaultModel) {
      window.electronAPI
        .getDefaultModel()
        .then((result: any) => {
          if (result && result.model) {
            setCurrentModel(result.model);
            // Also set the runtime model to the default
            window.electronAPI.setModel(result.model).catch(() => {});
          }
        })
        .catch((err: any) => console.error('Failed to fetch default model:', err));
    }
  }, []);

  const handleModelSelect = (modelId: string) => {
    setCurrentModel(modelId);
    // Session-only: update runtime but don't persist as default
    window.electronAPI
      .setModel(modelId)
      .catch((err: any) => console.error('Failed to set model:', err));
  };

  // Listen for default model changes from Settings
  useEffect(() => {
    if (!window.electronAPI?.onModelChanged) return;
    const unsubscribe = window.electronAPI.onModelChanged((modelId: string) => {
      setCurrentModel((prev) => (prev === modelId ? prev : modelId));
    });
    return () => unsubscribe();
  }, []);

  // Persist Settings
  useEffect(() => {
    localStorage.setItem('natively_hideChatHidesWidget', String(hideChatHidesWidget));
  }, [hideChatHidesWidget]);

  // Mouse Passthrough State
  const [isMousePassthrough, setIsMousePassthrough] = useState(false);
  useEffect(() => {
    window.electronAPI
      ?.getOverlayMousePassthrough?.()
      .then(setIsMousePassthrough)
      .catch(() => {});
    const unsub = window.electronAPI?.onOverlayMousePassthroughChanged?.((v) =>
      setIsMousePassthrough(v),
    );
    return () => unsub?.();
  }, []);

  // Audio capture / screen-recording warning banner. Two distinct IPC
  // events feed the same banner surface but require different title and
  // action: the macOS screen-recording-permission denial points at the
  // OS Privacy pane, while generic audio-capture failures (no-chunks
  // watchdog, TCC zero-fill, terminal STT init failure, SCK errors) are
  // cross-platform and should open Natively's own Settings. Bundling
  // both under a hardcoded "Screen Recording Permission Denied" title
  // with an x-apple.systempreferences action was issue #252: on Windows
  // the audio-capture-failed path fired, the user saw a macOS-only title
  // and the Open Settings button handed Windows shell a URI scheme it
  // couldn't resolve (Microsoft Store popup).
  type SystemAudioWarning = {
    kind: 'screen-recording-permission' | 'audio-capture-failure' | 'microphone-capture-failure';
    message: string;
    backend?: string;
    code?: string;
    recommendedFix?: 'open-settings' | 'reset-tcc' | 'restart-app' | 'none';
    staleGrantSuspected?: boolean;
  };
  const systemAudioRepairAction = 'repair-and-restart';
  const [systemAudioWarning, setSystemAudioWarning] = useState<SystemAudioWarning | null>(null);
  const [isRepairingTcc, setIsRepairingTcc] = useState(false);
  useEffect(() => {
    sttUserStatusRef.current = sttUserStatus;
    if (sttUserStatus === 'connected') {
      micCaptureFailureRef.current = false;
    }
    if (sttUserStatus === 'failed') {
      micCaptureFailureRef.current = true;
    }
  }, [sttUserStatus]);

  useEffect(() => {
    if (!window.electronAPI?.getMeetingActive || !window.electronAPI?.onMeetingStateChanged) return;

    let mounted = true;
    window.electronAPI
      .getMeetingActive()
      .then((isActive) => {
        if (!mounted || !isActive) return;
        setSystemAudioWarning(null);
        setSystemAudioIssue(null);
        setRollingTranscript('');
        setIsInterviewerSpeaking(false);
        micCaptureFailureRef.current = false;
      })
      .catch(() => {});

    const unsub = window.electronAPI.onMeetingStateChanged(({ isActive }) => {
      if (!isActive) {
        setMeetingStartStatus(null);
        return;
      }
      setSystemAudioWarning(null);
      setSystemAudioIssue(null);
      setMeetingStartStatus(null);
      setRollingTranscript('');
      setIsInterviewerSpeaking(false);
      micCaptureFailureRef.current = false;
    });

    return () => {
      mounted = false;
      unsub?.();
    };
  }, []);

  useEffect(() => {
    const cleanupStatus = window.electronAPI?.onMeetingStartStatus?.((status) => {
      setMeetingStartStatus(status.phase === 'ready' ? null : status);
    });
    const cleanupAudio = window.electronAPI?.onMeetingAudioError?.((message: string) => {
      setMeetingStartStatus({ phase: 'failed', message });
      setIsExpanded(true);
    });

    return () => {
      cleanupStatus?.();
      cleanupAudio?.();
    };
  }, []);

  useEffect(() => {
    const unsub = window.electronAPI?.onSystemAudioPermissionDenied?.((message: string) => {
      setSystemAudioIssue(message || '系统音频未捕获');
      if (!micCaptureFailureRef.current && sttUserStatusRef.current !== 'failed') return;
      setSystemAudioWarning({ kind: 'screen-recording-permission', message });
      setIsExpanded(true); // Force overlay open so user sees the warning
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    const unsub = window.electronAPI?.onAudioCaptureFailed?.((payload) => {
      if (payload.channel === 'mic') {
        micCaptureFailureRef.current = true;
        if (payload.terminal || payload.stuck || payload.recommendedFix === 'reset-tcc' || payload.staleGrantSuspected) {
          setSystemAudioWarning({
            kind: 'microphone-capture-failure',
            message: payload.message,
            backend: payload.backend,
            code: payload.code,
            recommendedFix: payload.recommendedFix,
            staleGrantSuspected: payload.staleGrantSuspected,
          });
          setIsExpanded(true);
        }
        return;
      }
      setSystemAudioIssue(payload.message || '系统音频未捕获');
      if (!micCaptureFailureRef.current && sttUserStatusRef.current !== 'failed') return;
      // Only surface terminal failures or the stuck signal — transient
      // recovery attempts shouldn't spam the banner since recovery
      // typically succeeds within ~1.5s.
      if (payload.terminal || payload.stuck || payload.recommendedFix === 'reset-tcc' || payload.staleGrantSuspected) {
        setSystemAudioWarning({
          kind: 'audio-capture-failure',
          message: payload.message,
          backend: payload.backend,
          code: payload.code,
          recommendedFix: payload.recommendedFix,
          staleGrantSuspected: payload.staleGrantSuspected,
        });
        setIsExpanded(true);
      }
    });
    return () => unsub?.();
  }, []);

  const handleRepairTccPermission = useCallback(async () => {
    if (isRepairingTcc) return;
    setIsRepairingTcc(true);
    try {
      const scope = systemAudioWarning?.kind === 'microphone-capture-failure'
        ? 'microphone'
        : 'screen';
      const result = await window.electronAPI?.repairTccPermission?.(scope);
      if (!result?.success) {
        setSystemAudioWarning((prev) =>
          prev
            ? {
                ...prev,
                message: result?.error || '权限缓存修复失败，请手动在系统设置中重新授予权限。',
              }
            : prev,
        );
        return;
      }

      const shouldRestart = window.confirm('权限缓存已清理。立即重启 CueUp 以重新触发 macOS 授权吗？');
      if (shouldRestart) {
        await window.electronAPI?.restartAfterTccRepair?.();
      } else {
        setSystemAudioWarning((prev) =>
          prev
            ? {
                ...prev,
                message: '权限缓存已清理。请手动重启 CueUp 以重新触发 macOS 授权。',
              }
            : prev,
        );
      }
    } finally {
      setIsRepairingTcc(false);
    }
  }, [isRepairingTcc, systemAudioWarning?.kind]);

  // PR #173: STT not configured warning — shown when provider is 'none' during a meeting
  const [sttNotConfigured, setSttNotConfigured] = useState(false);
  useEffect(() => {
    let mounted = true;
    // Check current STT config on mount
    window.electronAPI
      ?.getSttProvider?.()
      .then((provider: string) => {
        if (mounted) {
          setSelectedSttProvider(provider);
          setSttNotConfigured(provider === 'none');
        }
      })
      .catch(() => {});

    // Listen for live config changes (e.g. user saves a key in Settings while meeting is active)
    const unsub = window.electronAPI?.onSttConfigChanged?.(
      (data: { configured: boolean; provider: string }) => {
        if (mounted) {
          setSelectedSttProvider(data.provider);
          setSttNotConfigured(!data.configured);
        }
      },
    );
    return () => {
      mounted = false;
      unsub?.();
    };
  }, []);

  // Keep the closure-free isExpanded mirror in sync.
  useEffect(() => {
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);

  // Single canonical size-reporter. While the chat overlay is expanded we
  // pin the OS window to STABLE_OVERLAY_WIDTH (=SHELL_WIDTH_EXPANDED) so the
  // shell can spring 600↔780 in renderer CSS without ever resizing the OS
  // window — no IPC race, no clip, no jump. Centered IPC is used so the
  // first chat-mode entry (when the OS window may grow from a smaller mode
  // into the stable canvas) keeps the TopPill's center fixed; subsequent
  // height-only updates have widthDelta=0 and don't shift X.
  const reportShellSize = useCallback(() => {
    if (!contentRef.current) return;
    const rect = contentRef.current.getBoundingClientRect();
    const childGap = 8; // Matches the root `gap-2` between TopPill and the shell.
    const childHeights = Array.from(contentRef.current.children).reduce((sum, child, index) => {
      const childHeight = Math.ceil((child as HTMLElement).getBoundingClientRect().height);
      return sum + childHeight + (index > 0 ? childGap : 0);
    }, 0);
    const widthCandidates = [
      rect.width,
      contentRef.current.scrollWidth,
      contentRef.current.offsetWidth,
      shellRef.current?.scrollWidth ?? 0,
      shellRef.current?.offsetWidth ?? 0,
    ];
    const heightCandidates = [
      rect.height,
      contentRef.current.scrollHeight,
      contentRef.current.offsetHeight,
      childHeights,
      shellRef.current?.scrollHeight ?? 0,
      shellRef.current?.offsetHeight ?? 0,
    ];
    const width = isExpandedRef.current
      ? STABLE_OVERLAY_WIDTH
      : Math.ceil(Math.max(...widthCandidates));
    // A small buffer prevents transparent panel clipping from fractional layout
    // and late font/render settling in the overlay window.
    const height = Math.ceil(Math.max(...heightCandidates)) + 16;
    const api = window.electronAPI as any;
    if (api?.updateContentDimensionsCentered) {
      api.updateContentDimensionsCentered({ width, height });
    } else {
      window.electronAPI?.updateContentDimensions({ width, height });
    }
  }, [STABLE_OVERLAY_WIDTH]);

  // ResizeObserver: rAF-debounced so the spring can update height without
  // flooding IPC. Width is constant in expanded mode, so per-frame updates
  // only carry height changes — no race with the renderer's CSS spring.
  useLayoutEffect(() => {
    if (!contentRef.current) return;

    const observer = new ResizeObserver(() => {
      if (rafDimUpdateRef.current) cancelAnimationFrame(rafDimUpdateRef.current);
      rafDimUpdateRef.current = requestAnimationFrame(() => {
        rafDimUpdateRef.current = null;
        reportShellSize();
      });
    });

    observer.observe(contentRef.current);
    return () => {
      observer.disconnect();
      if (rafDimUpdateRef.current) {
        cancelAnimationFrame(rafDimUpdateRef.current);
        rafDimUpdateRef.current = null;
      }
    };
  }, [reportShellSize]);

  // attachedContext (screenshots add/remove) and initial-sizing safety:
  // both just re-run the canonical reporter — no more "what width should I
  // use right now?" branching against animation flags.
  useEffect(() => {
    const id = requestAnimationFrame(reportShellSize);
    return () => cancelAnimationFrame(id);
  }, [attachedContext, reportShellSize]);

  useEffect(() => {
    const timer = setTimeout(reportShellSize, 600);
    return () => clearTimeout(timer);
  }, [reportShellSize]);

  // ── Code-expansion ──────────────────────────────────────────────────────
  // The shell's width animates 600↔780 with a renderer-only spring against a
  // STABLE 780-wide OS canvas. mx-auto on the wrapper distributes the width
  // delta as symmetric horizontal margin → expansion grows from the center,
  // TopPill stays anchored, no IPC during the animation. Height growth is
  // picked up by the ResizeObserver and forwarded to the OS as height-only
  // updates (width is unchanged so no X shift, no jump).
  const startTransition = useCallback(
    (targetWidth: number) => {
      codeExpandedRef.current = targetWidth === SHELL_WIDTH_EXPANDED;
      if (animationControlsRef.current) animationControlsRef.current.stop();

      // iMessage-style sticky bottom. Capture the user's scroll intent now,
      // before scrollMaxH starts changing. If they were at (or near) the
      // bottom, we keep them pinned there throughout the spring so growing
      // viewport height doesn't reveal stale history below the visible chat.
      // If they were scrolled up to read history, we leave their position
      // alone — the extra viewport extends downward into empty space, which
      // is the correct behavior for a reader.
      const container = scrollContainerRef.current;
      if (container) {
        const distanceFromBottom =
          container.scrollHeight - (container.scrollTop + container.clientHeight);
        wasAtBottomRef.current = distanceFromBottom <= 8;
      }

      // Symmetric ease-in-out-cubic. Smooth ramp on both ends — no perceived
      // velocity break at the start or finish, which is what makes a width
      // animation read as "buttery" rather than "snappy". The cubic poly
      // is gentle enough that the 1px-per-frame motion at the edges is
      // visually subliminal at 60Hz, eliminating the "settle" jitter you
      // get with steeper ease-out curves on width-driven reflow.
      animationControlsRef.current = animate(shellWidth, targetWidth, {
        type: 'tween' as const,
        ease: [0.65, 0, 0.35, 1],
        duration: 0.7,
        onUpdate: () => {
          if (!wasAtBottomRef.current) return;
          const c = scrollContainerRef.current;
          if (!c) return;
          // scrollMaxH is derived from shellWidth, so on every tick the
          // viewport height has just changed. Re-pin to bottom in the
          // SAME frame — single layout read, single write, no flush.
          c.scrollTop = c.scrollHeight - c.clientHeight;
        },
        onComplete: () => {
          animationControlsRef.current = null;
        },
      });
    },
    [shellWidth, SHELL_WIDTH_EXPANDED],
  );

  // Scan [data-code-msg] elements and check if any intersect the scroll container
  // viewport. Called on every scroll event and after every messages update.
  // Uses a stability gate: the visibility must hold its new state for
  // STABILITY_MS before a transition fires. This filters out the rapid
  // visible↔invisible flicker that occurs when a code block crosses the
  // viewport edge during a fast scroll, which would otherwise interrupt
  // the 0.7s tween mid-flight and cause stutter.
  const STABILITY_MS = 120;
  const checkCodeVisibility = useCallback(() => {
    const container = scrollContainerRef.current;

    // Scroll container unmounted (session reset / messages cleared) — force
    // contraction so the shell returns to its collapsed width.
    if (!container) {
      if (stableVisibilityTimerRef.current) {
        clearTimeout(stableVisibilityTimerRef.current);
        stableVisibilityTimerRef.current = null;
      }
      pendingVisibilityRef.current = null;
      if (codeExpandedRef.current) startTransition(SHELL_WIDTH_COLLAPSED);
      return;
    }

    const codeEls = container.querySelectorAll('[data-code-msg]');
    let visible = false;
    if (codeEls.length > 0) {
      const cRect = container.getBoundingClientRect();
      for (const el of codeEls) {
        const r = el.getBoundingClientRect();
        if (r.bottom > cRect.top && r.top < cRect.bottom) {
          visible = true;
          break;
        }
      }
    }

    // Already in the correct state — clear any pending change so a
    // mid-flight tween isn't interrupted by a stale timer firing.
    if (visible === codeExpandedRef.current) {
      pendingVisibilityRef.current = null;
      if (stableVisibilityTimerRef.current) {
        clearTimeout(stableVisibilityTimerRef.current);
        stableVisibilityTimerRef.current = null;
      }
      return;
    }

    // State change detected. If we're already waiting on the SAME pending
    // change, let the timer continue ticking — don't reset it on every
    // scroll frame, or fast scroll would never let the timer fire.
    if (pendingVisibilityRef.current === visible) return;

    pendingVisibilityRef.current = visible;
    if (stableVisibilityTimerRef.current) clearTimeout(stableVisibilityTimerRef.current);
    stableVisibilityTimerRef.current = setTimeout(() => {
      stableVisibilityTimerRef.current = null;
      const target = pendingVisibilityRef.current;
      pendingVisibilityRef.current = null;
      if (target !== null && target !== codeExpandedRef.current) {
        startTransition(target ? SHELL_WIDTH_EXPANDED : SHELL_WIDTH_COLLAPSED);
      }
    }, STABILITY_MS);
  }, [startTransition, SHELL_WIDTH_COLLAPSED, SHELL_WIDTH_EXPANDED]);

  // Re-check after every messages update (catches mid-stream code fences).
  useEffect(() => {
    const raf = requestAnimationFrame(() => checkCodeVisibility());
    return () => cancelAnimationFrame(raf);
  }, [messages, checkCodeVisibility]);

  // Re-attach scroll listener whenever messages change — the scroll container
  // is conditionally rendered so scrollContainerRef.current is null at mount.
  //
  // The visibility check does layout reads (querySelectorAll +
  // getBoundingClientRect on every code element). Running it synchronously
  // on every scroll event forces a layout flush mid-scroll-frame, which
  // shows up as text jitter during fast scrolls. rAF-coalescing it ensures
  // at most one check per frame and lets the read happen at the natural
  // post-scroll layout point in the frame lifecycle.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        checkCodeVisibility();
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [messages, checkCodeVisibility]);

  // Cancel all in-flight async work on unmount.
  useEffect(() => {
    return () => {
      animationControlsRef.current?.stop();
      animationControlsRef.current = null;
      if (rafDimUpdateRef.current) {
        cancelAnimationFrame(rafDimUpdateRef.current);
        rafDimUpdateRef.current = null;
      }
      if (stableVisibilityTimerRef.current) {
        clearTimeout(stableVisibilityTimerRef.current);
        stableVisibilityTimerRef.current = null;
      }
      pendingVisibilityRef.current = null;
      // PERF: cancel any pending token-flush RAF so we don't try to
      // setState on an unmounted component.
      if (tokenBufRef.current.raf !== null) {
        cancelAnimationFrame(tokenBufRef.current.raf);
        tokenBufRef.current.raf = null;
        tokenBufRef.current.text = '';
      }
      // Also reset imperative streaming refs on unmount so stale DOM
      // node refs don't fire after the component is gone.
      streamingNodeRef.current = null;
      streamingTextRef.current = '';
      streamingMsgIdRef.current = null;
    };
  }, []);
  // ────────────────────────────────────────────────────────────────────────

  // Build conversation context from messages
  useEffect(() => {
    const context = messages
      .filter((m) => m.role !== 'user' || !m.hasScreenshot)
      .map(
        (m) =>
          `${m.role === 'interviewer' ? 'Interviewer' : m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`,
      )
      .slice(-20)
      .join('\n');
    setConversationContext(context);
  }, [messages]);

  // Listen for settings window visibility changes
  useEffect(() => {
    if (!window.electronAPI?.onSettingsVisibilityChange) return;
    const unsubscribe = window.electronAPI.onSettingsVisibilityChange((isVisible) => {
      setIsSettingsOpen(isVisible);
    });
    return () => unsubscribe();
  }, []);

  // Sync Window Visibility with Expanded State
  useEffect(() => {
    if (isExpanded) {
      window.electronAPI.showWindow(isStealthRef.current);
      isStealthRef.current = false; // Reset back to default
    } else {
      // Slight delay to allow animation to clean up if needed, though immediate is safer for click-through
      // Using setTimeout to ensure the render cycle completes first
      // Increased to 400ms to allow "contract to bottom" exit animation to finish
      setTimeout(() => window.electronAPI.hideWindow(), 400);
    }
  }, [isExpanded]);

  // Keyboard shortcut to toggle expanded state (via Main Process)
  useEffect(() => {
    if (!window.electronAPI?.onToggleExpand) return;
    const unsubscribe = window.electronAPI.onToggleExpand(() => {
      setIsExpanded((prev) => !prev);
    });
    return () => unsubscribe();
  }, []);

  // Ensure overlay is expanded when requested by main process (e.g. after switching to overlay mode).
  // IMPORTANT: set isStealthRef before setIsExpanded so that if isExpanded was false, the
  // isExpanded effect fires showWindow(true) instead of showWindow(false). Without this,
  // ensure-expanded on a collapsed overlay would trigger show()+focus(), breaking stealth.
  useEffect(() => {
    if (!window.electronAPI?.onEnsureExpanded) return;
    const unsubscribe = window.electronAPI.onEnsureExpanded(() => {
      isStealthRef.current = true;
      setIsExpanded(true);
    });
    return () => unsubscribe();
  }, []);

  // Session Reset Listener - Clears UI when a NEW meeting starts
  useEffect(() => {
    if (!window.electronAPI?.onSessionReset) return;
    const unsubscribe = window.electronAPI.onSessionReset(() => {
      console.log('[NativelyInterface] Resetting session state...');
      setMessages([]);
      setInputValue('');
      setAttachedContext([]);
      setManualTranscript('');
      setVoiceInput('');
      setIsProcessing(false);
      setMeetingStartStatus(null);
      setHasUserTranscript(false);
      setHasInterviewerTranscript(false);
      // Optionally reset connection status if needed, but connection persists

      // Track new conversation/session if applicable?
      // Actually 'app_opened' is global, 'assistant_started' is overlay.
      // Maybe 'conversation_started' event?
      analytics.trackConversationStarted();
    });
    return () => unsubscribe();
  }, []);

  const handleScreenshotAttach = (data: { path: string; preview: string }) => {
    setIsExpanded(true);
    setAttachedContext((prev) => {
      // Prevent duplicates and cap at 5
      if (prev.some((s) => s.path === data.path)) return prev;
      const updated = [...prev, data];
      return updated.slice(-5); // Keep last 5
    });
  };

  // STT Status listener — must survive isExpanded changes.
  // If registered inside the [isExpanded] effect, events are dropped during cleanup.
  useEffect(() => {
    return window.electronAPI.onSttStatusChanged((data) => {
      if (data.provider && data.provider !== 'none') {
        setSelectedSttProvider(data.provider);
        setSttNotConfigured(false);
      }

      if (data.channel === 'user') {
        setSttUserStatus(data.state);
        setSttUserProvider(data.provider);
        if (data.error) setSttUserError(data.error);
        if (data.state === 'connected') setSttUserError('');
      } else if (data.channel === 'interviewer') {
        setSttInterviewerStatus(data.state);
        setSttInterviewerProvider(data.provider);
        if (data.error) setSttInterviewerError(data.error);
        if (data.state === 'connected') setSttInterviewerError('');
      }
    });
  }, []);

  // ── PERF: streaming-token rAF coalescing ─────────────────────────────────
  // Token streams (LLM answers) used to call setMessages PER TOKEN. Groq
  // emits ~200–400 tok/s, so a 400-token answer triggered 400 React renders
  // — each one cloning the messages array and re-rendering every prior row.
  //
  // ── Imperative Streaming (Option 2: RAF-throttled markdown) ──────────────
  //
  // Architecture overview:
  //   • queueToken() writes each token directly to DOM via ref.textContent
  //     — zero React renders per token. A pending RAF schedules a markdown
  //     render (via marked + DOMPurify) at up to 60fps so the user sees
  //     formatted output throughout the stream.
  //   • Only the FIRST token of a new stream calls setMessages() to mount
  //     the bubble. The bubble's ref-callback wires streamingNodeRef.
  //   • flushToken() resets the imperative refs so the final-answer
  //     setMessages() takes ownership of the rendered row via React.
  //   • tokenBufRef is kept for the legacy sentinel/negotiation-coaching path
  //     and for the cleanup effect above.
  //
  // Tradeoff: marked parses the FULL accumulated text each RAF tick (not
  // incremental). In practice this is <1ms for typical LLM responses and
  // invisible at 60fps. If a response grows beyond ~20 KB we can throttle
  // the RAF to every other frame.
  // ─────────────────────────────────────────────────────────────────────────

  // Legacy buffer kept for sentinel/negotiation-coaching reset path.
  const tokenBufRef = useRef<{ intent: string; text: string; raf: number | null }>({
    intent: '',
    text: '',
    raf: null,
  });

  // Imperative streaming refs
  const streamingNodeRef   = useRef<HTMLDivElement | null>(null);
  const streamingTextRef   = useRef<string>('');
  const streamingMsgIdRef  = useRef<string | null>(null);
  const streamingIntentRef = useRef<string | null>(null);
  const streamingRafRef    = useRef<number | null>(null);

  // Helper: render accumulated markdown to the streaming DOM node via RAF.
  // Called after every token write. Schedules at most one RAF per frame.
  const scheduleMarkdownRender = useCallback(() => {
    if (streamingRafRef.current !== null) return; // already pending
    streamingRafRef.current = requestAnimationFrame(() => {
      streamingRafRef.current = null;
      const node = streamingNodeRef.current;
      if (!node || !streamingTextRef.current) return;
      node.innerHTML = renderSafeStreamingMarkdown(streamingTextRef.current);
    });
  }, []);

  // queueToken: imperative DOM write per token + RAF markdown render.
  // Only the FIRST token of a stream calls setMessages (to mount the bubble).
  // Subsequent tokens bypass React entirely — zero re-renders mid-stream.
  const queueToken = useCallback((intent: string, token: string) => {
    // If a DIFFERENT stream intent arrives while one is active, flush the
    // current stream into React state so rows don't bleed across intents.
    if (
      shouldFlushPreviousStream(
        streamingIntentRef.current,
        intent,
        streamingMsgIdRef.current,
      ) &&
      streamingTextRef.current
    ) {
      const prevText = streamingTextRef.current;
      const prevId   = streamingMsgIdRef.current;
      streamingNodeRef.current  = null;
      streamingTextRef.current  = '';
      streamingMsgIdRef.current = null;
      streamingIntentRef.current = null;
      if (streamingRafRef.current !== null) {
        cancelAnimationFrame(streamingRafRef.current);
        streamingRafRef.current = null;
      }
      reactStartTransition(() => {
        setMessages((prev) => {
          const idx = prev.findLastIndex((m) => m.id === prevId);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], text: prevText };
            return updated;
          }
          return prev;
        });
      });
    }

    streamingTextRef.current += token;
    streamingIntentRef.current = intent;

    if (streamingMsgIdRef.current !== null) {
      // Mid-stream: write directly to DOM, schedule markdown render.
      if (streamingNodeRef.current) {
        // Fast path: update textContent immediately so the user sees the
        // new character without waiting for the RAF, then let the RAF
        // upgrade it to rendered HTML. This gives sub-frame latency for
        // plain text and up-to-60fps latency for markdown.
        streamingNodeRef.current.textContent = streamingTextRef.current;
      }
      scheduleMarkdownRender();
      return;
    }

    // First token: mount the bubble via setMessages, then RAF will render.
    const id = genMessageId();
    streamingMsgIdRef.current = id;
    streamingIntentRef.current = intent;
    reactStartTransition(() => {
      setMessages((prev) => [
        ...prev,
        { id, role: 'system', text: token, intent, isStreaming: true },
      ]);
    });
    scheduleMarkdownRender();
  }, [scheduleMarkdownRender]);

  // registerStreamingNode: ref-callback wired to the streaming bubble's div.
  // Called by React when the node mounts/unmounts.
  const registerStreamingNode = useCallback((msgId: string, el: HTMLDivElement | null) => {
    if (msgId !== streamingMsgIdRef.current) return;
    streamingNodeRef.current = el;
    if (el && streamingTextRef.current) {
      // Push any text that arrived before the DOM node was ready.
      scheduleMarkdownRender();
    }
  }, [scheduleMarkdownRender]);

  const flushToken = useCallback(() => {
    // Cancel any pending markdown RAF — the final-answer setMessages is
    // about to take ownership of the row with fully rendered content.
    if (streamingRafRef.current !== null) {
      cancelAnimationFrame(streamingRafRef.current);
      streamingRafRef.current = null;
    }
    const text   = streamingTextRef.current;
    const msgId  = streamingMsgIdRef.current;
    // Reset imperative refs BEFORE setMessages so the streaming short-circuit
    // in renderMessageText is no longer active when React re-renders the row.
    streamingNodeRef.current  = null;
    streamingTextRef.current  = '';
    streamingMsgIdRef.current = null;
    streamingIntentRef.current = null;
    if (!text || !msgId) return;
    // NOT wrapped in startTransition — ordering must hold.
    setMessages((prev) => {
      const idx = prev.findLastIndex((m) => m.id === msgId);
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], text };
        return updated;
      }
      return prev;
    });
  }, []);
  // ──────────────────────────────────────────────────────────────────────────

  // Connect to Native Audio Backend
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // Connection Status
    window.electronAPI
      .getNativeAudioStatus()
      .then((status) => {
        setIsConnected(status.connected);
      })
      .catch(() => setIsConnected(false));

    cleanups.push(
      window.electronAPI.onNativeAudioConnected(() => {
        setIsConnected(true);
      }),
    );
    cleanups.push(
      window.electronAPI.onNativeAudioDisconnected(() => {
        setIsConnected(false);
      }),
    );

    // Real-time Transcripts
    cleanups.push(
      window.electronAPI.onNativeAudioTranscript((transcript) => {
        showSenseVoiceEmotion(transcript);

        // When Answer button is active, capture USER transcripts for voice input
        // Use ref to avoid stale closure issue
        if (isRecordingRef.current && transcript.speaker === 'user') {
          if (transcript.final) {
            // Accumulate final transcripts
            setVoiceInput((prev) => {
              const updated = prev + (prev ? ' ' : '') + transcript.text;
              voiceInputRef.current = updated;
              return updated;
            });
            setManualTranscript(''); // Clear partial preview
            manualTranscriptRef.current = '';
          } else {
            // Show live partial transcript
            setManualTranscript(transcript.text);
            manualTranscriptRef.current = transcript.text;
          }
          return; // Don't add to messages while recording
        }

        if (transcript.speaker !== 'interviewer' && transcript.speaker !== 'user') {
          return; // Safety check for any other speaker types
        }

        setSttNotConfigured(false);
        if (transcript.speaker === 'user') {
          setHasUserTranscript(true);
          setSttUserStatus('connected');
          setSttUserError('');
        } else if (transcript.speaker === 'interviewer') {
          setHasInterviewerTranscript(true);
          setSttInterviewerStatus('connected');
          setSttInterviewerError('');
          setSystemAudioIssue(null);
        }

        const speakerLabel = transcript.speaker === 'user' ? 'Me' : 'Interviewer';
        const displaySpeakerLabel = transcript.speakerLabel || speakerLabel;

        // Route to rolling transcript bar - accumulate text continuously
        setIsInterviewerSpeaking(!transcript.final);

        if (transcript.final) {
          // Append finalized text to accumulated transcript
          setRollingTranscript((prev) => {
            const separator = prev ? '  ·  ' : '';
            return prev + separator + `${displaySpeakerLabel}: ${transcript.text}`;
          });

          // Clear speaking indicator after pause
          setTimeout(() => {
            setIsInterviewerSpeaking(false);
          }, 3000);
        } else {
          // For partial transcripts, show current segment appended to accumulated
          setRollingTranscript((prev) => {
            // Find where previous finalized content ends (look for last separator)
            const lastSeparator = prev.lastIndexOf('  ·  ');
            const accumulated = lastSeparator >= 0 ? prev.substring(0, lastSeparator + 5) : '';
            return accumulated + `${speakerLabel}: ${transcript.text}`;
          });
        }
      }),
    );

    // AI Suggestions from native audio (legacy)
    cleanups.push(
      window.electronAPI.onSuggestionProcessingStart(() => {
        setIsProcessing(true);
        setIsExpanded(true);
      }),
    );

    cleanups.push(
      window.electronAPI.onSuggestionGenerated((data) => {
        setIsProcessing(false);
        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: data.suggestion,
          },
        ]);
      }),
    );

    cleanups.push(
      window.electronAPI.onSuggestionError((err) => {
        setIsProcessing(false);
        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: `Error: ${err.error}`,
          },
        ]);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceSuggestedAnswerToken((data) => {
        // Coaching now arrives via onIntelligenceNegotiationCoaching only —
        // sentinel detection on this stream has been removed.
        if (data.requestId && activeRealtimeRequestIdRef.current && data.requestId !== activeRealtimeRequestIdRef.current) return;
        if (data.requestId) activeRealtimeRequestIdRef.current = data.requestId;
        queueToken('what_to_answer', data.token);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceSuggestedAnswer((data) => {
        if (data.requestId && activeRealtimeRequestIdRef.current && data.requestId !== activeRealtimeRequestIdRef.current) return;
        if (data.requestId) activeRealtimeRequestIdRef.current = data.requestId;
        // PERF: flush any tokens still pending in the rAF buffer onto the
        // streaming row BEFORE we apply the final-answer setMessages, so no
        // tokens are lost on stream completion.
        flushToken();
        setIsProcessing(false);

        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'what_to_answer') {
            const updated = [...prev];
            updated[prev.length - 1] = {
              ...lastMsg,
              text: data.answer,
              isStreaming: false,
            };
            return updated;
          }
          return [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: data.answer,
              intent: 'what_to_answer',
            },
          ];
        });
        activeRealtimeRequestIdRef.current = null;
      }),
    );

    // Sprint 9: time-batched token channel — single subscription that
    // unrolls a kind-tagged items array onto the existing queueToken path.
    // The 5 per-token channels (intelligence-suggested-answer-token,
    // intelligence-refined-answer-token, etc.) are no longer being sent
    // by main.ts for these streams — their handlers above are now inert
    // safety nets and only fire if some other code path emits them.
    cleanups.push(
      window.electronAPI.onIntelligenceTokenBatch((data) => {
        const { kind, items } = data;
        if (!items || items.length === 0) return;
        if (kind === 'suggested_answer') {
          for (const it of items) {
            if (it.requestId && activeRealtimeRequestIdRef.current && it.requestId !== activeRealtimeRequestIdRef.current) continue;
            if (it.requestId) activeRealtimeRequestIdRef.current = it.requestId;
            queueToken('what_to_answer', (it as any).token);
          }
        } else if (kind === 'refined_answer') {
          for (const it of items) queueToken((it as any).intent, (it as any).token);
        } else if (kind === 'recap') {
          for (const it of items) queueToken('recap', (it as any).token);
        } else if (kind === 'clarify') {
          for (const it of items) queueToken('clarify', (it as any).token);
        }
      }),
    );

    // Sprint 7: dedicated negotiation-coaching channel.
    // The engine now intercepts the coaching sentinel server-side and
    // emits this event INSTEAD of suggested_answer / suggested_answer_token.
    // Renderer no longer needs JSON.parse-per-token detection (the
    // existing prefix-gated detection paths above are kept as defense-
    // in-depth — they are inert because the engine never sends sentinel
    // tokens through suggested_answer anymore).
    cleanups.push(
      window.electronAPI.onIntelligenceNegotiationCoaching((data) => {
        // Flush any pending streamed tokens before swapping the streaming
        // row to a coaching card; otherwise rAF-buffered text would be
        // appended onto the card row's empty text after this setMessages.
        flushToken();
        setIsProcessing(false);
        const coaching = data.payload;
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          // If a what_to_answer streaming row is in flight, replace it
          // with the coaching card so the user doesn't see two bubbles.
          if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'what_to_answer') {
            const updated = [...prev];
            updated[prev.length - 1] = {
              ...lastMsg,
              text: '',
              isStreaming: false,
              isNegotiationCoaching: true,
              negotiationCoachingData: coaching,
            };
            return updated;
          }
          return [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: '',
              intent: 'what_to_answer',
              isNegotiationCoaching: true,
              negotiationCoachingData: coaching,
            },
          ];
        });
      }),
    );

    // STREAMING: Refinement
    cleanups.push(
      window.electronAPI.onIntelligenceRefinedAnswerToken((data) => {
        // PERF: rAF-coalesce per-token state updates.
        queueToken(data.intent, data.token);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceRefinedAnswer((data) => {
        flushToken();
        setIsProcessing(false);
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.isStreaming && lastMsg.intent === data.intent) {
            const updated = [...prev];
            updated[prev.length - 1] = {
              ...lastMsg,
              text: data.answer,
              isStreaming: false,
            };
            return updated;
          }
          return [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: data.answer,
              intent: data.intent,
            },
          ];
        });
      }),
    );

    // STREAMING: Recap
    cleanups.push(
      window.electronAPI.onIntelligenceRecapToken((data) => {
        queueToken('recap', data.token);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceRecap((data) => {
        flushToken();
        setIsProcessing(false);
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'recap') {
            const updated = [...prev];
            updated[prev.length - 1] = {
              ...lastMsg,
              text: data.summary,
              isStreaming: false,
            };
            return updated;
          }
          return [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: data.summary,
              intent: 'recap',
            },
          ];
        });
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceManualResult((data) => {
        setIsProcessing(false);
        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: `🎯 **Answer:**\n\n${data.answer}`,
          },
        ]);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceError((data) => {
        if (data.requestId && activeRealtimeRequestIdRef.current && data.requestId !== activeRealtimeRequestIdRef.current) return;
        setIsProcessing(false);
        flushToken();
        setMessages((prev) => {
          const message = `Error (${data.mode}): ${data.error}`;
          const index = data.requestId
            ? prev.findLastIndex((item) => item.id === data.requestId)
            : -1;
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = { ...updated[index], text: message, isStreaming: false };
            return updated;
          }
          return [...prev, { id: genMessageId(), role: 'system', text: message }];
        });
        if (data.requestId === activeRealtimeRequestIdRef.current) {
          activeRealtimeRequestIdRef.current = null;
        }
      }),
    );
    return () => cleanups.forEach((fn) => fn());
  }, [isExpanded, showSenseVoiceEmotion]);

  useEffect(() => {
    return () => {
      if (emotionClearTimerRef.current !== null) {
        window.clearTimeout(emotionClearTimerRef.current);
      }
    };
  }, []);

  // Stable mount-only effect for screenshot listeners.
  // These MUST NOT be inside the [isExpanded] effect — when a screenshot is
  // taken, `switchToOverlay` fires `ensure-expanded` which can flip isExpanded
  // from false→true, triggering the [isExpanded] effect cleanup. If `screenshot-taken`
  // arrives during that teardown gap the event is silently dropped (same issue
  // as clarify streaming listeners below). handleScreenshotAttach only uses stable
  // useState setters so a mount-only closure is safe here.
  useEffect(() => {
    const cleanupTaken = window.electronAPI.onScreenshotTaken(handleScreenshotAttach);
    const cleanupAttached = window.electronAPI.onScreenshotAttached?.(handleScreenshotAttach);
    return () => {
      cleanupTaken?.();
      cleanupAttached?.();
    };
  }, []);

  // Stable mount-only effect for clarify streaming listeners.
  // These MUST NOT be inside the [isExpanded] effect — if the user
  // expands/collapses the panel while a clarify stream is in-flight,
  // the [isExpanded] effect would tear down and re-register listeners,
  // orphaning the final 'clarify' event and leaving isProcessing=true forever.
  useEffect(() => {
    const cleanupToken = window.electronAPI.onIntelligenceClarifyToken((data) => {
      queueToken('clarify', data.token);
    });

    const cleanupFinal = window.electronAPI.onIntelligenceClarify((data) => {
      flushToken();
      setIsProcessing(false);
      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'clarify') {
          const updated = [...prev];
          updated[prev.length - 1] = { ...lastMsg, text: data.clarification, isStreaming: false };
          return updated;
        }
        return [
          ...prev,
          {
            id: genMessageId(),
            role: 'system' as const,
            text: data.clarification,
            intent: 'clarify',
          },
        ];
      });
    });

    return () => {
      cleanupToken();
      cleanupFinal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — these listeners must survive isExpanded changes

  // Quick Actions - Updated to use new Intelligence APIs

  // PERF: useCallback so the reference is stable between renders. MessageRow
  // (memoized below) receives this as a prop; without a stable identity its
  // memo comparator would never match and the bailout would not fire.
  const emitAnswerQualityEvent = useCallback((
    answerId: string,
    eventType: AnswerQualityEventType,
    metadata?: Record<string, unknown>,
    surface = 'overlay',
  ) => {
    return window.electronAPI
      ?.trackAnswerQualityEvent?.({
        answerId,
        eventType,
        surface,
        metadata,
      })
      .catch(() => {});
  }, []);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    analytics.trackCopyAnswer();
    if (latestAnswerId) {
      const lifecycle = latestAnswerLifecycleRef.current;
      if (lifecycle?.answerId === latestAnswerId) {
        lifecycle.copied = true;
      }
      void emitAnswerQualityEvent(latestAnswerId, 'copied', {
        answerAgeMs: lifecycle?.answerId === latestAnswerId
          ? Date.now() - lifecycle.shownAt
          : undefined,
        hadCitations: latestAnswerCitations.length > 0,
      });
    }
    // Optional: Trigger a small toast or state change for visual feedback
  }, [emitAnswerQualityEvent, latestAnswerCitations.length, latestAnswerId]);

  const handleAcceptLatestAnswer = useCallback(() => {
    const lifecycle = latestAnswerLifecycleRef.current;
    if (!lifecycle || lifecycle.accepted) return;
    lifecycle.accepted = true;
    void emitAnswerQualityEvent(lifecycle.answerId, 'accepted', {
      answerAgeMs: Date.now() - lifecycle.shownAt,
      hadCitations: latestAnswerCitations.length > 0,
      triggerSource: 'accept_button',
    }, lifecycle.surface);
  }, [emitAnswerQualityEvent, latestAnswerCitations.length]);

  const handleOpenLatestCitation = useCallback(async () => {
    const answerId = latestAnswerId;
    const citation = latestAnswerCitations.find((item) => item.sourceType === 'uploaded_material' && item.citationId);
    if (!answerId || !citation?.citationId) return;
    const result = await window.electronAPI?.openAnswerCitation?.({
      answerId,
      citationId: citation.citationId,
    });
    setLatestCitationStatus((result?.status as CitationStatus | undefined) ?? 'missing-citation');
    if (!result?.success) {
      setCitationPreviewMessage(
        result?.status === 'stale-citation'
          ? '引用来源已变更，无法预览原片段'
          : '引用来源不可用',
      );
      return;
    }
    setLatestCitationStatus('ok');
    setCitationPreviewMessage(result.previewText || '已找到引用来源');
  }, [latestAnswerCitations, latestAnswerId]);

  const handleWhatToSay = async (
    promptInstruction?: string | React.MouseEvent,
    generationOptions?: { source?: 'overlay' | 'launcher' | 'dynamic_action'; persist?: boolean; modeEvent?: DynamicActionModeEvent; throwOnError?: boolean },
  ) => {
    const dynamicPromptInstruction =
      typeof promptInstruction === 'string' ? promptInstruction : undefined;
    const previousLifecycle = latestAnswerLifecycleRef.current;
    if (
      previousLifecycle &&
      !previousLifecycle.copied &&
      !previousLifecycle.accepted &&
      !previousLifecycle.regenerated
    ) {
      const terminalEvent: AnswerQualityEventType =
        generationOptions?.source === 'dynamic_action' ? 'ignored' : 'regenerated';
      previousLifecycle.regenerated = terminalEvent === 'regenerated';
      void emitAnswerQualityEvent(previousLifecycle.answerId, terminalEvent, {
        answerAgeMs: Date.now() - previousLifecycle.shownAt,
        triggerSource: generationOptions?.source ?? 'overlay',
        hadCitations: latestAnswerCitations.length > 0,
      }, previousLifecycle.surface);
    }
    setIsExpanded(true);
    setIsProcessing(true);
    const requestId = latestAnswerRequestIdRef.current + 1;
    latestAnswerRequestIdRef.current = requestId;
    const realtimeRequestId = `what_${Date.now()}_${requestId}`;
    activeRealtimeRequestIdRef.current = realtimeRequestId;
    setCitationPreviewMessage(null);
    analytics.trackCommandExecuted('what_to_say');

    // Capture and clear attached image context.
    // Also merge in any screenshot from the capture-and-process shortcut that
    // arrived via pendingCaptureRef before the React state flush (React 18 fix).
    const pending = pendingCaptureRef.current;
    let currentAttachments = attachedContext;
    if (pending && !currentAttachments.some((s) => s.path === pending.path)) {
      currentAttachments = [...currentAttachments, pending].slice(-5);
    }

    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      // Show the attached image in chat
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'user',
          text: 'What should I say about this?',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
      // Scroll to bottom when user sends message
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }

    flushToken();
    streamingMsgIdRef.current = realtimeRequestId;
    streamingIntentRef.current = 'what_to_answer';
    streamingTextRef.current = '';
    setMessages((prev) => [
      ...prev,
      {
        id: realtimeRequestId,
        role: 'system',
        text: '',
        intent: 'what_to_answer',
        isStreaming: true,
      },
    ]);

    try {
      // Pass imagePath if attached
      const result = await window.electronAPI.generateWhatToSay(
        undefined,
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
        {
          requestId: realtimeRequestId,
          promptInstruction: dynamicPromptInstruction,
          ...generationOptions,
        },
      );
      if (requestId !== latestAnswerRequestIdRef.current) {
        return;
      }
      setScreenContextStatus(result.screenContextStatus || 'not_available');
      setLatestUsedImageInput(Boolean(result.usedImageInput));
      setLatestVisionProviderUsed(result.visionProviderUsed);
      setLatestVisionModelUsed(result.visionModelUsed);
      setLatestVisionFailureReason(result.visionFailureReason);
      setLatestAnswerId(result.answerId);
      setLatestAnswerTrace(result.contextTrace ?? null);
      const nextCitations = result.citations ?? [];
      setLatestAnswerCitations(nextCitations);
      setLatestCitationStatus(nextCitations.some((citation: AnswerCitation) => citation.sourceType === 'uploaded_material' && citation.citationId) ? 'candidate' : 'none');
      setCitationPreviewMessage(null);
      setLatestDegradedReason(result.degradedReason);
      refreshContextHealth().catch(() => {});
      const statusMessage = formatRealtimeAnswerStatusForDisplay(result.statusCode, result.error);
      if (result.statusCode !== 'ok' && statusMessage && !result.answer) {
        setMessages((prev) => {
          const index = prev.findLastIndex((item) => item.id === realtimeRequestId);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = { ...updated[index], text: statusMessage, isStreaming: false };
            return updated;
          }
          return [...prev, { id: realtimeRequestId, role: 'system', text: statusMessage }];
        });
        if (generationOptions?.throwOnError) {
          throw new Error(statusMessage);
        }
      }
      if (result.answerId) {
        const surface = generationOptions?.source ?? 'overlay';
        latestAnswerLifecycleRef.current = {
          answerId: result.answerId,
          shownAt: Date.now(),
          surface,
          copied: false,
          accepted: false,
          regenerated: false,
        };
        void emitAnswerQualityEvent(result.answerId, 'shown', {
          triggerSource: generationOptions?.source ?? 'overlay',
          hadCitations: (result.citations ?? []).length > 0,
        }, surface);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
      if (generationOptions?.throwOnError) {
        throw err;
      }
    } finally {
      if (requestId === latestAnswerRequestIdRef.current) {
        setIsProcessing(false);
      }
    }
  };

  const handleRecap = async () => {
    setIsExpanded(true);
    setIsProcessing(true);
    analytics.trackCommandExecuted('recap');

    try {
      await window.electronAPI.generateRecap();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClarify = async () => {
    setIsExpanded(true);
    setIsProcessing(true);
    analytics.trackCommandExecuted('clarify');

    try {
      await window.electronAPI.generateClarify();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCodeHint = async () => {
    setIsExpanded(true);
    setIsProcessing(true);
    analytics.trackCommandExecuted('code_hint');

    const currentAttachments = attachedContext;
    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      // Show the attached image in chat
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'user',
          text: 'Give me a code hint for this',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
      // Scroll to bottom when user sends message
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }

    try {
      await window.electronAPI.generateCodeHint(
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
      );
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBrainstorm = async () => {
    setIsExpanded(true);
    setIsProcessing(true);
    analytics.trackCommandExecuted('brainstorm');

    const currentAttachments = attachedContext;
    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      // Show the attached image in chat
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'user',
          text: 'Brainstorm with this context',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
      // Scroll to bottom when user sends message
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }

    try {
      await window.electronAPI.generateBrainstorm(
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
      );
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Setup Streaming Listeners
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    const unsubscribeChatContextStatus = window.electronAPI.onChatContextStatus?.((payload) => {
      setLatestDegradedReason(payload.degradedReason);
      setLatestChatSourceStatus(payload.sourceStatus ?? null);
      if ((payload.uploadedMaterialHitCount ?? 0) > 0) {
        setLatestCitationStatus(payload.citationCount > 0 ? 'candidate' : 'none');
      }
      refreshContextHealth().catch(() => {});
    });
    if (unsubscribeChatContextStatus) cleanups.push(unsubscribeChatContextStatus);

    // Stream Token — rAF-coalesced via queueToken (same path as intelligence streams)
    cleanups.push(
      window.electronAPI.onGeminiStreamToken((token) => {
        queueToken('chat', token);
      }),
    );

    // Stream Done
    cleanups.push(
      window.electronAPI.onGeminiStreamDone(() => {
        flushToken();
        setIsProcessing(false);

        // Calculate latency if we have a start time
        let latency = 0;
        if (requestStartTimeRef.current) {
          latency = Date.now() - requestStartTimeRef.current;
          requestStartTimeRef.current = null;
        }

        // Track Usage
        analytics.trackModelUsed({
          model_name: currentModel,
          provider_type: detectProviderType(currentModel),
          latency_ms: latency,
        });

        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
            const text = lastMsg.text;
            const isCode =
              text.includes('```') || text.includes('def ') || text.includes('function ');
            return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false, isCode }];
          }
          return prev;
        });
      }),
    );

    // Stream Error
    cleanups.push(
      window.electronAPI.onGeminiStreamError((error) => {
        flushToken();
        setIsProcessing(false);
        requestStartTimeRef.current = null; // Clear timer on error
        setMessages((prev) => {
          // Append error to the current message or add new one?
          // Let's add a new error block if the previous one confusing,
          // or just update status.
          // Ideally we want to show the partial response AND the error.
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.isStreaming) {
            const updated = [...prev];
            updated[prev.length - 1] = {
              ...lastMsg,
              isStreaming: false,
              text: lastMsg.text + `\n\n[Error: ${error}]`,
            };
            return updated;
          }
          return [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: `❌ Error: ${error}`,
            },
          ];
        });
      }),
    );

    // JIT RAG Stream listeners (for live meeting RAG responses)
    if (window.electronAPI.onRAGStreamChunk) {
      cleanups.push(
        window.electronAPI.onRAGStreamChunk((data: { chunk: string }) => {
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
              const updated = [...prev];
              updated[prev.length - 1] = {
                ...lastMsg,
                text: lastMsg.text + data.chunk,
                isCode: (lastMsg.text + data.chunk).includes('```'),
              };
              return updated;
            }
            return prev;
          });
        }),
      );
    }

    if (window.electronAPI.onRAGStreamComplete) {
      cleanups.push(
        window.electronAPI.onRAGStreamComplete(() => {
          setIsProcessing(false);
          requestStartTimeRef.current = null;
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
              return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }];
            }
            if (lastMsg && lastMsg.isStreaming) {
              const updated = [...prev];
              updated[prev.length - 1] = { ...lastMsg, isStreaming: false };
              return updated;
            }
            return prev;
          });
        }),
      );
    }

    if (window.electronAPI.onRAGStreamError) {
      cleanups.push(
        window.electronAPI.onRAGStreamError((data) => {
          const error = 'error' in data ? data.error : data.message;
          setIsProcessing(false);
          requestStartTimeRef.current = null;
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.isStreaming) {
              const updated = [...prev];
              updated[prev.length - 1] = {
                ...lastMsg,
                isStreaming: false,
                text: lastMsg.text + `\n\n[RAG Error: ${error}]`,
              };
              return updated;
            }
            return prev;
          });
        }),
      );
    }

    return () => cleanups.forEach((fn) => fn());
  }, [currentModel, queueToken, flushToken, refreshContextHealth]); // Ensure tracking captures correct model

  const handleAnswerNow = async () => {
    if (isManualRecording) {
      // Stop recording - send accumulated voice input to Gemini
      isRecordingRef.current = false; // Update ref immediately
      setIsManualRecording(false);
      setManualTranscript(''); // Clear live preview

      // Send manual finalization signal to STT Providers
      window.electronAPI
        .finalizeMicSTT()
        .catch((err) => console.error('[NativelyInterface] Failed to send finalizeMicSTT:', err));

      const currentAttachments = attachedContext;
      setAttachedContext([]); // Clear context immediately on send

      const question = (
        voiceInputRef.current +
        (manualTranscriptRef.current ? ' ' + manualTranscriptRef.current : '')
      ).trim();
      setVoiceInput('');
      voiceInputRef.current = '';
      setManualTranscript('');
      manualTranscriptRef.current = '';

      if (!question && currentAttachments.length === 0) {
        // No voice input and no image — show real STT error if available
        if (sttUserStatus === 'failed' && sttUserError) {
          setMessages((prev) => [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: `❌ STT Error: ${sttUserError}`,
            },
          ]);
        } else if (sttUserStatus === 'reconnecting') {
          setMessages((prev) => [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: '⏳ STT is reconnecting, try again in a moment.',
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: '⚠️ No speech detected. Try speaking closer to your microphone.',
            },
          ]);
        }
        return;
      }

      // Show user's spoken question
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'user',
          text: question,
          hasScreenshot: currentAttachments.length > 0,
          screenshotPreview: currentAttachments[0]?.preview,
        },
      ]);

      // Scroll to bottom when user sends message
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);

      // Add placeholder for streaming response
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: '',
          intent: 'chat',
          isStreaming: true,
        },
      ]);

      setIsProcessing(true);

      try {
        let prompt = buildManualVoiceQuestionPrompt(
          activeMode?.templateType,
          currentAttachments.length > 0,
        );

        if (currentAttachments.length === 0) {
          // JIT RAG pre-flight: try to use indexed meeting context first
          const ragResult = await window.electronAPI.ragQueryLive?.(question);
          if (ragResult?.success) {
            // JIT RAG handled it — response streamed via rag:stream-chunk events
            return;
          }
        }

        // Call Streaming API: message = question, context = instructions
        setLatestAnswerTrace(null);
        setLatestAnswerCitations([]);
        setLatestCitationStatus('none');
        setCitationPreviewMessage(null);
        setLatestDegradedReason(undefined);
        setLatestChatSourceStatus(null);
        requestStartTimeRef.current = Date.now();
        await window.electronAPI.streamGeminiChat(
          question,
          currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
          prompt,
          { skipSystemPrompt: true },
        );
      } catch (err) {
        // Initial invocation failing (e.g. IPC error before stream starts)
        setIsProcessing(false);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          // If we just added the empty streaming placeholder, remove it or fill it with error
          if (last && last.isStreaming && last.text === '') {
            return prev.slice(0, -1).concat({
              id: genMessageId(),
              role: 'system',
              text: `❌ Error starting stream: ${err}`,
            });
          }
          return [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: `❌ Error: ${err}`,
            },
          ];
        });
      }
    } else {
      // Start recording - reset voice input state
      setVoiceInput('');
      voiceInputRef.current = '';
      setManualTranscript('');
      isRecordingRef.current = true; // Update ref immediately
      setIsManualRecording(true);

      // Ensure native audio is connected
      try {
        // Native audio is now managed by main process
        // await window.electronAPI.invoke('native-audio-connect');
      } catch (err) {
        // Already connected, that's fine
      }
    }
  };

  const handleManualSubmit = async () => {
    if (!inputValue.trim() && attachedContext.length === 0) return;

    const userText = inputValue;
    const currentAttachments = attachedContext;

    // Clear inputs immediately
    setInputValue('');
    setAttachedContext([]);

    // Seal any in-flight streaming rows from a previous turn before we
    // append the new user message + placeholder. Without this, the rAF
    // token coalescer (queueToken) can append tokens of the next stream
    // onto the prior row whenever the streaming intent matches —
    // surfacing as the next answer starting mid-sentence with leftover
    // text from the previous turn. Also flush any tokens still pending
    // in the rAF buffer so they land on the prior row, not the new one.
    flushToken();
    tokenBufRef.current.intent = '';
    tokenBufRef.current.text = '';
    if (tokenBufRef.current.raf !== null) {
      cancelAnimationFrame(tokenBufRef.current.raf);
      tokenBufRef.current.raf = null;
    }
    setMessages((prev) =>
      prev.some((m) => m.isStreaming)
        ? prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
        : prev,
    );

    setMessages((prev) => [
      ...prev,
      {
        id: genMessageId(),
        role: 'user',
        text: userText || (currentAttachments.length > 0 ? 'Analyze this screenshot' : ''),
        hasScreenshot: currentAttachments.length > 0,
        screenshotPreview: currentAttachments[0]?.preview,
      },
    ]);

    // Scroll to bottom when user sends message
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);

    // Add placeholder for streaming response
    setMessages((prev) => [
      ...prev,
      {
        id: genMessageId(),
        role: 'system',
        text: '',
        intent: 'chat',
        isStreaming: true,
      },
    ]);

    setIsExpanded(true);
    setIsProcessing(true);

    try {
      // JIT RAG pre-flight: try to use indexed meeting context first
      if (currentAttachments.length === 0) {
        const ragResult = await window.electronAPI.ragQueryLive?.(userText || '');
        if (ragResult?.success) {
          // JIT RAG handled it — response streamed via rag:stream-chunk events
          return;
        }
      }

      // Pass imagePath if attached, AND conversation context
      setLatestAnswerTrace(null);
      setLatestAnswerCitations([]);
      setLatestCitationStatus('none');
      setCitationPreviewMessage(null);
      setLatestDegradedReason(undefined);
      setLatestChatSourceStatus(null);
      requestStartTimeRef.current = Date.now();
      await window.electronAPI.streamGeminiChat(
        userText || 'Analyze this screenshot',
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
        conversationContext, // Pass context so "answer this" works
      );
    } catch (err) {
      setIsProcessing(false);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.isStreaming && last.text === '') {
          // remove the empty placeholder
          return prev.slice(0, -1).concat({
            id: genMessageId(),
            role: 'system',
            text: `❌ Error starting stream: ${err}`,
          });
        }
        return [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: `❌ Error: ${err}`,
          },
        ];
      });
    }
  };

  // Refresh the latest-handler ref on every render so the captured-key
  // listener (mounted with [] deps) calls the CURRENT closure, not a
  // stale snapshot from first render.
  handleManualSubmitRef.current = handleManualSubmit;

  const clearChat = () => {
    setMessages([]);
  };

  // PERF: useCallback so MessageRow's memo comparator can rely on a stable
  // function identity. Deps are the things the closure actually reads that
  // can change: theme + memoized markdown components + memoized appearance.
  // setMessages is a stable React setter and isLightTheme drives both the
  // other deps so its inclusion is mostly defensive.
  const renderMessageText = useCallback(
    (msg: Message) => {
      // ── Imperative streaming short-circuit ──────────────────────────────
      // While the message is mid-stream, render a plain div with a ref so
      // queueToken can write rendered markdown HTML directly to the DOM node
      // without going through React reconciliation.
      // On stream completion, flushToken() resets streamingMsgIdRef and the
      // next render falls through to the normal intent-specific path below.
      if (msg.isStreaming && msg.role === 'system' && !msg.isNegotiationCoaching
          && msg.id === streamingMsgIdRef.current) {
        return (
          <div
            ref={(el) => registerStreamingNode(msg.id, el)}
            className="markdown-content whitespace-pre-wrap"
          >
            {/* Initial text shown before the RAF fires for the first time */}
            {msg.text}
          </div>
        );
      }
      // ────────────────────────────────────────────────────────────────────

      // Negotiation coaching card takes priority
      if (msg.isNegotiationCoaching && msg.negotiationCoachingData) {
        return (
          <NegotiationCoachingCard
            {...msg.negotiationCoachingData}
            phase={msg.negotiationCoachingData.phase as any}
            onSilenceTimerEnd={() => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === msg.id
                    ? {
                        ...m,
                        negotiationCoachingData: m.negotiationCoachingData
                          ? { ...m.negotiationCoachingData, showSilenceTimer: false }
                          : undefined,
                      }
                    : m,
                ),
              );
            }}
          />
        );
      }

      // Code-containing messages get special styling
      // We split by code blocks to keep the "Code Solution" UI intact for the code parts
      // But use ReactMarkdown for the text parts around it
      if (msg.isCode || (msg.role === 'system' && msg.text.includes('```'))) {
        const parts = msg.text.split(/(```[\s\S]*?```)/g);
        return (
          <div
            className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`}
            style={appearance.subtleStyle}
          >
            <div
              className={`flex items-center gap-2 mb-2 font-semibold text-xs uppercase tracking-wide ${isLightTheme ? 'text-violet-600' : 'text-purple-300'}`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>Code Solution</span>
            </div>
            <div
              className={`space-y-2 text-[13px] leading-relaxed ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}
            >
              {parts.map((part, i) => {
                if (part.startsWith('```')) {
                  const match = part.match(/```(\w+)?\n?([\s\S]*?)```/);
                  if (match) {
                    const lang = match[1] || 'python';
                    const code = match[2].trim();
                    return (
                      <HighlightedCode
                        key={i}
                        code={code}
                        lang={lang}
                        isLightTheme={isLightTheme}
                        codeTheme={codeTheme}
                        codeBlockClass={codeBlockClass}
                        codeHeaderClass={codeHeaderClass}
                        codeHeaderTextClass={codeHeaderTextClass}
                        codeLineNumberColor={codeLineNumberColor}
                        appearance={appearance}
                      />
                    );
                  }
                }
                // Regular text - Render with Markdown
                return (
                  <div key={i} className="markdown-content">
                    <ReactMarkdown
                      remarkPlugins={REMARK_PLUGINS}
                      rehypePlugins={REHYPE_PLUGINS}
                      components={mdComponents.codeText}
                    >
                      {part}
                    </ReactMarkdown>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      // Custom Styled Labels (Shorten, Recap, Follow-up) - also use Markdown for content
      if (msg.intent === 'shorten') {
        return (
          <div
            className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`}
            style={appearance.subtleStyle}
          >
            <div
              className={`flex items-center gap-2 mb-2 font-semibold text-xs uppercase tracking-wide ${isLightTheme ? 'text-cyan-700' : 'text-cyan-300'}`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Shortened</span>
            </div>
            <div
              className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}
            >
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={mdComponents.shortenText}
              >
                {msg.text}
              </ReactMarkdown>
            </div>
          </div>
        );
      }

      if (msg.intent === 'recap') {
        return (
          <div
            className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`}
            style={appearance.subtleStyle}
          >
            <div
              className={`flex items-center gap-2 mb-2 font-semibold text-xs uppercase tracking-wide ${isLightTheme ? 'text-indigo-700' : 'text-indigo-300'}`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Recap</span>
            </div>
            <div
              className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}
            >
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={mdComponents.recapText}
              >
                {msg.text}
              </ReactMarkdown>
            </div>
          </div>
        );
      }

      if (msg.intent === 'what_to_answer') {
        // Split text by code blocks (Handle unclosed blocks at EOF)
        const parts = msg.text.split(/(```[\s\S]*?(?:```|$))/g);

        return (
          <div
            className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`}
            style={appearance.subtleStyle}
          >
            <div className="flex items-center gap-2 mb-2 text-emerald-400 font-semibold text-xs uppercase tracking-wide">
              <span>Say this</span>
            </div>
            <div className="text-[14px] leading-relaxed overlay-text-primary">
              {parts.map((part, i) => {
                if (part.startsWith('```')) {
                  // Robust matching: handles unclosed blocks for streaming (```...$)
                  const match = part.match(/```(\w*)\s+([\s\S]*?)(?:```|$)/);

                  // Fallback logic: if it starts with ticks, treat as code (even if unclosed)
                  if (match || part.startsWith('```')) {
                    const lang = match && match[1] ? match[1] : 'python';
                    let code = '';

                    if (match && match[2]) {
                      code = match[2].trim();
                    } else {
                      // Manual strip if regex failed
                      code = part
                        .replace(/^```\w*\s*/, '')
                        .replace(/```$/, '')
                        .trim();
                    }

                    return (
                      <HighlightedCode
                        key={i}
                        code={code}
                        lang={lang}
                        isLightTheme={isLightTheme}
                        codeTheme={codeTheme}
                        codeBlockClass={codeBlockClass}
                        codeHeaderClass={codeHeaderClass}
                        codeHeaderTextClass={codeHeaderTextClass}
                        codeLineNumberColor={codeLineNumberColor}
                        appearance={appearance}
                      />
                    );
                  }
                }
                // Regular text - Render Markdown
                // PERF: hoisted components map — see mdComponents useMemo
                // at top of component. Inline literal here would create a
                // fresh object on every streaming token, defeating
                // ReactMarkdown's internal render-bailout.
                return (
                  <div key={i} className="markdown-content">
                    <ReactMarkdown
                      remarkPlugins={REMARK_PLUGINS}
                      rehypePlugins={REHYPE_PLUGINS}
                      components={mdComponents.whatToAnswerText}
                    >
                      {part}
                    </ReactMarkdown>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      if (msg.intent === 'clarify') {
        return (
          <div
            className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`}
            style={appearance.subtleStyle}
          >
            <div
              className={`flex items-center gap-2 mb-2 font-semibold text-xs uppercase tracking-wide ${isLightTheme ? 'text-violet-700' : 'text-violet-300'}`}
            >
              <span>Clarify</span>
            </div>
            <div
              className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}
            >
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={mdComponents.standard}
              >
                {msg.text}
              </ReactMarkdown>
            </div>
          </div>
        );
      }

      // Standard Text Messages (e.g. from User or Interviewer)
      // We still want basic markdown support here too
      return (
        <div className="markdown-content">
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            components={mdComponents.standard}
          >
            {msg.text}
          </ReactMarkdown>
        </div>
      );
    },
    [isLightTheme, mdComponents, appearance],
  );

  // We use a ref to hold the latest handlers to avoid re-binding the event listener on every render
  const handlersRef = useRef({
    handleWhatToSay,
    handleRecap,
    handleAnswerNow,
    handleClarify,
    handleCodeHint,
    handleBrainstorm,
  });

  // Update ref on every render so the event listener always access latest state/props
  handlersRef.current = {
    handleWhatToSay,
    handleRecap,
    handleAnswerNow,
    handleClarify,
    handleCodeHint,
    handleBrainstorm,
  };

  useEffect(() => {
    // ── Continuous, frame-rate-independent scroll with momentum ──
    // Velocity is integrated against real elapsed time so 60Hz, 120Hz, and
    // dropped-frame paths all produce the same physical speed. While a key
    // is held we ease velocity up to TERMINAL; on release we decay it
    // exponentially, which is what makes the stop feel weighted instead of
    // snapped. Sub-pixel motion is preserved via a fractional accumulator,
    // and we write `scrollTop` directly to bypass any browser scroll-behavior
    // smoothing that would fight the loop.
    const TERMINAL_VELOCITY = 1400; // px/s at full hold
    const ACCEL_SECONDS = 0.18; // time to reach terminal from rest
    const DECAY_HALF_LIFE = 0.09; // seconds for velocity to halve after release
    const DECAY_K = Math.LN2 / DECAY_HALF_LIFE;
    const MIN_VELOCITY = 6; // px/s — snap to 0 below this
    const MAX_FRAME_DT = 0.05; // clamp to absorb tab-throttle hiccups

    let direction: -1 | 0 | 1 = 0; // -1 up, 0 idle, 1 down (or both up+down → 0)
    let upHeld = false;
    let downHeld = false;
    let velocity = 0; // signed px/s
    let positionFraction = 0; // sub-pixel accumulator
    let lastTs = 0;
    let rafId: number | null = null;

    const recomputeDirection = () => {
      direction = upHeld === downHeld ? 0 : upHeld ? -1 : 1;
    };

    const tick = (ts: number) => {
      const container = scrollContainerRef.current;
      if (!container) {
        rafId = null;
        lastTs = 0;
        return;
      }
      if (lastTs === 0) lastTs = ts;
      const dt = Math.min((ts - lastTs) / 1000, MAX_FRAME_DT);
      lastTs = ts;

      if (direction !== 0) {
        const target = direction * TERMINAL_VELOCITY;
        const step = (TERMINAL_VELOCITY / ACCEL_SECONDS) * dt;
        if (Math.abs(target - velocity) <= step) velocity = target;
        else velocity += Math.sign(target - velocity) * step;
      } else {
        velocity *= Math.exp(-DECAY_K * dt);
        if (Math.abs(velocity) < MIN_VELOCITY) velocity = 0;
      }

      // Cache layout reads once per frame, then a single scrollTop write.
      const maxScroll = container.scrollHeight - container.clientHeight;
      const current = container.scrollTop;
      const move = velocity * dt + positionFraction;
      const intMove = Math.trunc(move);
      positionFraction = move - intMove;

      if (intMove !== 0) {
        let next = current + intMove;
        if (next <= 0) {
          next = 0;
          if (velocity < 0) {
            velocity = 0;
            positionFraction = 0;
          }
        } else if (next >= maxScroll) {
          next = maxScroll;
          if (velocity > 0) {
            velocity = 0;
            positionFraction = 0;
          }
        }
        if (next !== current) container.scrollTop = next;
      }

      if (direction !== 0 || velocity !== 0) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
        lastTs = 0;
        positionFraction = 0;
      }
    };

    const startScrollLoop = () => {
      if (rafId === null) rafId = requestAnimationFrame(tick);
    };
    const releaseScroll = () => {
      upHeld = false;
      downHeld = false;
      recomputeDirection();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const {
        handleWhatToSay,
        handleRecap,
        handleAnswerNow,
        handleClarify,
        handleCodeHint,
        handleBrainstorm,
      } = handlersRef.current;

      // Chat Shortcuts (Scope: Local to Chat/Overlay usually, but we allow them here if focused)
      if (isShortcutPressed(e, 'whatToAnswer')) {
        e.preventDefault();
        handleWhatToSay();
      } else if (isShortcutPressed(e, 'clarify')) {
        e.preventDefault();
        handleClarify();
      } else if (isShortcutPressed(e, 'dynamicAction4')) {
        e.preventDefault();
        if (actionButtonMode === 'brainstorm') {
          handleBrainstorm();
        } else {
          handleRecap();
        }
      } else if (isShortcutPressed(e, 'answer')) {
        e.preventDefault();
        handleAnswerNow();
      } else if (isShortcutPressed(e, 'clarify')) {
        e.preventDefault();
        handleClarify();
      } else if (isShortcutPressed(e, 'codeHint')) {
        e.preventDefault();
        handleCodeHint();
      } else if (isShortcutPressed(e, 'brainstorm')) {
        e.preventDefault();
        handleBrainstorm();
      } else if (isShortcutPressed(e, 'scrollUp')) {
        e.preventDefault();
        upHeld = true;
        recomputeDirection();
        startScrollLoop();
      } else if (isShortcutPressed(e, 'scrollDown')) {
        e.preventDefault();
        downHeld = true;
        recomputeDirection();
        startScrollLoop();
      } else if (isShortcutPressed(e, 'moveWindowUp') || isShortcutPressed(e, 'moveWindowDown')) {
        // Prevent default scrolling when moving window
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Users typically lift the modifier (Cmd/Ctrl) first, so releasing
      // either it or the arrow ends the hold and lets momentum decay.
      if (e.key === 'ArrowUp') {
        upHeld = false;
        recomputeDirection();
      } else if (e.key === 'ArrowDown') {
        downHeld = false;
        recomputeDirection();
      } else if (e.key === 'Meta' || e.key === 'Control') {
        releaseScroll();
      }
    };

    // Window blur swallows keyup; reset to avoid stuck scrolling.
    const handleBlur = () => releaseScroll();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isShortcutPressed]);

  // General Global Shortcuts (Rebindable)
  // We listen here to handle them when the window is focused (renderer side)
  // Global shortcuts (when window blurred) are handled by Main process -> GlobalShortcuts
  // But Main process events might not reach here if we don't listen, or we want unified handling.
  // Actually, KeybindManager registers global shortcuts. If they are registered as global,
  // Electron might consume them before they reach here?
  // 'toggle-app' is Global.
  // 'toggle-visibility' is NOT Global in default config (isGlobal: false), so it depends on focus.
  // So we MUST listen for them here.

  const generalHandlersRef = useRef({
    toggleVisibility: () => window.electronAPI.toggleWindow(),
    processScreenshots: handleWhatToSay,
    resetCancel: async () => {
      if (isProcessing) {
        setIsProcessing(false);
      } else {
        await window.electronAPI.resetIntelligence();
        setMessages([]);
        setAttachedContext([]);
        setInputValue('');
      }
    },
    toggleMousePassthrough: () => {
      const newState = !isMousePassthrough;
      setIsMousePassthrough(newState);
      window.electronAPI?.setOverlayMousePassthrough?.(newState);
    },
    takeScreenshot: async () => {
      try {
        const data = await window.electronAPI.takeScreenshot();
        if (data && data.path) {
          handleScreenshotAttach(data as { path: string; preview: string });
        }
      } catch (err) {
        console.error('Error triggering screenshot:', err);
      }
    },
    selectiveScreenshot: async () => {
      try {
        const data = await window.electronAPI.takeSelectiveScreenshot();
        if (data && !data.cancelled && data.path) {
          handleScreenshotAttach(data as { path: string; preview: string });
        }
      } catch (err) {
        console.error('Error triggering selective screenshot:', err);
      }
    },
  });

  // Update ref
  generalHandlersRef.current = {
    toggleVisibility: () => window.electronAPI.toggleWindow(),
    processScreenshots: handleWhatToSay,
    resetCancel: async () => {
      if (isProcessing) {
        setIsProcessing(false);
      } else {
        await window.electronAPI.resetIntelligence();
        setMessages([]);
        setAttachedContext([]);
        setInputValue('');
      }
    },
    toggleMousePassthrough: () => {
      const newState = !isMousePassthrough;
      setIsMousePassthrough(newState);
      window.electronAPI?.setOverlayMousePassthrough?.(newState);
    },
    takeScreenshot: async () => {
      try {
        const data = await window.electronAPI.takeScreenshot();
        if (data && data.path) {
          handleScreenshotAttach(data as { path: string; preview: string });
        }
      } catch (err) {
        console.error('Error triggering screenshot:', err);
      }
    },
    selectiveScreenshot: async () => {
      try {
        const data = await window.electronAPI.takeSelectiveScreenshot();
        if (data && !data.cancelled && data.path) {
          handleScreenshotAttach(data as { path: string; preview: string });
        }
      } catch (err) {
        console.error('Error triggering selective screenshot:', err);
      }
    },
  };

  useEffect(() => {
    const handleGeneralKeyDown = (e: KeyboardEvent) => {
      const handlers = generalHandlersRef.current;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (isShortcutPressed(e, 'toggleVisibility')) {
        // Always allow toggling visibility
        e.preventDefault();
        handlers.toggleVisibility();
      } else if (isShortcutPressed(e, 'processScreenshots')) {
        if (!isInput) {
          e.preventDefault();
          handlers.processScreenshots();
        }
        // If input focused, let default behavior (Enter) happen or handle it via onKeyDown in Input
      } else if (isShortcutPressed(e, 'resetCancel')) {
        e.preventDefault();
        handlers.resetCancel();
      } else if (isShortcutPressed(e, 'takeScreenshot')) {
        e.preventDefault();
        handlers.takeScreenshot();
      } else if (isShortcutPressed(e, 'selectiveScreenshot')) {
        e.preventDefault();
        handlers.selectiveScreenshot();
      } else if (isShortcutPressed(e, 'toggleMousePassthrough')) {
        e.preventDefault();
        handlers.toggleMousePassthrough();
      }
    };

    window.addEventListener('keydown', handleGeneralKeyDown);
    return () => window.removeEventListener('keydown', handleGeneralKeyDown);
  }, [isShortcutPressed]);

  // Global "Capture & Process" shortcut handler (issue #90)
  // Registered separately so it always has the latest handlersRef via stable ref access.
  // Main process takes the screenshot and sends "capture-and-process" with path+preview;
  // we attach the screenshot to context and immediately trigger AI analysis.
  useEffect(() => {
    if (!window.electronAPI.onCaptureAndProcess) return;
    const unsubscribe = window.electronAPI.onCaptureAndProcess((data) => {
      setIsExpanded(true);

      // Store screenshot in a stable ref BEFORE updating React state.
      // This fixes the React 18 concurrent mode timing race where setTimeout(0)
      // could fire before setAttachedContext had flushed, leaving handleWhatToSay
      // with an empty attachedContext and causing silent failures.
      pendingCaptureRef.current = data;

      setAttachedContext((prev) => {
        if (prev.some((s) => s.path === data.path)) return prev;
        return [...prev, data].slice(-5);
      });

      // Use requestAnimationFrame so we wait for at least one paint cycle —
      // more reliable than setTimeout(0) under React 18 concurrent scheduling.
      // The ref guarantees handleWhatToSay has the screenshot regardless of
      // whether the state update has flushed yet.
      requestAnimationFrame(() => {
        try {
          handlersRef.current.handleWhatToSay();
        } finally {
          pendingCaptureRef.current = null;
        }
      });
    });
    return unsubscribe;
  }, []);

  // Inertial-scroll engine. Each globalShortcut fire kicks velocity on one
  // axis; a single RAF loop integrates position with friction. A lone tap
  // glides ~250ms then decays; rapid taps sustain motion. Needed because
  // Carbon HotKey on macOS does not auto-repeat with Cmd held, so naive
  // per-fire scrollBy(100px) produces stuttery, taps-only motion.
  const inertialScrollRef = useRef<{
    kick: (axis: 'vert' | 'horiz', direction: -1 | 1) => void;
  } | null>(null);

  useEffect(() => {
    const KICK_VELOCITY = 900; // px/s added per press
    const TERMINAL_VELOCITY = 3200; // px/s clamp
    const FRICTION_HALF_LIFE = 0.16; // seconds for velocity to halve
    const MIN_VELOCITY = 8; // px/s — snap to zero below
    const MAX_FRAME_DT = 0.05; // clamp for tab-throttle hiccups

    const state = {
      raf: null as number | null,
      lastTs: 0,
      vert: { vel: 0, target: null as HTMLElement | null, frac: 0 },
      horiz: { vel: 0, target: null as HTMLElement | null, frac: 0 },
    };

    const resolveHorizontalTarget = (container: HTMLElement): HTMLElement | null => {
      const containerRect = container.getBoundingClientRect();
      const containerCenter = (containerRect.top + containerRect.bottom) / 2;

      const preElements = container.querySelectorAll('pre');
      let best: HTMLElement | null = null;
      let bestDistance = Infinity;

      preElements.forEach((pre) => {
        // Walk up from <pre> until we find the actual horizontal scroller.
        // Markdown renderers often wrap <pre> in a div that holds overflow-x.
        let scroller: HTMLElement | null = pre as HTMLElement;
        while (scroller && scroller !== container) {
          if (scroller.scrollWidth > scroller.clientWidth + 1) break;
          scroller = scroller.parentElement;
        }
        if (!scroller || scroller === container) return;
        if (scroller.scrollWidth <= scroller.clientWidth + 1) return;

        const rect = scroller.getBoundingClientRect();
        if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) return;

        const distance = Math.abs((rect.top + rect.bottom) / 2 - containerCenter);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = scroller;
        }
      });

      return best;
    };

    const tick = (ts: number) => {
      if (state.lastTs === 0) state.lastTs = ts;
      const dt = Math.min((ts - state.lastTs) / 1000, MAX_FRAME_DT);
      state.lastTs = ts;
      const decay = Math.pow(0.5, dt / FRICTION_HALF_LIFE);

      const stepAxis = (axis: 'vert' | 'horiz') => {
        const a = state[axis];
        if (Math.abs(a.vel) < MIN_VELOCITY || !a.target) {
          a.vel = 0;
          a.frac = 0;
          a.target = null;
          return false;
        }
        const move = a.vel * dt + a.frac;
        const intMove = Math.trunc(move);
        a.frac = move - intMove;
        if (intMove !== 0) {
          if (axis === 'vert') a.target.scrollTop += intMove;
          else a.target.scrollLeft += intMove;
        }
        a.vel *= decay;
        return true;
      };

      const vertActive = stepAxis('vert');
      const horizActive = stepAxis('horiz');

      if (vertActive || horizActive) {
        state.raf = requestAnimationFrame(tick);
      } else {
        state.raf = null;
        state.lastTs = 0;
      }
    };

    const kick = (axis: 'vert' | 'horiz', direction: -1 | 1) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      let target: HTMLElement | null;
      if (axis === 'vert') {
        target = container;
      } else {
        target = resolveHorizontalTarget(container);
        // No visible scrollable code block → no-op rather than scrolling
        // an off-screen one or shaking the chat container sideways.
        if (!target) return;
      }

      const a = state[axis];
      // Reverse direction: reset rather than fight existing momentum.
      if (a.target !== target || Math.sign(a.vel) === -direction) {
        a.vel = 0;
        a.frac = 0;
      }
      a.target = target;
      const next = a.vel + direction * KICK_VELOCITY;
      a.vel = Math.max(-TERMINAL_VELOCITY, Math.min(TERMINAL_VELOCITY, next));

      if (state.raf === null) state.raf = requestAnimationFrame(tick);
    };

    inertialScrollRef.current = { kick };

    return () => {
      if (state.raf !== null) cancelAnimationFrame(state.raf);
      inertialScrollRef.current = null;
    };
  }, []);

  // Stealth Global Shortcuts Handler
  // Listens for shortcuts triggered when the app is in the background
  useEffect(() => {
    if (!window.electronAPI.onGlobalShortcut) return;
    const unsubscribe = window.electronAPI.onGlobalShortcut(({ action }) => {
      const handlers = handlersRef.current;
      const generalHandlers = generalHandlersRef.current;

      isStealthRef.current = true;

      if (action === 'whatToAnswer') handlers.handleWhatToSay();
      else if (action === 'recap') handlers.handleRecap();
      else if (action === 'dynamicAction4') {
        if (actionButtonMode === 'brainstorm') handlers.handleBrainstorm();
        else handlers.handleRecap();
      } else if (action === 'answer') handlers.handleAnswerNow();
      else if (action === 'clarify') handlers.handleClarify();
      else if (action === 'codeHint') handlers.handleCodeHint();
      else if (action === 'brainstorm') handlers.handleBrainstorm();
      else if (action === 'scrollUp') inertialScrollRef.current?.kick('vert', -1);
      else if (action === 'scrollDown') inertialScrollRef.current?.kick('vert', 1);
      else if (action === 'scrollLeft') inertialScrollRef.current?.kick('horiz', -1);
      else if (action === 'scrollRight') inertialScrollRef.current?.kick('horiz', 1);
      else if (action === 'processScreenshots') generalHandlers.processScreenshots();
      else if (action === 'resetCancel') generalHandlers.resetCancel();
      else if (action === 'takeScreenshot') generalHandlers.takeScreenshot();
      else if (action === 'selectiveScreenshot') generalHandlers.selectiveScreenshot();

      // Safety reset if it didn't trigger an expansion
      setTimeout(() => {
        isStealthRef.current = false;
      }, 500);
    });
    return unsubscribe;
  }, []);

  // ── ModelSelector click-outside close ──
  //
  // ROUND 3 FIX (#4): replaces the dead `on('blur')` handler in the
  // ModelSelectorWindowHelper. With NSPanel-nonactivating the model-
  // selector window may never become key on click, so its blur listener
  // never fires and the dropdown stays open forever. We close it here
  // by firing an IPC on every overlay mousedown EXCEPT clicks on the
  // toggle button itself (which would race with toggleWindow's open/close
  // logic). Main process no-ops the IPC if model selector is already
  // closed.
  useEffect(() => {
    if (!window.electronAPI?.modelSelectorCloseIfOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-model-selector-toggle="true"]')) return;
      window.electronAPI.modelSelectorCloseIfOpen().catch(() => {});
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // ── Derived STT status for the rolling transcript indicator (interviewer channel) ──
  const interviewerSttIndicatorStatus = sttInterviewerStatus;
  // Strip consecutive error count from display — show only in expanded diagnostics
  const interviewerSttIndicatorError = sttInterviewerError?.replace(
    /\s*\(\d+ consecutive errors\):?/gi,
    '',
  );
  const sttSummary = getSttSummary(
    sttUserStatus,
    sttUserProvider,
    sttInterviewerProvider,
    selectedSttProvider,
    sttNotConfigured,
    hasUserTranscript,
    hasInterviewerTranscript,
    systemAudioIssue,
  );
  const statusPillBaseClass = `flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium shadow-sm backdrop-blur-xl ${isLightTheme ? 'bg-white/55 border-black/10' : 'bg-black/20 border-white/10'}`;
  const latestAnswerTrustExplanation = buildLatestAnswerTrustExplanation({
    trace: latestAnswerTrace,
    citations: latestAnswerCitations,
    citationStatus: latestCitationStatus,
    citationPreviewMessage,
    degradedReason: latestDegradedReason,
  });
  const contextLabels = latestAnswerTrustExplanation.sourceLabels;
  const contextStatusText = contextLabels.length > 0
    ? `上下文：${contextLabels.join(' / ')}`
    : '上下文：仅使用当前输入';
  const materialCitationCount = latestAnswerCitations.filter((c) => c.sourceType === 'uploaded_material').length;
  const latestDegradedReasonDisplay = latestAnswerTrustExplanation.degradedMessages.length === 0
    ? formatDegradedReasonForDisplay(latestDegradedReason)
    : null;
  const latestSourceStatus = latestAnswerTrace?.sourceStatus ?? latestChatSourceStatus ?? undefined;
  const ragReady = latestSourceStatus?.ragReady ?? contextHealth?.ragReady;
  const embeddingReady = latestSourceStatus?.embeddingReady ?? contextHealth?.embeddingReady;
  const formatReadyLabel = (ready: boolean | undefined, availableLabel: string, unavailableLabel: string) => {
    if (ready === true) return availableLabel;
    if (ready === false) return unavailableLabel;
    return '状态检查中';
  };
  const baseConfidenceHealthItems = [
    formatReadyLabel(ragReady, 'RAG 可用', 'RAG 不可用'),
    formatReadyLabel(embeddingReady, 'Embedding 可用', 'Embedding 不可用'),
    latestSourceStatus?.screenContextStatus === 'available'
      ? '屏幕上下文可用'
      : latestSourceStatus?.screenContextStatus === 'failed'
        ? '屏幕上下文不可用'
        : '未使用屏幕上下文',
    sttUserStatus === 'connected' ? '你的 STT 正常' : '你的 STT 异常',
    sttInterviewerStatus === 'connected' ? '对方 STT 正常' : '对方 STT 异常',
    latestSourceStatus?.speakerSeparationStatus === 'on'
      ? '说话人分离可用'
      : latestSourceStatus?.speakerSeparationStatus === 'off'
        ? '说话人分离关闭'
        : '说话人分离不可用',
  ];
  const confidenceHealthItems = Array.from(new Set([
    ...latestAnswerTrustExplanation.primaryMessages,
    ...baseConfidenceHealthItems,
    ...latestAnswerTrustExplanation.degradedMessages,
  ].filter(Boolean)));

  const copyDiagnostics = async () => {
    const version = import.meta.env.VITE_APP_VERSION || 'unknown';
    const [arch, osVersion] = await Promise.all([
      window.electronAPI?.getArch?.().catch(() => 'unknown'),
      window.electronAPI?.getOsVersion?.().catch(() => 'unknown'),
    ]);
    const userCat = sttUserError ? categorizeSttError(sttUserError) : null;
    const interviewerCat = sttInterviewerError ? categorizeSttError(sttInterviewerError) : null;
    const report = [
      '## STT Diagnostic Report',
      `App Version: ${version}`,
      `Platform: ${osVersion} (${arch})`,
      `---`,
      `Microphone Provider: ${sttUserProvider}`,
      `Microphone Status: ${sttUserStatus}`,
      userCat ? `Microphone Category: ${userCat.title} [${userCat.category}]` : '',
      `Microphone Error: ${sttUserError || 'N/A'}`,
      `---`,
      `System Audio Provider: ${sttInterviewerProvider}`,
      `System Audio Status: ${sttInterviewerStatus}`,
      interviewerCat
        ? `System Audio Category: ${interviewerCat.title} [${interviewerCat.category}]`
        : '',
      `System Audio Error: ${sttInterviewerError || 'N/A'}`,
      `Timestamp: ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = report;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  };

  return (
    <div
      ref={contentRef}
      data-interface-theme={isGlassTheme ? 'liquid-glass' : undefined}
      className="flex flex-col items-center w-fit mx-auto h-fit min-h-0 bg-transparent p-0 rounded-[24px] font-sans gap-2 overlay-text-primary"
    >
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="flex flex-col items-center gap-2 w-full"
          >
            <TopPill
              expanded={isExpanded}
              onToggle={() => setIsExpanded(!isExpanded)}
              onQuit={() => (onEndMeeting ? onEndMeeting() : window.electronAPI.quitApp())}
              appearance={appearance}
              onLogoClick={() => window.electronAPI?.setWindowMode?.('launcher')}
            />
            <motion.div
              ref={shellRef}
              className={`relative max-w-full backdrop-blur-2xl border rounded-[24px] ${isModeDropdownOpen ? 'overflow-visible' : 'overflow-hidden'} flex flex-col draggable-area overlay-shell-surface ${overlayPanelClass}`}
              style={{
                ...appearance.shellStyle,
                width: shellWidth,
                // Removed will-change: 'width' — Framer Motion animates shellWidth
                // using transform (translateX), not CSS width, so this hint created
                // a ghost compositor layer with stale dimensions from the first
                // meeting's layout, blocking correct compositing on remount.
              }}
            >
              {isGlassTheme && <GlassEffectLayer parentRef={shellRef} cornerRadius={24} />}

              <div className="relative no-drag flex flex-wrap items-center justify-center gap-1.5 px-4 pt-3 pb-1">
                <div ref={modeDropdownRef} className="relative">
                  <div
                    className={`${statusPillBaseClass} overlay-text-primary cursor-pointer hover:opacity-80 transition-opacity`}
                    title={
                      activeModeDisplayLabel ? `当前模式：${activeModeDisplayLabel}` : '尚未选择模式'
                    }
                    onClick={() => setIsModeDropdownOpen((prev) => !prev)}
                  >
                    <LayoutGrid className="h-3 w-3 opacity-70" />
                    <span>{activeModeDisplayLabel ? `模式：${activeModeDisplayLabel}` : '模式：通用'}</span>
                    <ChevronDown
                      size={12}
                      className={`opacity-60 transition-transform duration-200 ${isModeDropdownOpen ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <AnimatePresence>
                    {isModeDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        className={`absolute top-full left-0 mt-1.5 w-60 z-50 rounded-xl border shadow-xl backdrop-blur-xl overflow-hidden ${
                          isLightTheme
                            ? 'border-black/10 bg-bg-elevated'
                            : 'border-white/10 bg-bg-elevated'
                        }`}
                      >
                        <div className="max-h-[min(22rem,calc(100vh-7rem))] overflow-y-auto p-1 space-y-0.5">
                          {modes.length === 0 && (
                            <div className="px-3 py-2 text-[11px] text-text-tertiary italic text-center">
                              暂无模式
                            </div>
                          )}
                          {modes.map((mode) => {
                            const isSelected = mode.isActive;
                            const isGeneral = mode.templateType === 'general';
                            return (
                              <button
                                key={mode.id}
                                onClick={async () => {
                                  if (isSelected) {
                                    setIsModeDropdownOpen(false);
                                    setModeDropdownError(null);
                                    return;
                                  }
                                  if (!isGeneral) {
                                    // Pro check — attempt set-active and let backend gate it
                                    const result = await window.electronAPI?.modesSetActive?.(mode.id);
                                    if (result?.error === 'pro_required') {
                                      setModeDropdownError('Pro 功能：切换到高级模式需要订阅');
                                      return;
                                    }
                                  } else {
                                    await window.electronAPI?.modesSetActive?.(mode.id);
                                  }
                                  setModeDropdownError(null);
                                  setIsModeDropdownOpen(false);
                                }}
                                className={`w-full rounded-[10px] px-3 py-1.5 min-h-7 flex items-center justify-between transition-all duration-200 ${isSelected ? 'bg-bg-item-active text-text-primary' : 'hover:bg-bg-item-surface text-text-secondary hover:text-text-primary'}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-xs font-medium truncate">{getModeDisplayName(mode)}</span>
                                  {!isGeneral && (
                                    <Lock size={10} className="opacity-50 shrink-0" />
                                  )}
                                </div>
                                {isSelected && (
                                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                                    <Check size={14} className="text-accent-primary shrink-0" strokeWidth={3} />
                                  </motion.div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        <AnimatePresence>
                          {modeDropdownError && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="px-3 py-2 text-[11px] text-amber-400 bg-amber-400/10 border-t border-amber-400/10"
                            >
                              {modeDropdownError}
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <div className="border-t border-white/5 p-1.5">
                          <button
                            onClick={() => {
                              setIsModeDropdownOpen(false);
                              onOpenModes?.();
                            }}
                            className="w-full rounded-[10px] px-3 py-2 flex items-center gap-2 text-[11px] text-text-tertiary hover:text-text-primary hover:bg-bg-item-surface transition-all duration-200"
                          >
                            <Settings size={12} />
                            <span>管理模式...</span>
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div
                  className={`${statusPillBaseClass} ${getStatusToneClass(sttSummary.tone)}`}
                  title={sttSummary.detail}
                >
                  <Mic className="h-3 w-3 opacity-70" />
                  <span>{sttSummary.label}</span>
                </div>
                {(() => {
                  // Vision-first status chip. Order of preference for what to show:
                  //   1. attached screenshots queued for this turn
                  //   2. failure from the last vision call (reason-aware)
                  //   3. success from the last vision call (provider/model surfaced)
                  //   4. legacy ocr-available fallback (only fires if a legacy mode is re-enabled)
                  //   5. nothing-yet placeholder
                  const visionFailed =
                    screenContextStatus === 'failed' || !!latestVisionFailureReason;
                  const visionSucceeded =
                    (latestUsedImageInput || screenContextStatus === 'available') && !visionFailed;
                  const failureLabelMap: Record<string, string> = {
                    no_vision_provider: '未配置视觉服务',
                    all_vision_failed: '视觉识别失败',
                    privacy_blocked: '隐私模式阻止视觉',
                    scope_blocked: '截图权限已禁用',
                    provider_timeout: '视觉识别超时',
                  };
                  const failureLabel = latestVisionFailureReason
                    ? failureLabelMap[latestVisionFailureReason] || '视觉识别失败'
                    : '视觉识别失败';
                  const failureTitleMap: Record<string, string> = {
                    no_vision_provider:
                      '当前未配置支持视觉的服务商。请添加 CueUp、OpenAI、Claude、Gemini、Groq 密钥，或配置本地 Ollama 视觉模型。',
                    all_vision_failed:
                      '本轮所有已配置的视觉服务商都失败了，请检查额度后重试。',
                    privacy_blocked:
                      '隐私视觉模式阻止了云端视觉服务商，且当前未配置本地视觉模型。',
                    scope_blocked:
                      '当前服务商未启用截图权限，请在设置中开启截图数据范围。',
                    provider_timeout:
                      '视觉服务商本次调用超时，系统已自动切换到下一个服务商。',
                  };
                  const failureTitle = latestVisionFailureReason
                    ? failureTitleMap[latestVisionFailureReason] ||
                      '本轮视觉识别失败。'
                    : '本轮未获得屏幕视觉识别结果。';
                  const providerLabel = latestVisionProviderUsed
                    ? `视觉：${latestVisionProviderUsed}`
                    : '已使用视觉输入';
                  const providerTitle =
                    latestVisionProviderUsed && latestVisionModelUsed
                      ? `最近一次回答使用了 ${latestVisionProviderUsed}（${latestVisionModelUsed}）处理截图`
                      : latestVisionProviderUsed
                        ? `最近一次回答使用了 ${latestVisionProviderUsed} 处理截图`
                        : '最近一次回答直接使用了附带的屏幕截图';
                  return (
                    <div
                      className={`${statusPillBaseClass} ${visionFailed ? getStatusToneClass('warn') : visionSucceeded ? getStatusToneClass('ok') : 'overlay-text-primary'}`}
                      title={
                        attachedContext.length > 0
                          ? '发送本轮消息时，会一并把附带截图交给视觉服务商处理'
                          : visionFailed
                            ? failureTitle
                            : visionSucceeded
                              ? providerTitle
                              : '状态：当前没有附带截图；点击截图快捷键后，本轮回答才会使用屏幕内容。'
                      }
                    >
                      <Monitor className="h-3 w-3 opacity-70" />
                      <span>
                        {attachedContext.length > 0
                          ? `已附带 ${attachedContext.length} 张截图`
                          : visionFailed
                            ? failureLabel
                            : visionSucceeded
                              ? providerLabel
                              : '无屏幕上下文'}
                      </span>
                    </div>
                  );
                })()}
                <div
                  className={`${statusPillBaseClass} overlay-text-primary`}
                  title={`状态：${llmPrivacyLabel}: ${llmProviderLabel}`}
                >
                  <ShieldCheck className="h-3 w-3 opacity-70" />
                  <span>{llmRouteDisplayLabel}</span>
                </div>
              </div>

              {meetingStartStatus?.phase === 'failed' && (
                <div className="flex items-center justify-between mx-4 mt-3 mb-1 px-3.5 py-2.5 bg-red-500/10 border border-red-500/20 rounded-[12px] shadow-sm relative no-drag">
                  <div className="flex flex-col gap-1 pr-3">
                    <div className="flex items-center gap-2 text-[12.5px] text-red-600 dark:text-red-400/90 font-medium leading-tight">
                      <div className="shrink-0 p-1 bg-red-500/20 rounded-full">
                        <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                      </div>
                      <span>会议启动异常</span>
                    </div>
                    <p className="text-[11px] text-red-600/70 dark:text-red-400/60 leading-snug pl-[26px]">
                      {meetingStartStatus.message || '会议音频启动失败，请检查麦克风权限后重试。'}
                    </p>
                  </div>
                  <button
                    onClick={() => setMeetingStartStatus(null)}
                    className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-red-600/50 hover:text-red-700 dark:text-red-500/50 dark:hover:text-red-400 transition-colors"
                    title="关闭"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* System Audio / Screen Recording Warning Banner */}
              {systemAudioWarning && (
                <div className="flex items-center justify-between mx-4 mt-3 mb-1 px-3.5 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-[12px] shadow-sm relative no-drag group/warning">
                  <div className="flex flex-col gap-1 pr-3">
                    <div className="flex items-center gap-2 text-[12.5px] text-yellow-600 dark:text-yellow-400/90 font-medium leading-tight">
                      <div className="shrink-0 p-1 bg-yellow-500/20 rounded-full">
                        <svg
                          className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                          />
                        </svg>
                      </div>
                      <span>
                        {systemAudioWarning.kind === 'screen-recording-permission'
                          ? '屏幕录制权限被拒绝'
                          : systemAudioWarning.kind === 'microphone-capture-failure'
                            ? '麦克风未录到声音'
                          : systemAudioWarning.code === 'CORE_AUDIO_TCC_RESET_REQUIRED'
                            ? '系统音频录制权限需要修复'
                          : '音频采集异常'}
                      </span>
                    </div>
                    <p className="text-[11px] text-yellow-600/70 dark:text-yellow-400/60 leading-snug pl-[26px]">
                      {systemAudioWarning.message}
                    </p>
                    {systemAudioWarning.kind === 'audio-capture-failure' && systemAudioWarning.backend ? (
                      <p className="text-[10px] uppercase tracking-[0.12em] text-yellow-700/65 dark:text-yellow-400/55 leading-snug pl-[26px]">
                        后端: {systemAudioWarning.backend}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {systemAudioWarning.kind === 'screen-recording-permission' ? (
                      <button
                        // Defense-in-depth: kind === 'screen-recording-permission'
                        // is only ever set from a darwin-gated broadcast site
                        // in main.ts (and the IPC allowlist rejects x-apple
                        // URLs on non-darwin), but we still guard at call time
                        // so a future regression in the broadcast layer can't
                        // produce a no-op or worse on Windows.
                        onClick={() => {
                          if (isMac)
                            window.electronAPI.openExternal(
                              'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
                            );
                        }}
                        className="px-3 py-1.5 rounded-lg bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-700 dark:text-yellow-500 text-[11px] font-semibold transition-all active:scale-95 border border-yellow-500/20 shadow-sm"
                      >
                        打开设置
                      </button>
                    ) : systemAudioWarning.recommendedFix === 'reset-tcc' || systemAudioWarning.staleGrantSuspected ? (
                      <button
                        onClick={handleRepairTccPermission}
                        data-action={systemAudioRepairAction}
                        className="px-3 py-1.5 rounded-lg bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-700 dark:text-yellow-500 text-[11px] font-semibold transition-all active:scale-95 border border-yellow-500/20 shadow-sm"
                      >
                        {isRepairingTcc ? '修复中...' : '修复权限并重启'}
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          window.electronAPI?.toggleSettingsWindow?.();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-700 dark:text-yellow-500 text-[11px] font-semibold transition-all active:scale-95 border border-yellow-500/20 shadow-sm"
                      >
                        打开设置
                      </button>
                    )}
                    <button
                      onClick={() => setSystemAudioWarning(null)}
                      className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-yellow-600/50 hover:text-yellow-700 dark:text-yellow-500/50 dark:hover:text-yellow-400 transition-colors absolute top-1 right-1 opacity-0 group-hover/warning:opacity-100"
                      title="关闭"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}

              {/* PR #173: STT Not Configured Warning Banner */}
              {sttNotConfigured && (
                <div className="flex items-center justify-between mx-4 mt-3 mb-1 px-3.5 py-2.5 bg-orange-500/10 border border-orange-500/20 rounded-[12px] shadow-sm relative no-drag group/stt-warning">
                  <div className="flex flex-col gap-1 pr-3">
                    <div className="flex items-center gap-2 text-[12.5px] text-orange-600 dark:text-orange-400/90 font-medium leading-tight">
                      <div className="shrink-0 p-1 bg-orange-500/20 rounded-full">
                        <svg
                          className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                          />
                        </svg>
                      </div>
                      <span>语音转写未配置</span>
                    </div>
                    <p className="text-[11px] text-orange-600/70 dark:text-orange-400/60 leading-snug pl-[26px]">
                      尚未选择语音转写服务商。请打开“设置 → 音频”进行配置。
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        window.electronAPI?.toggleSettingsWindow?.();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-700 dark:text-orange-500 text-[11px] font-semibold transition-all active:scale-95 border border-orange-500/20 shadow-sm"
                    >
                      打开设置
                    </button>
                    <button
                      onClick={() => setSttNotConfigured(false)}
                      className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-orange-600/50 hover:text-orange-700 dark:text-orange-500/50 dark:hover:text-orange-400 transition-colors absolute top-1 right-1 opacity-0 group-hover/stt-warning:opacity-100"
                      title="关闭"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {detectedEmotion && (
                  <motion.div
                    key={`${detectedEmotion.emotion}-${detectedEmotion.receivedAt}`}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                    className="w-full flex justify-center px-4 pb-1"
                  >
                    <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 shadow-sm dark:text-amber-200">
                      <span className="text-amber-500/80">情绪</span>
                      <span>{detectedEmotion.speaker}</span>
                      <span>{detectedEmotion.label}</span>
                      {detectedEmotion.emotionDegree && <span>{TRANSCRIPT_EMOTION_DEGREE_LABELS[detectedEmotion.emotionDegree]}</span>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Phase 3 — Dynamic action card row (Cluely-style live triggers).
                                Appears between status pills and rolling transcript so users see
                                actionable suggestions in their primary scan path. Bar self-hides
                                when no actions are present. */}
              <DynamicActionBar
                onAcceptAction={(action: DynamicActionPayload, options) => {
                  return handleWhatToSay(action.promptInstruction, {
                    source: 'dynamic_action',
                    persist: true,
                    modeEvent: options.modeEvent,
                    throwOnError: true,
                  });
                }}
              />

              {/* Rolling Transcript Bar — includes STT status indicator inline */}
              {(showTranscript && rollingTranscript) ||
              interviewerSttIndicatorStatus !== 'connected' ||
              sttUserStatus !== 'connected' ? (
                <RollingTranscript
                  text={showTranscript ? rollingTranscript : ''}
                  isActive={isInterviewerSpeaking}
                  surfaceStyle={showTranscript ? appearance.transcriptStyle : undefined}
                  interviewerChannel={{
                    status: interviewerSttIndicatorStatus,
                    error: interviewerSttIndicatorError,
                    provider: sttInterviewerProvider,
                  }}
                  microphoneChannel={{
                    status: sttUserStatus,
                    error: sttUserError,
                    provider: sttUserProvider,
                  }}
                  onCopyDiagnostics={copyDiagnostics}
                />
              ) : null}

              {/* Chat History - Only show if there are messages OR active states */}
              {(messages.length > 0 || isManualRecording || isProcessing) && (
                <motion.div
                  ref={scrollContainerRef}
                  className="flex-1 overflow-y-auto p-4 space-y-3 no-drag"
                  style={{ scrollbarWidth: 'none', maxHeight: scrollMaxH }}
                >
                  {(latestAnswerTrace || latestDegradedReason) && (
                    <div
                      className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[11px] ${isLightTheme ? 'bg-white/60 border-black/10 text-slate-700' : 'bg-black/25 border-white/10 text-slate-200'}`}
                    >
	                      <ShieldCheck className="w-3.5 h-3.5 opacity-70" />
	                      <span>{contextStatusText}</span>
	                      <span className="opacity-75">{confidenceHealthItems.join(' · ')}</span>
	                      {materialCitationCount > 0 && (
	                        <button
	                          type="button"
	                          onClick={handleOpenLatestCitation}
	                          className="opacity-75 underline underline-offset-2 hover:opacity-100"
	                          title="查看引用片段"
	                          aria-label="查看引用片段"
	                        >
	                          查看引用片段 {materialCitationCount}
	                        </button>
	                      )}
	                      {latestDegradedReasonDisplay && (
	                        <span className={isLightTheme ? 'text-amber-700' : 'text-amber-200'}>
	                          {latestDegradedReasonDisplay}
	                        </span>
	                      )}
	                      {citationPreviewMessage && (
	                        <span className={isLightTheme ? 'text-slate-600' : 'text-slate-300'}>
	                          {citationPreviewMessage}
	                        </span>
	                      )}
	                      {latestAnswerId && (
	                        <button
	                          type="button"
	                          onClick={handleAcceptLatestAnswer}
	                          className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${isLightTheme ? 'border-black/10 hover:bg-black/5' : 'border-white/10 hover:bg-white/10'}`}
	                          title="标记这个答案有用"
	                          aria-label="标记这个答案有用"
	                        >
	                          <Check className="h-3 w-3" />
	                        </button>
	                      )}
	                    </div>
                  )}
                  {/* Every row spans the full inner width of the scroll
                                        container, which itself rides the shell's animated
                                        width. Bubble max-widths are percentages so the text
                                        and code grow with the canvas — same as iMessage /
                                        Mail when their windows resize. Reflow during the
                                        700 ms tween is gentle (≈0.3 px / frame width delta)
                                        and reads as the canvas "breathing", not jitter.
                                        The other polish (sticky bottom, stable code line
                                        layout via wrapLongLines:false, stability gate that
                                        suppresses transitions during scroll) keeps the
                                        motion calm.

                                        Each row is rendered through React.memo'd MessageRow
                                        so a setMessages on the streaming row does NOT
                                        re-render every prior message — bailout fires on
                                        identity equality (msg, theme, callbacks). */}
                  {messages.map((msg) => (
                    <MessageRow
                      key={msg.id}
                      msg={msg}
                      isLightTheme={isLightTheme}
                      appearance={appearance}
                      onCopy={handleCopy}
                      renderMessageText={renderMessageText}
                    />
                  ))}

                  {/* Active Recording State with Live Transcription */}
                  {isManualRecording && (
                    <div className="flex flex-col items-end gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      {/* Live transcription preview */}
                      {(manualTranscript || voiceInput) && (
                        <div className="max-w-[85%] px-3.5 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-[18px] rounded-tr-[4px]">
                          <span className="text-[13px] overlay-status-ok-text">
                            {voiceInput}
                            {voiceInput && manualTranscript ? ' ' : ''}
                            {manualTranscript}
                          </span>
                        </div>
                      )}
                      <div className="px-3 py-2 flex gap-1.5 items-center bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                        <div
                          className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"
                          style={{ animationDelay: '0ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"
                          style={{ animationDelay: '150ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"
                          style={{ animationDelay: '300ms' }}
                        />
                        <span className="text-[10px] overlay-status-ok-text opacity-80 ml-1">正在聆听...</span>
                      </div>
                    </div>
                  )}

                  {isProcessing && (
                    <div className="flex justify-start">
                      <div
                        className="px-3 py-2 flex gap-1.5 overlay-subtle-surface rounded-full border"
                        style={appearance.subtleStyle}
                      >
                        <div
                          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                          style={{ animationDelay: '0ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                          style={{ animationDelay: '150ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                          style={{ animationDelay: '300ms' }}
                        />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </motion.div>
              )}

              {/* Quick Actions - Minimal & Clean */}
              <div
                className={`flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 overflow-x-hidden ${rollingTranscript && showTranscript ? 'pt-1' : 'pt-3'}`}
              >
                <button
                  onClick={handleWhatToSay}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`}
                  style={appearance.chipStyle}
                >
                  <Pencil className="w-3 h-3 opacity-70" /> 该说什么？
                </button>
                <button
                  onClick={handleClarify}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`}
                  style={appearance.chipStyle}
                >
                  <MessageSquare className="w-3 h-3 opacity-70" /> 澄清
                </button>
                <button
                  onClick={actionButtonMode === 'brainstorm' ? handleBrainstorm : handleRecap}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`}
                  style={appearance.chipStyle}
                >
                  {actionButtonMode === 'brainstorm' ? (
                    <>
                      <Lightbulb className="w-3 h-3 opacity-70" /> 头脑风暴
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3 h-3 opacity-70" /> 回顾
                    </>
                  )}
                </button>
                <button
                  onClick={handleAnswerNow}
                  className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all active:scale-95 duration-200 interaction-base interaction-press min-w-[74px] whitespace-nowrap shrink-0 ${
                    isManualRecording
                      ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                      : 'overlay-chip-surface overlay-text-interactive'
                  }`}
                  style={isManualRecording ? undefined : appearance.chipStyle}
                >
                  {isManualRecording ? (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                      停止
                    </>
                  ) : (
                    <>
                      <Zap className="w-3 h-3 opacity-70" /> 问 AI
                    </>
                  )}
                </button>
              </div>

              {/* Input Area */}
              <div className="p-3 pt-0">
                {/* Latent Context Preview (Attached Screenshot) */}
                {attachedContext.length > 0 && (
                  <div
                    className={`mb-2 rounded-lg p-2 transition-all duration-200 border ${subtleSurfaceClass}`}
                    style={appearance.subtleStyle}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium overlay-text-primary">
                        已附带 {attachedContext.length} 张截图
                      </span>
                      <button
                        onClick={() => setAttachedContext([])}
                        className="p-1 rounded-full transition-colors overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
                        title="全部移除"
                        style={appearance.iconStyle}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto max-w-full pb-1">
                      {attachedContext.map((ctx, idx) => (
                        <div key={ctx.path} className="relative group/thumb flex-shrink-0">
                          <img
                            src={ctx.preview}
                            alt={`截图 ${idx + 1}`}
                            className={`h-10 w-auto rounded border ${isLightTheme ? 'border-black/15' : 'border-white/20'}`}
                          />
                          <button
                            onClick={() =>
                              setAttachedContext((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="absolute -top-1 -right-1 w-4 h-4 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                            title="移除"
                          >
                            <X className="w-2.5 h-2.5 text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <span className="text-[10px] overlay-text-muted">
                      输入问题或点击回答
                    </span>
                  </div>
                )}

                <div className="relative group">
                  <input
                    ref={textInputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                    className={`w-full border focus:ring-1 rounded-xl pl-3 pr-10 py-2.5 focus:outline-none transition-all duration-200 ease-sculpted text-[13px] leading-relaxed ${inputClass}`}
                    style={appearance.inputStyle}
                  />

                  {/* Custom Rich Placeholder */}
                  {!inputValue && (
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[13px] overlay-text-muted">
                      <span>可询问屏幕或对话内容，或按</span>
                      <div className="flex items-center gap-1 opacity-80">
                        {(
                          shortcuts.selectiveScreenshot || [getModifierSymbol('cmd'), 'Shift', 'H']
                        ).map((key, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <span className="text-[10px]">+</span>}
                            <kbd
                              className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center overlay-control-surface overlay-text-secondary"
                              style={appearance.controlStyle}
                            >
                              {key}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                      <span>进行区域截图</span>
                    </div>
                  )}

                  {!inputValue && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none opacity-20">
                      <span className="text-[10px]">↵</span>
                    </div>
                  )}
                </div>

                {/* Bottom Row */}
                <div className="flex items-center justify-between mt-3 px-0.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      data-model-selector-toggle="true"
                      onClick={(e) => {
                        // Calculate position for detached window
                        if (!contentRef.current) return;
                        const contentRect = contentRef.current.getBoundingClientRect();
                        const buttonRect = e.currentTarget.getBoundingClientRect();
                        const GAP = 8;

                        const x = window.screenX + buttonRect.left;
                        const y = window.screenY + contentRect.bottom + GAP;

                        window.electronAPI.toggleModelSelector({ x, y });
                      }}
                      className={`
                                                flex items-center gap-2 px-3 py-1.5
                                                border rounded-lg transition-colors
                                                text-xs font-medium w-[140px]
                                                interaction-base interaction-press
                                                ${controlSurfaceClass}
                                            `}
                      style={appearance.controlStyle}
                    >
                      <span className="truncate min-w-0 flex-1">
                        {getModelDisplayName(currentModel)}
                      </span>
                      <ChevronDown size={14} className="shrink-0 transition-transform" />
                    </button>

                    <button
                      type="button"
                      onClick={() => generalHandlersRef.current.selectiveScreenshot()}
                      className={`h-7 w-7 flex items-center justify-center rounded-lg border transition-colors interaction-base interaction-press ${controlSurfaceClass}`}
                      style={appearance.controlStyle}
                      title="进行区域截图"
                      aria-label="进行区域截图"
                    >
                      <Image className="w-3.5 h-3.5 opacity-70" />
                    </button>

                    <div className="w-px h-3 mx-1" style={appearance.dividerStyle} />

                    <div className="relative">
                      <button
                        onClick={(e) => {
                          if (isSettingsOpen) {
                            // If open, just close it (toggle will handle logic but we can be explicit or just toggle)
                            // Actually toggle-settings-window handles hiding if visible, so logic is same.
                            window.electronAPI.toggleSettingsWindow();
                            return;
                          }

                          if (!contentRef.current) return;

                          const contentRect = contentRef.current.getBoundingClientRect();
                          const buttonRect = e.currentTarget.getBoundingClientRect();
                          const POPUP_WIDTH = 270; // Matches SettingsWindowHelper actual width
                          const GAP = 8; // Same gap as between TopPill and main body (gap-2 = 8px)

                          // X: Left-aligned relative to the Settings Button
                          const x = window.screenX + buttonRect.left;

                          // Y: Below the main content + gap
                          const y = window.screenY + contentRect.bottom + GAP;

                          window.electronAPI.toggleSettingsWindow({ x, y });
                        }}
                        className={`
                                            w-7 h-7 flex items-center justify-center rounded-lg
                                            interaction-base interaction-press
                                            ${
                                              isSettingsOpen
                                                ? 'overlay-icon-surface overlay-icon-surface-hover overlay-text-primary'
                                                : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'
                                            }
                                        `}
                        style={appearance.iconStyle}
                        title="设置"
                        aria-label="打开设置"
                        data-testid="overlay-settings-button"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Mouse Passthrough Toggle */}
                    <div className="relative">
                      <button
                        onClick={() => {
                          const newState = !isMousePassthrough;
                          setIsMousePassthrough(newState);
                          window.electronAPI?.setOverlayMousePassthrough?.(newState);
                        }}
                        className={`
                                                    w-7 h-7 flex items-center justify-center rounded-lg
                                                    interaction-base interaction-press
                                                    ${
                                                      isMousePassthrough
                                                        ? 'overlay-icon-surface overlay-icon-surface-hover text-sky-400 opacity-100'
                                                        : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'
                                                    }
                                                `}
                        style={appearance.iconStyle}
                      >
                        <PointerOff className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={handleManualSubmit}
                    disabled={!inputValue.trim()}
                    className={`
                                    w-7 h-7 rounded-full flex items-center justify-center
                                    interaction-base interaction-press
                                    ${
                                      inputValue.trim()
                                        ? 'bg-[#007AFF] text-white shadow-lg shadow-blue-500/20 hover:bg-[#0071E3]'
                                        : 'overlay-icon-surface overlay-text-muted cursor-not-allowed'
                                    }
                                `}
                    style={inputValue.trim() ? undefined : appearance.iconStyle}
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NativelyInterface;
