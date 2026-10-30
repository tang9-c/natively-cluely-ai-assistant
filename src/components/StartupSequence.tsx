import React from 'react';
import { useReducedMotion } from 'framer-motion';
import heroVideo from '../assets/hero.webm';
import NativelyInterfaceCard from './NativelyInterfaceCard';
interface StartupSequenceProps { onComplete(): void; pending?: boolean; error?: string | null }
const TERMS_URL = 'https://github.com/tang9-c/natively-cluely-ai-assistant/blob/ci/intel-mac-workflow/termsandcondition.md';
const PRIVACY_URL = 'https://github.com/tang9-c/natively-cluely-ai-assistant/blob/ci/intel-mac-workflow/PRIVACY.md';
export default function StartupSequence({ onComplete, pending, error }: StartupSequenceProps) {
  const reducedMotion = useReducedMotion();
  return <div className="fixed inset-0 z-[100] grid min-h-0 bg-bg-primary text-text-primary lg:grid-cols-2 no-drag">
    <div className="flex min-h-0 flex-col overflow-y-auto px-7 py-6 sm:px-12 sm:py-8">
      <p className="font-celeb text-xl tracking-wide">CueUp</p>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-5">
        <p className="mb-3 text-xs text-text-secondary">欢迎使用 Feigenbaum CueUp</p>
        <h1 className="font-celeb-light text-3xl font-medium leading-tight tracking-tight sm:text-4xl">先完成初始设置<br className="hidden sm:block" />再开始第一场会议</h1>
        <p className="mt-4 text-sm leading-relaxed text-text-secondary">接下来配置声音和 AI，再开始会议。</p>
        <p className="mt-3 text-xs text-text-secondary">权限与设备 · 语音识别 · AI 服务</p>
        {error && <p role="alert" className="mt-3 text-sm text-status-error">{error}</p>}
        <button disabled={pending} onClick={onComplete} className="mt-6 w-full rounded-xl bg-button-primary-bg hover:bg-button-primary-hover disabled:bg-button-primary-disabled-bg disabled:text-button-primary-disabled-text px-6 py-3.5 text-sm font-semibold text-button-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary disabled:opacity-100">
          {pending ? '正在读取…' : '开始设置'}
        </button>
      </main>
      <footer className="shrink-0 text-center text-[11px] leading-relaxed text-text-secondary">
        点击开始设置即表示你同意 CueUp 的{' '}
        <button onClick={() => void window.electronAPI?.openExternal?.(TERMS_URL)} className="underline underline-offset-4 focus-visible:outline">服务条款</button> 和{' '}
        <button onClick={() => void window.electronAPI?.openExternal?.(PRIVACY_URL)} className="underline underline-offset-4 focus-visible:outline">隐私政策</button>
      </footer>
    </div>
    <div className="relative hidden min-h-0 items-center justify-center overflow-hidden border-l border-border-subtle bg-bg-elevated lg:flex">
      {!reducedMotion && <video className="absolute inset-0 h-full w-full object-cover opacity-30" src={heroVideo} muted loop playsInline autoPlay aria-hidden="true" />}
      <div className="relative w-full max-w-lg px-10"><NativelyInterfaceCard />
        <div className="mt-8 flex flex-wrap justify-center gap-3 text-xs text-text-secondary">{['本地优先转写', '屏幕与上下文理解', '会议后记录与检索'].map(label => <span key={label} className="rounded-full border border-border-muted bg-bg-primary/80 px-3 py-2">{label}</span>)}</div>
      </div>
    </div>
  </div>;
}
