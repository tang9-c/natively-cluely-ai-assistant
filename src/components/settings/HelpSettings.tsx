import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Command, Monitor, Mic, Settings, Zap, Key, User, Play, Image, ArrowUp, FileText, Sparkles, Search, ChevronUp, Copy,
    FileJson, MessageSquare, Briefcase, Eye, EyeOff, ChevronDown, ChevronRight, HelpCircle, Upload, CheckCircle2,
    RefreshCw, Trash2, Check, ExternalLink, Volume2, Globe, Brain, Cpu, Calendar, Star, CreditCard, X, Pencil, Lightbulb,
    SlidersHorizontal, PointerOff, ArrowRight, LayoutGrid, DollarSign, Building2, Database
} from 'lucide-react';
import { useShortcuts, ShortcutConfig } from '../../hooks/useShortcuts';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { isMac, getModifierSymbol } from '../../utils/platformUtils';
import cueUpIcon from '../icon.png';

// ----------------------
// Animations & Mocks
// ----------------------

const CMD_SYMBOL = getModifierSymbol('cmd');
const MOCK_BUTTONS = [
    { icon: Pencil, label: '怎么回答？', kbd: `${CMD_SYMBOL}1`, color: 'blue' },
    { icon: MessageSquare, label: '澄清', kbd: `${CMD_SYMBOL}2`, color: 'indigo' },
    { icon: RefreshCw, label: '回顾', kbd: `${CMD_SYMBOL}7`, color: 'amber' },
    { icon: HelpCircle, label: '跟进问题', kbd: `${CMD_SYMBOL}4`, color: 'teal' },
    { icon: Zap, label: '问 AI', kbd: `${CMD_SYMBOL}5`, color: 'emerald' },
] as const;

const colorMap: Record<string, string> = {
    blue: 'bg-blue-500/10 text-blue-500 border-blue-500/25',
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/25',
    amber: 'bg-amber-500/10 text-amber-500 border-amber-500/25',
    teal: 'bg-teal-500/10 text-teal-500 border-teal-500/25',
    emerald: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/25',
};

const MockAppInterface = () => {
    const [activeBtn, setActiveBtn] = useState(0);
    const isLight = useResolvedTheme() === 'light';

    useEffect(() => {
        const id = setInterval(() => setActiveBtn(i => (i + 1) % MOCK_BUTTONS.length), 1600);
        return () => clearInterval(id);
    }, []);

    return (
        <div className="flex flex-col items-center w-full max-w-[600px] mx-auto opacity-100 relative h-[380px] overflow-hidden">
            <div className="flex flex-col items-center w-[600px] transform scale-[0.8] origin-top absolute top-0 pt-2">
                {/* Top Pill Replica */}
                <div className="flex justify-center mb-2 select-none z-50">
                    <div className="flex items-center gap-2 rounded-full backdrop-blur-md pl-1.5 pr-1.5 py-1.5 bg-bg-item-surface border border-border-subtle shadow-sm">
                        {/* Logo Button */}
                        <div className="w-8 h-8 rounded-full bg-bg-item-active flex items-center justify-center border border-border-muted overflow-hidden">
                            <img
                                src={cueUpIcon}
                                alt="CueUp"
                                className="w-[20px] h-[20px] object-contain"
                                style={{ filter: isLight ? 'brightness(0)' : 'brightness(0) invert(1)', opacity: 0.9 }}
                            />
                        </div>
                        {/* Center Segment */}
                        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-bg-item-surface text-text-primary text-[12px] font-medium border border-border-muted">
                            <ChevronUp className="w-3.5 h-3.5 opacity-70" />
                            <span className="tracking-wide opacity-80">隐藏</span>
                        </div>
                        {/* Stop Button */}
                        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-bg-item-active text-text-primary border border-border-muted">
                            <div className="w-3.5 h-3.5 rounded-[3px] bg-current opacity-80" />
                        </div>
                    </div>
                </div>

                {/* Main Window */}
                <div className="relative w-full backdrop-blur-[30px] border border-border-subtle rounded-[24px] overflow-hidden flex flex-col bg-bg-item-surface shadow-2xl">

                    {/* Rolling Transcript Bar — replica of RollingTranscript.tsx */}
                    <div className="relative w-[90%] mx-auto pt-2">
                        <div
                            className="overflow-hidden whitespace-nowrap text-right"
                            style={{ maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)' }}
                        >
                            <span className="text-text-secondary inline-flex items-center text-[13px] italic leading-7 opacity-60">
                                ...并考虑为水平扩展引入分布式缓存层
                                <span className="inline-flex items-center ml-2">
                                    <span className="w-1 h-1 bg-green-500/60 rounded-full animate-pulse" />
                                </span>
                            </span>
                        </div>
                    </div>

                    {/* Chat History */}
                    <div className="p-4 space-y-3 pb-2 flex-1 overflow-y-auto max-h-[220px]">
                        <div className="flex justify-start">
                            <div className="max-w-[85%] px-4 py-3 text-[14px] leading-relaxed font-normal text-text-primary">
                                <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium uppercase tracking-wider text-text-secondary opacity-70">
                                    面试官
                                </div>
                                <span className="text-text-secondary italic">那么你会如何优化当前算法？</span>
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <div className="max-w-[72.25%] px-[13.6px] py-[10.2px] text-[14px] leading-relaxed whitespace-pre-wrap bg-blue-500/10 border border-blue-500/20 text-blue-500 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium">
                                <span className="font-semibold text-emerald-500 block mb-1 text-[12px]">🎯 回答</span>
                                一个好的方法是使用哈希映射来缓存中间结果，将时间复杂度降低到 O(N)。
                            </div>
                        </div>
                    </div>

                    {/* Quick Actions — cycling highlight */}
                    <div className="flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 pt-3 overflow-x-hidden">
                        {MOCK_BUTTONS.map((btn, idx) => {
                            const Icon = btn.icon;
                            const isActive = activeBtn === idx;
                            return (
                                <button key={idx} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all duration-300 whitespace-nowrap shrink-0 ${isActive ? colorMap[btn.color] : 'bg-bg-item-surface text-text-primary border-border-subtle'}`}>
                                    <Icon className="w-3 h-3 opacity-70" /> {btn.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Input Area */}
                    <div className="p-3 pt-0">
                        <div className="relative">
                            <div className="w-full border border-border-subtle rounded-xl pl-3 pr-10 py-2.5 text-[13px] leading-relaxed bg-bg-input shadow-inner flex items-center h-[46px]">
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[13px] text-text-secondary opacity-60">
                                    <span className="hidden sm:inline">询问屏幕上或对话中的任何问题，或</span>
                                    <div className="flex items-center gap-1 opacity-80 sm:ml-0.5">
                                        <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center bg-bg-item-surface border-border-subtle text-text-primary shadow-sm">{getModifierSymbol('cmd')}</kbd>
                                        <span className="text-[10px]">+</span>
                                        <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center bg-bg-item-surface border-border-subtle text-text-primary shadow-sm">{getModifierSymbol('shift')}</kbd>
                                        <span className="text-[10px]">+</span>
                                        <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center bg-bg-item-surface border-border-subtle text-text-primary shadow-sm">H</kbd>
                                    </div>
                                    <span className="hidden sm:inline">进行选择性截图</span>
                                </div>
                            </div>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-20 text-text-primary">
                                <span className="text-[10px]">↵</span>
                            </div>
                        </div>
                        {/* Bottom Row */}
                        <div className="flex items-center justify-between mt-3 px-0.5">
                            <div className="flex items-center gap-1.5">
                                <button className="flex items-center gap-2 px-3 py-1.5 border border-border-subtle rounded-lg bg-bg-item-surface text-text-primary text-xs font-medium w-[140px] shadow-sm">
                                    <span className="truncate min-w-0 flex-1 text-left">Doubao Seed 2.0 Lite</span>
                                    <ChevronDown size={14} className="shrink-0 opacity-70" />
                                </button>
                                <div className="h-3 w-px bg-border-subtle mx-1" />
                                <button className="w-8 h-8 flex items-center justify-center border border-border-subtle rounded-lg bg-bg-item-surface text-text-primary shadow-sm">
                                    <SlidersHorizontal size={14} className="opacity-70" />
                                </button>
                                <div className="h-3 w-px bg-border-subtle mx-1" />
                                <button className="w-8 h-8 flex items-center justify-center border border-border-subtle rounded-lg bg-bg-item-surface text-text-primary shadow-sm">
                                    <PointerOff size={14} className="opacity-70" />
                                </button>
                            </div>
                            <button className="w-7 h-7 rounded-full flex items-center justify-center bg-bg-item-surface border border-border-subtle shadow-sm text-text-secondary">
                                <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const MockMeetingInterfaceAnim = () => {
    const [tab, setTab] = useState('summary');

    useEffect(() => {
        const tabs = ['summary', 'transcript', 'usage'];
        let i = 0;
        const interval = setInterval(() => { i = (i + 1) % tabs.length; setTab(tabs[i]); }, 3500);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="w-full aspect-[3/2] bg-bg-secondary rounded-[20px] border border-border-subtle overflow-hidden flex flex-col relative shadow-lg select-none pointer-events-none">

            {/* Header */}
            <div className="px-6 pt-5 pb-0 shrink-0">
                <div className="text-xs text-text-tertiary font-medium mb-0.5">今天 · 47 分钟</div>
                <h1 className="text-xl font-bold text-text-primary tracking-tight">系统设计面试</h1>
            </div>

            {/* Tabs row */}
            <div className="flex items-center justify-between px-6 pt-4 pb-3 shrink-0">
                <div className="p-1 rounded-xl inline-flex items-center gap-0.5 bg-bg-input border border-border-subtle">
                    {['summary', 'transcript', 'usage'].map((t) => (
                        <button key={t} className={`relative px-3 py-1 text-[12px] font-medium rounded-lg z-10 transition-colors ${tab === t ? 'text-text-primary bg-bg-elevated shadow-sm border border-border-subtle' : 'text-text-tertiary'}`}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary opacity-70">
                    <Copy size={12} /> 复制完整{tab}
                </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden px-6 pb-14">
                <AnimatePresence mode="wait">
                    {tab === 'summary' && (
                        <motion.div key="summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                            {/* Overview — plain paragraph + border-b, matches MeetingDetails prose block */}
                            <div className="mb-5 pb-5 border-b border-border-subtle">
                                <p className="text-sm text-text-secondary leading-relaxed">讨论了新支付网关的微服务架构。分析了 Redis 与 Memcached 在缓存选型中的差异，重点关注数据持久化以防止结账时的竞态条件。</p>
                            </div>
                            {/* Action Items — h2 heading + dot-bullet list, matches MeetingDetails exactly */}
                            <section className="mb-6">
                                <h2 className="text-base font-semibold text-text-primary mb-3">行动项</h2>
                                <ul className="space-y-3">
                                    {['起草 Redis 实现约束文档。', '安排 Memcached 基准测试的跟进。'].map((item, i) => (
                                        <li key={i} className="flex items-start gap-3">
                                            <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary shrink-0" />
                                            <p className="text-sm text-text-secondary leading-relaxed">{item}</p>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                            {/* Key Points */}
                            <section>
                                <h2 className="text-base font-semibold text-text-primary mb-3">关键点</h2>
                                <ul className="space-y-3">
                                    {['选择 Redis 是因为其有序集合支持，可实现 O(log N) 速率限制。', '讨论了通过分布式缓存层进行水平扩展。'].map((item, i) => (
                                        <li key={i} className="flex items-start gap-3">
                                            <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary shrink-0" />
                                            <p className="text-sm text-text-secondary leading-relaxed">{item}</p>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        </motion.div>
                    )}
                    {tab === 'transcript' && (
                        <motion.div key="transcript" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-6">
                            {/* Matches MeetingDetails: speaker + timestamp inline, then text below — no card/border */}
                            {[
                                { speaker: '面试官', time: '10:32', text: '为什么购物车会话使用 Redis 而不是 Memcached？' },
                                { speaker: '我', time: '10:33', text: '因为我们需要有序集合来实现速率限制和自动过期，而无需自定义定时任务。' },
                            ].map((entry, i) => (
                                <div key={i}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-semibold text-text-secondary">{entry.speaker}</span>
                                        <span className="text-xs text-text-tertiary font-mono">{entry.time}</span>
                                    </div>
                                    <p className="text-text-secondary text-sm leading-relaxed">{entry.text}</p>
                                </div>
                            ))}
                        </motion.div>
                    )}
                    {tab === 'usage' && (
                        <motion.div key="usage" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="space-y-4">
                            <div className="flex justify-end pt-2">
                                <div className="bg-accent-primary text-white px-4 py-2 rounded-2xl rounded-tr-sm max-w-[75%] text-xs leading-relaxed shadow-sm">
                                    你能详细说明 Redis 速率限制吗？
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 w-5 h-5 rounded-full bg-bg-input flex items-center justify-center border border-border-subtle shrink-0">
                                    <img src={cueUpIcon} alt="AI" className="w-3 h-3 opacity-50 object-contain force-black-icon" />
                                </div>
                                <div>
                                    <div className="text-[10px] text-text-tertiary mb-1 font-medium">10:35 AM</div>
                                    <p className="text-xs text-text-secondary leading-relaxed">你提到使用 Redis 有序集合来实现滑动速率窗口——高效是因为它能自动过期陈旧记录，同时保持操作严格为 O(log N)。</p>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Floating ask bar */}
            <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-center">
                <div className="w-full max-w-[440px] flex items-center relative">
                    <div className="w-full pl-4 pr-11 py-2.5 bg-bg-item-surface shadow-sm border border-border-subtle rounded-full text-xs text-text-tertiary/70">询问本次会议...</div>
                    <div className="absolute right-2 p-1.5 rounded-full bg-bg-item-active text-text-primary border border-border-subtle shadow-sm">
                        <ArrowUp size={13} className="rotate-45" />
                    </div>
                </div>
            </div>
        </div>
    );
};

const MockMeetingChatAnim = () => {
    return (
        <div className="w-full bg-bg-secondary rounded-[20px] border border-border-subtle overflow-hidden flex flex-col select-none pointer-events-none shadow-lg max-h-[280px]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
                <div className="flex items-center gap-2 text-text-tertiary">
                    <img src={cueUpIcon} className="w-3.5 h-3.5 force-black-icon opacity-50" alt="图标" />
                    <span className="text-[13px] font-medium">搜索本次会议</span>
                </div>
                <X size={16} className="text-text-tertiary" />
            </div>

            {/* Messages */}
            <div className="p-5 space-y-5">
                <div className="flex justify-end">
                    <div className="bg-accent-primary text-white px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[75%] text-sm leading-relaxed shadow-sm">
                        他们提到了哪些 API 依赖？
                    </div>
                </div>
                <div className="flex flex-col items-start">
                    <p className="text-sm text-text-primary leading-relaxed max-w-[85%]">
                        根据上午 10:45 附近的转录，他们明确提到集成 <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-[12px] font-mono text-text-primary border border-border-subtle">Stripe 支付意向</code> 来安全地处理重复层级逻辑。
                    </p>
                    <div className="flex items-center gap-2 mt-2.5 text-xs text-text-tertiary">
                        <Copy size={13} /> 复制消息
                    </div>
                </div>
            </div>
        </div>
    );
};

const MockSearchPillAnim = () => {
    const isLight = useResolvedTheme() === 'light';
    return (
        <div className="flex justify-center flex-col items-center py-10 rounded-[26px] border border-border-subtle relative overflow-hidden h-[340px] bg-bg-card">
            <div className="absolute inset-0 bg-black/5 backdrop-blur-[2px]" />
            <motion.div
                initial={{ y: -10, opacity: 0, scale: 0.95 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                className={`w-[480px] ${isLight ? 'bg-[#F2F2F7]/90' : 'bg-[#161618]/90'} backdrop-blur-xl backdrop-saturate-150 rounded-2xl shadow-md overflow-hidden z-10 transform-gpu relative border border-border-subtle`}
            >
                {/* Input Row */}
                <div className="relative flex items-center border-b border-border-muted">
                    <div className="absolute left-3 flex items-center pointer-events-none">
                        <Search size={14} className="text-text-tertiary" />
                    </div>
                    <div className="w-full bg-transparent pl-9 pr-4 py-2.5 text-[13px] text-text-primary outline-none flex items-center h-[38px]">
                        <span className="opacity-90">系统</span><motion.span animate={{ opacity: [1, 0, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-[1.5px] h-3.5 bg-blue-500 ml-[2px] inline-block" />
                    </div>
                </div>

                {/* Results Panel mock */}
                <div className="w-[480px]">
                    <div className="py-2">
                        {/* 探索 Section */}
                        <div className="px-3 py-1">
                            <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                                探索
                            </div>

                            <div className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left bg-bg-item-active transition-colors">
                                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
                                    <Sparkles size={12} className="text-white" />
                                </div>
                                <span className="text-[13px] text-text-primary truncate">
                                    系统
                                </span>
                            </div>

                            <div className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-bg-item-hover transition-colors">
                                <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0 border border-border-subtle">
                                    <Search size={12} className="text-text-secondary" />
                                </div>
                                <span className="text-[13px] text-text-secondary">
                                    搜索 "<span className="text-text-primary">"系统"</span>
                                </span>
                            </div>
                        </div>

                        {/* 会话 Section */}
                        <div className="px-3 py-1 mt-1">
                            <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                                会话
                            </div>

                            <div className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-bg-item-hover transition-colors">
                                <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0 border border-border-subtle">
                                    <FileText size={12} className="text-text-secondary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] text-text-primary truncate">
                                        系统设计面试
                                    </div>
                                    <div className="text-[11px] text-text-tertiary">
                                        1月12日
                                    </div>
                                </div>
                            </div>

                            <div className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-bg-item-hover transition-colors">
                                <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0 border border-border-subtle">
                                    <FileText size={12} className="text-text-secondary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] text-text-primary truncate">
                                        系统架构同步
                                    </div>
                                    <div className="text-[11px] text-text-tertiary">
                                        1月08日
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

const MockPermissionsAnim = () => {
    const [toggled, setToggled] = useState(false);
    useEffect(() => {
        const i = setInterval(() => setToggled(t => !t), 2500);
        return () => clearInterval(i);
    }, []);

    return (
        <div className="flex justify-center flex-col items-center gap-4 py-8 bg-bg-card rounded-xl border border-border-subtle relative overflow-hidden h-[240px]">
            <div className="w-[300px] bg-bg-elevated border border-border-subtle rounded-xl shadow-lg p-4 z-10">
                <div className="flex items-center gap-3 mb-4 border-b border-border-subtle pb-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center">
                        <Monitor className="w-4 h-4" />
                    </div>
                    <div className="font-semibold text-sm text-text-primary">屏幕录制</div>
                </div>
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <img src={cueUpIcon} alt="CueUp" className="w-6 h-6 object-contain rounded drop-shadow-sm opacity-90" />
                        <span className="text-text-primary text-sm font-medium">CueUp</span>
                    </div>

                    <motion.div
                        initial={false}
                        animate={{ backgroundColor: toggled ? '#3b82f6' : 'var(--bg-toggle-switch)' }}
                        className="w-10 h-6 rounded-full relative shadow-inner"
                    >
                        <motion.div
                            initial={false}
                            animate={{ x: toggled ? 18 : 2 }}
                            className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-md"
                        />
                    </motion.div>
                </div>
            </div>
            <div className="text-xs text-text-secondary text-center max-w-[280px]">
                {isMac
                    ? 'CueUp 需要辅助功能和屏幕录制权限来分析屏幕内容。'
                    : 'CueUp 会在你第一次开始会议时请求麦克风权限。'}
            </div>
        </div>
    );
};

const MockPillControlsAnim = () => {
    const [windowShowing, setWindowShowing] = useState(true);

    useEffect(() => {
        const interval = setInterval(() => setWindowShowing(prev => !prev), 2400);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="mt-4 space-y-2.5">
            <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider px-1 mb-3">胶囊控制</div>

            {/* Logo → Launcher */}
            <div className="flex items-center gap-3 p-3 bg-bg-elevated border border-border-subtle rounded-xl">
                <div className="w-8 h-8 rounded-full bg-bg-item-active flex items-center justify-center border border-border-muted shrink-0 shadow-sm">
                    <img src={cueUpIcon} alt="图标" className="w-[18px] h-[18px] object-contain force-black-icon opacity-90" />
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <motion.div
                        animate={{ opacity: [0.7, 1, 0.7] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 shrink-0"
                    >
                        <span className="relative flex h-[7px] w-[7px] shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                            <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-emerald-400" />
                        </span>
                        <span className="text-[11px] font-medium text-emerald-500">会议进行中</span>
                    </motion.div>
                    <span className="text-[11px] text-text-secondary leading-snug">— 点击此处即可快速恢复</span>
                </div>
            </div>

            {/* Hide / Show toggle */}
            <div className="flex items-center gap-3 p-3 bg-bg-elevated border border-border-subtle rounded-xl">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bg-item-active border border-border-muted shrink-0 w-[68px]">
                    <motion.div animate={{ rotate: windowShowing ? 0 : 180 }} transition={{ duration: 0.35, ease: 'easeInOut' }}>
                        <ChevronUp className="w-3 h-3 text-text-secondary" />
                    </motion.div>
                    <span className="text-[11px] text-text-secondary font-medium">{windowShowing ? '隐藏' : '显示'}</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="relative w-14 h-9 shrink-0">
                        <motion.div
                            animate={{ opacity: windowShowing ? 1 : 0 }}
                            transition={{ duration: 0.35 }}
                            className="absolute inset-0 rounded-lg border border-border-subtle bg-bg-item-surface flex items-center justify-center"
                        >
                            <Eye className="w-3.5 h-3.5 text-text-tertiary" />
                        </motion.div>
                        <motion.div
                            animate={{ opacity: windowShowing ? 0 : 0.4 }}
                            transition={{ duration: 0.35 }}
                            className="absolute inset-0 rounded-lg border border-dashed border-border-subtle flex items-center justify-center"
                        >
                            <EyeOff className="w-3.5 h-3.5 text-text-tertiary" />
                        </motion.div>
                    </div>
                    <span className="text-[11px] text-text-secondary leading-snug">切换整个窗口 — 隐藏或显示 <strong className="text-text-primary">CueUp 窗口</strong></span>
                </div>
            </div>

            {/* Stop → end session */}
            <div className="flex items-center gap-3 p-3 bg-bg-elevated border border-border-subtle rounded-xl">
                <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center shrink-0">
                    <div className="w-3 h-3 rounded-[2.5px] bg-red-400" />
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <motion.span
                        animate={{ opacity: [1, 0.25, 1] }}
                        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                        className="text-[11px] text-red-400 font-medium shrink-0"
                    >
                        会话立即结束
                    </motion.span>
                    <span className="text-[11px] text-text-tertiary">— 返回启动器</span>
                </div>
            </div>

        </div>
    );
};

// Audio Mock Animations

const getBadgeStyle = (color?: string) => {
    switch (color) {
        case 'blue': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
        case 'orange': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
        case 'purple': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
        case 'teal': return 'bg-teal-500/10 text-teal-500 border-teal-500/20';
        case 'cyan': return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
        case 'indigo': return 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20';
        case 'green': return 'bg-green-500/10 text-green-500 border-green-500/20';
        default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
};

const getIconStyle = (color?: string, isSelectedItem: boolean = false) => {
    if (isSelectedItem) return 'bg-accent-primary text-white shadow-sm';
    switch (color) {
        case 'blue': return 'bg-blue-500/10 text-blue-600';
        case 'orange': return 'bg-orange-500/10 text-orange-600';
        case 'purple': return 'bg-purple-500/10 text-purple-600';
        case 'teal': return 'bg-teal-500/10 text-teal-600';
        case 'cyan': return 'bg-cyan-500/10 text-cyan-600';
        case 'indigo': return 'bg-indigo-500/10 text-indigo-600';
        case 'green': return 'bg-green-500/10 text-green-600';
        default: return 'bg-gray-500/10 text-gray-600';
    }
};

const MockProviderSelectionAnim = () => {
    const isLight = useResolvedTheme() === 'light';
    const [isOpen, setIsOpen] = useState(false);
    useEffect(() => {
        const i = setInterval(() => setIsOpen(o => !o), 4000);
        return () => clearInterval(i);
    }, []);

    const options = [
        { id: 'local-sensevoice', label: 'Local SenseVoice', badge: '', recommended: true, desc: '中文优先，本地实时转录', color: 'green', icon: <img src={cueUpIcon} className={`w-[14px] h-[14px] object-contain opacity-80 ${isLight ? '' : 'filter brightness-0 invert'}`} alt="CueUp" /> },
        { id: 'qcloud-stt', label: 'QCLOUD API', badge: '已保存', recommended: false, desc: '同一把 QCLOUD key，中文优先并支持说话人分离', color: 'blue', icon: <Mic size={14} /> },
        { id: 'doubao-auc', label: 'Doubao AUC', badge: '已保存', recommended: false, desc: 'AUC BigModel，支持说话人和情绪信息', color: 'orange', icon: <Mic size={14} /> },
    ];
    const selected = options[0];

    return (
        <div className="flex justify-center flex-col items-center py-6 bg-bg-card rounded-xl border border-border-subtle relative overflow-hidden h-[300px]">
            <div className="w-[340px] flex flex-col gap-2 relative z-10 font-sans">
                <label className="text-xs font-medium text-text-secondary">语音提供商</label>
                <div className="relative">
                    <button className={`w-full group bg-bg-input border border-border-subtle shadow-sm rounded-xl p-2.5 pr-3.5 flex items-center justify-between transition-all duration-200 outline-none ${isOpen ? 'ring-2 ring-accent-primary/20 border-accent-primary/50' : 'hover:shadow-md'}`}>
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 transition-all duration-300 transform ${getIconStyle(selected.color, false)}`}>
                                {selected.icon}
                            </div>
                            <div className="min-w-0 flex-1 text-left">
                                <div className="flex items-center gap-2">
                                    <span className="text-[13px] font-semibold text-text-primary truncate leading-tight">{selected.label}</span>
                                    {selected.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ml-2 ${getBadgeStyle('green')}`}>{selected.badge}</span>}
                                    {selected.recommended && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ml-2 ${getBadgeStyle(selected.color)}`}>推荐</span>}
                                </div>
                                <span className="text-[11px] text-text-tertiary truncate block leading-tight mt-0.5">{selected.desc}</span>
                            </div>
                        </div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-text-tertiary transition-transform duration-300 group-hover:bg-bg-input ${isOpen ? 'rotate-180 bg-bg-input text-text-primary' : ''}`}>
                            <ChevronDown size={14} strokeWidth={2.5} />
                        </div>
                    </button>

                    <AnimatePresence>
                        {isOpen && (
                            <motion.div
                                initial={{ opacity: 0, y: 4, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                                transition={{ duration: 0.15, ease: "easeOut" }}
                                className={"absolute top-full left-0 w-full mt-2 backdrop-blur-xl rounded-xl shadow-2xl overflow-hidden z-20 bg-bg-elevated border border-border-subtle"}
                            >
                                <div className="max-h-[170px] overflow-hidden relative" style={{ WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)' }}>
                                    <motion.div
                                        className="p-1.5 space-y-0.5"
                                        animate={{ y: [0, 0, -110, -110, 0, 0] }}
                                        transition={{ duration: 3.5, ease: "easeInOut", repeat: Infinity }}
                                    >
                                        {options.map((option) => {
                                            const isSelected = selected.id === option.id;
                                            return (
                                                <div key={option.id} className={`w-full rounded-[10px] p-2 flex items-center gap-3 transition-all duration-200 group relative cursor-pointer ${isSelected ? 'bg-bg-item-active shadow-inner' : 'hover:bg-bg-item-hover'}`}>
                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 ${isSelected ? 'scale-100' : 'scale-95 group-hover:scale-100'} ${getIconStyle(option.color, false)}`}>
                                                        {option.icon}
                                                    </div>
                                                    <div className="flex-1 min-w-0 text-left">
                                                        <div className="flex items-center justify-between mb-0.5">
                                                            <div className="flex items-center gap-2">
                                                                <span className={"text-[13px] font-medium transition-colors text-text-primary"}>{option.label}</span>
                                                                {option.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${getBadgeStyle('green')}`}>{option.badge}</span>}
                                                                {option.recommended && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${getBadgeStyle(option.color)}`}>推荐</span>}
                                                            </div>
                                                            {isSelected && <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}><Check size={14} className="text-accent-primary" strokeWidth={3} /></motion.div>}
                                                        </div>
                                                        <span className={"text-[11px] block truncate transition-colors text-text-secondary"}>{option.desc}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </motion.div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Animated Cursor */}
            <motion.div
                className="absolute w-5 h-5 z-30 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                animate={{
                    x: isOpen ? 100 : 150,
                    y: isOpen ? 80 : 30
                }}
                transition={{ duration: 1.2, ease: 'easeInOut' }}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="black" strokeWidth="1.5"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.42c.45 0 .67-.54.35-.85L6.35 3.35a.5.5 0 0 0-.85.35Z" /></svg>
            </motion.div>
        </div>
    );
};

const MockApiKeyFlowAnim = () => {
    const [stage, setStage] = useState(0); // 0: enter key, 1: saving, 2: test, 3: connected, 4: trash
    useEffect(() => {
        const i = setInterval(() => setStage(s => (s + 1) % 5), 2000);
        return () => clearInterval(i);
    }, []);

    return (
        <div className="flex justify-center flex-col items-center gap-2 py-8 bg-bg-card rounded-xl border border-border-subtle relative overflow-hidden h-[240px]">
            <div className="w-[380px] space-y-2 relative z-10">
                <label className="text-xs font-medium text-text-secondary block">QCLOUD / Doubao API 密钥</label>
                <div className="flex gap-2">
                    <div className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary flex items-center shadow-inner">
                        <span className={stage > 0 ? "opacity-100" : "opacity-40"}>
                            {stage > 0 ? "sk-a8B2c..." : "输入 API 密钥"}
                        </span>
                        {stage === 0 && <motion.div animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-0.5 h-4 bg-accent-primary ml-0.5" />}
                    </div>
                    <div className="px-5 py-2 rounded-lg text-xs font-medium bg-bg-elevated border border-border-subtle flex items-center justify-center transition-colors shadow-sm">
                        {stage === 1 ? <Check size={14} className="text-green-500" /> : '保存'}
                    </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-3">
                        <div className="text-xs bg-bg-input px-3 py-1.5 rounded-md flex items-center gap-2 border border-border-subtle shadow-sm">
                            {stage === 2 ? <RefreshCw size={12} className="text-blue-500 animate-spin" /> : stage > 2 ? <Check size={12} className="text-green-500" /> : <Play size={12} className="text-text-tertiary" />}
                            <span className={stage > 2 ? "text-green-500" : "text-text-primary"}>
                                {stage === 2 ? '测试中...' : stage > 2 ? '已连接' : '测试 API 密钥'}
                            </span>
                        </div>
                    </div>
                    <div className={`p-2 rounded-lg ${stage === 4 ? 'bg-red-500/20 text-red-500' : 'text-text-tertiary'} border border-transparent`}>
                        <Trash2 size={16} />
                    </div>
                </div>
            </div>

            {/* Animated Cursor */}
            <motion.div
                className="absolute w-5 h-5 z-20 drop-shadow-lg"
                animate={{
                    x: stage === 0 ? 0 : stage === 1 ? 140 : stage === 2 ? -80 : stage === 4 ? 170 : 170,
                    y: stage === 0 ? 20 : stage === 1 ? 20 : stage === 2 ? 65 : stage === 4 ? 65 : 65
                }}
                transition={{ duration: 0.5, ease: 'easeInOut' }}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="black" strokeWidth="1.5"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.42c.45 0 .67-.54.35-.85L6.35 3.35a.5.5 0 0 0-.85.35Z" /></svg>
            </motion.div>
        </div>
    );
};

// ----------------------
// Reusable Components
// ----------------------

interface AccordionSectionProps {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
}

const AccordionSection: React.FC<AccordionSectionProps> = ({ title, icon, children, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className={`border rounded-xl mb-4 overflow-hidden transition-all duration-200 bg-bg-card border-border-subtle shadow-sm`}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between p-4 transition-colors hover:bg-bg-item-surface group`}
            >
                <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-bg-item-surface border border-border-subtle group-hover:border-border-muted transition-colors text-text-secondary`}>
                        {icon}
                    </div>
                    <span className={`font-semibold text-sm text-text-primary`}>{title}</span>
                </div>
                {isOpen ? <ChevronDown className="w-5 h-5 text-text-tertiary" /> : <ChevronRight className="w-5 h-5 text-text-tertiary" />}
            </button>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                        <div className={`p-5 border-t border-border-subtle text-sm leading-relaxed text-text-secondary`}>
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const SetupGuide = () => {
    const cmd = getModifierSymbol('cmd');
    const shift = getModifierSymbol('shift');
    const steps = [
        {
            title: '授予权限',
            desc: isMac
                ? '在 macOS 隐私与安全性设置中为 CueUp 启用屏幕录制和辅助功能。'
                : '第一次开始会议时批准麦克风提示（设置 → 隐私 → 麦克风）。',
        },
        {
            title: '设置音频',
            desc: '打开设置 → 音频，优先选择 Local SenseVoice；需要云端中文转录或说话人分离时，选择 QCLOUD API 或 Doubao AUC。',
        },
        {
            title: '连接 AI 模型',
            desc: '打开设置 → AI 提供商，默认聊天模型是 Doubao；也可以配置 QCLOUD 或自定义端点。',
        },
        {
            title: '个性化（可选）',
            desc: '在启动器打开“档案智能”入口，上传简历和职位描述；在启动器打开“公司调研”运行独立公司情报调研；或选择适合你会议的模式。',
        },
    ];

    const readyTitle = '一切就绪';
    const readyDesc = '完成上面四个步骤即可开会。可随时用以下快捷键唤起 CueUp。';

    const hotkeys = [
        { label: '切换显示', kbd: `${cmd}H` },
        { label: '截图', kbd: `${cmd}${shift}H` },
        { label: '聊天', kbd: `${cmd}K` },
    ];

    return (
        <div className="mb-10">
            <div className="mb-7">
                <h3 className="text-[20px] font-bold text-text-primary tracking-tight leading-tight">快速开始</h3>
                <p className="text-[13px] text-text-tertiary mt-0.5">四个步骤即可上手 CueUp；其它设置可在对应设置页随时调整。</p>
            </div>

            <div>
                {steps.map((step, i) => {
                    const isLast = i === steps.length - 1;
                    return (
                        <div key={i} className="flex gap-4">
                            {/* Step indicator column */}
                            <div className="flex flex-col items-center shrink-0" style={{ width: 28 }}>
                                <div className="w-7 h-7 rounded-full bg-accent-primary flex items-center justify-center shrink-0">
                                    <span className="text-[11px] font-bold text-white leading-none">{i + 1}</span>
                                </div>
                                {!isLast && (
                                    <div className="w-px bg-border-subtle flex-1" style={{ minHeight: 32, marginTop: 5, marginBottom: 5 }} />
                                )}
                            </div>

                            {/* Content */}
                            <div className={`flex-1 min-w-0 ${isLast ? 'pb-4' : 'pb-6'}`} style={{ paddingTop: 3 }}>
                                <p className="text-[14px] font-semibold text-text-primary leading-snug">{step.title}</p>
                                {step.desc && (
                                    <p className="text-[13px] text-text-secondary leading-relaxed mt-0.5">{step.desc}</p>
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* Done state — visually a continuation of the timeline, not a 5th step */}
                <div className="flex gap-4">
                    <div className="flex flex-col items-center shrink-0" style={{ width: 28 }}>
                        <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" strokeWidth={2.5} />
                        </div>
                    </div>
                    <div className="flex-1 min-w-0 pb-0" style={{ paddingTop: 3 }}>
                        <p className="text-[14px] font-semibold text-text-primary leading-snug">{readyTitle}</p>
                        <p className="text-[13px] text-text-secondary leading-relaxed mt-0.5">{readyDesc}</p>
                        <div className="flex items-center gap-4 mt-3 flex-wrap">
                            {hotkeys.map((h, hi) => (
                                <React.Fragment key={h.kbd}>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[12px] text-text-secondary">{h.label}</span>
                                        <kbd className="font-mono text-[11px] font-semibold text-text-primary bg-bg-item-surface border border-border-subtle rounded-md px-1.5 py-0.5 leading-none">{h.kbd}</kbd>
                                    </div>
                                    {hi < hotkeys.length - 1 && <span className="text-border-subtle text-[12px] select-none">·</span>}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
export const HelpSettings: React.FC = () => {
    const { shortcuts } = useShortcuts();
    const isLight = useResolvedTheme() === 'light';

    // Kbd class applying theme variables natively
    const kbdClass = `px-1.5 py-0.5 rounded text-[10px] font-mono border inline-block bg-bg-item-surface border-border-subtle text-text-secondary shadow-sm`;

    return (
        <div className="w-full h-full flex flex-col animated fadeIn pb-10">
            <div className="mb-6 shrink-0">
                <h2 className={`text-2xl font-bold text-text-primary flex items-center gap-3`}>
                    <HelpCircle className="w-6 h-6 text-accent-primary" />
                    帮助与设置指南
                </h2>
                <p className={`text-sm text-text-secondary mt-3 max-w-2xl`}>
                    了解如何配置 CueUp 的权限、语音转写、AI 提供商、屏幕理解、会前准备、会议记录、模式和快捷键。
                </p>
            </div>

            <div data-help-scroll-content className="flex-1 space-y-2">

                <SetupGuide />

                <div className="h-10" />
                <div className="mb-4 flex items-center gap-2 border-b border-border-subtle pb-3">
                    <h3 className="text-[20px] font-bold text-text-primary tracking-tight leading-tight">帮助指南</h3>
                </div>

                <AccordionSection title="1. 应用权限设置" icon={<Monitor className="w-4 h-4" />}>
                    <div className="space-y-4">
                        <p>
                            {isMac
                                ? 'CueUp 优先在本地运行：本地 SenseVoice 转录、本地模型与本地存储默认启用。但你可以在“设置 → AI 提供商”和“设置 → 音频”中配置云端 LLM/STT，并在数据范围允许时由 CueUp 按需走云端路径。它仍需要操作系统权限来访问屏幕内容和全局快捷键。你的系统设置应如下所示：'
                                : 'CueUp 优先在本地运行：本地 SenseVoice、转录与存储默认启用。配置云端 LLM/STT 后仍会按你的设置走云端路径。Windows 会在你第一次开始会议时提示麦克风权限——不需要其他操作系统权限。'}
                        </p>
                        {isMac && <MockPermissionsAnim />}
                        <div className="space-y-3 mt-4">
                            <h4 className="font-bold text-base text-text-primary border-b border-border-subtle pb-2">硬件与引擎配置</h4>

                            <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2`}>
                                <h5 className={`font-semibold text-[13px] text-text-primary flex items-center gap-2`}>
                                    <Mic size={14} className="text-blue-500" /> 麦克风与扬声器回环选择
                                </h5>
                                <p className="text-[11px] opacity-90 leading-relaxed text-text-secondary">
                                    CueUp 可以全局捕获你说的和听到的声音。在音频设置顶部，使用下拉菜单明确选择你的硬件输入（例如你的物理麦克风）和输出捕获（扬声器播放的内容）。默认情况下，CueUp 使用<strong>系统默认</strong>，音频路由会自动跟随系统的偏好设置。
                                </p>
                            </div>

                            {isMac && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2`}>
                                        <h5 className={`font-semibold text-[13px] text-text-primary flex items-center gap-2`}>
                                            <Monitor size={14} className="text-accent-primary" /> ScreenCaptureKit（SCK）
                                        </h5>
                                        <p className="text-[11px] opacity-90 leading-relaxed text-text-secondary">
                                            macOS 13.0+ 推荐的后端。使用 Apple 现代的、高度优化的内部框架，安全地实现零延迟回环扬声器捕获。
                                        </p>
                                    </div>
                                    <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2`}>
                                        <h5 className={`font-semibold text-[13px] text-text-primary flex items-center gap-2`}>
                                            <Volume2 size={14} className="text-orange-500" /> CoreAudio（旧版）
                                        </h5>
                                        <p className="text-[11px] opacity-90 leading-relaxed text-text-secondary">
                                            旧硬件的备用引擎。依赖内部设备聚合来捕获输出音频。仅在 SCK 反复丢失扬声器数据包时使用。
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2`}>
                                <h5 className={`font-semibold text-[13px] text-text-primary flex items-center gap-2`}>
                                    <Globe size={14} className="text-green-500" /> 语言与地区口音
                                </h5>
                                <p className="text-[11px] opacity-90 leading-relaxed text-text-secondary">
                                    在 <strong>设置 → 音频</strong> 标签下，你必须指定 <strong>语言</strong> 你将使用的语言（例如，中文）。最重要的是，确保选择你特定的地区 <span className={kbdClass}>口音/地区</span> 映射（例如， <em>en-US</em> vs <em>en-GB</em> vs <em>en-IN</em>），因为 STT 后端会根据此映射大幅提升基于地区变音的转录准确性。
                                </p>
                            </div>
                        </div>

                        {isMac ? (
                            <div className="flex flex-col gap-3 mt-6">
                                <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle`}>
                                    <h4 className={`font-semibold text-sm mb-2 text-text-primary flex items-center gap-2`}>
                                        <Monitor className="w-4 h-4 text-accent-primary" /> 屏幕录制
                                    </h4>
                                    <p className="text-xs opacity-90 mb-2">让 CueUp 在捕获上下文或执行截图提问时读取你的屏幕。</p>
                                    <p className="text-[11px] text-text-tertiary">系统设置 &gt; 隐私与安全性 &gt; 屏幕录制</p>
                                </div>

                                <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle`}>
                                    <h4 className={`font-semibold text-sm mb-2 text-text-primary flex items-center gap-2`}>
                                        <HelpCircle className="w-4 h-4 text-amber-500" /> 截图权限异常
                                    </h4>
                                    <p className="text-xs opacity-90 mb-2">如果系统阻止了屏幕或系统音频捕获，音频页会显示权限错误。点击“修复并重启”清理 macOS 权限缓存，然后按系统提示重新授权；如果修复失败，请在系统设置中手动重新授予权限。</p>
                                    <p className="text-[11px] text-text-tertiary">麦克风转写仍可继续，但恢复屏幕录制权限前可能无法捕获系统音频或截图。</p>
                                </div>

                                <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle`}>
                                    <h4 className={`font-semibold text-sm mb-2 text-text-primary flex items-center gap-2`}>
                                        <Command className="w-4 h-4 text-purple-500" /> 辅助功能
                                    </h4>
                                    <p className="text-xs opacity-90 mb-2">让 CueUp 能够检测下方的全局键盘快捷键，无论当前聚焦哪个窗口。</p>
                                    <p className="text-[11px] text-text-tertiary">系统设置 &gt; 隐私与安全性 &gt; 辅助功能</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3 mt-6">
                                <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle`}>
                                    <h4 className={`font-semibold text-sm mb-2 text-text-primary flex items-center gap-2`}>
                                        <Mic className="w-4 h-4 text-blue-500" /> 麦克风
                                    </h4>
                                    <p className="text-xs opacity-90 mb-2">用于捕获你在会议中说的话。Windows 会在你第一次开始会议时提示。</p>
                                    <p className="text-[11px] text-text-tertiary">设置 &gt; 隐私 &gt; 麦克风</p>
                                </div>
                            </div>
                        )}
                    </div>
                </AccordionSection>

                <AccordionSection title="2. 音频语音转文字提供商设置（麦克风）" icon={<Mic className="w-4 h-4" />}>
                    <div className="space-y-6">
                        <p>CueUp 的语音页现在以三条主路径为核心：本地 SenseVoice、QCLOUD API 和 Doubao AUC。Local SenseVoice 适合默认本地中文实时转录；QCLOUD API 和 Doubao AUC 适合需要云端中文优先识别、说话人分离或高级分句信息的会议。</p>

                        <MockProviderSelectionAnim />

                        <div className="space-y-4 pt-2">
                            <h4 className="font-bold text-lg text-text-primary border-b border-border-subtle pb-2">API 密钥与测试</h4>
                            <p className="text-xs text-text-secondary">强烈建议在进入正式会议前先测试连接。如果额度或权限异常，系统会显示成功的 ping 或明确的错误信息。</p>

                            <MockApiKeyFlowAnim />
                        </div>

                        <div className="space-y-3 pt-4">
                            <h4 className="font-bold text-lg text-text-primary border-b border-border-subtle pb-2">特定提供商设置</h4>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2">
                                <h5 className="font-semibold text-sm text-text-primary flex justify-between items-center">
                                    <span>1. Local SenseVoice</span>
                                </h5>
                                <p className="text-xs opacity-90 leading-relaxed text-text-secondary">
                                    推荐默认方案。模型在本机运行，中文优先，不把原始音频发送到云端。第一次使用前需要在本地模型面板下载 SenseVoice 模型；如果模型未安装，设置页会显示下载入口和状态。
                                </p>
                            </div>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2">
                                <h5 className="font-semibold text-sm text-text-primary flex justify-between items-center">
                                    <span>2. QCLOUD API</span>
                                </h5>
                                <p className="text-xs opacity-90 leading-relaxed text-text-secondary">
                                    使用同一把 QCLOUD key 同时支持 LLM 路由和语音转写。保存 key 后，语音提供商下拉会出现 <strong>QCLOUD API</strong>；它默认中文优先，支持说话人分离。Embedding 保持本地优先；本地向量模型不可用时，可使用 QCLOUD 或豆包 Embedding 云端回退。
                                </p>
                            </div>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2">
                                <h5 className="font-semibold text-sm text-text-primary flex justify-between items-center">
                                    <span>3. Doubao AUC</span>
                                    <button onClick={() => { (window as any).electronAPI?.openExternal('https://www.volcengine.com/docs/6561/1354869') }} className="text-accent-primary hover:underline text-[10px] flex items-center gap-1"><ExternalLink size={10} /> 链接</button>
                                </h5>
                                <p className="text-xs opacity-90 leading-relaxed text-text-secondary">
                                    高级云端语音通道。AUC BigModel 支持异步任务、说话人分离、分句信息和情绪信息；适合更长音频或需要更完整会议结构的场景。保存 Doubao 语音 key 后可在语音页选择 <strong>Doubao AUC</strong>。
                                </p>
                            </div>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2">
                                <h5 className="font-semibold text-sm text-text-primary">说话人分离</h5>
                                <p className="text-xs opacity-90 leading-relaxed text-text-secondary">
                                    语音页底部有 <strong>Speaker separation</strong> 开关。设置为 Auto 时，CueUp 会在支持的云端通道上启用说话人分离；本地 SenseVoice 不会假装提供该能力，界面会明确显示不可用状态。
                                </p>
                            </div>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2">
                                <h5 className="font-semibold text-sm text-text-primary">Local SenseVoice · 术语/热词纠错</h5>
                                <p className="text-xs opacity-90 leading-relaxed text-text-secondary">
                                    本地 SenseVoice 设置页支持按术语维护“规范词 + 变体”，例如把容易听错的客户名、产品代号统一替换为期望写法。每条术语可独立启用或停用，整体纠错开关关闭时所有条目不生效。修改并保存后从下一次转写会话开始生效，已经写出的旧转录不会被回填。
                                </p>
                            </div>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2">
                                <h5 className="font-semibold text-sm text-text-primary">Local Whisper · 麦克风与系统音频</h5>
                                <p className="text-xs opacity-90 leading-relaxed text-text-secondary">
                                    Local Whisper 是保留的兼容路径，不是当前默认的本地语音主力。已有 Whisper 配置时，仍可分别为麦克风通道和系统音频通道选择模型；选择语言后，CueUp 会自动判断模型是否兼容，必要时给出“将自动调整”的明确提示并落到实际支持的模型上，避免静默切换。新配置优先使用 Local SenseVoice。
                                </p>
                            </div>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2">
                                <h5 className="font-semibold text-sm text-text-primary">说话人验证 vs. 通用说话人分离</h5>
                                <p className="text-xs opacity-90 leading-relaxed text-text-secondary">
                                    语音页的 <strong>Speaker separation</strong> 只是把音频按声学特征切成不同说话人；<strong>我的声音</strong>（设置侧“说话人验证”标签）则会注册本机声纹，把识别出的“本人”发言打上 ME 标签，用于后续角色化记录。两者各司其职，没有覆盖关系。
                                </p>
                            </div>
                        </div>

                    </div>
                </AccordionSection>

                <AccordionSection title="3. AI 模型与提示词引擎" icon={<Key className="w-4 h-4" />}>
                    <div className="space-y-4">
                        <p className="text-sm">CueUp 使用大语言模型（LLM）来理解屏幕、转录、模式、参考资料和个人上下文。默认聊天模型是 Doubao Seed 2.0 Lite；你也可以在“设置 → AI 提供商”中切换到 QCLOUD API 或自定义端点。QCLOUD API 的密钥和连通性测试位于独立的“设置 → QCLOUD API”页。</p>

                        <div className="space-y-3 pt-2">
                            <h4 className="font-bold text-lg text-text-primary border-b border-border-subtle pb-2">1. 当前云端模型</h4>

                            <div className="p-3 rounded-xl border bg-bg-item-surface border-border-subtle hover:border-border-muted transition-colors">
                                <h5 className="font-semibold text-sm text-text-primary flex justify-between items-center mb-1">
                                    <span className="flex items-center gap-2">
                                        <img src={cueUpIcon} alt="Doubao" className="w-4 h-4 object-contain force-black-icon opacity-80" /> Doubao
                                    </span>
                                    <button onClick={() => { (window as any).electronAPI?.openExternal('https://console.volcengine.com/ark') }} className="text-accent-primary hover:underline text-[10px] flex items-center gap-1"><ExternalLink size={10} /> 获取密钥</button>
                                </h5>
                                <p className="text-[11px] opacity-80 mb-2">当前默认聊天模型是 <strong>Doubao Seed 2.0 Lite</strong>。适合中文优先的实时回答，也可填写 Doubao Embedding Endpoint ID 用于云端向量。</p>
                                <span className={kbdClass}>doubao-seed-2-0-lite-260215</span>
                            </div>

                            <div className="p-3 rounded-xl border bg-bg-item-surface border-border-subtle hover:border-border-muted transition-colors">
                                <h5 className="font-semibold text-sm text-text-primary flex justify-between items-center mb-1">
                                    <span className="flex items-center gap-2">
                                        <img src={cueUpIcon} alt="QCLOUD API" className="w-4 h-4 object-contain force-black-icon opacity-80" /> QCLOUD API
                                    </span>
                                </h5>
                                <p className="text-[11px] opacity-80 mb-2">一把 key 可用于 LLM 路由和可选语音转写。保存时如果当前仍是自动默认模型，CueUp 会把聊天默认切到 QCLOUD；如果你已手动选择模型，会先询问确认。</p>
                                <span className={kbdClass}>sk-...</span>
                            </div>

                            <div className="mt-2 bg-bg-item-surface p-4 rounded-xl border border-border-subtle shadow-sm flex gap-3">
                                <div className="w-8 h-8 rounded-lg bg-bg-elevated border border-border-subtle flex items-center justify-center shrink-0">
                                    <Zap className="w-4 h-4 text-accent-primary" />
                                </div>
                                <p className="text-[11px] text-text-secondary leading-relaxed mt-0.5">
                                    <strong className="text-text-primary font-bold">自动模型注册表同步：</strong> CueUp 会周期性同步已配置提供商的模型列表。新模型进入注册表后，会出现在对应提供商的下拉菜单中；如果同步失败，仍保留本地默认模型和已保存的手动选择。
                                </p>
                            </div>

                            <div className="p-4 mt-2 rounded-xl border border-border-subtle bg-bg-item-surface">
                                <h5 className="font-semibold text-[13px] text-text-primary mb-1">配置当前模型引擎</h5>
                                <p className="text-[11px] text-text-secondary leading-relaxed">
                                    在启动器界面（开始按钮上方）可以切换<strong>当前模型</strong>。这个选择决定实时回答、屏幕理解和动态动作语义判断优先使用哪条 LLM 路径。屏幕截图只会发送给具备视觉能力且数据范围允许的提供商；如果云端数据范围被关闭，CueUp 会回退到可用的本地路径或给出明确降级提示。
                                </p>
                            </div>
                        </div>

                        <div className="space-y-3 pt-4">
                            <h4 className="font-bold text-lg text-text-primary border-b border-border-subtle pb-2">2. 自定义提供商</h4>
                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-3">
                                <p className="text-xs opacity-90 leading-relaxed text-text-secondary">
                                    使用自定义提供商接入任何标准的外部 LLM 路由（例如 OpenRouter、LMStudio 或企业内部端点）。使用 cURL 命令模板创建新提供商。
                                </p>
                                <div className="bg-bg-input p-3 rounded-lg border border-border-subtle space-y-2">
                                    <div className="text-[11px] font-mono text-text-secondary">
                                        <div className="text-purple-400">curl</div> <span className="text-blue-400">https://openrouter.ai/api/v1/chat/completions</span> \
                                        <br />  -H <span className="text-green-400">"Authorization: Bearer YOUR_KEY"</span> \
                                        <br /> ...
                                    </div>
                                </div>
                                <div className="flex items-start gap-2 mt-2">
                                    <div className="w-5 h-5 rounded bg-orange-500/20 text-orange-500 flex items-center justify-center shrink-0 mt-0.5"><Zap size={10} /></div>
                                    <div className="text-xs text-text-secondary leading-relaxed">
                                        <strong>关键：响应路径。</strong> 你必须告诉 CueUp 如何解析返回的 JSON。深层嵌套的输出必须定义准确的路径数组。对于使用 Chat Completions 返回格式的端点，通常填写：<span className={kbdClass}>choices[0].message.content</span>。
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3 pt-4">
                            <h4 className="font-bold text-lg text-text-primary border-b border-border-subtle pb-2">云提供商数据范围</h4>
                            <p className="text-xs text-text-secondary leading-relaxed">
                                CueUp 把每一类用户数据抽象成独立的数据范围，让你能逐项决定是否允许云端提供商接收。当前共 6 项：
                                <strong className="text-text-primary">转写内容</strong>、<strong className="text-text-primary">截图</strong>、<strong className="text-text-primary">参考文件</strong>、<strong className="text-text-primary">画像历史</strong>、<strong className="text-text-primary">云端向量</strong>、<strong className="text-text-primary">会后总结</strong>。
                                关闭某一项后，CueUp 会尽量使用本地路径或降级到不依赖该项的模型，但能否完全离线取决于当时可用的本地模型与通道——并非所有场景都能保证完全本地化。
                            </p>
                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2">
                                <h5 className="font-semibold text-[13px] text-text-primary">典型取舍</h5>
                                <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                    <li>关闭 <strong>截图</strong> 后，云端模型无法看到你的屏幕内容，但本地视觉模型仍可能可用；不存在视觉替代时会给出明确降级提示。</li>
                                    <li>关闭 <strong>转写内容</strong> 后，会议期间的实时上下文将不再发送给云端，依赖该数据的提示（例如会议追问）将受限制。</li>
                                    <li>关闭 <strong>云端向量</strong> 后，向量检索仍优先走本地 Embedding；只有显式选用云端 Embedding 时才会真正拦截。</li>
                                    <li>关闭 <strong>会后总结</strong> 后，本地规则提取仍会执行，但 LLM 增强的总结、行动项等会跳过云端路径或直接返回本地结果。</li>
                                </ul>
                            </div>
                        </div>

                    </div>
                </AccordionSection>

                <AccordionSection title="4. CueUp 界面操作" icon={<Monitor className="w-4 h-4" />}>
                    <div className="space-y-6">
                        <p className="text-[13px]">启动后，CueUp 会以视觉上隐藏但始终活跃的半透明覆盖层形式存在。这是你的指挥中心。</p>

                        <div className="relative w-full flex flex-col p-2 sm:p-5 bg-bg-main rounded-[26px] border border-border-subtle shadow-inner">
                            <MockAppInterface />
                            <MockPillControlsAnim />
                        </div>

                        {/* Quick Actions & Hotkeys */}
                        <div className="mt-4 mb-3 flex items-center gap-3">
                            <div className="flex-1 h-px bg-border-subtle" />
                            <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">快速操作与快捷键</span>
                            <div className="flex-1 h-px bg-border-subtle" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {([
                                { Icon: Pencil, color: 'blue', title: '怎么回答？', badge: null, bc: '', shortcutKey: 'whatToAnswer' as const, desc: '读取当前转录内容和屏幕，然后流式生成精确的朗读回答。' },
                                { Icon: Lightbulb, color: 'violet', title: '头脑风暴', badge: '面试开启', bc: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', shortcutKey: 'brainstorm' as const, desc: '当面试模式开启时，回顾变为头脑风暴——深度多步策略。' },
                                { Icon: HelpCircle, color: 'teal', title: '跟进问题', badge: null, bc: '', shortcutKey: 'followUp' as const, desc: '建议下一个逻辑问题，让对话顺畅进行。' },
                                { Icon: Zap, color: 'emerald', title: '问 AI', badge: null, bc: '', shortcutKey: 'answer' as const, desc: '录制你的语音问题，立即触发 AI 查询；已附带截图时会一起发送。' },
                                { Icon: MessageSquare, color: 'indigo', title: '澄清', badge: null, bc: '', shortcutKey: 'clarify' as const, desc: '当话题不清楚时，从潜在音频中生成尖锐的探查问题。' },
                                { Icon: RefreshCw, color: 'amber', title: '回顾', badge: '面试关闭', bc: 'bg-red-500/10 text-red-400 border-red-500/30', shortcutKey: 'recap' as const, desc: '当你跟不上时，将最近一段对话浓缩为要点。' },
                                { Icon: Sparkles, color: 'sky', title: '代码提示', badge: null, bc: '', shortcutKey: 'codeHint' as const, desc: '读取你的屏幕，引导你走向正确的代码实现。' },
                                { Icon: Monitor, color: 'rose', title: '截图提问', badge: null, bc: '', shortcutKey: 'takeScreenshot' as const, desc: '强制全屏截图并立即通过大语言模型处理。' },
                                { Icon: EyeOff, color: 'slate', title: '隐形执行', badge: null, bc: '', shortcutKey: 'processScreenshots' as const, desc: '在后台处理内容，从不显示界面。' },
                            ] as Array<{ Icon: React.ElementType; color: 'blue' | 'violet' | 'teal' | 'emerald' | 'indigo' | 'amber' | 'sky' | 'rose' | 'slate'; title: string; badge: string | null; bc: string; shortcutKey: keyof ShortcutConfig; desc: string }>).map(({ Icon, color, title, badge, bc, shortcutKey, desc }) => {
                                const rawKbd = shortcuts[shortcutKey];
                                const hasShortcut = Array.isArray(rawKbd) && rawKbd.length > 0;
                                const resolvedKbd = hasShortcut ? rawKbd.map(k =>
                                    k === '⌘' ? getModifierSymbol('cmd')
                                  : k === '⇧' ? getModifierSymbol('shift')
                                  : k === '⌥' ? getModifierSymbol('option')
                                  : k
                                ) : [];
                                const t = {
                                    blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(59,130,246,0.2),0_4px_12px_rgba(59,130,246,0.07)]' },
                                    violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(139,92,246,0.2),0_4px_12px_rgba(139,92,246,0.07)]' },
                                    teal: { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(20,184,166,0.2),0_4px_12px_rgba(20,184,166,0.07)]' },
                                    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(16,185,129,0.2),0_4px_12px_rgba(16,185,129,0.07)]' },
                                    indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(99,102,241,0.2),0_4px_12px_rgba(99,102,241,0.07)]' },
                                    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_4px_12px_rgba(245,158,11,0.07)]' },
                                    sky: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(14,165,233,0.2),0_4px_12px_rgba(14,165,233,0.07)]' },
                                    rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(244,63,94,0.2),0_4px_12px_rgba(244,63,94,0.07)]' },
                                    slate: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(100,116,139,0.2),0_4px_12px_rgba(100,116,139,0.07)]' },
                                }[color];

                                return (
                                    <div key={title} className={`group flex flex-col gap-1.5 p-3 rounded-xl border border-border-subtle bg-bg-item-surface hover:bg-bg-elevated transition-all duration-200 cursor-default ${t.glow}`}>

                                        {/* Line 1 — Icon + Name */}
                                        <div className="flex items-center gap-2">
                                            <div className={`w-5 h-5 rounded-md ${t.bg} border ${t.border} flex items-center justify-center shrink-0`}>
                                                <Icon className={`w-3 h-3 ${t.text}`} strokeWidth={2.5} />
                                            </div>
                                            <span className="text-[12px] font-bold text-text-primary tracking-tight leading-none truncate">{title}</span>
                                        </div>

                                        {/* Line 2 — Interview mode badge */}
                                        <div className="flex items-center">
                                            {badge ? (
                                                <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-[2px] border rounded leading-none ${bc}`}>{badge}</span>
                                            ) : (
                                                <span className="text-[9px] font-bold text-text-tertiary/50 uppercase tracking-wider leading-none">始终活跃</span>
                                            )}
                                        </div>

                                        {/* Line 3 — Shortcut */}
                                        <div className="flex items-center gap-1 min-h-[18px]">
                                            {hasShortcut ? (
                                                resolvedKbd.map((key, i) => (
                                                    <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-mono inline-block bg-bg-elevated text-text-secondary">{key}</span>
                                                ))
                                            ) : (
                                                <span className="text-[10px] text-text-tertiary/70 font-medium">未设置</span>
                                            )}
                                        </div>

                                        {/* Divider */}
                                        <div className="h-px bg-gradient-to-r from-transparent via-border-subtle to-transparent" />

                                        {/* Description */}
                                        <p className="text-[11px] text-text-secondary leading-[1.5]">{desc}</p>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="border-t border-border-subtle pt-6">
                            <h4 className="font-bold text-sm text-text-primary flex items-center gap-2 mb-3">
                                <Zap className="w-4 h-4 text-accent-primary" /> 动态动作卡片
                            </h4>
                            <p className="text-[12px] text-text-secondary leading-relaxed">
                                除了上面手动触发的快捷操作，CueUp 还会基于当前会议信号、可信证据和所选模式，主动在界面右侧弹出动态动作卡片。出现时机由后端事件流决定，不会和任何用户设置开关重复。
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl">
                                    <h5 className="font-semibold text-[12px] text-text-primary mb-1">可能的输出形态</h5>
                                    <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                        <li>直接说出口的回答片段</li>
                                        <li>可勾选的验证检查清单</li>
                                        <li>邮件草稿（含报价/合同/案例请求等）</li>
                                        <li>行动项（含负责人与截止时间）</li>
                                        <li>决策记录（含依据）</li>
                                    </ul>
                                </div>
                                <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl">
                                    <h5 className="font-semibold text-[12px] text-text-primary mb-1">高置信度自动动作</h5>
                                    <p className="text-[11px] text-text-secondary leading-relaxed">
                                        符合自动执行条件且达到当前置信度阈值的卡片，会显示约 <strong>5 秒</strong> 的自动倒计时；倒计时归零后自动执行。按 <kbd className={kbdClass}>Tab</kbd> 可立即接受当前主卡片，无需等待倒计时。界面同一时间按优先级最多展示 <strong>3 张</strong> 卡片，超出后新的会替换旧的。
                                    </p>
                                </div>
                            </div>
                        </div>


                    </div>
                </AccordionSection>

                <AccordionSection title="5. AI 会前准备" icon={<Sparkles className="w-4 h-4" />}>
                    <div className="space-y-6">
                        <p className="text-[13px] leading-relaxed">
                            AI 会前准备用于在开会前明确会议背景、选择合适模式，并检查客户可能问我们的问题是否已有资料支持。在启动器点击 <strong>开始准备</strong> 会创建一条<strong>新的空白会议准备</strong>，不会自动打开上一次记录；历史草稿和已完成结果可从 <strong>最近准备</strong> 中打开。
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl">
                                <div className="mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-bold text-sky-500">1</div>
                                <h4 className="font-semibold text-sm text-text-primary">描述会议</h4>
                                <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
                                    输入或说出会议主题、客户、参会人、目标、议程和背景。语音服务返回临时识别结果时，文本会同步显示；停止后仍可编辑。AI 拆解缺失字段时会保留为空或标记待确认，不会凭空补全。
                                </p>
                            </div>
                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl">
                                <div className="mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/15 text-[11px] font-bold text-violet-500">2</div>
                                <h4 className="font-semibold text-sm text-text-primary">确认信息与模式</h4>
                                <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
                                    修正拆解结果后，让 AI 在 <strong>Sales、FDE、招聘或团队会议</strong> 中推荐一个主模式。可以不关联历史会议，也可以选择一场历史会议，用于整理上次讨论和待确认承诺。
                                </p>
                            </div>
                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl">
                                <div className="mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] font-bold text-emerald-500">3</div>
                                <h4 className="font-semibold text-sm text-text-primary">查看准备结果</h4>
                                <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
                                    查看已关联会议的摘要和承诺，以及<strong>对方参会者可能问我们的问题</strong>。系统会针对每个问题检查资料覆盖情况；你可以编辑、新增或删除问题，再决定是否补充资料。
                                </p>
                            </div>
                        </div>

                        <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                            <h4 className="font-semibold text-sm mb-3 text-text-primary flex items-center gap-2">
                                <FileText className="w-4 h-4 text-sky-500" /> 如何理解资料状态
                            </h4>
                            <ul className="text-[11px] text-text-secondary space-y-1.5 list-disc pl-4">
                                <li><strong>资料充分</strong>：检索资料支持回答，且存在可核对的引用来源。</li>
                                <li><strong>部分准备</strong>：已有证据支持一部分内容，但仍有明确缺口或适用边界。</li>
                                <li><strong>资料缺失</strong>：当前没有足够证据支持回答，需要补充相应资料。</li>
                                <li><strong>无需内部资料</strong>：回答只依赖已确认会议信息或历史／现场原文，不需要声明公司事实。</li>
                                <li><strong>检查失败</strong>：检索或 AI 校验发生技术错误，不代表资料充分或缺失；请稍后点击<strong>重新检查</strong>。</li>
                            </ul>
                            <p className="mt-3 text-[11px] leading-relaxed text-text-secondary">
                                点击 <strong>补充资料</strong> 可前往资料库；资料准备完成后返回当前问题并点击 <strong>重新检查</strong>。重新检查只更新所选问题，不会重新生成整份准备结果。
                            </p>
                        </div>

                        <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                            <h4 className="font-semibold text-sm mb-2 text-amber-500 flex items-center gap-2">
                                <Lightbulb className="w-4 h-4" /> 当前能力边界
                            </h4>
                            <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                <li><strong>公司调研只是跳转入口</strong>，不会自动把调研结果写入当前会议准备。</li>
                                <li>当前不会自动同步 CRM 或日历，也不会自动判定承诺已经兑现或资料已经组织审批。</li>
                                <li><strong>准备结果不会注入会议回答</strong>；点击“使用推荐模式开始会议”时，CueUp <strong>只应用已确认的推荐模式</strong>。</li>
                                <li>重要案例、价格、能力、合规和交付承诺仍应打开引用来源核对后再对外表达。</li>
                            </ul>
                        </div>
                    </div>
                </AccordionSection>

                <AccordionSection title="6. 会议智能" icon={<Calendar className="w-4 h-4" />}>
                    <div className="space-y-6">
                        <p className="text-[13px]">会话结束后，CueUp 会把会议保存到本地数据库，并生成包含转录、AI 用量和结构化摘要的会议详情。</p>

                        <MockMeetingInterfaceAnim />

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl shadow-sm hover:border-border-muted transition-colors group">
                                <h4 className="text-[14px] font-bold text-text-primary flex items-center gap-2 mb-2">
                                    <FileText className="w-4 h-4 text-blue-500 group-hover:scale-110 transition-transform" /> 摘要生成
                                </h4>
                                <p className="text-[12px] text-text-secondary leading-relaxed">
                                    会议一结束，CueUp 就会触发本地后台任务，把会议转录整理成格式化 Markdown，包含结构化概览和行动项。即使会后云端摘要失败，已保存的会议转录仍可在会议详情中查看。
                                </p>
                            </div>

                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl shadow-sm hover:border-border-muted transition-colors group">
                                <h4 className="text-[14px] font-bold text-text-primary flex items-center gap-2 mb-2">
                                    <Volume2 className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" /> 原始转录
                                </h4>
                                <p className="text-[12px] text-text-secondary leading-relaxed">
                                    深入精确的对话时间线。说话人分离尝试使用音量阈值区分"我"和"对方"，捕获所有实际说出的话及时间戳。
                                </p>
                            </div>

                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl shadow-sm hover:border-border-muted transition-colors group">
                                <h4 className="text-[14px] font-bold text-text-primary flex items-center gap-2 mb-2">
                                    <Cpu className="w-4 h-4 text-purple-500 group-hover:scale-110 transition-transform" /> 用量与存储
                                </h4>
                                <p className="text-[12px] text-text-secondary leading-relaxed">
                                    查看会议过程中 AI 全局消耗的 token 数量，区分视觉和文本输入分别统计。
                                </p>
                            </div>
                        </div>

                        <div className="border-t border-border-subtle pt-6">
                            <h4 className="font-bold text-sm text-text-primary flex items-center gap-2 mb-4">
                                <MessageSquare className="w-4 h-4 text-accent-primary" /> 会议内语义搜索
                            </h4>
                            <p className="text-[13px] mb-6">不用重新阅读整段转录来查找发生了什么，使用会议详情窗口底部的 RAG 检索界面即可。</p>

                            <MockMeetingChatAnim />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
                                <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl shadow-sm hover:border-border-muted transition-colors group">
                                    <h4 className="text-[14px] font-bold text-text-primary flex items-center gap-2 mb-2">
                                        <Search className="w-4 h-4 text-orange-500 group-hover:scale-110 transition-transform" /> 上下文语义搜索
                                    </h4>
                                    <p className="text-[12px] text-text-secondary leading-relaxed">
                                        你无需编写冗长的 AI 提示。只需问"他们列出了哪些 API 依赖？"，系统就会注入该特定时间线的局部转录内容，动态提供高度准确的回答。
                                    </p>
                                </div>

                                <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl shadow-sm hover:border-border-muted transition-colors group">
                                    <h4 className="text-[14px] font-bold text-text-primary flex items-center gap-2 mb-2">
                                        <Brain className="w-4 h-4 text-teal-500 group-hover:scale-110 transition-transform" /> 记忆隔离
                                    </h4>
                                    <p className="text-[12px] text-text-secondary leading-relaxed">
                                        这里的对话严格限定在所选会议范围内，不使用全局记忆，确保提取聚焦且不会跨会议串味。
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="border-t border-border-subtle pt-6">
                            <h4 className="font-bold text-sm text-text-primary flex items-center gap-2 mb-3">
                                <Sparkles className="w-4 h-4 text-accent-primary" /> 会后增强字段
                            </h4>
                            <p className="text-[12px] text-text-secondary leading-relaxed">
                                会议结束后，后端会基于会议内容和已接受的动态动作生成一组结构化的“会后增强”结果，遵循 <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-[11px] font-mono border border-border-subtle">schemaVersion: 2</code> 的事实。需要区分两层事实：哪些字段会写入会议详情（详情页可见）、哪些只是后端保存的内部结构化数据（当前不在详情页展示）。
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                <div className="p-3 bg-bg-item-surface border border-border-subtle rounded-xl">
                                    <h5 className="font-semibold text-[12px] text-text-primary mb-1">会议详情页可见</h5>
                                    <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                        <li>结构化行动项（任务、负责人、截止时间）</li>
                                        <li>会议决策</li>
                                        <li>会议中的开放问题</li>
                                        <li>会议辅导洞察</li>
                                        <li>跟进邮件/消息草稿</li>
                                    </ul>
                                </div>
                                <div className="p-3 bg-bg-item-surface border border-border-subtle rounded-xl">
                                    <h5 className="font-semibold text-[12px] text-text-primary mb-1">后端保存的内部结构化数据</h5>
                                    <p className="text-[11px] text-text-secondary leading-relaxed">
                                        阻塞项留底、能力匹配问答留底，以及 FDE（现场发现/集成/安全/风险/成功标准/下一步）和 Recruiting（候选人证据/追问/顾虑/岗位兴趣匹配）的模式专属留底都会作为 <code className="bg-bg-tertiary px-1 rounded text-[10px]">schemaVersion: 2</code> 的一部分保存到本地，但当前不在会议详情页渲染，未来版本可能接入更多视图。
                                    </p>
                                </div>
                            </div>
                            <p className="text-[11px] text-text-tertiary mt-3 leading-relaxed">
                                这些字段不是每次会议都会出现，也不是同一会议每次都会填满——只有当对应信号出现且被生成流程接受时才会写入。在会议详情看到的内容可直接对外使用前请人工复核。
                            </p>
                        </div>
                    </div>
                </AccordionSection>

                <AccordionSection title="7. 全局搜索与快捷键" icon={<Search className="w-4 h-4" />}>
                    <div className="space-y-6">
                        <p className="text-[13px]">按 <span className={kbdClass}>{isMac ? 'Cmd+K' : 'Ctrl+K'}</span> 在电脑任意位置唤出 CueUp 全局面板。这相当于你的 Spotlight 覆盖层，用于直接与系统核心交互。</p>

                        <MockSearchPillAnim />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 mb-4">
                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl shadow-sm hover:border-border-muted transition-colors group">
                                <h4 className="text-[14px] font-bold text-text-primary flex items-center gap-2 mb-2">
                                    <Briefcase className="w-4 h-4 text-sky-500 group-hover:scale-110 transition-transform" /> 即时会议跳转
                                </h4>
                                <p className="text-[12px] text-text-secondary leading-relaxed">
                                    输入至少两个字符即可在所有历史会议的标题、摘要和正文转录中进行全文检索；结果会按会议去重，并展示最相关的正文片段。点击结果可直接打开会议。
                                </p>
                            </div>

                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl shadow-sm hover:border-border-muted transition-colors group">
                                <h4 className="text-[14px] font-bold text-text-primary flex items-center gap-2 mb-2">
                                    <Sparkles className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" /> 对话式兜底
                                </h4>
                                <p className="text-[12px] text-text-secondary leading-relaxed">
                                    未选中具体会议时按回车，会进入“询问所有会议”的全局 AI 问答；输入过程中只做结构化全文检索，不会调用 LLM。检索服务不可用时会退回标题和摘要的本地匹配。
                                </p>
                            </div>
                        </div>

                        <div className="border-t border-border-subtle pt-6">
                            <h4 className="font-bold text-sm text-text-primary border-b border-border-subtle pb-1">全局系统快捷键</h4>
                            <p className="text-[11px] text-text-secondary mt-1 mb-3">这些快捷键在你的操作系统任意位置都能触发，无论 CueUp 是否处于焦点或完全隐藏。在"设置 &gt; 快捷键"中可以修改它们。</p>

                            <div className="grid gap-3">
                                <div className="flex items-center justify-between p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                    <div className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded shrink-0 bg-bg-input border border-border-subtle flex items-center justify-center mt-0.5">
                                            <Eye className="w-4 h-4 text-text-primary" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-sm text-text-primary">显示 / 隐藏界面</div>
                                            <div className="text-xs text-text-secondary mt-1">快速切换窗口可见性。需要紧急隐藏时立即可用。</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        {(shortcuts.toggleVisibility || [getModifierSymbol('cmd'), 'B']).map((key: string, i: number) => <span key={i} className={kbdClass}>{key}</span>)}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                    <div className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded shrink-0 bg-bg-input border border-border-subtle flex items-center justify-center mt-0.5">
                                            <Image className="w-4 h-4 text-text-primary" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-sm text-text-primary">捕获上下文截图</div>
                                            <div className="text-xs text-text-secondary mt-1">在后台静默截图，并把视觉内容送入受数据范围保护的 LLM 上下文流程。</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        {(shortcuts.takeScreenshot || [getModifierSymbol('cmd'), 'H']).map((key: string, i: number) => <span key={i} className={kbdClass}>{key}</span>)}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                    <div className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded shrink-0 bg-bg-input border border-border-subtle flex items-center justify-center mt-0.5">
                                            <MessageSquare className="w-4 h-4 text-text-primary" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-sm text-text-primary">处理已捕获的上下文（执行）</div>
                                            <div className="text-xs text-text-secondary mt-1">触发 CueUp 分析滚动缓冲区的截图和文本。</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        {(shortcuts.processScreenshots || [getModifierSymbol('cmd'), 'Enter']).map((key: string, i: number) => <span key={i} className={kbdClass}>{key}</span>)}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                    <div className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded shrink-0 bg-bg-input border border-border-subtle flex items-center justify-center mt-0.5">
                                            <Zap className="w-4 h-4 text-text-primary" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-sm text-text-primary">即时捕获并执行</div>
                                            <div className="text-xs text-text-secondary mt-1">一键完成截图捕获与处理。</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        {(shortcuts.captureAndProcess || [getModifierSymbol('cmd'), getModifierSymbol('shift'), 'Enter']).map((key: string, i: number) => <span key={i} className={kbdClass}>{key}</span>)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </AccordionSection>



                <AccordionSection title="8. 专业版智能" icon={<Star className="w-4 h-4" />}>
                    <div className="space-y-6">
                        {/* Profile */}
                        <div>
                            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl mb-4">
                                <h4 className="text-[13px] font-semibold text-amber-500 flex items-center gap-2 mb-1">
                                    <User size={14} /> 档案智能系统
                                </h4>
                                <p className="text-[11px] text-text-secondary leading-relaxed mb-0">
                                    档案智能会解析你的背景资料，并自动注入到所有查询中——你不必在每次输入提示时重复介绍自己，AI 会根据你的职位给出定制化的回复。
                                </p>
                            </div>

                            <div className="grid md:grid-cols-2 gap-3">
                                <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                                    <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                        <Globe className="w-4 h-4 text-blue-500" /> 核心优势
                                    </h4>
                                    <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                        <li><strong>零上下文准备：</strong> 模型自动继承你的技术栈、经验等信息。</li>
                                        <li><strong>简历解析：</strong> 上传 PDF 简历即可在本地完成信息提取。</li>
                                        <li><strong>全局开关：</strong> 通过星标按钮启用 <span className="text-amber-500 font-semibold">档案模式</span>。</li>
                                    </ul>
                                </div>

                                <div className="p-4 rounded-xl border bg-accent-primary/5 border-border-subtle">
                                    <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                        <CreditCard className="w-4 h-4 text-accent-primary" /> 功能说明
                                    </h4>
                                    <p className="text-[11px] text-text-secondary mb-2">
                                        Profile Intelligence 是 CueUp 的核心功能，所有用户均可免费使用。
                                    </p>
                                    <ol className="text-[11px] text-text-secondary space-y-1 list-decimal pl-4 mb-0">
                                        <li>上传你的简历 PDF，AI 将基于你的真实经历回答问题。</li>
                                        <li>上传职位描述（JD），AI 将针对该岗位进行精准回答。</li>
                                    </ol>
                                </div>
                            </div>
                        </div>

                        <div className="border-t border-border-subtle pt-5 mt-2">
                            <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl mb-4">
                                <h4 className="text-[13px] font-semibold text-purple-400 flex items-center gap-2 mb-1">
                                    <Briefcase size={14} /> 职位描述对齐
                                </h4>
                                <p className="text-[11px] text-text-secondary leading-relaxed mb-0">
                                    把目标<strong>职位描述 PDF</strong> 与你的简历一同上传。CueUp 会提取岗位名称、级别、公司和所需技术栈，然后在每次回复时都让回答贴合该岗位的具体要求——在终面环节保持对齐非常有帮助。
                                </p>
                            </div>

                            <div className="grid md:grid-cols-2 gap-3 mb-5">
                                <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                                    <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                        <Building2 className="w-4 h-4 text-purple-400" /> 公司情报
                                    </h4>
                                    <p className="text-[11px] text-text-secondary leading-relaxed">
                                        在启动器标题栏点击 <strong>公司调研</strong> 入口（独立公司情报调研面板），输入公司名称后点击 <strong>立即调研</strong>，CueUp 会按 6 个维度整理公司资料：经营实力、业务版图、战略动向、关键人画像、技术与资产现状、采购合规历史。同一公司短时间内重复研究时会优先复用缓存，需要时可用 <strong>强制刷新</strong> 重新拉取。当上游检索失败或被降级时，面板会显示明确的失败或 fallback 横幅，结果不会被静默替换为编造内容。
                                    </p>
                                </div>
                                <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                                    <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                        <DollarSign className="w-4 h-4 text-emerald-500" /> 谈判话术
                                    </h4>
                                    <p className="text-[11px] text-text-secondary leading-relaxed">
                                        根据当前 JD 的级别和你的背景生成<strong>量身定制的薪资谈判话术</strong>。在薪酬沟通过程中会有实时辅导内联展示。
                                    </p>
                                </div>
                            </div>

                            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl mb-4">
                                <h4 className="text-[13px] font-semibold text-emerald-500 flex items-center gap-2 mb-1">
                                    <FileText size={14} /> 自定义上下文
                                </h4>
                                <p className="text-[11px] text-text-secondary leading-relaxed mb-0">
                                    除了简历和 JD，你还可以在<strong>自定义上下文</strong>文本框中输入任意内容——销售数据、产品细节、LeetCode 解法、个人偏好。系统会以 <code className="bg-bg-elevated px-1 rounded text-[10px]">&lt;user_context&gt;</code> 块的形式注入到每一次 AI 调用中，覆盖所有模式和提供商。
                                </p>
                            </div>
                            <div className="grid md:grid-cols-2 gap-3">
                                <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                                    <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                        <Upload className="w-4 h-4 text-emerald-500" /> 使用方法
                                    </h4>
                                    <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                        <li>在启动器标题栏点击 <strong>档案智能</strong> 入口（独立面板）</li>
                                        <li>滚动到 <strong>自定义上下文</strong> 文本框</li>
                                        <li>直接输入任意内容 — 800 毫秒后自动保存</li>
                                        <li>最多 4,000 字符，带实时字数统计</li>
                                    </ul>
                                </div>
                                <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                                    <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                        <Sparkles className="w-4 h-4 text-amber-500" /> 这里写什么
                                    </h4>
                                    <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                        <li>你公司的产品详情或定价</li>
                                        <li>招聘候选人流程备注</li>
                                        <li>你偏好的 LeetCode / 数据结构与算法模式</li>
                                        <li>个人格式或风格偏好</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </AccordionSection>

                <AccordionSection title="9. 模式管理器" icon={<LayoutGrid className="w-4 h-4" />}>
                    <div className="space-y-6">
                        <p className="text-[13px]">模式让你为会话分配专门的 AI 角色。每个模式都有定制的系统提示词、个人上下文区域、参考文件和智能笔记模板分区——因此 CueUp 会根据你是在销售电话、编码面试还是团队站会中表现出不同的行为。</p>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {([
                                { name: 'General', desc: '默认通用模式，无特定主题时的兜底助手。' },
                                { name: 'Interview', desc: 'STAR 格式回答、行为故事、分步编码提示；覆盖数据结构与算法/系统设计推理。' },
                                { name: 'Sales', desc: '异议处理、发现性问题、产品推销框架。' },
                                { name: 'FDE', desc: '客户现场发现、多人会议事实捕捉、交付风险与下一步推进。' },
                                { name: 'Recruiting', desc: '候选人评估、职位描述交叉参考、结构化评估。' },
                                { name: 'Team Meet', desc: '行动项、公告、阻塞项、决策——自动提取。' },
                                { name: 'Looking for work', desc: '求职与面试准备，简历对齐、行为问题与谈判话术。' },
                                { name: 'Lecture', desc: '概念拆解、直觉优先的解释、公式笔记。' },
                            ] as Array<{ name: string; desc: string }>).map(({ name, desc }) => (
                                <div key={name} className="p-3 rounded-xl border bg-bg-item-surface border-border-subtle">
                                    <h5 className="font-semibold text-sm text-text-primary mb-1">{name}</h5>
                                    <p className="text-[11px] text-text-secondary leading-relaxed">{desc}</p>
                                </div>
                            ))}
                        </div>

                        <div className="space-y-3 pt-2 border-t border-border-subtle">
                            <h4 className="font-bold text-sm text-text-primary pt-4">如何使用模式</h4>
                            <div className="grid md:grid-cols-2 gap-3">
                                <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                                    <h4 className="font-semibold text-sm mb-2 text-text-primary">打开管理器</h4>
                                    <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                        <li>点击 <strong>网格图标</strong> 在启动器标题栏中</li>
                                        <li>也可以点击主界面工具栏中的网格图标</li>
                                        <li>管理器会显示内置模式、模板库和你创建的自定义模式</li>
                                    </ul>
                                </div>
                                <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                                    <h4 className="font-semibold text-sm mb-2 text-text-primary">激活模式</h4>
                                    <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                        <li>在左侧边栏选择任意模式</li>
                                        <li>点击 <strong>设为活跃</strong> 立即应用</li>
                                        <li>工具栏图标实时显示当前模式名称</li>
                                        <li>点击 <strong>停用</strong> 返回 General</li>
                                    </ul>
                                </div>
                                <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                                    <h4 className="font-semibold text-sm mb-2 text-text-primary">参考文件</h4>
                                    <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                        <li>每个模式可上传 PDF、DOCX、TXT、Markdown 等参考文件</li>
                                        <li>文件内容会作为实时上下文注入回答</li>
                                        <li>适合简历、产品资料、职位描述和项目背景</li>
                                        <li>单文件约 12k 字符，总量约 40k 字符</li>
                                    </ul>
                                </div>
                                <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                                    <h4 className="font-semibold text-sm mb-2 text-text-primary">自定义模式与模板</h4>
                                    <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                        <li>点击 <strong>+ 新建模式</strong> 创建空白模式</li>
                                        <li>浏览 <strong>模板库</strong> 选择预设角色</li>
                                        <li>编辑 <strong>实时提示词</strong> 后用行内保存按钮保存</li>
                                        <li>为每个模式定义 <strong>备注分区模板</strong>，控制会议记录格式</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                            <h4 className="text-[13px] font-semibold text-indigo-400 flex items-center gap-2 mb-1">
                                <Star size={14} /> 专家模式
                            </h4>
                            <p className="text-[11px] text-text-secondary leading-relaxed mb-0">
                                CueUp 提供 8 种专家模式：General、Sales、FDE、Recruiting、Team Meet、Looking for work、Technical Interview 和 Lecture。每个模式都有针对性的系统提示和笔记结构，帮助你在不同场景下获得最佳辅助。
                            </p>
                        </div>

                        <div className="border-t border-border-subtle pt-6">
                            <h4 className="font-bold text-sm text-text-primary flex items-center gap-2 mb-3">
                                <Lightbulb className="w-4 h-4 text-amber-500" /> 意图词（按模式编辑）
                            </h4>
                            <p className="text-[12px] text-text-secondary leading-relaxed">
                                每个模式允许你维护一组“意图词”，保存后会作为该模式下关键词意图识别的输入信号之一。多个词用英文逗号分隔；每组最多 2000 字符。
                            </p>
                            <p className="text-[12px] text-text-secondary leading-relaxed mt-2">
                                以下是常见用途示例，并不是固定的五个意图类型——具体可用标签由当前模式和代码侧分类器共同维护，例如 <code className="bg-bg-tertiary px-1 rounded text-[10px]">clarification</code>、<code className="bg-bg-tertiary px-1 rounded text-[10px]">follow_up</code>、<code className="bg-bg-tertiary px-1 rounded text-[10px]">capture_action</code>、<code className="bg-bg-tertiary px-1 rounded text-[10px]">capture_decision</code>、<code className="bg-bg-tertiary px-1 rounded text-[10px]">capture_risk</code> 等，以及销售、招聘、FDE 等模式专属意图。
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
                                {([
                                    { name: '澄清', desc: '当对方要求解释、澄清或说明时触发' },
                                    { name: '跟进', desc: '会议末尾或后续推进项' },
                                    { name: '行动项', desc: '需要落到负责人和截止时间的任务' },
                                    { name: '决策', desc: '会上确认的共识或拍板' },
                                    { name: '风险阻塞', desc: '依赖、卡点、延期、权限等信号' },
                                ] as Array<{ name: string; desc: string }>).map(({ name, desc }) => (
                                    <div key={name} className="p-3 rounded-xl border bg-bg-item-surface border-border-subtle">
                                        <h5 className="font-semibold text-[12px] text-text-primary mb-0.5">{name}</h5>
                                        <p className="text-[11px] text-text-secondary leading-relaxed">{desc}</p>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[11px] text-text-tertiary mt-3 leading-relaxed">
                                意图类型清单、意图到动作映射以及其它分类规则仍由应用代码统一维护，用户在模式设置中编辑的意图词只参与当前模式的关键词意图识别，不会自动改写上面这些代码侧规则。
                            </p>
                        </div>
                    </div>
                </AccordionSection>

                <AccordionSection title="10. 技能" icon={<Sparkles className="w-4 h-4" />}>
                    <div className="space-y-6">
                        <p className="text-[13px]">
                            技能是本地 <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-[12px] font-mono text-text-primary border border-border-subtle">SKILL.md</code> 指令包。CueUp 会随安装包预置常用技能，也允许你在技能文件夹里继续添加自己的技能。
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {([
                                { name: '客户谈判复盘', desc: '从客户沟通转写里提炼核心需求、顾虑、异议回应和下次跟进重点。' },
                                { name: '周例会/月度经营会', desc: '逐人整理上周完成、卡点、本周计划、支援请求和会上拍板事项。' },
                                { name: '招聘面试评估', desc: '整理候选人逐题回答、经验技能、亮点疑问、复试追问点和匹配度评分。' },
                                { name: '文本去 AI 味', desc: '把 AI 生成文本改得更自然、更具体，更像真人写出来的内容。' },
                            ] as Array<{ name: string; desc: string }>).map(({ name, desc }) => (
                                <div key={name} className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                                    <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-emerald-500" /> {name}
                                    </h4>
                                    <p className="text-[11px] text-text-secondary leading-relaxed">{desc}</p>
                                </div>
                            ))}
                        </div>

                        <div className="grid md:grid-cols-2 gap-3">
                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                                <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-blue-500" /> 从转录生成 Markdown
                                </h4>
                                <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                    <li>打开会议详情，切到 <strong>转录</strong> 标签。</li>
                                    <li>点击 <strong>用技能处理</strong>，选择一个技能。</li>
                                    <li>生成 Markdown 文件后，可以点击 <strong>打开文件</strong> 或 <strong>打开文件夹</strong>。</li>
                                </ul>
                            </div>
                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                                <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                    <Settings className="w-4 h-4 text-violet-500" /> 技能设置
                                </h4>
                                <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                    <li><strong>技能自动触发</strong> 会在输入中识别“润色一下”等明确请求。</li>
                                    <li><strong>转录监听</strong> 会根据会议转写判断是否建议临时激活技能。</li>
                                    <li><strong>技能文件夹</strong> 里每个子目录都需要包含一个 SKILL.md。</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </AccordionSection>

                <AccordionSection title="11. 窗口与通用设置" icon={<Monitor className="w-4 h-4" />}>
                    <div className="space-y-4">
                        <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                            <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                <Monitor className="w-4 h-4 text-accent-primary" /> 屏幕共享边界
                            </h4>
                            {isMac ? (
                                <p className="text-[11px] text-text-secondary leading-relaxed">
                                    在 <strong>macOS 15+</strong> 中使用腾讯会议、飞书会议时，请选择<strong>单个窗口共享</strong>。整屏共享可能包含 CueUp，系统内容保护无法保证排除会议浮窗。
                                </p>
                            ) : (
                                <p className="text-[11px] text-text-secondary leading-relaxed">
                                    在 <strong>Windows 11</strong> 中，CueUp 会通过系统内容保护尝试在整屏共享时排除会议浮窗；实际效果取决于会议软件是否使用 Windows 标准捕获接口。
                                </p>
                            )}
                        </div>

                        <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle">
                            <h4 className="font-semibold text-sm mb-2 text-text-primary">通用开关</h4>
                            <p className="text-[11px] text-text-secondary leading-relaxed">
                                通用设置还包括登录时打开 CueUp、不保存会议、显示面试官转录文本、自动滚动、主题、会议界面风格和 AI 响应语言。开启“不保存会议”后，会议结束时会丢弃转录、摘要和历史记录；主题与界面风格只影响外观，AI 响应语言控制建议和笔记的输出语言。应用版本区域可检查并安装更新。
                            </p>
                        </div>

                        <div className="grid gap-3">
                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                    <EyeOff className="w-4 h-4 text-text-secondary" /> 动态界面透明度
                                </h4>
                                <p className="text-xs text-text-secondary">
                                    把你的视觉占用降到接近零。进入通用设置面板，把 <strong>透明度滑块</strong> 往下拖，让界面在下层原生应用之上呈现完全透明的效果。
                                </p>
                            </div>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                    <Monitor className="w-4 h-4 text-text-secondary" /> 鼠标穿透模式
                                </h4>
                                <p className="text-[11px] text-text-secondary mb-2">
                                    想让 AI 提示与屏幕完全融为一体、又不阻挡你的点击？在界面切换菜单里启用 <strong>鼠标穿透</strong> 即可。
                                </p>
                                <div className="p-2 border border-orange-500/20 bg-orange-500/5 rounded-lg">
                                    <p className="text-[10px] text-orange-400 m-0">
                                        <strong>⚠️ Warning:</strong> 这将使 CueUp 覆盖层完全不可点击。你必须记住全局热键（例如 <strong>{isMac ? 'Cmd' : 'Ctrl'}+Shift+Arrows</strong> 来移动， <strong>{isMac ? 'Cmd' : 'Ctrl'}+B</strong> 来隐藏， <strong>{isMac ? 'Cmd' : 'Ctrl'}+1-7</strong> 来执行操作）以在此激活后控制应用。
                                    </p>
                                </div>
                            </div>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                    <Database className="w-4 h-4 text-text-secondary" /> 存储空间与调试支持
                                </h4>
                                <p className="text-[11px] text-text-secondary mb-2">
                                    通用设置中的“存储空间”会显示内置模型、已下载模型、应用缓存和旧版数据的占用，并列出经过安全检查后可释放的项目。删除已下载模型后，需要使用时可以重新下载；正在使用的模型或尚未完成迁移验证的数据不会被清理。
                                </p>
                                <p className="text-[11px] text-text-secondary">
                                    “详细调试日志”用于输出音频、语音转写和管线诊断信息；“导出质量报告”会生成最近 7 天的质量统计、遥测和调试日志支持包。排查问题时可先开启详细日志，完成后再关闭。
                                </p>
                            </div>
                        </div>
                    </div>
                </AccordionSection>

                <AccordionSection title="12. 资料库与业务系统知识源" icon={<Upload className="w-4 h-4" />}>
                    <div className="space-y-6">
                        <p className="text-[13px]">CueUp 在会议回答中可以直接引用两类外部资料：本地“资料库”和受控的“业务系统知识源”。两者都用于补充事实，但接入方式和能力范围不同。</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl">
                                <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-blue-500" /> 资料库（本地文件）
                                </h4>
                                <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                    <li>支持 <strong>PDF、DOCX、Markdown、TXT、PPTX</strong> 五种格式。</li>
                                    <li><strong>PPTX</strong> 需要先在“设置 → 语音”配置并选择 <strong>QCLOUD API</strong>，旧版 <code className="bg-bg-tertiary px-1 rounded text-[10px]">.ppt</code> 不支持。</li>
                                    <li>上传后资料会进入“加入索引队列”，处理完成变为“已索引”，失败会标记错误并可重试。</li>
                                    <li>当语义索引不可用（未配置 Embedding 或部分资料索引失败）时，CueUp 会退回<strong>关键词匹配</strong>，并在面板上以琥珀色横幅提示。</li>
                                    <li>已索引资料支持 <strong>重新索引</strong>（基于已提取文本重建）和 <strong>重新上传新文件</strong>，但不会回填历史会议结果。</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl">
                                <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                    <Database className="w-4 h-4 text-violet-500" /> 业务系统知识源
                                </h4>
                                <ul className="text-[11px] text-text-secondary space-y-1 list-disc pl-4">
                                    <li>支持连接 <strong>Windchill 知识源（PLM）</strong>、<strong>QMS 知识源</strong> 以及其它受控业务系统。</li>
                                    <li>认证方式支持 <strong>API Key</strong> 或 <strong>账号密码</strong>，凭据保存在本机凭据文件中；保存后设置面板不会回显已保存的 Key 或密码原文。</li>
                                    <li>当前仅用作<strong>只读查询</strong>：CueUp 只读取对方返回的字段用于检索与回答，不会写入、审批或代你承诺任何业务动作。</li>
                                    <li>写入、审批、业务承诺等动作始终需要人工在原系统里确认，不要让 AI 输出直接触发。</li>
                                    <li>认证失败时面板会提示“请检查 API Key 或账号密码”，可立即在设置里更新凭据。</li>
                                </ul>
                            </div>
                        </div>

                        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                            <h4 className="text-[13px] font-semibold text-amber-500 flex items-center gap-2 mb-1">
                                <Sparkles className="w-4 h-4" /> 引用边界
                            </h4>
                            <p className="text-[11px] text-text-secondary leading-relaxed mb-0">
                                两类资料都会以“检索到的片段”形式注入到回答上下文：仅达到当前检索门槛（相似度门槛）的片段会被加入，其余资料不会被强行引用；未达到门槛时 CueUp 可能退回通用上下文，按模型自身判断给出回答。涉及金额、合规、责任归属等重要结论，请在发送前打开对应原始资料核对，不要仅凭检索片段做对外承诺。检索是否开启、是否回退到关键词匹配，可在对应设置卡片顶部状态里查看。
                            </p>
                        </div>
                    </div>
                </AccordionSection>

            </div>
        </div>
    );
};
