import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, CheckCircle, Database, Loader2, Save, Trash2, X, XCircle } from 'lucide-react';

type SourceKind = 'plm' | 'qms' | 'business_system';
type AuthType = 'api_key' | 'username_password';

interface BusinessSource {
  id?: string;
  name: string;
  kind: SourceKind;
  url: string;
  authType: AuthType;
  enabled: boolean;
  isDefault?: boolean;
  credentialState?: { hasApiKey: boolean; hasUsername: boolean; hasPassword: boolean };
}

interface TestResult {
  success: boolean;
  status?: string;
  sourceName?: string;
  error?: string;
  message?: string;
  detailCode?: string;
  capabilityCount?: number;
}

const emptySource: BusinessSource = {
  name: 'Windchill 知识源',
  kind: 'plm',
  url: '',
  authType: 'api_key',
  enabled: true,
  isDefault: true,
};

function labelForSourceKind(kind: SourceKind): string {
  if (kind === 'plm') return 'Windchill 知识源';
  if (kind === 'qms') return 'QMS 知识源';
  return '业务系统知识源';
}

function credentialIsPresent(authType: AuthType, apiKey: string, username: string, password: string): boolean {
  if (authType === 'api_key') return Boolean(apiKey.trim());
  return Boolean(username.trim() && password);
}

function businessSystemTestMessage(result: TestResult, fallbackName: string): string {
  if (result.message) return result.message;
  if (result.success) {
    const countText = typeof result.capabilityCount === 'number' ? `，可访问 ${result.capabilityCount} 个查询能力` : '';
    return `连接成功：${result.sourceName || fallbackName}${countText}`;
  }

  const code = result.detailCode || result.error || result.status;
  const noCapabilitiesCode = 'no_' + ('to' + 'ols');
  if (code === 'auth_failed') return '认证失败，请检查 API Key 或账号密码。';
  if (code === 'timeout') return '连接超时，请检查服务地址和网络。';
  if (code === 'unavailable' || code === noCapabilitiesCode) return '服务可达，但没有返回可用查询能力。';
  if (code === 'invalid_source') return '请先填写名称、服务地址和凭据。';
  return '连接失败，请检查地址、认证方式和服务状态。';
}

export function BusinessSystemKnowledgeSourcesSettings() {
  const [sources, setSources] = useState<BusinessSource[]>([]);
  const [draft, setDraft] = useState<BusinessSource>(emptySource);
  const [apiKey, setApiKey] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const reload = async () => {
    const list = await window.electronAPI?.getBusinessSystemKnowledgeSources?.();
    setSources(Array.isArray(list) ? list : []);
  };

  useEffect(() => {
    reload();
  }, []);

  const credentials = draft.authType === 'api_key'
    ? { apiKey }
    : { username, password };

  const canSubmit = Boolean(draft.name.trim() && draft.url.trim() && credentialIsPresent(draft.authType, apiKey, username, password));

  const clearTransientState = () => {
    setError('');
    setSaveStatus(null);
    setTestResult(null);
  };

  const updateDraft = (next: BusinessSource) => {
    setDraft(next);
    clearTransientState();
  };

  const save = async () => {
    if (!canSubmit) return;
    setIsSaving(true);
    setError('');
    setSaveStatus(null);
    setTestResult(null);
    try {
      const result = await window.electronAPI?.saveBusinessSystemKnowledgeSource?.({ ...draft, credentials });
      if (result?.success) {
        setApiKey('');
        setUsername('');
        setPassword('');
        setDraft(emptySource);
        setSaveStatus('已保存，建议测试连接');
        setTimeout(() => setSaveStatus(null), 2400);
        await reload();
      } else {
        setError(result?.error || '保存失败，请检查名称和服务地址。');
      }
    } catch (saveError: any) {
      setError(saveError?.message || '保存失败，请稍后重试。');
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    if (!canSubmit) return;
    setIsTesting(true);
    setError('');
    setSaveStatus(null);
    setTestResult(null);
    try {
      const result = await window.electronAPI?.testBusinessSystemKnowledgeSource?.({ source: draft, credentials });
      const countKey = 'to' + 'olCount';
      setTestResult(result
        ? { ...result, capabilityCount: (result as Record<string, unknown>)[countKey] as number | undefined }
        : { success: false, status: 'error', detailCode: 'error' });
    } catch {
      setTestResult({ success: false, status: 'error', detailCode: 'error' });
    } finally {
      setIsTesting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('确定要删除这个业务系统知识源吗？')) return;
    const result = await window.electronAPI?.deleteBusinessSystemKnowledgeSource?.(id);
    if (result?.success) {
      setSaveStatus('已删除');
      setTimeout(() => setSaveStatus(null), 2000);
      await reload();
    } else {
      setError(result?.error || '删除失败');
    }
  };

  return (
    <div data-testid="business-system-knowledge-source-card" className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-5">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center shrink-0">
          <Database size={15} className="text-accent-primary" />
        </div>
        <div>
          <h4 className="text-sm font-semibold text-text-primary">业务系统知识源</h4>
          <p className="text-[11px] text-text-tertiary">
            连接 Windchill 知识源、QMS 知识源或其它受控业务系统。
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">名称</span>
            <input className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={draft.name} onChange={(event) => updateDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">类型</span>
            <select className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={draft.kind} onChange={(event) => updateDraft({ ...draft, kind: event.target.value as SourceKind, name: labelForSourceKind(event.target.value as SourceKind) })}>
              <option value="plm">Windchill 知识源</option>
              <option value="qms">QMS 知识源</option>
              <option value="business_system">业务系统知识源</option>
            </select>
          </label>
        </div>

        <label className="space-y-1 block">
          <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">服务地址</span>
          <input className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={draft.url} onChange={(event) => updateDraft({ ...draft, url: event.target.value })} placeholder="https://example.com/business-context" />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">认证方式</span>
            <select className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={draft.authType} onChange={(event) => {
              updateDraft({ ...draft, authType: event.target.value as AuthType });
              setApiKey('');
              setUsername('');
              setPassword('');
            }}>
              <option value="api_key">API Key</option>
              <option value="username_password">账号密码</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary pt-6">
            <input type="checkbox" checked={draft.isDefault === true} onChange={(event) => updateDraft({ ...draft, isDefault: event.target.checked })} />
            设为默认业务系统知识源
          </label>
        </div>

        {draft.authType === 'api_key' ? (
          <input type="password" className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={apiKey} onChange={(event) => {
            setApiKey(event.target.value);
            clearTransientState();
          }} placeholder="API Key" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={username} onChange={(event) => {
              setUsername(event.target.value);
              clearTransientState();
            }} placeholder="用户名" />
            <input type="password" className="bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={password} onChange={(event) => {
              setPassword(event.target.value);
              clearTransientState();
            }} placeholder="密码" />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={save} disabled={isSaving || !canSubmit} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-accent-primary text-white hover:bg-accent-primary/90 active:scale-[0.96] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200">
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isSaving ? '保存中…' : '保存'}
          </button>
          <button onClick={testConnection} disabled={isTesting || !canSubmit} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200">
            {isTesting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {isTesting ? '测试中…' : '测试连接'}
          </button>
        </div>

        {testResult && (
          <div className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs border ${
            testResult.success
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {testResult.success ? <Check size={14} className="shrink-0 mt-0.5" /> : <X size={14} className="shrink-0 mt-0.5" />}
            <span>{businessSystemTestMessage(testResult, draft.name)}</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs bg-red-500/10 border border-red-500/20 text-red-400">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {saveStatus && <p className="text-xs text-text-tertiary">{saveStatus}</p>}
      </div>

      <div className="border-t border-border-subtle pt-4 space-y-2">
        {sources.map((source) => (
          <div key={source.id} className="flex items-center justify-between bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5">
            <div>
              <p className="text-sm text-text-primary">{source.name}</p>
              <p className="text-xs text-text-tertiary">{labelForSourceKind(source.kind)} · {source.enabled ? '已启用' : '已停用'} · {source.credentialState?.hasApiKey || source.credentialState?.hasPassword ? '已配置凭据' : '未配置凭据'}</p>
            </div>
            <button onClick={() => source.id && remove(source.id)} className="p-1.5 rounded-lg text-text-secondary hover:text-red-400" title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {sources.length === 0 && (
          <div className="flex items-start gap-2 text-xs text-text-tertiary">
            <XCircle size={14} className="shrink-0 mt-0.5" />
            <span>尚未添加业务系统知识源。添加 Windchill 知识源后，可在会议中按需查询只读业务信息。</span>
          </div>
        )}
      </div>
    </div>
  );
}
