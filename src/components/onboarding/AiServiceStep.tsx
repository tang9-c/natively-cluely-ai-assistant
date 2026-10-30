import { useEffect, useRef, useState } from 'react';
import type { OnboardingSnapshot, OnboardingStateResult } from '../../../shared/onboarding';
import type { OnboardingFormGuard } from '../../hooks/useOnboarding';
import { DEFAULT_CHAT_MODEL_ID, STANDARD_CLOUD_MODELS, codexCliSelectorId, getModelDisplayName, normalizeAiProvider, getCodexCliModelId, getAiModelDisplayName, resolveAiModelInput, CODEX_CLI_MODEL_PRESETS } from '../../utils/modelUtils';
import { onboardingErrorText, saveAndValidateOnboarding } from '../../utils/onboardingActions';
import { getAiProviderLabel, getAiSettingsTab, TRANSCRIPT_SCOPE_LABEL, TRANSCRIPT_SCOPE_DESCRIPTION } from '../../utils/settingsDisplay';
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
  const initialProvider = normalizeAiProvider(check.provider);
  const initialModel = initialProvider === 'codex-cli' ? getCodexCliModelId(check.modelId ?? 'codex-cli') : check.modelId || DEFAULT_CHAT_MODEL_ID;
  const [originalProvider] = useState(initialProvider);
  const [provider, setProvider] = useState(initialProvider), [model, setModel] = useState(initialModel);
  const [key, setKey] = useState(''), [changingKey, setChangingKey] = useState(false);
  const [scope, setScope] = useState<boolean | undefined>(undefined), [savedScope, setSavedScope] = useState<boolean | undefined>(undefined);
  const [saved, setSaved] = useState({ provider: initialProvider, model: initialModel });
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
  const hasSavedKey = provider === 'natively' ? check.qcloudKeyConfigured === true : check.configured && provider === check.provider;
  const currentCheck = provider === normalizeAiProvider(check.provider) && model.trim() === (provider === 'codex-cli' ? getCodexCliModelId(check.modelId ?? '', codex?.model) : check.modelId);
  const checkError = currentCheck ? check.errorCode : undefined;
  const dirty = !!key || provider !== saved.provider || model !== saved.model || scope !== savedScope || (provider === 'codex-cli' && !!codex && codex.path !== savedCodexPath);
  useEffect(() => {
    let active = true;
    api.getProviderDataScopes().then(scopes => { if (active) { setScope(scopes.transcript); setSavedScope(scopes.transcript); } }).catch(() => { if (active) setError('无法读取范围策略，请重试。'); });
    api.getCodexCliConfig().then(config => { if (active) { setCodex(config); setSavedCodexPath(config.path);
      if (initialProvider === 'codex-cli' && check.modelId === 'codex-cli') { setModel(current => current || config.model); setSaved(current => current.model ? current : { ...current, model: config.model }); } } }).catch(() => {});
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
      } else if (provider === 'natively') {
        if (key) {
          const result = await api.setNativelyApiKey(key, { selectAsDefault: false, deferValidation: true });
          if (!result.success) { setError(onboardingErrorText('storage_failed')); return false; }
          setKey(''); setChangingKey(false);
        }
        if (!(await api.setDefaultModel('natively')).success) { setError(onboardingErrorText('storage_failed')); return false; }
      } else if (provider === 'codex-cli') {
        if (!codex) return false;
        const result = await api.setCodexCliConfig({ ...codex, enabled: true, model: model.trim() });
        const selector = normalizeAiProvider(check.provider) === 'codex-cli' && check.modelId === 'codex-cli' ? 'codex-cli' : codexCliSelectorId(model.trim());
        if (!result.success || (selector !== check.modelId && !(await api.setDefaultModel(selector)).success)) { setError(onboardingErrorText('storage_failed')); return false; }
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
    if (['doubao', 'natively'].includes(provider) && (!hasSavedKey || changingKey) && !key.trim()) {
      setInvalidField('key'); setError(provider === 'natively' ? '请填写 QCLOUD API Key。' : '请填写 AI 密钥。'); keyInput.current?.focus(); return;
    }
    if (provider === 'codex-cli' && !codex?.path.trim()) { setInvalidField('path'); setError('请填写可执行文件。'); pathInput.current?.focus(); return; }
    setInvalidField(null); setPending(true); setError(null);
    const result = await saveAndValidateOnboarding({ target: 'ai', save, clear: () => setKey(''), refresh,
      validate: expectedRevision => api.validateOnboardingService({ target: 'ai', expectedRevision }) });
    setPending(false);
    if (result.saved) setStatus(result.success ? '本次模型响应通过' : '已保存，尚未验证所选模型');
    if (!result.success) setError(onboardingErrorText(result.errorCode));
    await refresh();
  };
  if (provisioning && !['natively', 'doubao'].includes(provider)) return <section className="space-y-5">
    <button className={button} onClick={() => setProvisioning(false)}>返回 AI 提供商</button>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-medium">配置当前 AI 服务</h1>
    <p className="text-sm text-text-secondary">请返回原设置，按照当前服务的账号或程序配置说明完成设置。</p>
    <button className={button} onClick={() => onOpenSettings(getAiSettingsTab(provider))}>返回原设置</button>
  </section>;
  if (provisioning) return <section className="space-y-5">
    <button className={button} onClick={() => setProvisioning(false)}>返回 AI 提供商</button>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-medium">{provider === 'natively' ? '开通 QCLOUD API' : '开通豆包 AI 服务'}</h1>
    {provider === 'natively' ? <ol className="list-decimal space-y-5 pl-5 text-sm leading-relaxed"><li>打开 QCLOUD API 平台，按平台提供的方式登录或注册账号。</li><li>在平台的令牌管理中创建 API Key，并确认可用额度与聊天服务访问权限。</li><li>复制 QCLOUD API Key，回到 CueUp 填写并验证。</li></ol> : <ol className="list-decimal space-y-5 pl-5 text-sm leading-relaxed"><li>注册或登录火山引擎账号。</li><li>按控制台提示开通所需模型。</li><li>创建 API Key。</li><li>回到 CueUp，粘贴密钥并验证所选模型。</li></ol>}
    <div className="flex flex-wrap gap-2">{(provider === 'natively' ? [['打开 QCLOUD API 平台', 'https://aigw.feigenbaum.com.cn/']] : provisionLinks).map(([label, url]) => <button key={url} className={button} onClick={() => { void api.openExternal(url).catch(() => setError('未能打开浏览器，请重试。')); }}>{label}</button>)}</div>
    <p className="text-xs leading-relaxed text-text-secondary">账号、模型权限及费用由服务提供方管理。CueUp 不提供试用额度，也不代为充值。返回应用不会自动验证，也不会读取剪贴板。</p>
    <button className="rounded-lg bg-button-primary-bg hover:bg-button-primary-hover disabled:bg-button-primary-disabled-bg disabled:text-button-primary-disabled-text px-4 py-2.5 text-sm text-button-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary" onClick={() => setProvisioning(false)}>我已准备好，返回填写</button>
    {error && <p role="alert" className="text-xs text-status-error">{error}</p>}
  </section>;
  return <section className="space-y-5">
    <div><h1 ref={heading} tabIndex={-1} className="text-2xl font-medium">连接 AI，让它帮助你理解会议</h1><p className="mt-2 text-sm text-text-secondary">验证当前保存的服务和模型，不发送你的会议内容。</p></div>
    <button className={button} onClick={() => setProvisioning(true)}>我还没有账号或密钥</button>
    <fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm">AI 提供商<select aria-label="AI 提供商" className={control} value={provider} onChange={e => { setProvider(e.target.value); setModel(e.target.value === saved.provider ? saved.model : e.target.value === 'codex-cli' ? codex?.model || '' : e.target.value === 'natively' ? 'natively' : DEFAULT_CHAT_MODEL_ID); setKey(''); setChangingKey(false); setInvalidField(null); setError(null); setStatus(null); }}>
        <option value="natively">{getAiProviderLabel('natively')}</option><option value="doubao">{getAiProviderLabel('doubao')}</option><option value="codex-cli">{getAiProviderLabel('codex-cli')}</option>{!['natively', 'doubao', 'codex-cli', 'none'].includes(originalProvider) && <option value={originalProvider}>当前提供商 · {getAiProviderLabel(originalProvider)}</option>}
      </select></label>
      <label className="block text-sm">聊天默认模型<input ref={modelInput} aria-invalid={invalidField === 'model'} aria-describedby={invalidField === 'model' ? 'onboarding-ai-error' : undefined} list="onboarding-ai-models" className={control} readOnly={!['doubao', 'codex-cli'].includes(provider)} value={provider === 'natively' ? getModelDisplayName('natively') : check.modelName && currentCheck ? check.modelName : getAiModelDisplayName(provider, model)} onChange={e => setModel(resolveAiModelInput(provider, e.target.value))} /></label>
      <datalist id="onboarding-ai-models">{(provider === 'doubao' ? STANDARD_CLOUD_MODELS.doubao.ids : provider === 'codex-cli' ? CODEX_CLI_MODEL_PRESETS.map(model => model.id) : []).map(id => <option key={id} value={getAiModelDisplayName(provider, id)} label={id} />)}</datalist>
      {['doubao', 'natively'].includes(provider) && (hasSavedKey && !changingKey ? <div className="text-xs">{provider === 'natively' ? 'QCLOUD API 密钥已保存，语音识别与 AI 共用。' : '密钥已保存'} <button className={button} onClick={() => setChangingKey(true)}>更换密钥</button></div>
        : <label className="block text-sm">{provider === 'natively' ? 'QCLOUD API Key' : 'AI API Key'}<input ref={keyInput} aria-invalid={invalidField === 'key'} aria-describedby={invalidField === 'key' ? 'onboarding-ai-error' : undefined} type="password" autoComplete="off" className={control} value={key} onChange={e => setKey(e.target.value)} /></label>)}
      {provider === 'codex-cli' && <div className="space-y-2 rounded-xl border border-border-muted p-4 text-xs"><label className="block">可执行文件<input ref={pathInput} aria-invalid={invalidField === 'path'} aria-describedby={invalidField === 'path' ? 'onboarding-ai-error' : undefined} className={control} value={codex?.path || ''} onChange={event => setCodex(current => current ? { ...current, path: event.target.value } : current)} /></label><p>{program}</p><p>推理：{status ?? '尚未验证 AI 请求'}</p>
        <button className={button} onClick={async () => { if (!codex) return; try { const result = await api.testCodexCli(codex); setProgram(result.success ? '已检测到程序（不代表已登录或推理通过）' : '未检测到程序，请检查原设置'); } catch { setProgram('程序检测失败'); } }}>检测 CLI</button>
      </div>}
      <label className="block text-sm">{TRANSCRIPT_SCOPE_LABEL}<select aria-label={TRANSCRIPT_SCOPE_LABEL} className={control} value={scope === undefined ? 'inherit' : scope ? 'allow' : 'deny'} onChange={e => setScope(e.target.value === 'inherit' ? undefined : e.target.value === 'allow')}>
        {savedScope === undefined && <option value="inherit">沿用当前策略（允许）</option>}<option value="allow">允许</option><option value="deny">不允许</option>
      </select></label>
      <p className="text-xs leading-relaxed text-text-secondary">{TRANSCRIPT_SCOPE_DESCRIPTION}</p>
      {['natively', 'doubao', 'codex-cli'].includes(provider) && <button className={button} onClick={() => void validate()}>{provider === 'codex-cli' ? '验证当前配置' : '保存并验证'}</button>}
    </fieldset>
    <p role="status" className={`text-xs ${pending || currentCheck && check.status === 'previously_verified' ? 'text-status-info' : currentCheck && check.status === 'verified' ? 'text-status-success' : 'text-text-secondary'}`}>{pending ? '正在保存并验证…' : !currentCheck ? '配置已更改，保存后重新检查。' : status ?? (check.status === 'verified' ? '本次模型响应通过' : check.status === 'previously_verified' ? '上次验证通过' : check.configured ? '已保存，尚未验证所选模型' : '尚未配置')}{currentCheck && check.checkedAt ? ` · ${new Date(check.checkedAt).toLocaleString()}` : ''}</p>
    {(error || checkError) && <p id="onboarding-ai-error" role="alert" className={`text-xs ${!error && ['scope_denied', 'unsupported_check'].includes(checkError ?? '') ? 'text-status-warning' : 'text-status-error'}`}>{error ?? onboardingErrorText(checkError)}</p>}
    <button className={button} onClick={() => onOpenSettings(getAiSettingsTab(provider))}>返回原设置</button>
    {!['natively', 'doubao', 'codex-cli'].includes(provider) && <><p className="text-xs text-status-warning">引导暂不能验证此配置，原服务仍然保留。</p><button className={button} onClick={() => { setProvider('doubao'); setModel(DEFAULT_CHAT_MODEL_ID); }}>选择支持的服务</button></>}
  </section>;
}
