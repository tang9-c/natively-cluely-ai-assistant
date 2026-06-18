import React, { useState, useEffect, useRef } from 'react';
import { SENSEVOICE_EMOTION_LABELS } from '../../shared/senseVoiceEmotion';
import type { TranscriptEmotion } from '../../shared/senseVoiceEmotion';
import type { NativeAudioTranscriptPayload } from '../types/electron';

interface SuggestionOverlayProps {
    className?: string;
}

type Transcript = NativeAudioTranscriptPayload;

interface GeneratedSuggestion {
    question: string;
    suggestion: string;
    confidence: number;
}

/**
 * Natively-style suggestion overlay component
 * Displays real-time transcripts and AI-generated suggestions
 */
export const SuggestionOverlay: React.FC<SuggestionOverlayProps> = ({ className }) => {
    const [isConnected, setIsConnected] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [currentTranscript, setCurrentTranscript] = useState<Transcript | null>(null);
    const [displayedEmotion, setDisplayedEmotion] = useState<TranscriptEmotion | null>(null);
    const [suggestion, setSuggestion] = useState<GeneratedSuggestion | null>(null);
    const [error, setError] = useState<string | null>(null);
    const emotionClearTimerRef = useRef<number | null>(null);

    useEffect(() => {
        // Subscribe to native audio events
        const cleanups: (() => void)[] = [];

        const clearDisplayedEmotion = () => {
            if (emotionClearTimerRef.current !== null) {
                window.clearTimeout(emotionClearTimerRef.current);
                emotionClearTimerRef.current = null;
            }
            setDisplayedEmotion(null);
        };

        const showDisplayedEmotion = (emotion: TranscriptEmotion) => {
            if (emotionClearTimerRef.current !== null) {
                window.clearTimeout(emotionClearTimerRef.current);
            }
            setDisplayedEmotion(emotion);
            emotionClearTimerRef.current = window.setTimeout(() => setDisplayedEmotion(null), 4000);
        };

        // Connection status
        cleanups.push(
            window.electronAPI.onNativeAudioConnected(() => {
                setIsConnected(true);
                console.log('[SuggestionOverlay] Native audio connected');
            })
        );

        cleanups.push(
            window.electronAPI.onNativeAudioDisconnected(() => {
                setIsConnected(false);
                console.log('[SuggestionOverlay] Native audio disconnected');
            })
        );

        // Real-time transcripts
        cleanups.push(
            window.electronAPI.onNativeAudioTranscript((transcript) => {
                setCurrentTranscript(transcript);
                if (transcript.emotion && transcript.emotionSource === 'sensevoice') {
                    showDisplayedEmotion(transcript.emotion);
                } else {
                    clearDisplayedEmotion();
                }
                // Clear after a delay if it's a final transcript
                if (transcript.final) {
                    window.setTimeout(() => setCurrentTranscript(null), 3000);
                }
            })
        );

        // Processing status
        cleanups.push(
            window.electronAPI.onSuggestionProcessingStart(() => {
                setIsProcessing(true);
                setError(null);
            })
        );

        // Generated suggestions
        cleanups.push(
            window.electronAPI.onSuggestionGenerated((data) => {
                setSuggestion(data);
                setIsProcessing(false);
            })
        );

        // Errors
        cleanups.push(
            window.electronAPI.onSuggestionError((err) => {
                setError(err.error);
                setIsProcessing(false);
            })
        );

        return () => {
            if (emotionClearTimerRef.current !== null) {
                window.clearTimeout(emotionClearTimerRef.current);
            }
            cleanups.forEach(cleanup => cleanup());
        };
    }, []);

    // Don't render if not connected
    if (!isConnected && !suggestion && !currentTranscript) {
        return null;
    }

    return (
        <div className={`suggestion-overlay ${className || ''}`}>
            {/* Connection indicator */}
            <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-xs text-gray-400">
                    {isConnected ? '直播中' : '已断开'}
                </span>
            </div>

            {/* Current transcript (interviewer's speech) */}
            {currentTranscript && (
                <div className="transcript-bubble mb-3 p-3 rounded-lg bg-gray-800/80 backdrop-blur-sm border border-gray-700">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-blue-400">
                            {currentTranscript.speaker === 'interviewer' ? '🎤 面试官' : '👤 你'}
                        </span>
                        {displayedEmotion && (
                            <span className="rounded border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                                情绪 {SENSEVOICE_EMOTION_LABELS[displayedEmotion]}
                            </span>
                        )}
                        {!currentTranscript.final && (
 <span className="text-xs text-gray-500 animate-pulse">聆听中...</span>
                        )}
                    </div>
                    <p className="text-sm text-gray-200">{currentTranscript.text}</p>
                </div>
            )}

            {/* Processing indicator */}
            {isProcessing && (
                <div className="processing-indicator flex items-center gap-2 p-3 rounded-lg bg-purple-900/30 border border-purple-700">
                    <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-purple-300">正在生成建议...</span>
                </div>
            )}

            {/* AI Suggestion */}
            {suggestion && !isProcessing && (
                <div className="suggestion-card p-4 rounded-lg bg-gradient-to-br from-indigo-900/80 to-purple-900/80 backdrop-blur-sm border border-indigo-500/50 shadow-lg shadow-indigo-500/20">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-indigo-300">💡 建议回复</span>
                        <span className="text-xs text-gray-400">
                            {Math.round(suggestion.confidence * 100)}% 置信度
                        </span>
                    </div>
                    <p className="text-sm text-gray-100 leading-relaxed">{suggestion.suggestion}</p>
                    <div className="mt-2 pt-2 border-t border-indigo-700/50">
                        <p className="text-xs text-gray-400 italic">
                            Re: "{suggestion.question.substring(0, 50)}..."
                        </p>
                    </div>
                </div>
            )}

            {/* Error state */}
            {error && (
                <div className="error-card p-3 rounded-lg bg-red-900/30 border border-red-700">
                    <span className="text-sm text-red-300">⚠️ {error}</span>
                </div>
            )}

            {/* Instructions */}
            <div className="mt-3 text-xs text-gray-500 text-center">
                <p>说"换个说法"或"简短一点"进行跟进</p>
            </div>
        </div>
    );
};

export default SuggestionOverlay;
