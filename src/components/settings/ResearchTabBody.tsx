// src/components/settings/ResearchTabBody.tsx
//
// Settings tab for the Research feature. Surfaces the Tavily API key
// management + cache controls so users can re-configure or reset state
// without leaving the Settings overlay.

import { useEffect, useState } from 'react';
import { Info, Trash2 } from 'lucide-react';

export function ResearchTabBody() {
  const [apiKey, setApiKey] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<null | {
    valid: boolean; reason?: string; quotaLow?: boolean;
  }>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

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
    const r = await window.electronAPI.testTavilyApiKey(apiKey);
    setTestResult(r);
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

  return (
    <div className="space-y-6 p-6 max-w-xl">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-base font-semibold">Tavily API Key</h3>
          {hasStoredKey && (
            <span className="text-[10px] font-bold text-emerald-500 px-1.5 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20">
              已连接
            </span>
          )}
        </div>
        <p className="text-sm text-text-muted mb-3">
          为公司调研提供实时网络搜索能力。如未提供，将使用大语言模型的一般知识进行公司调研，信息可能已过时。
        </p>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); setError(''); }}
          placeholder={hasStoredKey ? '••••••••••••' : '输入 Tavily API 密钥 (tvly-...)'}
          className="w-full px-3 py-2 rounded border border-border bg-bg-secondary"
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleSave}
            disabled={isSaving || !apiKey.trim()}
            className="px-4 py-2 rounded bg-accent-primary text-white disabled:opacity-50"
          >
            {isSaving ? '保存中…' : '保存'}
          </button>
          <button
            onClick={handleTest}
            disabled={!apiKey}
            className="px-4 py-2 rounded border disabled:opacity-50"
          >
            测试连接
          </button>
          {hasStoredKey && (
            <button
              onClick={handleRemove}
              className="px-4 py-2 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 inline-flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              移除
            </button>
          )}
        </div>
        {testResult && (
          <p className={`mt-2 text-sm ${testResult.valid ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.valid
              ? (testResult.quotaLow ? '✓ Key 有效，但额度已接近上限' : '✓ Key 有效')
              : `✗ ${testResult.reason ?? '验证失败'}`}
          </p>
        )}
        {error && (
          <p className="mt-2 text-sm text-red-400">{error}</p>
        )}
        {saveStatus && <p className="mt-2 text-sm text-text-muted">{saveStatus}</p>}

        <div className="mt-4 flex items-start gap-2 px-3 py-2.5 bg-bg-secondary rounded-lg border border-border">
          <Info className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
          <p className="text-xs text-text-muted leading-relaxed">
            在{' '}
            <span
              className="text-emerald-500/80 hover:text-emerald-400 underline underline-offset-2 cursor-pointer"
              onClick={() => window.electronAPI?.openExternal?.('https://app.tavily.com/home')}
            >
              app.tavily.com
            </span>{' '}
            获取免费 API 密钥。密钥以 <code className="text-emerald-500/80">tvly-</code> 开头。免费额度每月 1000 次。
          </p>
        </div>
      </div>

      <div className="border-t border-border pt-6">
        <h3 className="text-base font-semibold mb-2">缓存</h3>
        <p className="text-sm text-text-muted mb-3">
          同一公司 24h 内只生成一次 dossier。
        </p>
        <button onClick={handleClearCache} className="px-4 py-2 rounded border">
          清除所有缓存
        </button>
      </div>
    </div>
  );
}
