import React, { useState, useEffect, useRef } from 'react';
import {
    X, RefreshCw, Upload, Briefcase, Trash2, Pencil, Check,
    Building2, Search, Sparkles, User, ArrowUpRight
} from 'lucide-react';
import { ProfileVisualizer } from './profile/ProfileVisualizer';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { motion, AnimatePresence } from 'framer-motion';
import { MasterProfileSection } from './profile/MasterProfileSection';
import { ScenarioSection } from './profile/ScenarioSection';

const spring = { type: "spring" as const, stiffness: 100, damping: 20 };

// ─── Profile Intelligence Apple-style CSS (mirrors ModesSettings GATE_CSS) ────
// Lives at module scope so it's not re-allocated on each render.
const PI_CSS = `
    .pi-root {
        --pi-hero: #ffffff;
        --pi-sub: rgba(255,255,255,0.55);
        --pi-sub-low: rgba(255,255,255,0.4);
        --pi-border: rgba(255,255,255,0.06);
        --pi-shell-bg: rgba(255,255,255,0.025);
        --pi-shell-border: rgba(255,255,255,0.05);
        --pi-shell-hover: rgba(255,255,255,0.09);
        --pi-core-bg1: rgba(255,255,255,0.045);
        --pi-core-bg2: rgba(255,255,255,0.01);
        --pi-core-shadow1: rgba(255,255,255,0.1);
        --pi-core-shadow2: rgba(255,255,255,0.04);
        --pi-cta-bg: #ffffff;
        --pi-cta-text: #0a0a0a;
        --pi-cta-ring: rgba(0,0,0,0.08);
        --pi-cta-shadow: 0 4px 14px rgba(0,0,0,0.28);
        --pi-noise: 0.035;
    }
    .pi-root[data-theme='light'] {
        --pi-hero: #1d1d1f;
        --pi-sub: #6e6e73;
        --pi-sub-low: #86868b;
        --pi-border: rgba(0,0,0,0.07);
        --pi-shell-bg: #f5f5f7;
        --pi-shell-border: rgba(0,0,0,0.05);
        --pi-shell-hover: rgba(0,0,0,0.1);
        --pi-core-bg1: #ffffff;
        --pi-core-bg2: #fdfdfd;
        --pi-core-shadow1: rgba(0,0,0,0.02);
        --pi-core-shadow2: #ffffff;
        --pi-cta-bg: #0a0a0a;
        --pi-cta-text: #ffffff;
        --pi-cta-ring: rgba(255,255,255,0.14);
        --pi-cta-shadow: 0 4px 14px rgba(0,0,0,0.12);
        --pi-noise: 0;
    }

    /* ── Premium Double-Bezel Bento (Doppelrand) ── */
    .pi-bento-shell {
        padding: 6px;
        background: var(--pi-shell-bg);
        border-radius: 28px;
        border: 1px solid var(--pi-shell-border);
        box-shadow: 0 6px 18px rgba(0,0,0,0.08);
        transition: border-color 320ms cubic-bezier(0.23, 1, 0.32, 1),
                    box-shadow 320ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .pi-bento-shell:hover {
        box-shadow: 0 14px 36px rgba(0,0,0,0.16);
        border-color: var(--pi-shell-hover);
    }
    .pi-bento-core {
        background-image: linear-gradient(135deg, var(--pi-core-bg1) 0%, var(--pi-core-bg2) 100%);
        box-shadow: inset 0 1px 1px var(--pi-core-shadow1),
                    inset 0 0 0 1px var(--pi-core-shadow2);
        border-radius: calc(28px - 6px);
        overflow: hidden;
        position: relative;
        height: 100%;
        width: 100%;
    }
    .pi-bento-core::after {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: var(--pi-noise);
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        z-index: 10;
        mix-blend-mode: overlay;
    }
    .pi-bento-content { position: relative; z-index: 1; height: 100%; }

    /* ── Button-in-Button CTA (Manage Pro / Unlock Pro) ── */
    .pi-cta-group {
        padding: 5px 5px 5px 18px;
        height: 40px;
        border-radius: 20px;
        background: var(--pi-cta-bg);
        color: var(--pi-cta-text);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
        border: none;
        cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center; gap: 10px;
        box-shadow: var(--pi-cta-shadow);
        transition: transform 220ms cubic-bezier(0.23, 1, 0.32, 1),
                    box-shadow 220ms ease;
        white-space: nowrap;
    }
    .pi-cta-group:hover {
        transform: scale(0.975);
        box-shadow: 0 8px 22px rgba(0,0,0,0.22);
    }
    .pi-cta-group:active { transform: scale(0.94); }
    .pi-cta-icon-ring {
        width: 30px; height: 30px;
        border-radius: 50%;
        background: var(--pi-cta-ring);
        display: flex; align-items: center; justify-content: center;
        transition: transform 320ms cubic-bezier(0.23, 1, 0.32, 1);
        flex-shrink: 0;
    }
    .pi-cta-group:hover .pi-cta-icon-ring {
        transform: translateX(2px) translateY(-1px) scale(1.06);
    }

    /* Trial variant retains violet without losing pill geometry */
    .pi-cta-group--trial {
        background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
        color: #ffffff;
        box-shadow: 0 4px 14px rgba(124,58,237,0.35);
    }
    .pi-cta-group--trial .pi-cta-icon-ring { background: rgba(255,255,255,0.18); }
    .pi-cta-group--trial:hover { box-shadow: 0 8px 22px rgba(124,58,237,0.45); }

    /* ── Yellow BETA pill ── */
    .pi-beta-badge {
        display: inline-flex; align-items: center; justify-content: center;
        height: 22px;
        padding: 0 10px;
        border-radius: 999px;
        background: #FACC15;
        color: #0a0a0a;
        font-size: 9.5px;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        line-height: 1;
        box-shadow: 0 1px 0 rgba(255,255,255,0.4) inset,
                    0 2px 6px rgba(250,204,21,0.35);
    }

    /* ── Subtle pill badges (plan / trial) ── */
    .pi-meta-badge {
        display: inline-flex; align-items: center;
        height: 22px;
        padding: 0 10px;
        border-radius: 999px;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        line-height: 1;
    }
    .pi-meta-badge--plan {
        background: var(--pi-shell-bg);
        color: var(--pi-hero);
        border: 1px solid var(--pi-shell-border);
    }
    .pi-meta-badge--trial {
        background: linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(124,58,237,0.14) 100%);
        color: #c4b5fd;
        border: 1px solid rgba(139,92,246,0.32);
    }
    .pi-root[data-theme='light'] .pi-meta-badge--trial { color: #6d28d9; }

    /* ── Long upload pill with internal indeterminate progress ── */
    .pi-upload-pill {
        position: relative;
        width: 100%;
        height: 48px;
        border-radius: 999px;
        padding: 5px 5px 5px 22px;
        background: var(--pi-cta-bg);
        color: var(--pi-cta-text);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
        border: none;
        cursor: pointer;
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        box-shadow: var(--pi-cta-shadow);
        overflow: hidden;
        transition: transform 220ms cubic-bezier(0.23, 1, 0.32, 1),
                    box-shadow 220ms ease,
                    background 200ms ease;
    }
    .pi-upload-pill:hover:not(:disabled) {
        transform: scale(0.985);
        box-shadow: 0 8px 22px rgba(0,0,0,0.22);
    }
    .pi-upload-pill:active:not(:disabled) { transform: scale(0.96); }
    .pi-upload-pill:disabled { cursor: progress; }

    .pi-upload-pill--secondary {
        background: var(--pi-shell-bg);
        color: var(--pi-hero);
        border: 1px solid var(--pi-shell-border);
        box-shadow: none;
    }
    .pi-upload-pill--secondary:hover:not(:disabled) {
        background: var(--pi-shell-hover);
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }

    /* Indeterminate sweep — fills the pill while work is in flight */
    .pi-upload-pill__fill {
        position: absolute;
        inset: 0;
        z-index: 0;
        overflow: hidden;
        border-radius: inherit;
    }
    .pi-upload-pill__fill::before {
        content: '';
        position: absolute;
        top: 0; bottom: 0;
        left: -45%;
        width: 45%;
        background: linear-gradient(90deg,
            transparent 0%,
            var(--pi-upload-sweep, rgba(0,0,0,0.18)) 50%,
            transparent 100%);
        animation: pi-upload-sweep 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    .pi-upload-pill__fill::after {
        content: '';
        position: absolute;
        inset: 0;
        background: var(--pi-upload-tint, transparent);
        opacity: 0.5;
    }
    /* Primary (dark bg in dark, white bg in light): subtle inverse sweep */
    .pi-root[data-theme='light'] .pi-upload-pill:not(.pi-upload-pill--secondary) {
        --pi-upload-sweep: rgba(255,255,255,0.22);
    }
    /* Accent tinting via data-accent */
    .pi-upload-pill[data-accent='blue'] {
        --pi-upload-sweep: rgba(59,130,246,0.45);
        --pi-upload-tint: rgba(59,130,246,0.08);
    }
    .pi-upload-pill[data-accent='emerald'] {
        --pi-upload-sweep: rgba(16,185,129,0.45);
        --pi-upload-tint: rgba(16,185,129,0.08);
    }

    @keyframes pi-upload-sweep {
        0%   { left: -45%; }
        100% { left: 100%; }
    }

    .pi-upload-pill__content {
        position: relative; z-index: 1;
        display: flex; align-items: center; gap: 10px;
        min-width: 0;
    }
    .pi-upload-pill__label {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pi-upload-pill__ring {
        position: relative; z-index: 1;
        width: 38px; height: 38px;
        border-radius: 50%;
        background: var(--pi-cta-ring);
        display: flex; align-items: center; justify-content: center;
        transition: transform 320ms cubic-bezier(0.23, 1, 0.32, 1);
        flex-shrink: 0;
    }
    .pi-upload-pill:hover:not(:disabled) .pi-upload-pill__ring {
        transform: translateX(2px) scale(1.05);
    }
    .pi-upload-pill--secondary .pi-upload-pill__ring {
        background: var(--pi-shell-bg);
        border: 1px solid var(--pi-shell-border);
    }
    .pi-upload-spinner { animation: pi-spin 0.9s linear infinite; }
    @keyframes pi-spin { to { transform: rotate(360deg); } }

    /* ── "Pro" badge shown next to upload card titles for Free Tier ── */
    .pi-upload-pill__pro-badge {
        display: inline-flex; align-items: center;
        height: 18px;
        padding: 0 7px;
        margin-left: 8px;
        border-radius: 999px;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        line-height: 1;
        background: linear-gradient(135deg, rgba(139,92,246,0.22) 0%, rgba(124,58,237,0.18) 100%);
        color: #c4b5fd;
        border: 1px solid rgba(139,92,246,0.36);
        vertical-align: middle;
    }
    .pi-root[data-theme='light'] .pi-upload-pill__pro-badge { color: #6d28d9; }

    /* ── Header close button (mirrors ModesSettings manager closeBtn — flat, no shadow) ── */
    .pi-close-btn {
        display: flex; align-items: center; justify-content: center;
        width: 36px; height: 36px; border-radius: 8px;
        background: transparent;
        color: var(--pi-sub-low);
        border: none;
        cursor: pointer;
        box-shadow: none;
        transition: color 150ms ease, transform 150ms ease;
    }
    .pi-close-btn:hover { color: var(--pi-hero); background: transparent; }
    .pi-close-btn:active { transform: scale(0.9); }
`;

const BezelCard = ({ children, className = "", delay = 0, style = {} }: any) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ ...spring, delay }}
            style={style}
            className={`pi-bento-shell ${className}`}
        >
            <div className="pi-bento-core bg-bg-item-surface">
                <div className="pi-bento-content">
                    {children}
                </div>
            </div>
        </motion.div>
    );
};

const MagneticButton = ({ children, onClick, disabled, className = "", primary = false, style }: any) => {
    return (
        <motion.button
            whileHover={!disabled ? { scale: 1.02, y: -1 } : {}}
            whileTap={!disabled ? { scale: 0.98 } : {}}
            transition={spring}
            onClick={onClick}
            disabled={disabled}
            style={style}
            className={`relative group px-6 py-3 text-[13px] tracking-tight font-bold rounded-full flex items-center justify-center gap-2 overflow-hidden ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className} ${primary ? 'bg-text-primary text-bg-main shadow-[0_10px_20px_-10px_rgba(0,0,0,0.2)]' : 'bg-bg-input text-text-primary hover:bg-bg-surface border border-border-subtle'}`}
        >
            {children}
            {primary && (
                <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/20 pointer-events-none" />
            )}
        </motion.button>
    );
};

export function ProfileIntelligenceSettings({ onClose }: { onClose: () => void }) {
    const hasProfileAccess = true;
    const isLight = useResolvedTheme() === 'light';

    // Profile Engine State
    const [profileStatus, setProfileStatus] = useState<{
        hasProfile: boolean;
        profileMode: boolean;
        name?: string;
        role?: string;
        totalExperienceYears?: number;
    }>({ hasProfile: false, profileMode: false });
    const [profileUploading, setProfileUploading] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [profileData, setProfileData] = useState<any>(null);
    const [jdUploading, setJdUploading] = useState(false);
    const [jdError, setJdError] = useState('');
    const [customNotes, setCustomNotes] = useState('');
    const [customNotesSaved, setCustomNotesSaved] = useState(false);
    const customNotesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [persona, setPersona] = useState('');
    const [personaSaved, setPersonaSaved] = useState(false);
    const personaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // Proactively load profile data
        window.electronAPI?.profileGetStatus?.().then(setProfileStatus).catch(() => { });
        window.electronAPI?.profileGetProfile?.().then((data: any) => {
            setProfileData(data);
        }).catch(() => { });
        window.electronAPI?.profileGetNotes?.().then((res: any) => {
            if (res?.success) setCustomNotes(res.content ?? '');
        }).catch(() => { });
    }, []);

    useEffect(() => {
        window.electronAPI?.profileGetPersona?.().then((res: any) => {
            if (res?.success) setPersona(res.content ?? '');
        }).catch(() => { });
    }, []);

    return (
        <div
            className="pi-root flex flex-col h-full bg-bg-main relative"
            data-theme={isLight ? 'light' : 'dark'}
            style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Geist", "Satoshi", system-ui, sans-serif', WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' as any }}
        >
            <style>{PI_CSS}</style>
            <motion.div
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ ...spring, delay: 0.1 }}
                className="flex items-center justify-between p-6 border-b border-white/5 bg-bg-surface/70 shrink-0 backdrop-blur-3xl sticky top-0 z-50"
            >
                <div className="flex items-center gap-5">
                    <div className="w-12 h-12 rounded-[1.25rem] bg-bg-input border border-border-subtle shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] flex items-center justify-center text-text-primary">
                        <User size={22} strokeWidth={2} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2.5 mb-1.5">
                            <h2 className="text-[22px] font-bold text-text-primary leading-none" style={{ letterSpacing: '-0.025em' }}>档案智能</h2>
                        </div>
                        <p className="text-[13px] text-text-secondary" style={{ letterSpacing: '-0.005em' }}>
                            管理 AI 在所有会议中可使用的身份、背景、场景资料和回答偏好
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={onClose}
                        className="pi-close-btn"
                        aria-label="关闭"
                    >
                        <X size={18} strokeWidth={2} />
                    </button>
                </div>
            </motion.div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto p-5 pb-12">
                    <div className="space-y-6">
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, ...spring }} className="mb-4 pt-2">
                            <h3 className="text-lg font-bold text-text-primary tracking-tight">启用状态</h3>
                            <p className="text-[13px] text-text-secondary mt-1">
                                先确认档案是否可用，再补充基础身份、资料来源和回答偏好。
                            </p>
                        </motion.div>

                                    <BezelCard delay={0.2}>
                                        <div className="flex flex-col justify-between min-h-[200px]">

                                            {/* Header */}
                                            <div className="p-5 pb-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 rounded-full bg-bg-input border border-border-subtle flex items-center justify-center text-text-primary shadow-sm hover:scale-105 transition-transform duration-300">
                                                            <span className="font-bold text-sm tracking-tight">
                                                                {profileData?.identity?.name ? profileData.identity.name.charAt(0).toUpperCase() : 'U'}
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <h4 className="text-sm font-bold text-text-primary tracking-tight">
                                                                {profileData?.identity?.name || '尚未建立档案'}
                                                            </h4>
                                                            <p className="text-xs text-text-secondary mt-0.5 tracking-wide">
                                                                {profileData?.identity?.email || '上传简历或填写基础身份后，AI 就能在会议中使用这些背景。'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-3">
                                                        {profileStatus.hasProfile && (
                                                            <button
                                                                onClick={async () => {
                                                                    if (!confirm('确定要删除已解析的专业形象吗？这将清除所有结构化时间线数据。')) return;
                                                                    try {
                                                                        await window.electronAPI?.profileDelete?.();
                                                                        setProfileStatus({ hasProfile: false, profileMode: false });
                                                                        setProfileData(null);
                                                                    } catch (e) { console.error('删除档案失败：', e); }
                                                                }}
                                                                className="text-[12px] font-medium text-text-tertiary hover:text-red-500 transition-colors px-3 py-1.5 rounded-full hover:bg-red-500/10"
                                                            >
                                                                断开连接
                                                            </button>
                                                        )}

                                                        {/* High-fidelity Toggle */}
                                                        <div className="flex items-center gap-2 bg-bg-input px-3 py-1.5 rounded-full border border-border-subtle">
                                                            <span className="text-xs font-medium text-text-secondary">在会议中使用档案智能</span>
                                                            <div
                                                                onClick={async () => {
                                                                    if (!profileStatus.hasProfile) return;
                                                                    const newState = !profileStatus.profileMode;
                                                                    try {
                                                                        await window.electronAPI?.profileSetMode?.(newState);
                                                                        setProfileStatus(prev => ({ ...prev, profileMode: newState }));
                                                                    } catch (e) {
                                                                        console.error('切换档案智能失败：', e);
                                                                    }
                                                                }}
                                                                className={`w-9 h-5 rounded-full relative transition-colors ${!profileStatus.hasProfile ? 'opacity-40 cursor-not-allowed bg-bg-toggle-switch' : profileStatus.profileMode ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                            >
                                                                <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-transform ${profileStatus.profileMode ? 'translate-x-4' : 'translate-x-0'}`} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Data Metrics & Extracted Skills */}
                                            <div className="p-5 pt-0 mt-auto">
                                                <div className="flex items-center justify-between bg-bg-input border border-border-subtle py-4 px-6 rounded-2xl shadow-sm">
                                                    <div className="flex flex-col items-center justify-center flex-1">
                                                        <span className="text-[20px] font-bold text-text-primary tracking-tight leading-none mb-1">{profileData?.experienceCount || 0}</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                                                            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">经验</span>
                                                        </div>
                                                    </div>

                                                    <div className="h-8 w-px bg-border-subtle/60" />

                                                    <div className="flex flex-col items-center justify-center flex-1">
                                                        <span className="text-[20px] font-bold text-text-primary tracking-tight leading-none mb-1">{profileData?.nodeCount || 0}</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]" />
                                                            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">节点</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {profileData?.skills && profileData.skills.length > 0 && (
                                                    <div className="mt-5">
                                                        <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide mb-2">
                                                            核心技能
                                                        </div>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {profileData.skills.slice(0, 15).map((skill: string, i: number) => (
                                                                <span key={i} className="text-[10px] font-medium text-text-secondary px-2 py-1 rounded-md border border-border-subtle bg-bg-input">
                                                                    {skill}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </BezelCard>

                        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, ...spring }} className="space-y-4">
                            <div>
                                <h3 className="text-lg font-bold text-text-primary tracking-tight">基础身份</h3>
                                <p className="text-[13px] text-text-secondary mt-1">
                                    AI 应该知道的长期背景，会在所有模式中作为档案上下文使用。
                                </p>
                            </div>
                            <MasterProfileSection />
                        </motion.div>

                                    <div className="pt-2">
                                        <h3 className="text-lg font-bold text-text-primary tracking-tight">资料来源</h3>
                                        <p className="text-[13px] text-text-secondary mt-1">
                                            上传简历、目标资料和场景档案，让 AI 有可引用的事实来源。
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <BezelCard delay={0.3}>
                                        <div className="transition-all h-full">
                                            <div className="p-5 flex flex-col gap-5 h-full">
                                                <div className="flex items-start gap-4 min-w-0">
                                                    <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0 mt-0.5 shadow-sm">
                                                        <Upload size={20} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <h4 className="text-[15px] font-bold text-text-primary mb-1 tracking-tight">
                                                            {profileStatus.hasProfile ? '替换简历或档案资料' : '上传简历或档案资料'}
                                                        </h4>
                                                        <p className="text-xs text-text-secondary leading-relaxed pr-2">
                                                            用于抽取经历、项目、技能和可复用背景。
                                                        </p>
                                                    </div>
                                                </div>

                                                <button
                                                    style={{ marginTop: 'auto' }}
                                                    onClick={async () => {
                                                        setProfileError('');
                                                        try {
                                                            const fileResult = await window.electronAPI?.profileSelectFile?.();
                                                            if (fileResult?.cancelled || !fileResult?.fileToken) return;

                                                            setProfileUploading(true);
                                                            const result = await window.electronAPI?.profileUploadResume?.(fileResult.fileToken);
                                                            if (result?.success) {
                                                                const status = await window.electronAPI?.profileGetStatus?.();
                                                                if (status) setProfileStatus(status);
                                                                const data = await window.electronAPI?.profileGetProfile?.();
                                                                if (data) setProfileData(data);
                                                            } else {
                                                                setProfileError(result?.error || '上传失败');
                                                            }
                                                        } catch (e: any) {
                                                            setProfileError(e.message || '上传失败');
                                                        } finally {
                                                            setProfileUploading(false);
                                                        }
                                                    }}
                                                    disabled={profileUploading}
                                                    className={`pi-upload-pill${profileStatus.hasProfile ? ' pi-upload-pill--secondary' : ''}`}
                                                    aria-busy={profileUploading}
                                                    aria-label={profileUploading ? '正在解析简历' : '选择简历文件'}
                                                >
                                                    {profileUploading && <span className="pi-upload-pill__fill" aria-hidden="true" />}
                                                    <span className="pi-upload-pill__content">
                                                        {profileUploading
                                                            ? <RefreshCw size={14} className="pi-upload-spinner" strokeWidth={2.5} />
                                                            : <Upload size={14} strokeWidth={2.5} />}
                                                        <span className="pi-upload-pill__label">
                                                            {profileUploading
                                                                ? '正在解析 · 处理结构语义…'
                                                                : profileStatus.hasProfile ? '替换简历文件' : '选择简历文件'}
                                                        </span>
                                                    </span>
                                                    <span className="pi-upload-pill__ring">
                                                        <ArrowUpRight size={14} strokeWidth={2.5} />
                                                    </span>
                                                </button>
                                            </div>

                                            {profileError && (
                                                <div className="px-5 pb-4">
                                                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-[11px] text-red-500 font-medium">
                                                        <X size={12} /> {profileError}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </BezelCard>

                                    <BezelCard delay={0.4}>
                                        <div className="transition-all h-full">
                                            <div className="p-5 flex flex-col gap-5 h-full">
                                                <div className="flex items-start gap-4 min-w-0">
                                                    <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0 mt-0.5 shadow-sm">
                                                        <Briefcase size={20} />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <h4 className="text-[15px] font-bold text-text-primary mb-1 tracking-tight">
                                                            {profileData?.hasActiveJD ? `${profileData.activeJD?.title} @ ${profileData.activeJD?.company}` : '上传职位描述'}
                                                        </h4>
                                                        {profileData?.hasActiveJD ? (
                                                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                                                                <span className="text-[9px] font-bold text-blue-500 px-1.5 py-0.5 bg-blue-500/10 rounded uppercase tracking-wide border border-blue-500/20">
                                                                    {profileData.activeJD?.level || 'mid'}-level
                                                                </span>
                                                                <div className="flex gap-1.5 flex-wrap">
                                                                    {profileData.activeJD?.technologies?.slice(0, 3).map((t: string, i: number) => (
                                                                        <span key={i} className="text-[10px] text-text-secondary">{t}</span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <p className="text-xs text-text-secondary leading-relaxed pr-2">
                                                                上传目标职位、目标客户或当前机会描述，用于调优相关回答；不是必填项。
                                                            </p>
                                                        )}
                                                    </div>
                                                    {profileData?.hasActiveJD && !jdUploading && (
                                                        <button
                                                            onClick={async () => {
                                                                await window.electronAPI?.profileDeleteJD?.();
                                                                const data = await window.electronAPI?.profileGetProfile?.();
                                                                if (data) setProfileData(data);
                                                            }}
                                                            className="shrink-0 mt-0.5 px-2.5 py-2 rounded-full text-xs text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-all border border-transparent hover:border-red-500/20"
                                                            aria-label="移除职位描述"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    )}
                                                </div>

                                                <button
                                                    style={{ marginTop: 'auto' }}
                                                    onClick={async () => {
                                                        setJdError('');
                                                        try {
                                                            const fileResult = await window.electronAPI?.profileSelectFile?.();
                                                            if (fileResult?.cancelled || !fileResult?.fileToken) return;

                                                            setJdUploading(true);
                                                            const result = await window.electronAPI?.profileUploadJD?.(fileResult.fileToken);
                                                            if (result?.success) {
                                                                const data = await window.electronAPI?.profileGetProfile?.();
                                                                if (data) setProfileData(data);
                                                            } else {
                                                                setJdError(result?.error || '职位描述上传失败');
                                                            }
                                                        } catch (e: any) {
                                                            setJdError(e.message || '职位描述上传失败');
                                                        } finally {
                                                            setJdUploading(false);
                                                        }
                                                    }}
                                                    disabled={jdUploading}
                                                    className={`pi-upload-pill${profileData?.hasActiveJD ? ' pi-upload-pill--secondary' : ''}`}
                                                    data-accent="blue"
                                                    aria-busy={jdUploading}
                                                    aria-label={jdUploading ? '正在解析职位描述' : (profileData?.hasActiveJD ? '替换职位描述' : '上传职位描述')}
                                                >
                                                    {jdUploading && <span className="pi-upload-pill__fill" aria-hidden="true" />}
                                                    <span className="pi-upload-pill__content">
                                                        {jdUploading
                                                            ? <RefreshCw size={14} className="pi-upload-spinner" strokeWidth={2.5} />
                                                            : <Briefcase size={14} strokeWidth={2.5} />}
                                                        <span className="pi-upload-pill__label">
                                                            {jdUploading
                                                                ? '正在解析 · 解码职位结构…'
                                                                : profileData?.hasActiveJD ? '替换职位描述' : '上传职位描述'}
                                                        </span>
                                                    </span>
                                                    <span className="pi-upload-pill__ring">
                                                        <ArrowUpRight size={14} strokeWidth={2.5} />
                                                    </span>
                                                </button>
                                            </div>

                                            {jdError && (
                                                <div className="px-5 pb-4">
                                                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-[11px] text-red-500 font-medium">
                                                        <X size={12} /> {jdError}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </BezelCard>
                                    </div>

                                    <ScenarioSection />

                                    <div className="pt-2">
                                        <h3 className="text-lg font-bold text-text-primary tracking-tight">回答偏好</h3>
                                        <p className="text-[13px] text-text-secondary mt-1">
                                            补充 AI 每次回答都应该遵守的背景、口径和表达方式。
                                        </p>
                                    </div>

                                    <BezelCard delay={0.3}>
                                            <div className="p-5">
                                                <div className="flex items-center gap-4 mb-4">
                                                    <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0">
                                                        <Pencil size={20} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="text-sm font-bold text-text-primary">补充背景</h4>
                                                            {customNotesSaved && (
                                                                <span className="text-[9px] font-bold text-emerald-500 px-1.5 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20 uppercase tracking-wide flex items-center gap-1">
                                                                    <Check size={8} /> 已保存
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] text-text-secondary mt-0.5">
                                                            添加 AI 需要长期记住的事实、偏好、边界和当前目标。
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="space-y-3">
                                                    <textarea
                                                        value={customNotes}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            if (val.length > 4000) return;
                                                            setCustomNotes(val);
                                                            setCustomNotesSaved(false);
                                                            if (customNotesDebounceRef.current) clearTimeout(customNotesDebounceRef.current);
                                                            customNotesDebounceRef.current = setTimeout(async () => {
                                                                try {
                                                                    await window.electronAPI?.profileSaveNotes?.(val);
                                                                    setCustomNotesSaved(true);
                                                                    setTimeout(() => setCustomNotesSaved(false), 2000);
                                                                } catch (_) {}
                                                            }, 800);
                                                        }}
                                                        placeholder={`示例：\n• Q4 ARR 为 210 万美元，同比增长 40% — 在讲述增长故事时使用\n• 使用 HashMap + 双向链表实现了 LRU Cache (LeetCode 146)，get/put 均为 O(1)\n• 我喜欢简洁直接的回答，不需要填充词\n• 我的目标底薪是 130 万人民币 — 不要低于 115 万`}
                                                        rows={6}
                                                        className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20 transition-all resize-none leading-relaxed"
                                                    />
                                                    <div className="flex items-center justify-between px-0.5">
                                                        <p className="text-[10px] text-text-tertiary">
                                                            自动保存 · 适用于所有模式和提供商
                                                        </p>
                                                        <span className={`text-[10px] tabular-nums ${customNotes.length > 3600 ? 'text-amber-500' : 'text-text-tertiary'}`}>
                                                            {customNotes.length}/4000
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </BezelCard>

                                    <BezelCard delay={0.35}>
                                            <div className="p-5">
                                                <div className="flex items-center gap-4 mb-4">
                                                    <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-accent-primary shrink-0">
                                                        <Sparkles size={20} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="text-sm font-bold text-text-primary">回答风格与角色</h4>
                                                            {personaSaved && (
                                                                <span className="text-[9px] font-bold text-emerald-500 px-1.5 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20 uppercase tracking-wide flex items-center gap-1">
                                                                    <Check size={8} /> 已更新
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] text-text-secondary mt-0.5">
                                                            设置 AI 的行为、语气和角色，适用于所有提供商。
                                                        </p>
                                                    </div>
                                                </div>
                                                <textarea
                                                    value={persona}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        if (val.length > 4000) return;
                                                        setPersona(val);
                                                        setPersonaSaved(false);
                                                        if (personaDebounceRef.current) clearTimeout(personaDebounceRef.current);
                                                        personaDebounceRef.current = setTimeout(async () => {
                                                            try {
                                                                const res = await window.electronAPI?.profileSavePersona?.(val);
                                                                if (res?.success) {
                                                                    setPersonaSaved(true);
                                                                    setTimeout(() => setPersonaSaved(false), 2000);
                                                                }
                                                            } catch (_) {}
                                                        }, 800);
                                                    }}
                                                    placeholder="示例：你是一位资深招聘经理。回答保持简洁，并在需要时提出一个针对性的跟进问题。"
                                                    rows={5}
                                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20 transition-all resize-none leading-relaxed"
                                                />
                                                <div className="flex items-center justify-between px-0.5 mt-3">
                                                    <p className="text-[10px] text-text-tertiary">
                                                        自动保存 · 作为用户提供的上下文处理
                                                    </p>
                                                    <span className={`text-[10px] tabular-nums ${persona.length > 3600 ? 'text-amber-500' : 'text-text-tertiary'}`}>
                                                        {persona.length}/4000
                                                    </span>
                                                </div>
                                            </div>
                                        </BezelCard>

                                    <div className="pt-4">
                                        <h3 className="text-lg font-bold text-text-primary tracking-tight">当前可用线索</h3>
                                        <p className="text-[13px] text-text-secondary mt-1">
                                            这里会显示 AI 当前能引用的身份、经验、技能、目标资料。
                                        </p>
                                        <div className="mt-4">
                                            <ProfileVisualizer profileData={profileData} />
                                        </div>
                                    </div>

                                    {profileData?.hasActiveJD && (
                                        <details className="rounded-lg border border-border-subtle bg-bg-surface/40 p-4">
                                            <summary className="cursor-pointer select-none text-sm font-bold text-text-primary">
                                                求职增强
                                                <span className="ml-2 text-[11px] font-normal text-text-secondary">
                                                    公司情报和薪资谈判只影响求职/招聘相关场景
                                                </span>
                                            </summary>
                                            <div className="mt-4 space-y-4">
                                    {profileData?.activeJD?.company && (
                                        <BezelCard delay={0.5}>
                                            <div className="p-5 flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-4 min-w-0">
                                                    <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-purple-500 shrink-0">
                                                        <Building2 size={20} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <h4 className="text-sm font-bold text-text-primary truncate">
                                                            公司情报：<span className="text-purple-400">{profileData.activeJD.company}</span>
                                                        </h4>
                                                        <p className="text-[11px] text-text-secondary mt-0.5">
                                                            查看经营、业务、战略、人员、基础设施和采购六个维度。
                                                        </p>
                                                    </div>
                                                </div>
                                                <MagneticButton
                                                    onClick={() => window.dispatchEvent(new CustomEvent(
                                                        'open-research-panel',
                                                        { detail: { companyName: profileData.activeJD.company } },
                                                    ))}
                                                >
                                                    <Search size={14} />
                                                    打开公司调研
                                                </MagneticButton>
                                            </div>
                                        </BezelCard>
                                    )}

                                            </div>
                                        </details>
                                    )}

                    </div>
                </div>
            </div>

        </div>
    );
}
