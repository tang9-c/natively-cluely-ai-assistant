// src/components/settings/ResearchTabBody.tsx
//
// Settings tab for the Research feature. Surfaces the Tavily API key
// management + cache controls so users can re-configure or reset state
// without leaving the Settings overlay.

import { useState } from 'react';

export function ResearchTabBody() {
  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<null | {
    valid: boolean; reason?: string; quotaLow?: boolean;
  }>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const handleTest = async () => {
    const r = await window.electronAPI.testTavilyApiKey(apiKey);
    setTestResult(r);
  };

  const handleSave = async () => {
    await window.electronAPI.setTavilyApiKey(apiKey);
    setSaveStatus('已保存');
    setTimeout(() => setSaveStatus(null), 2000);
  };

  const handleClearCache = async () => {
    const r = await window.electronAPI.profileClearResearchCache();
    setSaveStatus(`已清除 ${r.deleted} 条缓存`);
    setTimeout(() => setSaveStatus(null), 2000);
  };

  return (
    <div className="space-y-6 p-6 max-w-xl">
      <div>
        <h3 className="text-base font-semibold mb-2">Tavily API Key</h3>
        <p className="text-sm text-text-muted mb-3">
          Research 功能使用 Tavily 进行实时搜索。免费额度每月 1000 次。
        </p>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="tvly-..."
          className="w-full px-3 py-2 rounded border border-border bg-bg-secondary"
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded bg-accent-primary text-white"
          >
            保存
          </button>
          <button
            onClick={handleTest}
            disabled={!apiKey}
            className="px-4 py-2 rounded border disabled:opacity-50"
          >
            测试连接
          </button>
        </div>
        {testResult && (
          <p className={`mt-2 text-sm ${testResult.valid ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.valid
              ? (testResult.quotaLow ? '✓ Key 有效，但额度已接近上限' : '✓ Key 有效')
              : `✗ ${testResult.reason ?? '验证失败'}`}
          </p>
        )}
        {saveStatus && <p className="mt-2 text-sm text-text-muted">{saveStatus}</p>}
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
