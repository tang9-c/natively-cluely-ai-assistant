// src/components/settings/ResearchTabBody.tsx
//
// Settings tab for the Research feature. Surfaces the Tavily API key
// management + cache controls so users can re-configure or reset state
// without leaving the Settings overlay.

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  FlaskConical,
  Info,
  Loader2,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';

export const ResearchTabBody: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<null | {
    valid: boolean;
    reason?: string;
    quotaLow?: boolean;
  }>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const isLight = useResolvedTheme() === 'light';

  useEffect(() => {
    window.electronAPI?.getStoredCredentials?.()
      .then((creds: any) => {
        if (creds?.hasTavilyKey) {
          setHasStoredKey(true);
        }
      })
      .catch(() => {});
  }, []);

  const handleTest = async () => {
    if (!apiKey.trim()) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const r = await window.electronAPI.testTavilyApiKey(apiKey);
      setTestResult(r);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setError('');
    setIsSaving(true);
    try {
      const result = await window.electronAPI.setTavilyApiKey(apiKey.trim());
      if (result && !result.success) {
        setError(result.error ?? '保存 API 密钥失败。');
      } else {
        setHasStoredKey(true);
        setApiKey('');
        setSaveStatus('已保存');
        setTimeout(() => setSaveStatus(null), 2000);
      }
    } catch (e: any) {
      setError(e?.message ?? '保存 API 密钥时发生意外错误。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm('确定要移除 Tavily API 密钥吗？')) return;
    try {
      const res = await window.electronAPI.setTavilyApiKey('');
      if (res && res.success) {
        setHasStoredKey(false);
        setApiKey('');
        setSaveStatus('已移除');
        setTimeout(() => setSaveStatus(null), 2000);
      } else {
        setError(res?.error ?? '移除 API 密钥失败');
      }
    } catch (e: any) {
      setError(e?.message ?? '移除密钥时出错');
    }
  };

  const handleClearCache = async () => {
    const r = await window.electronAPI.profileClearResearchCache();
    setSaveStatus(`已清除 ${r.deleted} 条缓存`);
    setTimeout(() => setSaveStatus(null), 2000);
  };

  const surfaceHover = isLight ? 'hover:bg-black/5' : 'hover:bg-white/5';

  return (
    <div className="space-y-5 animated fadeIn select-text pb-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-text-primary mb-1 flex items-center gap-2">
            <FlaskConical size={18} className="text-accent-primary" />
            调研
          </h3>
          <p className="text-xs text-text-secondary">
            配置实时网络搜索，让公司在调研时获取最新公开信息。
          </p>
        </div>
        {hasStoredKey && (
          <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20">
            <Check size={12} strokeWidth={3} />
            已连接
          </span>
        )}
      </div>

      {/* API Key card */}
      <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center shrink-0">
            <Search size={15} className="text-accent-primary" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-text-primary">Tavily API Key</h4>
            <p className="text-[11px] text-text-tertiary">
              为公司调研提供实时网络搜索能力
            </p>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-text-secondary uppercase tracking-wide mb-1.5">
            API 密钥
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setError('');
              setTestResult(null);
            }}
            placeholder={hasStoredKey ? '••••••••••••' : '输入 Tavily API 密钥 (tvly-...)'}
            className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSave}
            disabled={isSaving || !apiKey.trim()}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all duration-200 ${
              isSaving || !apiKey.trim()
                ? `${isLight ? 'bg-black/5' : 'bg-white/5'} text-text-tertiary cursor-not-allowed`
                : 'bg-accent-primary text-white hover:bg-accent-primary/90 active:scale-[0.96]'
            }`}
          >
            {isSaving ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                保存中…
              </>
            ) : (
              <>
                <Save size={13} />
                保存
              </>
            )}
          </button>

          <button
            onClick={handleTest}
            disabled={isTesting || !apiKey.trim()}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium border border-border-subtle transition-all duration-200 ${
              isTesting || !apiKey.trim()
                ? 'opacity-50 cursor-not-allowed'
                : `${surfaceHover} text-text-secondary hover:text-text-primary`
            }`}
          >
            {isTesting ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                测试中…
              </>
            ) : (
              <>
                <Search size={13} />
                测试连接
              </>
            )}
          </button>

          {hasStoredKey && (
            <button
              onClick={handleRemove}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-red-400 hover:bg-red-500/10 transition-all duration-200"
            >
              <Trash2 size={13} />
              移除
            </button>
          )}
        </div>

        <AnimatePresence mode="wait">
          {testResult && (
            <motion.div
              key="test-result"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs border ${
                testResult.valid
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/10 border-red-500/20 text-red-400'
              }`}
            >
              {testResult.valid ? <Check size={14} className="shrink-0 mt-0.5" /> : <X size={14} className="shrink-0 mt-0.5" />}
              <span>
                {testResult.valid
                  ? testResult.quotaLow
                    ? 'Key 有效，但额度已接近上限'
                    : 'Key 有效'
                  : testResult.reason ?? '验证失败'}
              </span>
            </motion.div>
          )}

          {error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs bg-red-500/10 border border-red-500/20 text-red-400"
            >
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}

          {saveStatus && (
            <motion.p
              key="save-status"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="text-xs text-text-tertiary"
            >
              {saveStatus}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="flex items-start gap-2.5 px-3.5 py-3 bg-bg-input rounded-xl border border-border-subtle">
          <Info className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
          <p className="text-xs text-text-secondary leading-relaxed">
            在{' '}
            <span
              className="text-accent-primary hover:text-accent-primary/80 underline underline-offset-2 cursor-pointer"
              onClick={() => window.electronAPI?.openExternal?.('https://app.tavily.com/home')}
            >
              app.tavily.com
            </span>{' '}
            获取免费 API 密钥。密钥以 <code className="text-accent-primary bg-accent-primary/10 px-1 py-0.5 rounded text-[10px]">tvly-</code> 开头。免费额度每月 1000 次。
          </p>
        </div>
      </div>

      {/* Cache card */}
      <div className="bg-bg-card rounded-xl border border-border-subtle p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center shrink-0">
                <FlaskConical size={15} className="text-accent-primary" />
              </div>
              <h4 className="text-sm font-semibold text-text-primary">缓存</h4>
            </div>
            <p className="text-xs text-text-secondary">
              同一公司 24h 内只生成一次 dossier。
            </p>
          </div>
          <button
            onClick={handleClearCache}
            className={`px-4 py-2 rounded-xl text-xs font-medium border border-border-subtle transition-all duration-200 ${surfaceHover} text-text-secondary hover:text-text-primary active:scale-[0.96] shrink-0`}
          >
            清除所有缓存
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResearchTabBody;
