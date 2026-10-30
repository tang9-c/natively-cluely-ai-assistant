import { useEffect, useRef, useState } from 'react';
import type { OnboardingSnapshot, OnboardingStateResult } from '../../../shared/onboarding';
import type { OnboardingFormGuard } from '../../hooks/useOnboarding';
import { onboardingErrorText, saveAndValidateOnboarding } from '../../utils/onboardingActions';
const control = 'mt-2 w-full rounded-lg border border-border-muted bg-bg-elevated px-3 py-2 text-sm';
const button = 'rounded-lg border border-border-muted px-3 py-2 text-xs hover:bg-bg-item-active disabled:opacity-40';
export default function SpeechStep({ snapshot, refresh, registerFormGuard, onOpenSettings, onDownload }: {
  snapshot: OnboardingSnapshot; refresh(): Promise<OnboardingStateResult>;
  registerFormGuard(form: OnboardingFormGuard): () => void; onOpenSettings(tab: string): void;
  onDownload(modelId: string, revision: number, provider: string): Promise<boolean>;
}) {
  const api = window.electronAPI, check = snapshot.checks.stt;
  const keySetters: Record<string, (value: string) => Promise<{ success: boolean }>> = {
    'doubao-auc': api.setDoubaoApiKey, doubao: api.setDoubaoApiKey,
    'qcloud-stt': value => api.setNativelyApiKey(value, { selectAsDefault: false, deferValidation: true }), groq: api.setGroqSttApiKey,
    openai: api.setOpenAiSttApiKey, deepgram: api.setDeepgramApiKey, elevenlabs: api.setElevenLabsApiKey,
    azure: api.setAzureApiKey, ibmwatson: api.setIbmWatsonApiKey, soniox: api.setSonioxApiKey,
  };
  const initialProvider = check.provider && check.provider !== 'none' ? check.provider : 'local-sensevoice';
  const [originalProvider] = useState(initialProvider);
  const [provider, setProvider] = useState(initialProvider), [language, setLanguage] = useState('');
  const [languages, setLanguages] = useState<Record<string, { label?: string; name?: string; group?: string }>>({});
  const [saved, setSaved] = useState({ provider: initialProvider, language: '' });
  const [key, setKey] = useState(''), [changingKey, setChangingKey] = useState(false);
  const [model, setModel] = useState<{ id: string; name: string; sizeMb: number; status: string } | null>(null);
  const [catalog, setCatalog] = useState<NonNullable<typeof model>[]>([]);
  const [whisperId, setWhisperId] = useState(check.modelId || ''), [savedWhisperId, setSavedWhisperId] = useState(check.modelId || '');
  const [perChannel, setPerChannel] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const [missingKey, setMissingKey] = useState(false);
  const local = provider.startsWith('local-');
  const downloading = snapshot.downloads.find(d => d.modelId === check.modelId && d.status === 'running');
  const downloadError = snapshot.downloads.find(d => d.modelId === check.modelId && d.status === 'failed');
  const busy = pending || snapshot.meeting.isActive || snapshot.meeting.isStarting || check.status === 'checking';
  const dirty = key.length > 0 || provider !== saved.provider || language !== saved.language || (provider === 'local-whisper' && whisperId !== savedWhisperId);
  useEffect(() => {
    let active = true;
    Promise.all([api.getRecognitionLanguages(), api.getSttLanguage()]).then(([list, current]) => {
      if (active) { setLanguages(list); setLanguage(current); setSaved(s => ({ ...s, language: current })); }
    }).catch(() => { if (active) setError('无法读取语音配置，请重试。'); });
    return () => { active = false; };
  }, [api]);
  useEffect(() => {
    let active = true;
    const read = async () => {
      const result = provider === 'local-sensevoice' ? await api.localSenseVoiceGetModels() : provider === 'local-whisper' ? await api.localModelsGetList() : null;
      if (active) { setCatalog(result?.models ?? []); setModel(result?.models.find(m => m.id === check.modelId) ?? result?.models[0] ?? null); }
      if (provider === 'local-whisper') {
        const config = await api.localWhisperGetChannelConfig();
        if (active) { setWhisperId(config.globalModelId); setSavedWhisperId(config.globalModelId); setPerChannel(config.enabled); }
      }
    };
    void read().catch(() => { if (active) setError('无法读取模型目录，请重试。'); });
    const off = api.onLocalSenseVoiceDownloadComplete(() => { void read(); });
    return () => { active = false; off(); };
  }, [provider, check.modelId, api]);
  const save = async (): Promise<boolean> => {
    if (busy || (key && !keySetters[provider])) return false;
    try {
      if (key) {
        const result = await keySetters[provider](key);
        if (!result.success) { setError(onboardingErrorText('storage_failed')); return false; }
        setKey(''); setChangingKey(false);
      }
      if (provider === 'local-whisper' && whisperId !== savedWhisperId) {
        if (!(await api.localWhisperSetModel(whisperId)).success) { setError('未能保存当前模型。'); return false; }
        setSavedWhisperId(whisperId);
      }
      if (language !== saved.language && !(await api.setRecognitionLanguage(language)).success) { setError('未能保存会议语言。'); return false; }
      if (provider !== check.provider && !(await api.setSttProvider(provider as Parameters<typeof api.setSttProvider>[0])).success) { setError('未能保存语音服务。'); return false; }
      setSaved({ provider, language }); setStatus('已保存，尚未验证语音服务'); return true;
    } catch { setError(onboardingErrorText('storage_failed')); return false; }
  };
  useEffect(() => registerFormGuard({ isDirty: () => dirty, save, discard: () => { setKey(''); setProvider(saved.provider); setLanguage(saved.language); setWhisperId(savedWhisperId); } }), [dirty, saved, key, language, provider, whisperId, savedWhisperId, busy, registerFormGuard]);
  const validate = async () => {
    if (busy) return;
    if (!local && keySetters[provider] && (!check.configured || provider !== check.provider || changingKey) && !key.trim()) {
      setMissingKey(true); setError('请填写语音识别密钥。'); keyInput.current?.focus(); return;
    }
    setMissingKey(false); setPending(true); setError(null);
    const result = await saveAndValidateOnboarding({ target: 'stt', save, clear: () => setKey(''), refresh,
      validate: revision => api.validateOnboardingService({ target: 'stt', expectedRevision: revision }) });
    setPending(false); setStatus(result.saved ? result.success ? '本次检查通过' : '已保存，检查未通过' : null);
    if (!result.success) setError(onboardingErrorText(result.errorCode));
    await refresh();
  };
  const download = async (replace = false) => {
    if (!model || busy) return;
    if (replace && !window.confirm('重新下载将替换此模型的文件，不影响其他模型。继续？')) return;
    setPending(true); setError(null);
    try {
      if (!await save()) return;
      const current = await refresh(); if (!current.success) { setError(onboardingErrorText(current.errorCode)); return; }
      if (!await onDownload(model.id, current.snapshot.progress.configRevision.stt, provider)) setError('下载未能开始，模型可能正在使用中，请重试。');
    } finally { setPending(false); }
  };
  return <section className="space-y-5">
    <div><h1 tabIndex={-1} className="text-2xl font-medium">设置语音识别</h1><p className="mt-2 text-sm text-text-secondary">沿用当前服务；未配置时推荐本地 SenseVoice。</p></div>
    <fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm">会议语言<select aria-label="会议语言" className={control} value={language} onChange={e => { setLanguage(e.target.value); setStatus(null); }}>
        {language && !languages[language] && <option value={language}>{language}</option>}{Object.entries(languages).map(([value, lang]) => <option key={value} value={value}>{lang.group ? `${lang.group} · ${lang.label ?? value}` : lang.label ?? lang.name ?? value}</option>)}
      </select></label>
      <label className="block text-sm">语音识别服务<select aria-label="语音识别服务" className={control} value={provider} onChange={e => { setKey(''); setProvider(e.target.value); setStatus(null); setError(null); }}>
        <option value="local-sensevoice">本地 SenseVoice（推荐）</option><option value="doubao-auc">云端 Doubao AUC</option>
        <option value="qcloud-stt">云端 QCLOUD</option>{!['local-sensevoice', 'doubao-auc', 'qcloud-stt', 'none'].includes(originalProvider) && <option value={originalProvider}>当前服务 · {originalProvider}</option>}
      </select></label>
      {local ? <div className="space-y-3 rounded-xl border border-border-muted p-4">
        {provider === 'local-whisper' && <label className="block text-sm">当前 Whisper 模型<select aria-label="当前 Whisper 模型" disabled={perChannel} className={control} value={whisperId} onChange={event => { setWhisperId(event.target.value); setModel(catalog.find(m => m.id === event.target.value) ?? null); }}>
          {catalog.map(m => <option key={m.id} value={m.id}>{m.name} · {m.sizeMb} MB</option>)}
        </select>{perChannel && <span className="mt-2 block text-xs text-text-secondary">沿用现有每通道模型；高级修改可返回原设置。</span>}</label>}
        <h2 className="text-sm font-medium">{model?.name ?? provider}{model?.sizeMb ? ` · 约 ${model.sizeMb} MB` : ''}</h2>
        <p className="text-xs text-text-secondary">本地识别，音频无需为转写上传云端。文件准备后检查运行时能否加载，不录音。</p>
        {downloading ? <div role="status"><progress aria-label="模型下载进度" value={downloading.progress ?? 0} max={100} className="w-full" /><p className="text-xs">正在下载 {downloading.progress ?? 0}% · 可先配置 AI</p></div>
          : model?.status === 'missing' ? <button className={button} onClick={() => void download()}>下载模型</button>
          : <button className={button} onClick={() => void validate()}>检查模型</button>}
        <p className="text-xs text-text-secondary">下载模型包含完成后的加载检查；切页后下载继续。</p>
        {(error || downloadError) && !downloading && local && <button className={button} onClick={() => void download(true)}>重新下载</button>}
      </div> : <div className="space-y-3 rounded-xl border border-border-muted p-4">
        <p className="text-xs leading-relaxed text-text-secondary">语音将发送至所选识别服务。验证可能发送内置样本，不采集你的声音；凭据可访问不等于会议转写成功。AI 转写文本范围在下一步独立设置。</p>
        {!keySetters[provider] ? <p className="text-xs text-text-secondary">沿用已保存凭据；修改此服务的认证请返回原设置。</p> : check.configured && provider === check.provider && !changingKey ? <div className="text-xs">STT 密钥已保存 <button className={button} onClick={() => setChangingKey(true)}>更换语音密钥</button></div>
          : <label className="block text-sm">语音 API Key<input ref={keyInput} aria-invalid={missingKey} aria-describedby={missingKey ? 'onboarding-speech-error' : undefined} type="password" autoComplete="off" className={control} value={key} onChange={e => setKey(e.target.value)} /></label>}
        <button className={button} onClick={() => void validate()}>保存并验证语音服务</button>
        <button className={button} onClick={() => onOpenSettings('audio')}>配置帮助</button>
      </div>}
      {local && provider === 'local-whisper' && <button className={button} onClick={() => onOpenSettings('audio')}>修改当前 Whisper 模型</button>}
    </fieldset>
    <p className={`text-xs ${pending || check.status === 'previously_verified' ? 'text-status-info' : check.status === 'verified' ? 'text-status-success' : 'text-text-secondary'}`}>{pending ? '正在保存并检查…' : status ?? (check.status === 'verified' ? '本次检查通过' : check.status === 'previously_verified' ? '上次检查通过，沿用历史回执' : check.configured ? '已保存，尚未验证语音服务' : '尚未配置')}{check.depth ? ` · ${check.depth === 'model_load' ? '模型加载' : '凭据访问'}` : ''}</p>
    {(error || downloadError || check.errorCode) && <p id="onboarding-speech-error" role="alert" className={`text-xs ${!error && !downloadError && check.errorCode === 'unsupported_check' ? 'text-status-warning' : 'text-status-error'}`}>{error ?? (check.messageKey === 'onboarding.language_unsupported' ? '当前语音服务不支持所选语言，请更改语言或服务。' : onboardingErrorText(downloadError?.errorCode ?? check.errorCode))}</p>}
    {(error || downloadError || check.status === 'failed') && <button disabled={busy} className={button} onClick={() => void (downloadError ? download() : validate())}>重试</button>}
    {check.errorCode === 'unsupported_check' && <button className={button} onClick={() => onOpenSettings('audio')}>返回原语音设置</button>}
  </section>;
}
