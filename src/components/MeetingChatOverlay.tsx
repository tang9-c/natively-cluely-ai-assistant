import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStreamBuffer } from '../hooks/useStreamBuffer';
import { X, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { genMessageId } from '../utils/messageId';
import nativelyIcon from './icon.png';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { MeetingSearchResult } from '../../shared/meetingSearch';

// ============================================
// Types 
// ============================================

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    isStreaming?: boolean;
}

interface MeetingContext {
    id?: string;  // Required for RAG queries
    title: string;
    summary?: string;
    keyPoints?: string[];
    actionItems?: string[];
    transcript?: Array<{ speaker: string; text: string; timestamp: number }>;
}

interface MeetingChatOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    meetingContext: MeetingContext;
    initialQuery?: string;
    queryNonce?: number;
    onNewQuery: (query: string) => void;
}

type ChatState = 'idle' | 'opening' | 'waiting_for_llm' | 'streaming_response' | 'error' | 'closing';

// ============================================
// Typing Indicator Component
// ============================================

const TypingIndicator: React.FC = () => (
    <div className="flex items-center gap-1 py-4">
        <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    className="w-2 h-2 rounded-full bg-text-tertiary"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{
                        duration: 0.6,
                        repeat: Infinity,
                        delay: i * 0.15,
                        ease: "easeInOut"
                    }}
                />
            ))}
        </div>
    </div>
);

// ============================================
// Message Components
// ============================================

const UserMessage: React.FC<{ content: string }> = ({ content }) => (
    <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="flex justify-end mb-6"
    >
        <div className="bg-accent-primary text-white px-5 py-3 rounded-2xl rounded-tr-md max-w-[70%] text-[15px] leading-relaxed">
            {content}
        </div>
    </motion.div>
);

const AssistantMessage: React.FC<{ content: string; isStreaming?: boolean }> = ({ content, isStreaming }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-start mb-6"
        >
            <div className="text-text-primary text-[15px] leading-relaxed max-w-[85%]">
                <div className="markdown-content">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />,
                            a: ({ node, ...props }: any) => <a className="text-blue-500 hover:underline" {...props} />,
                            pre: ({ children }: any) => <div className="not-prose mb-4">{children}</div>,
                            code: ({ node, inline, className, children, ...props }: any) => {
                                const match = /language-(\w+)/.exec(className || '');
                                const isInline = inline ?? false;
                                const lang = match ? match[1] : '';

                                return !isInline ? (
                                    <div className="my-3 rounded-xl overflow-hidden border border-white/[0.08] shadow-lg bg-zinc-800/60 backdrop-blur-md">
                                        <div className="bg-white/[0.04] px-3 py-1.5 border-b border-white/[0.08]">
                                            <span className="text-[10px] uppercase tracking-widest font-semibold text-white/40 font-mono">
                                                {lang || '代码'}
                                            </span>
                                        </div>
                                        <div className="bg-transparent">
                                            <SyntaxHighlighter
                                                language={lang || 'text'}
                                                style={vscDarkPlus}
                                                customStyle={{
                                                    margin: 0,
                                                    borderRadius: 0,
                                                    fontSize: '13px',
                                                    lineHeight: '1.6',
                                                    background: 'transparent',
                                                    padding: '16px',
                                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                }}
                                                wrapLongLines={true}
                                                showLineNumbers={true}
                                                lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: 'rgba(255,255,255,0.2)', textAlign: 'right', fontSize: '11px' }}
                                                {...props}
                                            >
                                                {String(children).replace(/\n$/, '')}
                                            </SyntaxHighlighter>
                                        </div>
                                    </div>
                                ) : (
                                    <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-[13px] font-mono text-text-primary border border-border-subtle whitespace-pre-wrap" {...props}>
                                        {children}
                                    </code>
                                );
                            },
                        }}
                    >
                        {content}
                    </ReactMarkdown>
                </div>
                {isStreaming && (
                    <motion.span
                        className="inline-block w-0.5 h-4 bg-text-secondary ml-0.5 align-middle"
                        animate={{ opacity: [1, 0] }}
                        transition={{ duration: 0.5, repeat: Infinity }}
                    />
                )}
            </div>
            {!isStreaming && content && (
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-2 mt-3 text-[13px] text-text-tertiary hover:text-text-secondary transition-colors"
                >
                    {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    {copied ? '已复制' : '复制消息'}
                </button>
            )}
        </motion.div>
    );
};

// ============================================
// Main Component
// ============================================

const MeetingChatOverlay: React.FC<MeetingChatOverlayProps> = ({
    isOpen,
    onClose,
    meetingContext,
    initialQuery = '',
    queryNonce = 0,
    // onNewQuery
}) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [chatState, setChatState] = useState<ChatState>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const {
        appendToken,
        getBufferedContent,
        reset: resetStreamBuffer,
    } = useStreamBuffer();
    const activeRequestIdRef = useRef<string | null>(null);
    const activeStreamCleanupRef = useRef<(() => void) | null>(null);

    const cleanupActiveStreamListeners = useCallback(() => {
        activeStreamCleanupRef.current?.();
        activeStreamCleanupRef.current = null;
    }, []);

    const cancelActiveRequest = useCallback(() => {
        const requestId = activeRequestIdRef.current;
        const meetingId = meetingContext.id;
        if (requestId && meetingId) {
            void window.electronAPI?.ragCancelQuery({ meetingId, requestId });
        }
        activeRequestIdRef.current = null;
        cleanupActiveStreamListeners();
        resetStreamBuffer();
    }, [cleanupActiveStreamListeners, meetingContext.id, resetStreamBuffer]);

    // Submit initial query when overlay opens
    useEffect(() => {
        if (isOpen && initialQuery && messages.length === 0) {
            setChatState('opening');
            setTimeout(() => {
                submitQuestion(initialQuery);
            }, 100);
        }
    }, [isOpen, initialQuery, queryNonce]);

    // Listen for new queries from parent
    useEffect(() => {
        if (isOpen && initialQuery && messages.length > 0) {
            // This is a follow-up query
            submitQuestion(initialQuery);
        }
    }, [initialQuery, queryNonce]);

    // Reset state when overlay closes
    useEffect(() => {
        if (!isOpen) {
            cancelActiveRequest();
            setChatState('idle');
            setMessages([]);
            setErrorMessage(null);
        }
    }, [cancelActiveRequest, isOpen]);

    useEffect(() => () => {
        cancelActiveRequest();
    }, [cancelActiveRequest]);

    // ESC key handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    // Click outside handler
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            handleClose();
        }
    }, []);

    const handleClose = useCallback(() => {
        cancelActiveRequest();
        onClose();
    }, [cancelActiveRequest, onClose]);

    // Submit question using RAG streaming
    const submitQuestion = useCallback(async (question: string) => {
        if (!question.trim()) return;

        cancelActiveRequest();

        const userMessage: Message = {
            id: genMessageId(),
            role: 'user',
            content: question
        };
        setMessages(prev => [...prev, userMessage]);
        setChatState('waiting_for_llm');
        setErrorMessage(null);

        // Scroll to bottom when user sends message
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

        const assistantMessageId = genMessageId();
        const requestId = genMessageId();
        const meetingId = meetingContext.id;
        activeRequestIdRef.current = requestId;

        const replaceAssistant = (content: string) => {
            setMessages(prev => prev.map(msg =>
                msg.id === assistantMessageId
                    ? { ...msg, content, isStreaming: false }
                    : msg
            ));
        };

        const isCurrentEvent = (
            data: {
                requestId?: string;
                meetingId?: string;
                global?: boolean;
            }
        ) => {
            if (data.requestId !== activeRequestIdRef.current) return false;
            if (data.meetingId !== meetingId) return false;
            if (data.global === true) return false;
            return true;
        };

        try {
            // Add typing indicator delay (200ms) - makes the AI feel "thoughtful"
            await new Promise(resolve => setTimeout(resolve, 200));
            if (activeRequestIdRef.current !== requestId) return;

            // Create assistant message placeholder
            setMessages(prev => [...prev, {
                id: assistantMessageId,
                role: 'assistant',
                content: '',
                isStreaming: true
            }]);

            // Set up RAG streaming listeners (RAF-batched to avoid per-token re-renders)
            resetStreamBuffer();
            let cleanupListeners = () => {};
            const tokenCleanup = window.electronAPI?.onRAGStreamChunk((data) => {
                if (!isCurrentEvent(data)) return;
                setChatState('streaming_response');
                appendToken(data.chunk, (content) => {
                    setMessages(prev => prev.map(msg =>
                        msg.id === assistantMessageId
                            ? { ...msg, content }
                            : msg
                    ));
                });
            });

            const doneCleanup = window.electronAPI?.onRAGStreamComplete((data) => {
                if (!isCurrentEvent(data)) return;
                // Final commit — flush any remaining buffered content
                const finalContent = getBufferedContent();
                replaceAssistant(finalContent);
                setChatState('idle');
                activeRequestIdRef.current = null;
                resetStreamBuffer();
                cleanupListeners();
            });

            const errorCleanup = window.electronAPI?.onRAGStreamError((data) => {
                if (!isCurrentEvent(data)) return;
                const message = 'message' in data
                    ? data.message
                    : '本次会议搜索暂时不可用，请稍后重试。';
                replaceAssistant(message);
                setErrorMessage(null);
                setChatState('error');
                activeRequestIdRef.current = null;
                resetStreamBuffer();
                cleanupListeners();
            });

            cleanupListeners = () => {
                tokenCleanup?.();
                doneCleanup?.();
                errorCleanup?.();
                if (activeStreamCleanupRef.current === cleanupListeners) {
                    activeStreamCleanupRef.current = null;
                }
            };
            activeStreamCleanupRef.current = cleanupListeners;

            const result: MeetingSearchResult = meetingId
                ? await window.electronAPI.ragQueryMeeting({
                    meetingId,
                    query: question,
                    requestId,
                })
                : { status: 'meeting_not_found', message: '无法找到本次会议。' };

            if (activeRequestIdRef.current !== requestId) return;
            if (result.status === 'success') return;
            if (result.status === 'cancelled') {
                setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
                setChatState('idle');
            } else {
                replaceAssistant(result.message);
                setChatState(result.status === 'no_match' ? 'idle' : 'error');
            }
            activeRequestIdRef.current = null;
            resetStreamBuffer();
            cleanupListeners();

        } catch {
            if (activeRequestIdRef.current !== requestId) return;
            replaceAssistant('本次会议搜索暂时不可用，请稍后重试。');
            setErrorMessage(null);
            setChatState('error');
            activeRequestIdRef.current = null;
            cleanupActiveStreamListeners();
            resetStreamBuffer();
        }
    }, [
        appendToken,
        cancelActiveRequest,
        cleanupActiveStreamListeners,
        getBufferedContent,
        meetingContext.id,
        resetStreamBuffer,
    ]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    className="absolute inset-0 z-40 flex flex-col justify-end"
                    onClick={handleBackdropClick}
                >
                    {/* Backdrop with blur */}
                    <motion.div
                        initial={{ backdropFilter: 'blur(0px)' }}
                        animate={{ backdropFilter: 'blur(8px)' }}
                        exit={{ backdropFilter: 'blur(0px)' }}
                        transition={{ duration: 0.16 }}
                        className="absolute inset-0 bg-black/40"
                    />

                    {/* Chat Window - extends to bottom, leaves room for input */}
                    <motion.div
                        ref={chatWindowRef}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "85vh", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                            height: { type: "spring", stiffness: 300, damping: 30, mass: 0.8 },
                            opacity: { duration: 0.2 }
                        }}
                        className="relative mx-auto w-full max-w-[680px] mb-0 bg-bg-secondary rounded-t-[24px] border-t border-x border-border-subtle shadow-2xl overflow-hidden flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header with close button */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
                            <div className="flex items-center gap-2 text-text-tertiary">
                                <img src={nativelyIcon} className="w-3.5 h-3.5 force-black-icon opacity-50" alt="logo" />
                                <span className="text-[13px] font-medium">搜索本次会议</span>
                            </div>
                            <button
                                onClick={handleClose}
                                className="p-2 transition-colors group"
                            >
                                <X size={16} className="text-text-tertiary group-hover:text-red-500 group-hover:drop-shadow-[0_0_8px_rgba(239,68,68,0.5)] transition-all duration-300" />
                            </button>
                        </div>

                        {/* Messages area - scrollable */}
                        <div className="flex-1 overflow-y-auto px-6 py-4 pb-32 custom-scrollbar">
                            {messages.map((msg) => (
                                msg.role === 'user'
                                    ? <UserMessage key={msg.id} content={msg.content} />
                                    : <AssistantMessage key={msg.id} content={msg.content} isStreaming={msg.isStreaming} />
                            ))}

                            {chatState === 'waiting_for_llm' && <TypingIndicator />}

                            {errorMessage && (
                                <motion.div
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="text-[#FF6B6B] text-[13px] py-2"
                                >
                                    {errorMessage}
                                </motion.div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default MeetingChatOverlay;
