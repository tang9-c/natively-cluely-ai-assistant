import React, { useEffect, useState } from 'react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { ArrowLeft, Search, Mail, Link, ChevronDown, Play, ArrowUp, Copy, Check, MoreHorizontal, Settings, ArrowRight, Sparkles, FolderOpen, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MeetingChatOverlay from './MeetingChatOverlay';
import EditableTextBlock from './EditableTextBlock';
import NativelyLogo from './icon.png';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { SkillSummary } from '../types/electron';
import { resolveEffectiveSpeaker, type SpeakerIdentityCorrection } from '../../shared/speakerIdentity';

const formatTime = (ms: number) => {
    const date = new Date(ms);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
};

const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
};

const cleanMarkdown = (content: string) => {
    if (!content) return '';
    // Ensure code blocks are on new lines to fix rendering issues
    return content.replace(/([^\n])```/g, '$1\n\n```');
};

const formatTranscriptForSkill = (transcript?: Meeting['transcript']) => {
    return (transcript || [])
        .filter(entry => !['system', 'ai', 'assistant', 'model'].includes(entry.speaker?.toLowerCase()))
        .map(t => {
            const speaker = resolveEffectiveSpeaker(t);
            return `[${formatTime(t.timestamp)}] ${speaker === 'user' ? '我' : '对方'}: ${t.text}`;
        })
        .join('\n');
};

const parentPathOf = (filePath: string) => {
    const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return index > 0 ? filePath.slice(0, index) : filePath;
};

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    detailedSummary?: {
        overview?: string;
        actionItems: string[];
        keyPoints: string[];
        generationStatus?: 'success' | 'failed';
        decisions?: string[];
        openQuestions?: string[];
        actionItemsTitle?: string;
        keyPointsTitle?: string;
        sections?: Array<{ title: string; bullets: string[] }>;
        // Phase 7 — PostCallWorkflow enhancements (schema v2). Backend writes
        // these via buildPostCallEnhancements(); UI renders them when present.
        schemaVersion?: 2;
        actionItemsStructured?: Array<{
            id: string;
            text: string;
            owner?: string;
            deadline?: string;
            sourceTimestamp?: number;
        }>;
        followUpDraft?: string;
        coachingInsights?: Array<{
            id: string;
            type: string;
            title: string;
            detail: string;
            severity: 'info' | 'opportunity' | 'warning';
            evidence?: string;
        }>;
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
        speakerIdentityCorrection?: SpeakerIdentityCorrection;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
}

interface MeetingDetailsProps {
    meeting: Meeting;
    onBack: () => void;
    onOpenSettings: () => void;
}

const LEGACY_ENGLISH_FOLLOW_UP_PATTERN = /\b(?:Hi,|Hi team,|Thanks for the conversation today\.|Next steps:|Decisions:|Blockers:|Best,|I will follow up if anything else is needed\.)\b/i;
const LEGACY_ENGLISH_COACHING_PATTERN = /\b(?:Objection may need|conversation included|Next step was not explicit|Consider ending|captured|follow-up|needs follow-up|Confirm|Review these moments)\b/i;

const getVisibleCoachingInsights = (summary?: Meeting['detailedSummary']) => {
    return (summary?.coachingInsights || []).filter(insight => {
        const text = `${insight.title || ''}\n${insight.detail || ''}`.trim();
        if (!text) return false;
        return !LEGACY_ENGLISH_COACHING_PATTERN.test(text);
    });
};

const getVisibleFollowUpDraft = (summary?: Meeting['detailedSummary']) => {
    const draft = summary?.followUpDraft?.trim() || '';
    if (!draft) return '';
    return LEGACY_ENGLISH_FOLLOW_UP_PATTERN.test(draft) ? '' : draft;
};

const MeetingDetails: React.FC<MeetingDetailsProps> = ({ meeting: initialMeeting }) => {
    const isLight = useResolvedTheme() === 'light';
    // We need local state for the meeting object to reflect optimistic updates
    const [meeting, setMeeting] = useState<Meeting>(initialMeeting);
    const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'usage'>('summary');
    const [query, setQuery] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [submittedQuery, setSubmittedQuery] = useState('');
    const [submittedQueryNonce, setSubmittedQueryNonce] = useState(0);
    const [skills, setSkills] = useState<SkillSummary[]>([]);
    const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
    const [skillsLoading, setSkillsLoading] = useState(false);
    const [runningSkillId, setRunningSkillId] = useState<string | null>(null);
    const [skillExportStatus, setSkillExportStatus] = useState<{ message: string; filePath?: string; error?: boolean } | null>(null);
    const transcriptMarkdown = formatTranscriptForSkill(meeting.transcript);
    const canRunTranscriptSkill = activeTab === 'transcript' && transcriptMarkdown.trim().length > 0;
    const visibleCoachingInsights = getVisibleCoachingInsights(meeting.detailedSummary);
    const visibleFollowUpDraft = getVisibleFollowUpDraft(meeting.detailedSummary);

    const loadTranscriptSkills = async () => {
        if (typeof window.electronAPI?.skillsRefresh !== 'function') {
            setSkillExportStatus({ message: '技能桥接不可用，请重启应用后重试。', error: true });
            return;
        }

        setSkillsLoading(true);
        try {
            const list = await window.electronAPI.skillsRefresh();
            setSkills(Array.isArray(list) ? list : []);
        } catch (error: any) {
            setSkillExportStatus({ message: error?.message || '无法刷新技能。', error: true });
        } finally {
            setSkillsLoading(false);
        }
    };

    useEffect(() => {
        if (skillsMenuOpen && skills.length === 0) {
            void loadTranscriptSkills();
        }
    }, [skillsMenuOpen]);

    const handleSubmitQuestion = () => {
        if (query.trim()) {
            setSubmittedQuery(query);
            setSubmittedQueryNonce((prev) => prev + 1);
            if (!isChatOpen) {
                setIsChatOpen(true);
            }
            setQuery('');
        }
    };

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && query.trim()) {
            e.preventDefault();
            handleSubmitQuestion();
        }
    };

    const handleCopy = async () => {
        let textToCopy = '';

        if (activeTab === 'summary' && meeting.detailedSummary) {
            const formatList = (items?: string[]) => items && items.length > 0
                ? items.map(item => `- ${item}`).join('\n')
                : '无';
            const sectionsText = meeting.detailedSummary.sections && meeting.detailedSummary.sections.length > 0
                ? meeting.detailedSummary.sections
                    .filter(section => section.bullets.length > 0)
                    .map(section => `${section.title}：\n${formatList(section.bullets)}`)
                    .join('\n\n')
                : '';
            const coachingText = visibleCoachingInsights.length > 0
                ? visibleCoachingInsights
                    .map(insight => `- ${insight.title}：${insight.detail}${insight.evidence ? `\n  证据：${insight.evidence}` : ''}`)
                    .join('\n')
                : '';
            textToCopy = `
会议：${meeting.title}
日期：${new Date(meeting.date).toLocaleDateString()}

概述：
${meeting.detailedSummary.overview || ''}

行动项：
${formatList(meeting.detailedSummary.actionItems)}

要点：
${formatList(meeting.detailedSummary.keyPoints)}

决策项：
${formatList(meeting.detailedSummary.decisions)}

待确认事项：
${formatList(meeting.detailedSummary.openQuestions)}

${sectionsText ? `分区摘要：\n${sectionsText}\n\n` : ''}${coachingText ? `辅导：\n${coachingText}\n\n` : ''}${visibleFollowUpDraft ? `跟进草稿：\n${visibleFollowUpDraft}` : ''}
            `.trim();
        } else if (activeTab === 'transcript' && meeting.transcript) {
            textToCopy = meeting.transcript.map(t => {
                const speaker = resolveEffectiveSpeaker(t);
                return `[${formatTime(t.timestamp)}] ${speaker === 'user' ? '我' : '对方'}: ${t.text}`;
            }).join('\n');
        } else if (activeTab === 'usage' && meeting.usage) {
            textToCopy = meeting.usage.map(u => `问：${u.question || ''}\n答：${u.answer || ''}`).join('\n\n');
        }

        if (!textToCopy) return;

        try {
            await navigator.clipboard.writeText(textToCopy);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy content:', err);
        }
    };

    const handleRunTranscriptSkill = async (skill: SkillSummary) => {
        if (typeof window.electronAPI?.transcriptSkillRun !== 'function') {
            setSkillExportStatus({ message: '技能导出桥接不可用，请重启应用后重试。', error: true });
            return;
        }

        setRunningSkillId(skill.id);
        setSkillExportStatus({ message: `正在使用“${skill.name}”处理转录...` });
        try {
            const result = await window.electronAPI.transcriptSkillRun({
                skillId: skill.id,
                meetingId: meeting.id,
                meetingTitle: meeting.title,
                transcriptMarkdown,
            });

            if (!result?.success || !result.filePath) {
                setSkillExportStatus({ message: result?.error || '生成 Markdown 文件失败。', error: true });
                return;
            }

            setSkillExportStatus({ message: '已生成 Markdown 文件。', filePath: result.filePath });
            setSkillsMenuOpen(false);
        } catch (error: any) {
            setSkillExportStatus({ message: error?.message || '生成 Markdown 文件失败。', error: true });
        } finally {
            setRunningSkillId(null);
        }
    };

    const openExportPath = async (targetPath: string) => {
        if (typeof window.electronAPI?.openPath !== 'function') {
            setSkillExportStatus({ message: '打开文件桥接不可用，请重启应用后重试。', error: true });
            return;
        }
        const result = await window.electronAPI.openPath(targetPath);
        if (!result?.success) {
            setSkillExportStatus({ message: result?.error || '无法打开路径。', error: true });
        }
    };

    // UPDATE HANDLERS
    const handleTitleSave = async (newTitle: string) => {
        setMeeting(prev => ({ ...prev, title: newTitle }));
        if (window.electronAPI?.updateMeetingTitle) {
            await window.electronAPI.updateMeetingTitle(meeting.id, newTitle);
        }
    };

    const handleOverviewSave = async (newOverview: string) => {
        setMeeting(prev => ({
            ...prev,
            detailedSummary: {
                ...prev.detailedSummary!,
                overview: newOverview
            }
        }));
        if (window.electronAPI?.updateMeetingSummary) {
            await window.electronAPI.updateMeetingSummary(meeting.id, { overview: newOverview });
        }
    };

    const handleActionItemSave = async (index: number, newVal: string) => {
        const newItems = [...(meeting.detailedSummary?.actionItems || [])];
        if (!newVal.trim()) {
            // Optional: Remove empty items? For now just keep empty or update
        }
        newItems[index] = newVal;

        setMeeting(prev => ({
            ...prev,
            detailedSummary: {
                ...prev.detailedSummary!,
                actionItems: newItems
            }
        }));

        if (window.electronAPI?.updateMeetingSummary) {
            await window.electronAPI.updateMeetingSummary(meeting.id, { actionItems: newItems });
        }
    };

    const handleKeyPointSave = async (index: number, newVal: string) => {
        const newItems = [...(meeting.detailedSummary?.keyPoints || [])];
        newItems[index] = newVal;

        setMeeting(prev => ({
            ...prev,
            detailedSummary: {
                ...prev.detailedSummary!,
                keyPoints: newItems
            }
        }));

        if (window.electronAPI?.updateMeetingSummary) {
            await window.electronAPI.updateMeetingSummary(meeting.id, { keyPoints: newItems });
        }
    };


    return (
        <div className="h-full w-full flex flex-col bg-bg-secondary text-text-secondary font-sans overflow-hidden">
            {/* Main Content */}
            <main className="flex-1 overflow-y-auto custom-scrollbar">
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                    className="max-w-4xl mx-auto px-8 py-8 pb-32" // Added pb-32 for floating footer clearance
                >
                    {/* Meta Info & Actions Row */}
                    <div className="flex items-start justify-between mb-6">
                        <div className="w-full pr-4">
                            {/* Date formatting could be improved to use meeting.date if it's an ISO string */}
                            <div className="text-xs text-text-tertiary font-medium mb-1">
                                {new Date(meeting.date).toLocaleDateString('zh-CN', { weekday: 'long', month: 'short', day: 'numeric' })}
                            </div>

                            {/* Editable Title */}
                            <EditableTextBlock
                                initialValue={meeting.title}
                                onSave={handleTitleSave}
                                tagName="h1"
                                className="text-3xl font-bold text-text-primary tracking-tight -ml-2 px-2 py-1 rounded-md transition-colors"
                                multiline={false}
                            />
                        </div>

                        {/* Moved Actions: Follow-up & Share (REMOVED per user request) */}
                        {/* <div className="flex items-center gap-2 mt-1"> ... </div> */}
                    </div>

                    {/* Tabs */}
                    {/* Designing Tabs to match reference 1:1 (Dark Pill Container) */}
                    <div className="flex items-center justify-between mb-8">
                        <div className={`p-1 rounded-xl inline-flex items-center gap-0.5 ${isLight ? 'bg-[#E5E5EA] border border-black/[0.04]' : 'bg-[#121214] border border-white/[0.08]'}`}>
                            {[
                                { key: 'summary', label: '摘要' },
                                { key: 'transcript', label: '转录' },
                                { key: 'usage', label: '使用记录' },
                            ].map(({ key: tab, label }) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab as any)}
                                    className={`
                                        relative px-3 py-1 text-[13px] font-medium rounded-lg transition-all duration-200 z-10
                                        ${activeTab === tab ? (isLight ? 'text-black' : 'text-[#E9E9E9]') : `${isLight ? 'text-text-secondary' : 'text-text-tertiary'} hover:text-text-primary`}
                                    `}
                                >
                                    {activeTab === tab && (
                                        <motion.div
                                            layoutId="activeTabBackground"
                                            className={`absolute inset-0 rounded-lg -z-10 shadow-sm ${isLight ? 'bg-white' : 'bg-[#3A3A3C]'}`}
                                            initial={false}
                                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                                        />
                                    )}
                                    {label}
                                </button>
                            ))}
                        </div>

                        <div className="relative flex items-center gap-3">
                            {canRunTranscriptSkill && (
                                <div className="relative">
                                    <button
                                        onClick={() => setSkillsMenuOpen((open) => !open)}
                                        className="flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                                    >
                                        <Sparkles size={14} />
                                        用技能处理
                                        <ChevronDown size={13} className={skillsMenuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                                    </button>

                                    {skillsMenuOpen && (
                                        <div className={`absolute right-0 top-7 z-50 w-64 rounded-lg border shadow-xl overflow-hidden ${isLight ? 'bg-white border-black/[0.08]' : 'bg-[#1C1C1E] border-white/[0.10]'}`}>
                                            <div className="px-3 py-2 border-b border-border-subtle">
                                                <p className="text-xs font-semibold text-text-primary">选择技能</p>
                                                <p className="mt-0.5 text-[11px] leading-snug text-text-tertiary">将完整转录交给所选技能，生成 Markdown 文件。</p>
                                            </div>

                                            <div className="max-h-64 overflow-y-auto py-1">
                                                {skillsLoading && (
                                                    <p className="px-3 py-2 text-xs text-text-tertiary">正在加载技能...</p>
                                                )}
                                                {!skillsLoading && skills.length === 0 && (
                                                    <p className="px-3 py-2 text-xs text-text-tertiary">还没有可用技能</p>
                                                )}
                                                {!skillsLoading && skills.map((skill) => (
                                                    <button
                                                        key={skill.id}
                                                        onClick={() => handleRunTranscriptSkill(skill)}
                                                        disabled={Boolean(runningSkillId)}
                                                        className="w-full px-3 py-2 text-left hover:bg-bg-item-active/70 disabled:opacity-60 transition-colors"
                                                    >
                                                        <span className="flex items-center gap-2 text-xs font-medium text-text-primary">
                                                            <FileText size={13} />
                                                            <span className="truncate">{skill.name}</span>
                                                        </span>
                                                        {skill.description && (
                                                            <span className="mt-0.5 block truncate pl-5 text-[11px] text-text-tertiary">{skill.description}</span>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>

                                            <div className="grid grid-cols-2 gap-1 border-t border-border-subtle p-1">
                                                <button
                                                    onClick={loadTranscriptSkills}
                                                    className="rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-bg-item-active hover:text-text-primary"
                                                >
                                                    刷新技能
                                                </button>
                                                <button
                                                    onClick={() => window.electronAPI?.skillsOpenFolder?.()}
                                                    className="rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-bg-item-active hover:text-text-primary inline-flex items-center justify-center gap-1"
                                                >
                                                    <FolderOpen size={12} />
                                                    技能文件夹
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <button
                                onClick={handleCopy}
                                className="flex items-center gap-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                            >
                                {isCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                {isCopied ? '已复制' : activeTab === 'summary' ? '复制完整摘要' : activeTab === 'transcript' ? '复制完整转录' : '复制使用记录'}
                            </button>
                        </div>
                    </div>

                    {skillExportStatus && (
                        <div className={`-mt-5 mb-6 flex flex-wrap items-center justify-end gap-2 text-xs ${skillExportStatus.error ? 'text-red-500' : 'text-text-tertiary'}`}>
                            <span>{skillExportStatus.message}</span>
                            {skillExportStatus.filePath && (
                                <>
                                    <button
                                        onClick={() => openExportPath(skillExportStatus.filePath!)}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 font-medium text-text-secondary transition-colors hover:bg-bg-item-active hover:text-text-primary"
                                    >
                                        <FileText size={12} />
                                        打开文件
                                    </button>
                                    <button
                                        onClick={() => openExportPath(parentPathOf(skillExportStatus.filePath!))}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 font-medium text-text-secondary transition-colors hover:bg-bg-item-active hover:text-text-primary"
                                    >
                                        <FolderOpen size={12} />
                                        打开文件夹
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* Tab Content */}
                    <div className="space-y-8">
                        {/* Using standard divs for content, framer motion for layout */}
                        {activeTab === 'summary' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {meeting.detailedSummary?.generationStatus === 'failed' && (
                                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                                        云端摘要暂时生成失败，会议转录已保存。
                                    </p>
                                )}

                                {/* Overview - Rendered as Markdown */}
                                {meeting.detailedSummary?.overview && (
                                <div className="mb-6 pb-6 border-b border-border-subtle prose prose-sm max-w-none">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            h1: ({ node, ...props }) => <h1 className="text-xl font-bold text-text-primary mt-4 mb-2" {...props} />,
                                            h2: ({ node, ...props }) => <h2 className="text-lg font-semibold text-text-primary mt-4 mb-2" {...props} />,
                                            h3: ({ node, ...props }) => <h3 className="text-base font-semibold text-text-primary mt-3 mb-1" {...props} />,
                                            p: ({ node, ...props }) => <p className="text-sm text-text-secondary leading-relaxed mb-2" {...props} />,
                                            ul: ({ node, ...props }) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                            ol: ({ node, ...props }) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                            li: ({ node, ...props }) => <li className="text-sm text-text-secondary" {...props} />,
                                            strong: ({ node, ...props }) => <strong className="font-semibold text-text-primary" {...props} />,
                                            del: ({ node, ...props }) => <span {...props} />,
                                            a: ({ node, ...props }) => <a className="text-blue-500 hover:underline" {...props} />,
                                        }}
                                    >
                                        {meeting.detailedSummary?.overview || ''}
                                    </ReactMarkdown>
                                </div>
                                )}

                                {/* Action Items - Only show if there are items */}
                                {meeting.detailedSummary?.actionItems && meeting.detailedSummary.actionItems.length > 0 && (
                                    <section className="mb-8">
                                        <div className="flex items-center justify-between mb-4">
                                            <EditableTextBlock
                                                initialValue={meeting.detailedSummary?.actionItemsTitle || '行动项'}
                                                onSave={(val) => {
                                                    setMeeting(prev => ({
                                                        ...prev,
                                                        detailedSummary: { ...prev.detailedSummary!, actionItemsTitle: val }
                                                    }));
                                                    window.electronAPI?.updateMeetingSummary(meeting.id, { actionItemsTitle: val });
                                                }}
                                                tagName="h2"
                                                className="text-lg font-semibold text-text-primary -ml-2 px-2 py-1 rounded-sm transition-colors"
                                                multiline={false}
                                            />
                                        </div>
                                        <ul className="space-y-3">
                                            {meeting.detailedSummary.actionItems.map((item, i) => (
                                                <li key={i} className="flex items-start gap-3 group">
                                                    <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary group-hover:bg-blue-500 transition-colors shrink-0" />
                                                    <div className="flex-1">
                                                        <EditableTextBlock
                                                            initialValue={item}
                                                            onSave={(val) => handleActionItemSave(i, val)}
                                                            tagName="p"
                                                            className="text-sm text-text-secondary leading-relaxed -ml-2 px-2 rounded-sm transition-colors"
                                                            placeholder="输入行动项..."
                                                            onEnter={() => {
                                                                const newItems = [...(meeting.detailedSummary?.actionItems || [])];
                                                                newItems.splice(i + 1, 0, "");
                                                                setMeeting(prev => ({
                                                                    ...prev,
                                                                    detailedSummary: { ...prev.detailedSummary!, actionItems: newItems }
                                                                }));
                                                            }}
                                                        />
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {/* Key Points - Only show if there are items */}
                                {meeting.detailedSummary?.keyPoints && meeting.detailedSummary.keyPoints.length > 0 && (
                                    <section>
                                        <div className="flex items-center justify-between mb-4">
                                            <EditableTextBlock
                                                initialValue={meeting.detailedSummary?.keyPointsTitle || '要点'}
                                                onSave={(val) => {
                                                    setMeeting(prev => ({
                                                        ...prev,
                                                        detailedSummary: { ...prev.detailedSummary!, keyPointsTitle: val }
                                                    }));
                                                    window.electronAPI?.updateMeetingSummary(meeting.id, { keyPointsTitle: val });
                                                }}
                                                tagName="h2"
                                                className="text-lg font-semibold text-text-primary -ml-2 px-2 py-1 rounded-sm transition-colors"
                                                multiline={false}
                                            />
                                        </div>
                                        <ul className="space-y-3">
                                            {meeting.detailedSummary.keyPoints.map((item, i) => (
                                                <li key={i} className="flex items-start gap-3 group">
                                                    <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary group-hover:bg-purple-500 transition-colors shrink-0" />
                                                    <div className="flex-1">
                                                        <EditableTextBlock
                                                            initialValue={item}
                                                            onSave={(val) => handleKeyPointSave(i, val)}
                                                            tagName="p"
                                                            className="text-sm text-text-secondary leading-relaxed -ml-2 px-2 rounded-sm transition-colors"
                                                            placeholder="输入关键点..."
                                                            onEnter={() => {
                                                                const newItems = [...(meeting.detailedSummary?.keyPoints || [])];
                                                                newItems.splice(i + 1, 0, "");
                                                                setMeeting(prev => ({
                                                                    ...prev,
                                                                    detailedSummary: { ...prev.detailedSummary!, keyPoints: newItems }
                                                                }));
                                                            }}
                                                        />
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {/* Phase 7 — Structured action items (with owner / deadline).
                                    Rendered ONLY when PostCallWorkflow has produced them
                                    (schemaVersion === 2). Falls through silently otherwise so
                                    pre-Phase-7 meetings still look the same. */}
                                {meeting.detailedSummary?.actionItemsStructured && meeting.detailedSummary.actionItemsStructured.length > 0 && (
                                    <section className="mb-8">
                                        <h2 className="text-lg font-semibold text-text-primary mb-4">下一步</h2>
                                        <ul className="space-y-2">
                                            {meeting.detailedSummary.actionItemsStructured.map(item => (
                                                <li key={item.id} className="flex items-start gap-3 group">
                                                    <div className="mt-2 w-1.5 h-1.5 rounded-full bg-emerald-500/70 group-hover:bg-emerald-400 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-text-secondary leading-relaxed">{item.text}</p>
                                                        {(item.owner || item.deadline) && (
                                                            <p className="text-[11px] text-text-tertiary mt-0.5">
                                                                {item.owner && <span className="font-medium">{item.owner}</span>}
                                                                {item.owner && item.deadline && <span> · </span>}
                                                                {item.deadline && <span>截止：{item.deadline}</span>}
                                                            </p>
                                                        )}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {meeting.detailedSummary?.decisions && meeting.detailedSummary.decisions.length > 0 && (
                                    <section className="mb-8">
                                        <h2 className="text-lg font-semibold text-text-primary mb-4">决策项</h2>
                                        <ul className="space-y-3">
                                            {meeting.detailedSummary.decisions.map((decision, index) => (
                                                <li key={index} className="flex items-start gap-3 group">
                                                    <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary shrink-0" />
                                                    <p className="text-sm text-text-secondary leading-relaxed">{decision}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {meeting.detailedSummary?.openQuestions && meeting.detailedSummary.openQuestions.length > 0 && (
                                    <section className="mb-8">
                                        <h2 className="text-lg font-semibold text-text-primary mb-4">待确认事项</h2>
                                        <ul className="space-y-3">
                                            {meeting.detailedSummary.openQuestions.map((question, index) => (
                                                <li key={index} className="flex items-start gap-3 group">
                                                    <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-tertiary shrink-0" />
                                                    <p className="text-sm text-text-secondary leading-relaxed">{question}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {/* Phase 7 — Coaching insights (mode-specific opportunities). */}
                                {visibleCoachingInsights.length > 0 && (
                                    <section className="mb-8">
                                        <h2 className="text-lg font-semibold text-text-primary mb-4">辅导</h2>
                                        <ul className="space-y-3">
                                            {visibleCoachingInsights.map(insight => {
                                                const tone = insight.severity === 'warning'
                                                    ? 'border-amber-400/40 bg-amber-500/5'
                                                    : insight.severity === 'opportunity'
                                                        ? 'border-blue-400/40 bg-blue-500/5'
                                                        : 'border-text-tertiary/30 bg-transparent';
                                                return (
                                                    <li key={insight.id} className={`p-3 rounded-[10px] border ${tone}`}>
                                                        <p className="text-sm font-semibold text-text-primary">{insight.title}</p>
                                                        <p className="text-[12.5px] text-text-secondary mt-1 leading-relaxed">{insight.detail}</p>
                                                        {insight.evidence && (
                                                            <p className="text-[11px] text-text-tertiary mt-1.5 italic">"{insight.evidence}"</p>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </section>
                                )}

                                {/* Phase 7 — Follow-up email draft. Selectable + copy-friendly. */}
                                {visibleFollowUpDraft && (
                                    <section className="mb-8">
                                        <div className="flex items-center justify-between mb-3">
                                            <h2 className="text-lg font-semibold text-text-primary">跟进草稿</h2>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    navigator.clipboard?.writeText(visibleFollowUpDraft).catch(() => { /* swallow */ });
                                                }}
                                                className="text-[11px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-text-secondary border border-white/10 transition-colors"
                                            >
                                                复制
                                            </button>
                                        </div>
                                        <pre className="text-[12.5px] text-text-secondary leading-relaxed whitespace-pre-wrap font-sans select-text cursor-text p-3 rounded-[10px] border border-white/10 bg-white/[0.02]">{visibleFollowUpDraft}</pre>
                                    </section>
                                )}

                                {/* Mode-specific sections (when active mode has a notes template) */}
                                {meeting.detailedSummary?.sections && meeting.detailedSummary.sections.length > 0 && (
                                    <div className="space-y-8">
                                        {meeting.detailedSummary.sections.map((section, si) => (
                                            section.bullets.length > 0 && (
                                                <section key={si}>
                                                    <div className="flex items-center justify-between mb-4">
                                                        <h2 className="text-lg font-semibold text-text-primary">{section.title}</h2>
                                                    </div>
                                                    <ul className="space-y-3">
                                                        {section.bullets.map((bullet, bi) => (
                                                            <li key={bi} className="flex items-start gap-3 group">
                                                                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary shrink-0" />
                                                                <p className="text-sm text-text-secondary leading-relaxed">{bullet}</p>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </section>
                                            )
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        )}

                        {activeTab === 'transcript' && (
                            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <div className="space-y-6">
                                    {(() => {
                                        console.log('Raw Transcript:', meeting.transcript);
                                        const filteredTranscript = meeting.transcript?.filter(entry => {
                                            const isHidden = ['system', 'ai', 'assistant', 'model'].includes(entry.speaker?.toLowerCase());
                                            if (isHidden) console.log('Filtered out:', entry);
                                            return !isHidden;
                                        }) || [];
                                        console.log('Filtered Transcript:', filteredTranscript);

                                        if (filteredTranscript.length === 0) {
                                            return <p className="text-text-tertiary">没有可用的转录。</p>;
                                        }

                                        return filteredTranscript.map((entry, i) => (
                                            <div key={i} className="group">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xs font-semibold text-text-secondary">
                                                        {resolveEffectiveSpeaker(entry) === 'user' ? '我' : '对方'}
                                                    </span>
                                                    <span className="text-xs text-text-tertiary font-mono">{entry.timestamp ? formatTime(entry.timestamp) : '0:00'}</span>
                                                </div>
                                                <p className="text-text-secondary text-[15px] leading-relaxed transition-colors select-text cursor-text">{entry.text}</p>
                                            </div>
                                        ));
                                    })()}
                                </div>
                            </motion.section>
                        )}

                        {activeTab === 'usage' && (
                            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 pb-10">
                                {meeting.usage?.map((interaction, i) => (
                                    <div key={i} className="space-y-4">
                                        {/* User Question */}
                                        {interaction.question && (
                                            <div className="flex justify-end">
                                                <div className="bg-accent-primary text-white px-5 py-2.5 rounded-2xl rounded-tr-sm max-w-[80%] text-[15px] leading-relaxed shadow-sm">
                                                    {interaction.question}
                                                </div>
                                            </div>
                                        )}

                                        {/* AI Answer */}
                                        {interaction.answer && (
                                            <div className="flex items-start gap-4">
                                                <div className="mt-1 w-6 h-6 rounded-full bg-bg-input flex items-center justify-center border border-border-subtle shrink-0">
                                                    <img src={NativelyLogo} alt="AI" className="w-4 h-4 opacity-50 object-contain force-black-icon" />
                                                </div>
                                                <div>
                                                    <div className="text-[11px] text-text-tertiary mb-1.5 font-medium">{formatTime(interaction.timestamp)}</div>
                                                    <div className="text-text-secondary text-[15px] leading-relaxed max-w-none">
                                                        <ReactMarkdown
                                                            remarkPlugins={[remarkGfm]}
                                                            components={{
                                                                h1: ({ node, ...props }) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 whitespace-pre-wrap" {...props} />,
                                                                h2: ({ node, ...props }) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 whitespace-pre-wrap" {...props} />,
                                                                h3: ({ node, ...props }) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 whitespace-pre-wrap" {...props} />,
                                                                p: ({ node, ...props }) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 whitespace-pre-wrap" {...props} />,
                                                                ul: ({ node, ...props }) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                                                ol: ({ node, ...props }) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                                                li: ({ node, ...props }) => <li className="text-[15px] text-text-secondary font-normal" {...props} />,
                                                                strong: ({ node, ...props }) => <span className="font-normal text-text-secondary" {...props} />,
                                                                del: ({ node, ...props }) => <span {...props} />,
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
                                                                                    {lang || 'CODE'}
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
                                                                }
                                                            }}
                                                        >
                                                            {cleanMarkdown(interaction.answer || '')}
                                                        </ReactMarkdown>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {!meeting.usage?.length && <p className="text-text-tertiary">没有使用记录。</p>}
                            </motion.section>
                        )}
                    </div>
                </motion.div>
            </main>

            {/* Floating Footer (Ask Bar) */}
            <div className={`absolute bottom-0 left-0 right-0 p-6 flex justify-center pointer-events-none ${isChatOpen ? 'z-50' : 'z-20'}`}>
                <div className="w-full max-w-[440px] relative group pointer-events-auto">
                    {/* Dark Glass Effect Input (Matching Reference) */}
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        placeholder="询问本次会议..."
                        className="w-full pl-5 pr-12 py-3 bg-transparent backdrop-blur-[24px] backdrop-saturate-[140%] shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-white/20 rounded-full text-sm text-text-primary placeholder-text-tertiary/70 focus:outline-none transition-shadow duration-200"
                    />
                    <button
                        onClick={handleSubmitQuestion}
                        className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full transition-all duration-200 border border-white/5 ${query.trim() ? 'bg-text-primary text-bg-primary hover:scale-105' : 'bg-bg-item-active text-text-primary hover:bg-bg-item-hover'
                            }`}
                    >
                        <ArrowUp size={16} className="transform rotate-45" />
                    </button>
                </div>
            </div>

            {/* Chat Overlay */}
            <MeetingChatOverlay
                isOpen={isChatOpen}
                onClose={() => {
                    setIsChatOpen(false);
                    setQuery('');
                    setSubmittedQuery('');
                    setSubmittedQueryNonce(0);
                }}
                meetingContext={{
                    id: meeting.id,  // Required for RAG queries
                    title: meeting.title,
                    summary: meeting.detailedSummary?.overview,
                    keyPoints: meeting.detailedSummary?.keyPoints,
                    actionItems: meeting.detailedSummary?.actionItems,
                    transcript: meeting.transcript
                }}
                initialQuery={submittedQuery}
                queryNonce={submittedQueryNonce}
                onNewQuery={(newQuery) => {
                    setSubmittedQuery(newQuery);
                    setSubmittedQueryNonce((prev) => prev + 1);
                }}
            />
        </div>
    );
};

export default MeetingDetails;
