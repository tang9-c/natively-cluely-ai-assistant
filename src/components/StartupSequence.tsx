import React from 'react';
import { motion } from 'framer-motion';
import celebFont from '../font/Masterfont - Celeb MF Medium.otf?url';
import celebLightFont from '../font/Masterfont - Celeb MF Light.otf?url';
import interFont from '../font/Inter-4.1/web/Inter-Medium.woff2?url';
import interLightFont from '../font/Inter-4.1/web/Inter-Light.woff2?url';

import heroVideo from '../assets/hero.webm';
import NativelyInterfaceCard from './NativelyInterfaceCard';

interface StartupSequenceProps {
    onComplete: () => void;
}

// ─── Design Tokens (Stitch Semantic System) ──────────────────────────────
const COLORS = {
    pureSurface: '#FFFFFF',
    charcoalInk: '#18181B',  // Primary Text
    mutedSteel: '#71717A',   // Secondary text
};

const FONTS = {
    display: "'Geist', ui-sans-serif, system-ui, sans-serif",
    celebMedium: "'Celeb MF Medium', 'Geist', ui-sans-serif, system-ui, sans-serif",
    celebLight: "'Celeb MF Light', 'Geist', ui-sans-serif, system-ui, sans-serif",
    interMedium: "'Inter Medium', 'Geist', ui-sans-serif, system-ui, sans-serif",
    interLight: "'Inter Light', 'Geist', ui-sans-serif, system-ui, sans-serif",
};

// Premium Spring Physics
const springEase = [0.23, 1, 0.32, 1] as [number, number, number, number];

const containerVariants = {
    hidden: {},
    visible: {
        transition: {
            staggerChildren: 0.1,
            delayChildren: 0.1,
        },
    },
};

const itemVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.8, ease: springEase },
    },
};

const TERMS_URL = 'https://github.com/tang9-c/natively-cluely-ai-assistant/blob/ci/intel-mac-workflow/termsandcondition.md';
const PRIVACY_URL = 'https://github.com/tang9-c/natively-cluely-ai-assistant/blob/ci/intel-mac-workflow/PRIVACY.md';

// ─── Components ───────────────────────────────────────────────────────────

const ProductHighlights: React.FC = () => (
    <div className="flex flex-wrap items-center justify-center gap-3 mb-10 translate-y-2 text-[#777b84] select-none">
        {['本地优先转写', '屏幕与上下文理解', '会议后记录与检索'].map((label) => (
            <div key={label} className="rounded-full border border-[#d8dbe2] bg-[#f8f9fb] px-4 py-2 text-[13px] font-medium">
                {label}
            </div>
        ))}
    </div>
);

// ─── Main Subsystem ───────────────────────────────────────────────────────
const StartupSequence: React.FC<StartupSequenceProps> = ({ onComplete }) => {
    return (
        <div
            className="fixed inset-0 z-[100] flex overflow-hidden lg:grid lg:grid-cols-[1fr_1fr]"
            style={{ fontFamily: "'Inter', sans-serif", backgroundColor: '#f3f3f4', color: '#2f2f34' }}
        >
            <style>{`
                @font-face {
                    font-family: 'Celeb MF Medium';
                    src: url('${celebFont}') format('opentype');
                    font-weight: 500;
                    font-style: normal;
                }
                @font-face {
                    font-family: 'Celeb MF Light';
                    src: url('${celebLightFont}') format('opentype');
                    font-weight: 300;
                    font-style: normal;
                }
                @font-face {
                    font-family: 'Inter Medium';
                    src: url('${interFont}') format('woff2');
                    font-weight: 500;
                    font-style: normal;
                }
                @font-face {
                    font-family: 'Inter Light';
                    src: url('${interLightFont}') format('woff2');
                    font-weight: 300;
                    font-style: normal;
                }
                * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
            `}</style>

            {/* ── LEFT PANEL: Editorial Welcome Structure ── */}
            <motion.div
                className="relative flex flex-col items-center justify-center w-full h-full p-12 bg-white"
                initial="hidden"
                animate="visible"
                variants={containerVariants}
            >
                <div className="flex flex-col items-center w-full mt-auto wrap" style={{ transform: 'translateY(-4px)' }}>
                    {/* Typography Architecture (High-Fidelity) */}
                    <motion.h1
                        variants={itemVariants}
                        className="text-[44px] font-semibold tracking-[-0.5px] text-center mb-3"
                        style={{
                            background: 'linear-gradient(180deg, #2f2f34 0%, #50505a 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            lineHeight: '1.2',
                            fontFamily: FONTS.interMedium,
                            fontWeight: 500
                        }}
                    >
                        欢迎使用 CueUp
                    </motion.h1>

                    <motion.p
                        variants={itemVariants}
                        className="text-[25px] text-center mb-12 text-[#a7a7ad]"
                        style={{ fontFamily: FONTS.celebLight, fontWeight: 300 }}
                    >
                        实时转写、屏幕理解和会议辅助
                    </motion.p>

                    {/* High-Fidelity "Continue" Button */}
                    <motion.div variants={itemVariants} className="w-full flex justify-center">
                        <motion.button
                            onClick={onComplete}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="relative w-full max-w-[320px] h-[64px] rounded-[20px] text-[20px] font-medium text-[#eef3ff] flex items-center justify-center cursor-pointer outline-none overflow-hidden"
                            style={{
                                background: 'linear-gradient(100deg, #5f7ee8 0%, #6f97ee 50%, #88b6f7 100%)',
                                boxShadow: '0 10px 24px rgba(80,110,255,0.22)',
                            }}
                        >
                            {/* Gloss (Very Subtle) */}
                            <span className="absolute inset-0 rounded-[20px] pointer-events-none" style={{
                                background: 'linear-gradient(to bottom, rgba(255,255,255,0.22), rgba(255,255,255,0.06) 35%, transparent 60%)'
                            }} />

                            <span className="relative z-10 flex items-center">
                                继续 <span className="ml-[10px] text-[22px] opacity-90">›</span>
                            </span>
                        </motion.button>
                    </motion.div>
                </div>

                {/* Footer Component */}
                <motion.div variants={itemVariants} className="mt-auto flex flex-col items-center w-full">
                    <p className="text-[12px] opacity-60 mb-6 text-center" style={{ color: '#a7a7ad' }}>
                        点击继续即表示你同意 CueUp 的{' '}
                        <span
                            onClick={() => (window.electronAPI as any)?.openExternal?.(TERMS_URL)}
                            className="font-semibold text-[#2f2f34] underline underline-offset-[3px] decoration-[#2f2f34]/30 hover:decoration-[#2f2f34]/70 cursor-pointer transition-colors"
                        >
                            服务条款
                        </span>
                        {' '}和{' '}
                        <span
                            onClick={() => (window.electronAPI as any)?.openExternal?.(PRIVACY_URL)}
                            className="font-semibold text-[#2f2f34] underline underline-offset-[3px] decoration-[#2f2f34]/30 hover:decoration-[#2f2f34]/70 cursor-pointer transition-colors"
                        >
                            隐私政策
                        </span>
                        .
                    </p>
                    <ProductHighlights />
                </motion.div>
            </motion.div>

            {/* ── RIGHT PANEL: Grid Background + Video Composition ── */}
            <div
                className="hidden lg:flex flex-col relative items-center justify-center overflow-hidden w-full h-full"
                style={{ backgroundColor: '#F0F2F6' }}
            >
                {/* 1. Subtle Grid Pattern */}
                <div
                    className="absolute inset-0 z-0 pointer-events-none"
                    style={{
                        backgroundImage: `
                            linear-gradient(to right, rgba(0,0,0,0.025) 1px, transparent 1px),
                            linear-gradient(to bottom, rgba(0,0,0,0.025) 1px, transparent 1px)
                        `,
                        backgroundSize: '48px 48px',
                        backgroundPosition: 'center center'
                    }}
                />

                {/* Optional radial fade on the grid to make center pop */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_50%,transparent_40%,#F0F2F6_100%)] z-0 pointer-events-none" />

                {/* 2. Content layers — stacked vertically, card overlaps video top */}
                <div className="relative z-10 w-full flex flex-col items-center justify-center px-8" style={{ paddingBottom: '80px' }}>

                    {/* A. NativelyInterfaceCard — slightly wider, on top */}
                    <motion.div
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3, duration: 1, ease: springEase }}
                        className="relative w-[95%] drop-shadow-[0_24px_48px_rgba(0,0,0,0.25)]"
                        style={{ zIndex: 2 }}
                    >
                        <NativelyInterfaceCard isStatic={true} isMobile={false} spreadHotkeys />
                    </motion.div>

                    {/* B. Hero Video — slightly narrower, below; negative margin to overlap under card */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15, duration: 1, ease: springEase }}
                        className="w-[92%] rounded-[14px] overflow-hidden shadow-[0_16px_40px_rgba(0,0,0,0.18)] ring-1 ring-black/5 -mt-[160px]"
                        style={{ aspectRatio: '16/9', zIndex: 1 }}
                    >
                        <video
                            src={heroVideo}
                            autoPlay
                            muted
                            loop
                            playsInline
                            className="w-full h-full object-cover bg-black"
                        />
                    </motion.div>

                </div>

                {/* 3. Bottom Tagline */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6, duration: 1, ease: springEase }}
                    className="absolute bottom-16 z-20 text-center px-12"
                >
                    <h2
                        className="text-[36px] font-medium leading-[1.25] tracking-tight"
                        style={{ color: COLORS.charcoalInk }}
                    >
                        实时会议助手，<br />
                        随时准备帮助
                    </h2>
                </motion.div>

            </div>
        </div>
    );
};

export default StartupSequence;
