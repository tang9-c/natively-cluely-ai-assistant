import React, { useEffect, useState } from 'react';
import { CheckCircle, Database, Save, Trash2, XCircle } from 'lucide-react';

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

export function BusinessSystemKnowledgeSourcesSettings() {
  const [sources, setSources] = useState<BusinessSource[]>([]);
  const [draft, setDraft] = useState<BusinessSource>(emptySource);
  const [apiKey, setApiKey] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string>('');
  const [saving, setSaving] = useState(false);

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

  const save = async () => {
    setSaving(true);
    setStatus('');
    const result = await window.electronAPI?.saveBusinessSystemKnowledgeSource?.({ ...draft, credentials });
    setSaving(false);
    if (result?.success) {
      setApiKey('');
      setUsername('');
      setPassword('');
      setDraft(emptySource);
      setStatus('已保存业务系统知识源');
      await reload();
    } else {
      setStatus(result?.error || '保存失败');
    }
  };

  const testConnection = async () => {
    setStatus('正在测试连接...');
    const result = await window.electronAPI?.testBusinessSystemKnowledgeSource?.({ source: draft, credentials });
    setStatus(result?.success ? `连接成功：${result.sourceName || draft.name}` : `连接失败：${result?.status || result?.error || 'unknown'}`);
  };

  const remove = async (id: string) => {
    await window.electronAPI?.deleteBusinessSystemKnowledgeSource?.(id);
    await reload();
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
            <input className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">类型</span>
            <select className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as SourceKind })}>
              <option value="plm">Windchill 知识源</option>
              <option value="qms">QMS 知识源</option>
              <option value="business_system">业务系统知识源</option>
            </select>
          </label>
        </div>

        <label className="space-y-1 block">
          <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">服务地址</span>
          <input className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com/business-context" />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">认证方式</span>
            <select className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={draft.authType} onChange={(event) => setDraft({ ...draft, authType: event.target.value as AuthType })}>
              <option value="api_key">API Key</option>
              <option value="username_password">账号密码</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary pt-6">
            <input type="checkbox" checked={draft.isDefault === true} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} />
            设为默认业务系统知识源
          </label>
        </div>

        {draft.authType === 'api_key' ? (
          <input type="password" className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="API Key" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名" />
            <input type="password" className="bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-accent-primary text-white hover:bg-accent-primary/90 active:scale-[0.96] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200">
            <Save size={14} /> 保存
          </button>
          <button onClick={testConnection} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all duration-200">
            <CheckCircle size={14} /> 测试连接
          </button>
        </div>

        {status && <p className="text-xs text-text-secondary">{status}</p>}
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
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <XCircle size={14} /> 尚未添加业务系统知识源
          </div>
        )}
      </div>
    </div>
  );
}
