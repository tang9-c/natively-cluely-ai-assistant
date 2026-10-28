import { useEffect, useRef, useState } from 'react';
import type { OnboardingSnapshot, OnboardingStateResult } from '../../../shared/onboarding';
import type { OnboardingFormGuard } from '../../hooks/useOnboarding';
import { DEFAULT_CHAT_MODEL_ID, STANDARD_CLOUD_MODELS, codexCliSelectorId } from '../../utils/modelUtils';
import { onboardingErrorText, saveAndValidateOnboarding } from '../../utils/onboardingActions';
const control = 'mt-2 w-full rounded-lg border border-border-muted bg-bg-elevated px-3 py-2 text-sm';
const button = 'rounded-lg border border-border-muted px-3 py-2 text-xs hover:bg-bg-item-active disabled:opacity-40';
const provisionLinks = [
  ['打开官方入门', 'https://docs.volcengine.com/docs/ark/quick-start-beginner?lang=zh'],
  ['打开密钥管理说明', 'https://docs.volcengine.com/docs/ark/manage-api-keys?lang=zh'],
  ['打开密钥管理', 'https://ark.volcengine.com/region:cn-beijing/apikey'],
] as const;
export default function AiServiceStep({ snapshot, refresh, registerFormGuard, onOpenSettings, provisioning, onProvisioningChange: setProvisioning }: {
  provisioning: boolean; onProvisioningChange(open: boolean): void;
  snapshot: OnboardingSnapshot; refresh(): Promise<OnboardingStateResult>;
  registerFormGuard(form: OnboardingFormGuard): () => void; onOpenSettings(tab: string): void;
}) {
  const api = window.electronAPI, check = snapshot.checks.ai;
  const initialProvider = check.provider && check.provider !== 'none' ? check.provider : 'doubao';
  const [originalProvider] = useState(initialProvider);
  const [provider, setProvider] = useState(initialProvider), [model, setModel] = useState(check.modelId || DEFAULT_CHAT_MODEL_ID);
  const [key, setKey] = useState(''), [changingKey, setChangingKey] = useState(false);
  const [scope, setScope] = useState<boolean | undefined>(undefined), [savedScope, setSavedScope] = useState<boolean | undefined>(undefined);
  const [saved, setSaved] = useState({ provider: initialProvider, model: check.modelId || DEFAULT_CHAT_MODEL_ID });
  const [codex, setCodex] = useState<Awaited<ReturnType<typeof api.getCodexCliConfig>> | null>(null);
  const [savedCodexPath, setSavedCodexPath] = useState('');
  const [program, setProgram] = useState('尚未检测程序');
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), [status, setStatus] = useState<string | null>(null);
  const keyInput = useRef<HTMLInputElement>(null), modelInput = useRef<HTMLInputElement>(null), pathInput = useRef<HTMLInputElement>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [provisioning]);
  useEffect(() => api.onProviderDataScopesChanged(scopes => {
    setScope(current => current === savedScope ? scopes.transcript : current); setSavedScope(scopes.transcript);
  }), [api, savedScope]);
  const busy = pending || snapshot.meeting.isActive || snapshot.meeting.isStarting || check.status === 'checking';
  const dirty = !!key || provider !== saved.provider || model !== saved.model || scope !== savedScope || (provider === 'codex-cli' && !!codex && codex.path !== savedCodexPath);
  useEffect(() => {
    let active = true;
    api.getProviderDataScopes().then(scopes => { if (active) { setScope(scopes.transcript); setSavedScope(scopes.transcript); } }).catch(() => { if (active) setError('无法读取范围策略，请重试。'); });
    api.getCodexCliConfig().then(config => { if (active) { setCodex(config); setSavedCodexPath(config.path); } }).catch(() => {});
    return () => { active = false; };
  }, [api]);
  const save = async () => {
    if (busy || !model.trim()) return false;
    try {
      if (scope !== savedScope) {
        const result = await api.setProviderDataScopes({ transcript: scope !== false }, { mode: 'patch' });
        if (!result.success) { setError(onboardingErrorText('storage_failed')); return false; }
        setSavedScope(scope);
      }
      if (provider === 'doubao') {
        if (key) {
          const result = await api.setDoubaoLlmApiKey(key);
          if (!result.success) { setError(onboardingErrorText('storage_failed')); return false; }
          setKey(''); setChangingKey(false);
        }
        if (model !== check.modelId || provider !== check.provider) {
          const result = await api.setProviderPreferredModel('doubao', model.trim());
          if (!result.success || !(await api.setDefaultModel(model.trim())).success) { setError(onboardingErrorText('storage_failed')); return false; }
        }
      } else if (provider === 'codex-cli') {
        if (!codex) return false;
        const result = await api.setCodexCliConfig({ ...codex, enabled: true, model: model.trim() });
        if (!result.success || !(await api.setDefaultModel(codexCliSelectorId(model.trim()))).success) { setError(onboardingErrorText('storage_failed')); return false; }
      } else {
        setError(onboardingErrorText('unsupported_check')); return false;
      }
      if (codex && provider === 'codex-cli') setSavedCodexPath(codex.path);
      setSaved({ provider, model }); setStatus('已保存，尚未验证所选模型'); return true;
    } catch { setError(onboardingErrorText('storage_failed')); return false; }
  };
  useEffect(() => registerFormGuard({ isDirty: () => dirty, save, discard: () => { setKey(''); setProvider(saved.provider); setModel(saved.model); setScope(savedScope); setCodex(current => current ? { ...current, path: savedCodexPath } : current); } }), [dirty, key, provider, model, scope, savedScope, saved, codex, savedCodexPath, busy, registerFormGuard]);
  const validate = async () => {
    if (busy) return;
    if (!model.trim()) { setInvalidField('model'); setError('请填写 AI 模型。'); modelInput.current?.focus(); return; }
    if (provider === 'doubao' && (!check.configured || check.provider !== provider || changingKey) && !key.trim()) {
      setInvalidField('key'); setError('请填写 AI 密钥。'); keyInput.current?.focus(); return;
    }
    if (provider === 'codex-cli' && !codex?.path.trim()) { setInvalidField('path'); setError('请填写 Codex 程序路径。'); pathInput.current?.focus(); return; }
    setInvalidField(null); setPending(true); setError(null);
    const result = await saveAndValidateOnboarding({ target: 'ai', save, clear: () => setKey(''), refresh,
      validate: expectedRevision => api.validateOnboardingService({ target: 'ai', expectedRevision }) });
    setPending(false);
    if (result.saved) setStatus(result.success ? '本次模型响应通过' : '已保存，尚未验证所选模型');
    if (!result.success) setError(onboardingErrorText(result.errorCode));
    await refresh();
  };
  if (provisioning) return <section className="space-y-5">
    <button className={button} onClick={() => setProvisioning(false)}>返回 AI 服务</button>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-medium">开通豆包 AI 服务</h1>
    <ol className="list-decimal space-y-5 pl-5 text-sm leading-relaxed"><li>注册或登录火山引擎账号。</li><li>按控制台提示开通所需模型。</li><li>创建 API Key。</li><li>回到 CueUp，粘贴密钥并验证所选模型。</li></ol>
    <div className="flex flex-wrap gap-2">{provisionLinks.map(([label, url]) => <button key={url} className={button} onClick={() => { void api.openExternal(url).catch(() => setError('未能打开浏览器，请重试。')); }}>{label}</button>)}</div>
    <p className="text-xs leading-relaxed text-text-secondary">账号、模型权限及费用由服务提供方管理。CueUp 不提供试用额度，也不代为充值。返回应用不会自动验证，也不会读取剪贴板。</p>
    <button className="rounded-lg bg-accent-primary px-4 py-2.5 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary" onClick={() => setProvisioning(false)}>我已准备好，返回填写</button>
    {error && <p role="alert" className="text-xs text-amber-600">{error}</p>}
  </section>;
  return <section className="space-y-5">
    <div><h1 ref={heading} tabIndex={-1} className="text-2xl font-medium">连接 AI，让它帮助你理解会议</h1><p className="mt-2 text-sm text-text-secondary">验证当前保存的服务和模型，不发送你的会议内容。</p></div>
    <button className={button} onClick={() => setProvisioning(true)}>我还没有账号或密钥</button>
    <fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm">AI 服务<select aria-label="AI 服务" className={control} value={provider} onChange={e => { setProvider(e.target.value); setModel(e.target.value === saved.provider ? saved.model : e.target.value === 'codex-cli' ? codex?.model || '' : DEFAULT_CHAT_MODEL_ID); setKey(''); setChangingKey(false); setError(null); setStatus(null); }}>
        <option value="doubao">豆包</option><option value="codex-cli">Codex CLI</option>{!['doubao', 'codex-cli', 'none'].includes(originalProvider) && <option value={originalProvider}>当前服务 · {originalProvider}</option>}
      </select></label>
      <label className="block text-sm">AI 模型<input ref={modelInput} aria-invalid={invalidField === 'model'} aria-describedby={invalidField === 'model' ? 'onboarding-ai-error' : undefined} list="onboarding-ai-models" className={control} value={model} onChange={e => setModel(e.target.value)} /></label>
      <datalist id="onboarding-ai-models">{(provider === 'doubao' ? STANDARD_CLOUD_MODELS.doubao.ids : []).map(id => <option key={id} value={id} />)}</datalist>
      {provider === 'doubao' && (check.configured && provider === check.provider && !changingKey ? <div className="text-xs">密钥已保存 <button className={button} onClick={() => setChangingKey(true)}>更换密钥</button></div>
        : <label className="block text-sm">AI API Key<input ref={keyInput} aria-invalid={invalidField === 'key'} aria-describedby={invalidField === 'key' ? 'onboarding-ai-error' : undefined} type="password" autoComplete="off" className={control} value={key} onChange={e => setKey(e.target.value)} /></label>)}
      {provider === 'codex-cli' && <div className="space-y-2 rounded-xl border border-border-muted p-4 text-xs"><label className="block">Codex 程序路径<input ref={pathInput} aria-invalid={invalidField === 'path'} aria-describedby={invalidField === 'path' ? 'onboarding-ai-error' : undefined} className={control} value={codex?.path || ''} onChange={event => setCodex(current => current ? { ...current, path: event.target.value } : current)} /></label><p>{program}</p><p>推理：{status ?? '尚未验证 AI 请求'}</p>
        <button className={button} onClick={async () => { if (!codex) return; try { const result = await api.testCodexCli(codex); setProgram(result.success ? '已检测到程序（不代表已登录或推理通过）' : '未检测到程序，请检查原设置'); } catch { setProgram('程序检测失败'); } }}>检测程序</button>
      </div>}
      <label className="block text-sm">全局：允许转写文本用于 AI<select aria-label="全局：允许转写文本用于 AI" className={control} value={scope === undefined ? 'inherit' : scope ? 'allow' : 'deny'} onChange={e => setScope(e.target.value === 'inherit' ? undefined : e.target.value === 'allow')}>
        {savedScope === undefined && <option value="inherit">沿用当前策略（允许）</option>}<option value="allow">允许</option><option value="deny">不允许</option>
      </select></label>
      <p className="text-xs leading-relaxed text-text-secondary">影响所有使用此范围策略的 AI 服务，不影响云端语音识别的原始音频上传选择。拒绝后无法完成首次 AI 设置，可稍后继续。</p>
      {['doubao', 'codex-cli'].includes(provider) && <button className={button} onClick={() => void validate()}>{provider === 'codex-cli' ? '验证当前配置' : '保存并验证'}</button>}
    </fieldset>
    <p role="status" className="text-xs text-text-secondary">{pending ? '正在保存并验证…' : status ?? (check.status === 'verified' ? '本次模型响应通过' : check.status === 'previously_verified' ? '上次验证通过' : check.configured ? '已保存，尚未验证所选模型' : '尚未配置')}{check.checkedAt ? ` · ${new Date(check.checkedAt).toLocaleString()}` : ''}</p>
    {(error || check.errorCode) && <p id="onboarding-ai-error" role="alert" className="text-xs text-amber-600">{error ?? onboardingErrorText(check.errorCode)}</p>}
    <button className={button} onClick={() => onOpenSettings('ai-providers')}>返回原设置</button>
    {!['doubao', 'codex-cli'].includes(provider) && <><p className="text-xs text-amber-600">引导暂不能验证此配置，原服务仍然保留。</p><button className={button} onClick={() => { setProvider('doubao'); setModel(DEFAULT_CHAT_MODEL_ID); }}>选择支持的服务</button></>}
  </section>;
}
