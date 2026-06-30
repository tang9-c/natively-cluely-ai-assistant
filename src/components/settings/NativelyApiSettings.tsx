import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { NativelyLogoMark } from '../NativelyLogoMark';

// ─── Card wrapper ────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`bg-bg-item-surface rounded-2xl border border-border-subtle overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────
export const NativelyApiSettings: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const creds = await window.electronAPI.getStoredCredentials();
        if (creds.hasNativelyKey) {
          setApiKey('•'.repeat(24));
          setIsSaved(true);
        }
      } catch (e) {
        console.error('[NativelyApi]', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    if (!apiKey.trim() || apiKey.includes('•')) return;
    setIsSaving(true);
    setError(null);
    try {
      const r = await window.electronAPI.setNativelyApiKey(apiKey.trim());
      if (r.success) {
        setApiKey('•'.repeat(24));
        setIsSaved(true);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
        // @ts-ignore
        window.electronAPI?.setDefaultModel?.('natively').catch(console.error);
      } else {
        setError(r.error || '保存 QCLOUD key 失败');
      }
    } catch (e: any) {
      setError(e.message || '意外错误');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = () => {
    setApiKey('');
    setIsSaved(false);
    setError(null);
    window.electronAPI.setNativelyApiKey('').catch(() => {});
  };

  const isDirty = apiKey.length > 0 && !apiKey.includes('•') && !isSaved;

  return (
    <div className="space-y-4 animated fadeIn">
      {/* ── Page title ───────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-text-primary tracking-[-0.01em]">
            QCLOUD API
          </h3>
          <p className="text-[12px] text-text-tertiary mt-0.5 leading-snug">
            配置 QCLOUD key 后，默认聊天模型将切换到 QCLOUD。实时转录和向量模型保持本地优先。
          </p>
        </div>
        {!isLoading && isSaved && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
            <span className="text-[10px] font-semibold text-emerald-500 tracking-wide">
              已连接
            </span>
          </div>
        )}
      </div>

      {/* ── API Key card ─────────────────────────────────── */}
      <Card>
        {/* Card header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          {/* Tinted icon well — Apple style */}
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0">
            <NativelyLogoMark size={18} className="text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">QCLOUD key</p>
            <p className="text-[11px] text-text-tertiary leading-snug mt-0.5">
              保存后仅用于 QCLOUD LLM，实时转录和向量模型不会切换到远程服务。
            </p>
          </div>
        </div>

        {/* Hairline divider */}
        <div className="h-px bg-border-subtle mx-5" />

        {/* Body */}
        <div className="px-5 pt-4 pb-5 space-y-3">
          {/* Label row */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">
              QCLOUD key
            </span>
            {isSaved && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1 text-[11px] text-red-400/80 hover:text-red-400 transition-colors duration-150 cursor-pointer"
              >
                <Trash2 size={11} strokeWidth={2} />
                移除
              </button>
            )}
          </div>

          {/* Input — with inset shadow for Apple depth */}
          <input
            type="text"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setIsSaved(false);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder="请输入 QCLOUD key"
            spellCheck={false}
            autoComplete="off"
            className={`w-full bg-bg-input border rounded-xl px-3.5 py-2.5 text-[13px] font-mono text-text-primary
                            placeholder:text-text-tertiary/50 placeholder:font-sans placeholder:text-[13px]
                            shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]
                            focus:outline-none transition-all duration-150
                            ${
                              error
                                ? 'border-red-500/40 focus:border-red-500/60 focus:ring-1 focus:ring-red-500/20'
                                : 'border-border-subtle focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/15'
                            }`}
          />

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-500/8 border border-red-500/15 rounded-xl text-[12px] text-red-400">
              <AlertCircle size={13} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            className={`w-full py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150 select-none
                            ${
                              isSaving
                                ? 'bg-button-primary-disabled-bg border border-button-primary-disabled-border text-button-primary-disabled-text cursor-wait'
                                : justSaved
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-pointer'
                                  : !isDirty
                                    ? 'bg-button-primary-disabled-bg border border-button-primary-disabled-border text-button-primary-disabled-text cursor-default'
                                    : 'bg-button-primary-bg hover:bg-button-primary-hover text-white shadow-sm active:scale-[0.99] cursor-pointer'
                            }`}
          >
            {isSaving ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={13} className="animate-spin" />
                保存中...
              </span>
            ) : justSaved ? (
              <span className="flex items-center justify-center gap-2">
                <CheckCircle size={13} />
                已保存
              </span>
            ) : (
              '保存 key'
            )}
          </button>

          {/* Hint */}
          <p className="text-[11px] text-text-secondary leading-relaxed text-center">
            保存 QCLOUD key 后，聊天默认模型会自动切换为 QCLOUD API。
          </p>

          {/* T&C consent */}
          <p className="text-[10.5px] text-text-tertiary leading-relaxed text-center">
            STT 和 Embedding 不使用 QCLOUD，仍按当前本地优先配置运行。
          </p>
        </div>
      </Card>

      {/* ── How it works ─────────────────────────────────── */}
      <Card>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3.5">
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">
              使用方式
            </p>
          </div>
          <div className="space-y-3">
            {[
              { step: '1', text: '粘贴你的 QCLOUD key 并保存。' },
              { step: '2', text: '保存成功后，聊天默认模型会切换为 QCLOUD API。' },
              { step: '3', text: '实时转录和向量模型不使用 QCLOUD，继续保持本地优先。' },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-bg-input border border-border-subtle flex items-center justify-center text-[10px] font-bold text-text-tertiary shrink-0 mt-[1px]">
                  {step}
                </div>
                <p className="text-[12px] text-text-secondary leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
};
