import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, AlertCircle, CheckCircle, Save, ChevronDown, Check, RefreshCw, ExternalLink, Loader2 } from 'lucide-react';
import { CODEX_CLI_MODEL, CODEX_CLI_MODEL_PRESETS, codexCliSelectorId, STANDARD_CLOUD_MODELS, prettifyModelId } from '../../utils/modelUtils';
import { validateCurl } from '../../lib/curl-validator';
import { ProviderCard } from './ProviderCard';
import { LocalModelsPanel } from '../LocalModelsPanel';

interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
    responsePath: string;
}

interface ModelOption {
    id: string;
    name: string;
}

interface ModelSelectProps {
    value: string;
    options: ModelOption[];
    onChange: (value: string) => void;
    placeholder?: string;
}

const ModelSelect: React.FC<ModelSelectProps> = ({ value, options, onChange, placeholder = "Select model" }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedOption = options.find(o => o.id === value);

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-40 bg-bg-input border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between hover:bg-bg-elevated transition-colors"
                type="button"
            >
                <span className="truncate pr-2">{selectedOption ? selectedOption.name : placeholder}</span>
                <ChevronDown size={14} className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-1 w-full bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto animated fadeIn">
                    <div className="p-1 space-y-0.5">
                        {options.map((option) => (
                            <button
                                key={option.id}
                                onClick={() => {
                                    onChange(option.id);
                                    setIsOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-xs rounded-md flex items-center justify-between group transition-colors ${value === option.id ? 'bg-bg-input hover:bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                type="button"
                            >
                                <span className="truncate">{option.name}</span>
                                {value === option.id && <Check size={14} className="text-accent-primary shrink-0 ml-2" />}
                            </button>
                        ))}
                        {options.length === 0 && (
                            <div className="px-3 py-2 text-xs text-gray-500 italic">无可用模型</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const CodexCliModelField: React.FC<{
    label: string;
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
    onSelect: (value: string) => void;
    onSave: () => void;
}> = ({ label, value, placeholder, onChange, onSelect, onSave }) => (
    <label className="space-y-1">
        <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">{label}</span>
        <div className="flex gap-2">
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                onBlur={onSave}
                className="min-w-0 flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                placeholder={placeholder}
            />
            <ModelSelect
                value={value}
                options={value && !CODEX_CLI_MODEL_PRESETS.some(option => option.id === value)
                    ? [{ id: value, name: prettifyModelId(value) }, ...CODEX_CLI_MODEL_PRESETS]
                    : CODEX_CLI_MODEL_PRESETS}
                onChange={(modelId) => {
                    onChange(modelId);
                    onSelect(modelId);
                }}
                placeholder="预设"
            />
        </div>
    </label>
);

export const AIProvidersSettings: React.FC = () => {
    const MASKED_KEY = '•'.repeat(24);
    const isMaskedCredentialValue = (value: string) => /^•+$/.test(value.trim());
    const mergeMaskedValue = (currentValue: string, maskedValue?: string) => {
        if (!maskedValue) {
            return isMaskedCredentialValue(currentValue) ? '' : currentValue;
        }
        if (!currentValue || isMaskedCredentialValue(currentValue)) {
            return maskedValue;
        }
        return currentValue;
    };

    // --- Standard Providers ---
    const [apiKey, setApiKey] = useState('');
    const [groqApiKey, setGroqApiKey] = useState('');
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    const [claudeApiKey, setClaudeApiKey] = useState('');
    const [doubaoApiKey, setDoubaoApiKey] = useState('');
    const [doubaoEmbeddingModel, setDoubaoEmbeddingModel] = useState('');

    // Status
    const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});
    const [savingStatus, setSavingStatus] = useState<Record<string, boolean>>({});
    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});
    const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
    const [testError, setTestError] = useState<Record<string, string>>({});

    // --- Custom Providers ---
    const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
    const [isEditingCustom, setIsEditingCustom] = useState(false);
    const [editingProvider, setEditingProvider] = useState<CustomProvider | null>(null);
    const [customName, setCustomName] = useState('');
    const [customCurl, setCustomCurl] = useState('');
    const [customResponsePath, setCustomResponsePath] = useState('');
    const [curlError, setCurlError] = useState<string | null>(null);

    // --- Local (Ollama) ---
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'detected' | 'not-found' | 'fixing'>('checking');
    const [ollamaRestarted, setOllamaRestarted] = useState(false);
    const [isRefreshingOllama, setIsRefreshingOllama] = useState(false);

    // --- Local (Codex CLI) ---
    const [codexCliConfig, setCodexCliConfig] = useState({ enabled: false, path: 'codex', model: 'gpt-5.4', timeoutMs: 60000 });
    const [codexCliStatus, setCodexCliStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [codexCliError, setCodexCliError] = useState('');

    // --- Default Model ---
    const [defaultModel, setDefaultModel] = useState<string>('gemini-3.1-flash-lite-preview');

    // --- Dynamic Model Discovery ---
    const [preferredModels, setPreferredModels] = useState<Record<string, string>>({});

    // --- Screen Understanding (vision routing) ---
    const [screenUnderstandingMode, setScreenUnderstandingMode] = useState<'vision_first' | 'vision_only' | 'private_vision'>('vision_first');
    const [technicalInterviewVisionFirst, setTechnicalInterviewVisionFirst] = useState<boolean>(true);

    // --- Cloud Provider Data Scopes (fail-closed cloud share controls) ---
    const [providerDataScopes, setProviderDataScopes] = useState<{ transcript?: boolean; screenshots?: boolean; reference_files?: boolean; profile_history?: boolean; embeddings?: boolean; post_call_summary?: boolean }>({});

    const reloadStoredCredentials = async () => {
        try {
            // @ts-ignore
            const creds = await window.electronAPI?.getStoredCredentials?.();
            if (creds) {
                setHasStoredKey({
                    gemini: creds.hasGeminiKey,
                    groq: creds.hasGroqKey,
                    openai: creds.hasOpenaiKey,
                    claude: creds.hasClaudeKey,
                    doubao: creds.hasDoubaoKey || false,
                    natively: creds.hasNativelyKey || false
                });
                setApiKey(prev => mergeMaskedValue(prev, creds.geminiKey));
                setGroqApiKey(prev => mergeMaskedValue(prev, creds.groqKey));
                setOpenaiApiKey(prev => mergeMaskedValue(prev, creds.openaiKey));
                setClaudeApiKey(prev => mergeMaskedValue(prev, creds.claudeKey));
                setDoubaoApiKey(prev => mergeMaskedValue(prev, creds.doubaoKey));
                const pm: Record<string, string> = {};
                if (creds.geminiPreferredModel) pm.gemini = creds.geminiPreferredModel;
                if (creds.groqPreferredModel) pm.groq = creds.groqPreferredModel;
                if (creds.openaiPreferredModel) pm.openai = creds.openaiPreferredModel;
                if (creds.claudePreferredModel) pm.claude = creds.claudePreferredModel;
                if (creds.doubaoPreferredModel) pm.doubao = creds.doubaoPreferredModel;
                setPreferredModels(pm);
                if (creds.doubaoEmbeddingModel) setDoubaoEmbeddingModel(creds.doubaoEmbeddingModel);
            }

            // @ts-ignore
            const cliConfig = await window.electronAPI?.getCodexCliConfig?.();
            if (cliConfig) setCodexCliConfig(cliConfig);

            // @ts-ignore
            const custom = await window.electronAPI?.getCustomProviders();
            if (custom) {
                setCustomProviders(custom);
            }

            // Load persisted default model
            // @ts-ignore
            const result = await window.electronAPI?.getDefaultModel();
            if (result && result.model) {
                setDefaultModel(result.model);
            }

        } catch (e) {
            console.error("Failed to load settings:", e);
        }
    };

    // Load Initial Data
    useEffect(() => {
        reloadStoredCredentials();
        checkOllama();

    }, []);

    useEffect(() => {
        if (!window.electronAPI?.onCredentialsChanged) return;
        const unsubscribe = window.electronAPI.onCredentialsChanged(() => {
            reloadStoredCredentials().catch((error) => {
                console.error('Failed to refresh credentials:', error);
            });
        });
        return () => unsubscribe();
    }, []);

    // Ollama polling disabled by default
    // useEffect(() => {
    //     ensureOllamaStartup();
    //     const interval = setInterval(() => checkOllama(false), 3000);
    //     return () => clearInterval(interval);
    // }, []);

    // Load Screen Understanding (vision routing) settings
    useEffect(() => {
        window.electronAPI?.getScreenUnderstandingMode?.().then(setScreenUnderstandingMode as any).catch(() => { });
        (window.electronAPI as any)?.getTechnicalInterviewVisionFirst?.()
            .then(setTechnicalInterviewVisionFirst)
            .catch(() => {
                // Fallback to deprecated alias if the renderer is talking to an older main process.
                window.electronAPI?.getTechnicalInterviewDirectVision?.().then(setTechnicalInterviewVisionFirst).catch(() => { });
            });
    }, []);

    useEffect(() => {
        const api: any = window.electronAPI;
        if (!api?.onScreenUnderstandingModeChanged) return;
        const unsubscribe = api.onScreenUnderstandingModeChanged(setScreenUnderstandingMode);
        return () => unsubscribe?.();
    }, []);

    useEffect(() => {
        const api: any = window.electronAPI;
        const handler = (enabled: boolean) => setTechnicalInterviewVisionFirst(enabled);
        const unsub1 = api?.onTechnicalInterviewVisionFirstChanged?.(handler);
        const unsub2 = api?.onTechnicalInterviewDirectVisionChanged?.(handler);
        return () => {
            unsub1?.();
            unsub2?.();
        };
    }, []);

    // Load Cloud Provider Data Scopes and subscribe to cross-window changes
    useEffect(() => {
        window.electronAPI?.getProviderDataScopes?.().then(setProviderDataScopes).catch(() => { });
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onProviderDataScopesChanged) {
            const unsubscribe = window.electronAPI.onProviderDataScopesChanged(setProviderDataScopes);
            return () => unsubscribe();
        }
    }, []);

    // Load Screen Understanding (vision routing) settings
    useEffect(() => {
        window.electronAPI?.getScreenUnderstandingMode?.().then(setScreenUnderstandingMode as any).catch(() => { });
        (window.electronAPI as any)?.getTechnicalInterviewVisionFirst?.()
            .then(setTechnicalInterviewVisionFirst)
            .catch(() => {
                // Fallback to deprecated alias if the renderer is talking to an older main process.
                window.electronAPI?.getTechnicalInterviewDirectVision?.().then(setTechnicalInterviewVisionFirst).catch(() => { });
            });
    }, []);

    useEffect(() => {
        const api: any = window.electronAPI;
        if (!api?.onScreenUnderstandingModeChanged) return;
        const unsubscribe = api.onScreenUnderstandingModeChanged(setScreenUnderstandingMode);
        return () => unsubscribe?.();
    }, []);

    useEffect(() => {
        const api: any = window.electronAPI;
        const handler = (enabled: boolean) => setTechnicalInterviewVisionFirst(enabled);
        const unsub1 = api?.onTechnicalInterviewVisionFirstChanged?.(handler);
        const unsub2 = api?.onTechnicalInterviewDirectVisionChanged?.(handler);
        return () => {
            unsub1?.();
            unsub2?.();
        };
    }, []);

    // Load Cloud Provider Data Scopes and subscribe to cross-window changes
    useEffect(() => {
        window.electronAPI?.getProviderDataScopes?.().then(setProviderDataScopes).catch(() => { });
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onProviderDataScopesChanged) {
            const unsubscribe = window.electronAPI.onProviderDataScopesChanged(setProviderDataScopes);
            return () => unsubscribe();
        }
    }, []);

    const ensureOllamaStartup = async () => {
        setOllamaStatus('checking');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.invoke?.('ensure-ollama-running');
            if (result && result.success) {
                // It's running (or just started), now fetch models
                checkOllama(true);
            } else {
                setOllamaStatus('not-found');
            }
        } catch (e) {
            console.warn("Ollama ensure startup failed:", e);
            setOllamaStatus('not-found');
        }
    };

    const checkOllama = async (_isInitial = true) => {
        // Don't override 'checking' if we are already in smart-start mode
        // if (isInitial) setOllamaStatus('checking'); 

        try {
            // @ts-ignore
            const models = await window.electronAPI?.getAvailableOllamaModels?.();
            if (models && models.length > 0) {
                setOllamaModels(models);
                setOllamaStatus('detected');
            } else {
                // Silent failure on background checks
                // Only set not-found if we haven't detected it yet
                if (ollamaStatus !== 'detected') {
                    setOllamaStatus('not-found');
                }
            }
        } catch (e) {
            // console.warn(`Ollama check failed:`, e);
            if (ollamaStatus !== 'detected') {
                setOllamaStatus('not-found');
            }
        }
    };

    const handleFixOllama = async () => {
        setOllamaStatus('fixing');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.invoke?.('force-restart-ollama');
            if (result && result.success) {
                setOllamaRestarted(true);
                // Wait for server to be ready
                setTimeout(() => checkOllama(false), 2000);
            } else {
                setOllamaStatus('not-found');
            }
        } catch (e) {
            console.error("Fix failed", e);
            setOllamaStatus('not-found');
        }
    };

    const saveCodexCliConfig = async (next = codexCliConfig) => {
        const normalized = { ...next, timeoutMs: Number(next.timeoutMs) || 60000 };
        setCodexCliConfig(normalized);
        const result = await window.electronAPI?.setCodexCliConfig?.(normalized);
        if (result?.config) setCodexCliConfig(result.config);
        return result;
    };

    const handleTestCodexCli = async () => {
        setCodexCliStatus('testing');
        setCodexCliError('');
        try {
            const saveResult = await saveCodexCliConfig();
            const configToTest = saveResult?.config || codexCliConfig;
            const result = await window.electronAPI?.testCodexCli?.(configToTest);
            if (result?.success) {
                // If the main process auto-detected an install, reflect the
                // resolved path in the form so the user sees what got picked.
                if (result.config) setCodexCliConfig(result.config);
                setCodexCliStatus('success');
                setTimeout(() => setCodexCliStatus('idle'), 3000);
            } else {
                setCodexCliStatus('error');
                setCodexCliError(result?.error || 'Codex CLI test failed');
            }
        } catch (e: any) {
            setCodexCliStatus('error');
            setCodexCliError(e.message || 'Codex CLI test failed');
        }
    };

    const handleSaveKey = async (provider: string, key: string, setter: (val: string) => void) => {
        if (!key.trim() || isMaskedCredentialValue(key)) return;
        setSavingStatus(prev => ({ ...prev, [provider]: true }));
        try {
            let result;
            // @ts-ignore
            if (provider === 'gemini') result = await window.electronAPI.setGeminiApiKey(key);
            // @ts-ignore
            if (provider === 'groq') result = await window.electronAPI.setGroqApiKey(key);
            // @ts-ignore
            if (provider === 'openai') result = await window.electronAPI.setOpenaiApiKey(key);
            // @ts-ignore
            if (provider === 'claude') result = await window.electronAPI.setClaudeApiKey(key);
            // @ts-ignore
            if (provider === 'doubao') result = await window.electronAPI.setDoubaoLlmApiKey(key);

            if (result && result.success) {
                setSavedStatus(prev => ({ ...prev, [provider]: true }));
                setHasStoredKey(prev => ({ ...prev, [provider]: true }));
                setter(MASKED_KEY);
                setTimeout(() => setSavedStatus(prev => ({ ...prev, [provider]: false })), 2000);
            }
        } catch (e) {
            console.error(`Failed to save ${provider} key:`, e);
        } finally {
            setSavingStatus(prev => ({ ...prev, [provider]: false }));
        }
    };

    const handleRemoveKey = async (provider: string, setter: (val: string) => void) => {
        if (!confirm(`Are you sure you want to remove the ${provider} API key?`)) return;
        try {
            let result;
            // @ts-ignore
            if (provider === 'gemini') result = await window.electronAPI.setGeminiApiKey('');
            // @ts-ignore
            if (provider === 'groq') result = await window.electronAPI.setGroqApiKey('');
            // @ts-ignore
            if (provider === 'openai') result = await window.electronAPI.setOpenaiApiKey('');
            // @ts-ignore
            if (provider === 'claude') result = await window.electronAPI.setClaudeApiKey('');
            // @ts-ignore
            if (provider === 'doubao') result = await window.electronAPI.setDoubaoLlmApiKey('');

            if (result && result.success) {
                setHasStoredKey(prev => ({ ...prev, [provider]: false }));
                setter('');
            }
        } catch (e) {
            console.error(`Failed to remove ${provider} key:`, e);
        }
    };

    const handleTestConnection = async (provider: string, key: string) => {
        const normalizedKey = isMaskedCredentialValue(key) ? '' : key;
        // Allow testing if key is provided OR if we have a stored key
        if (!normalizedKey.trim() && !hasStoredKey[provider]) {
            return;
        }
        setTestStatus(prev => ({ ...prev, [provider]: 'testing' }));
        setTestError(prev => ({ ...prev, [provider]: '' }));

        try {
            // @ts-ignore
            const result = await window.electronAPI.testLlmConnection(provider, normalizedKey);
            if (result.success) {
                setTestStatus(prev => ({ ...prev, [provider]: 'success' }));
                setTimeout(() => setTestStatus(prev => ({ ...prev, [provider]: 'idle' })), 3000);
            } else {
                setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
                setTestError(prev => ({ ...prev, [provider]: result.error || '连接失败' }));
            }
        } catch (e: any) {
            setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
            setTestError(prev => ({ ...prev, [provider]: e.message || '连接失败' }));
        }
    };

    const openKeyUrl = (provider: string) => {
        const urls: Record<string, string> = {
            gemini: 'https://aistudio.google.com/app/apikey',
            groq: 'https://console.groq.com/keys',
            openai: 'https://platform.openai.com/api-keys',
            claude: 'https://console.anthropic.com/settings/keys',
            doubao: 'https://www.volcengine.com/docs/82379/1494384?lang=zh'
        };
        // @ts-ignore
        window.electronAPI?.openExternal(urls[provider]);
    };


    // --- Custom Provider Handlers ---

    const handleEditProvider = (provider: CustomProvider) => {
        setEditingProvider(provider);
        setCustomName(provider.name);
        setCustomCurl(provider.curlCommand);
        setCustomResponsePath(provider.responsePath || '');
        setIsEditingCustom(true);
        setCurlError(null);
    };

    const handleNewProvider = () => {
        setEditingProvider(null);
        setCustomName('');
        setCustomCurl('');
        setCustomResponsePath('');
        setIsEditingCustom(true);
        setCurlError(null);
    };

    const handleSaveCustom = async () => {
        setCurlError(null);
        if (!customName.trim()) {
            setCurlError("Provider Name is required.");
            return;
        }

        const validation = validateCurl(customCurl);
        if (!validation.isValid) {
            setCurlError(validation.message || "Invalid cURL command.");
            return;
        }

        const newProvider: CustomProvider = {
            id: editingProvider ? editingProvider.id : crypto.randomUUID(),
            name: customName,
            curlCommand: customCurl,
            responsePath: customResponsePath
        };

        try {
            // @ts-ignore
            const result = await window.electronAPI.saveCustomProvider(newProvider);
            if (result.success) {
                // Refresh list
                // @ts-ignore
                const updated = await window.electronAPI.getCustomProviders();
                setCustomProviders(updated);
                setIsEditingCustom(false);
            } else {
                setCurlError(result.error ?? null);
            }
        } catch (e: any) {
            setCurlError(e.message);
        }
    };

    const handleDeleteCustom = async (id: string) => {
        if (!confirm("Are you sure you want to delete this provider?")) return;
        try {
            // @ts-ignore
            const result = await window.electronAPI.deleteCustomProvider(id);
            if (result.success) {
                // @ts-ignore
                const updated = await window.electronAPI.getCustomProviders();
                setCustomProviders(updated);
            }
        } catch (e) {
            console.error("Failed to delete provider:", e);
        }
    };

    return (
        <div className="space-y-5 animated fadeIn pb-10">
            {/* Default Model for Chat */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">聊天默认模型</h3>
                    <p className="text-xs text-text-secondary mb-2">Primary model for new chats. Other configured models act as fallbacks.</p>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between">
                    <div>
                        <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">当前模型</label>
                        <p className="text-[10px] text-text-secondary">Applies to new chats instantly.</p>
                    </div>
                    <ModelSelect
                        value={defaultModel}
                        options={(() => {
                            const opts: { id: string; name: string }[] = [];

                            if (hasStoredKey.natively) {
                                opts.push({ id: 'natively', name: 'Natively API' });
                            }

                            for (const [prov, cfg] of Object.entries(STANDARD_CLOUD_MODELS)) {
                                if (!hasStoredKey[prov as keyof typeof hasStoredKey]) continue;
                                cfg.ids.forEach((id, i) => opts.push({ id, name: cfg.names[i] }));
                                const pm = preferredModels[prov as keyof typeof preferredModels];
                                if (pm && !cfg.ids.includes(pm)) {
                                    opts.push({ id: pm, name: prettifyModelId(pm) });
                                }
                            }
                            if (codexCliConfig.enabled) {
                                opts.push({ id: CODEX_CLI_MODEL.id, name: `${CODEX_CLI_MODEL.name} (${prettifyModelId(codexCliConfig.model)})` });
                                CODEX_CLI_MODEL_PRESETS.forEach(model => {
                                    const id = codexCliSelectorId(model.id);
                                    if (!opts.find(o => o.id === id)) {
                                        opts.push({ id, name: `${CODEX_CLI_MODEL.name}: ${model.name}` });
                                    }
                                });
                            }
                            customProviders.forEach(p => opts.push({ id: p.id, name: p.name }));
                            // Ollama models hidden by default
                            // ollamaModels.forEach(m => opts.push({ id: `ollama-${m}`, name: `${m} (Local)` }));

                            if (defaultModel && !opts.find(o => o.id === defaultModel)) {
                                opts.unshift({ id: defaultModel, name: prettifyModelId(defaultModel) });
                            }
                            return opts;
                        })()}
                        onChange={(val) => {
                            setDefaultModel(val);
                            // @ts-ignore - persist as default + update runtime + broadcast
                            window.electronAPI?.setDefaultModel(val).catch(console.error);
                        }}
                    />
                </div>

            </div>

            {/* Cloud Providers */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">云提供商</h3>
                    <p className="text-xs text-text-secondary mb-2">Add API keys to unlock cloud AI models.</p>
                </div>

                <div className="space-y-4">
                    {/* Doubao */}
                    <ProviderCard
                        providerId="doubao"
                        providerName="Doubao (Volcengine)"
                        apiKey={doubaoApiKey}
                        preferredModel={preferredModels.doubao}
                        hasStoredKey={!!hasStoredKey.doubao}
                        onKeyChange={setDoubaoApiKey}
                        onSaveKey={async () => { await handleSaveKey('doubao', doubaoApiKey, setDoubaoApiKey); }}
                        onRemoveKey={() => handleRemoveKey('doubao', setDoubaoApiKey)}
                        onTestConnection={() => handleTestConnection('doubao', doubaoApiKey)}
                        testStatus={testStatus.doubao || 'idle'}
                        testError={testError.doubao}
                        savingStatus={!!savingStatus.doubao}
                        savedStatus={!!savedStatus.doubao}
                        keyPlaceholder="Bearer ..."
                        keyUrl="https://www.volcengine.com/docs/82379/1494384?lang=zh"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, doubao: model }))}
                    />
                    {/* Doubao Embedding Endpoint ID */}
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle mt-3">
                        {/* Active warning when Doubao API key is set but embedding endpoint ID is missing.
                         * Without this, the embedding pipeline silently demotes to the bundled local
                         * 384d model and the user has no signal that RAG quality is degraded.
                         * See EmbeddingProviderResolver.ts:71 (the `; skipping` log). */}
                        {hasStoredKey.doubao && !doubaoEmbeddingModel && (
                            <div className="mb-3 flex items-start gap-2 rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-[11px] text-text-primary">
                                <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                                <div className="leading-relaxed">
                                    <div className="font-medium">Doubao API key 已配置，但缺少 Embedding Endpoint ID</div>
                                    <div className="text-text-secondary mt-0.5">
                                        RAG 向量搜索将自动降级到本地 384d 模型，质量与速度均受影响。填写下方 Endpoint ID 可恢复 Doubao 云端 embedding。
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="mb-2 flex items-center justify-between">
                            <label className="flex items-center text-xs font-medium text-text-primary uppercase tracking-wide">
                                Doubao Embedding Endpoint ID
                                {doubaoEmbeddingModel && <span className="ml-2 text-green-500 normal-case">✓ Saved</span>}
                            </label>
                            <span className="text-[10px] text-text-tertiary">用于 RAG 向量搜索</span>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={doubaoEmbeddingModel}
                                onChange={(e) => setDoubaoEmbeddingModel(e.target.value)}
                                placeholder="ep-20260321165850-k9w7r  ←  在方舟控制台创建 Embedding 推理接入点后复制"
                                className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary transition-colors"
                            />
                            <button
                                onClick={async () => {
                                    // @ts-ignore
                                    const result = await window.electronAPI?.setDoubaoEmbeddingModel?.(doubaoEmbeddingModel);
                                    if (result?.success) {
                                        setSavedStatus(prev => ({ ...prev, doubaoEmbedding: true }));
                                        setTimeout(() => setSavedStatus(prev => ({ ...prev, doubaoEmbedding: false })), 2000);
                                    }
                                }}
                                disabled={!doubaoEmbeddingModel.trim()}
                                className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-colors ${savedStatus.doubaoEmbedding
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-bg-input hover:bg-bg-secondary border border-border-subtle text-text-primary disabled:opacity-50'
                                    }`}
                            >
                                {savedStatus.doubaoEmbedding ? 'Saved!' : 'Save'}
                            </button>
                        </div>
                        <p className="text-[10px] text-text-secondary mt-2">
                            在<a href="https://console.volcengine.com/ark/region:ark+cn-beijing/model" target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline">方舟控制台</a>创建 Embedding 推理接入点，复制 Endpoint ID（以 <code className="bg-bg-input px-1 rounded">ep-</code> 开头）粘贴到此处。
                        </p>
                    </div>

                </div>
            </div>

            {/* Local (Codex CLI) Provider */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Local Provider (Codex CLI)</h3>
                    <p className="text-xs text-text-secondary">Route text and screenshot responses through a locally authenticated Codex CLI.</p>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">启用 Codex CLI</label>
                            <p className="text-[10px] text-text-secondary">Adds Codex CLI as a selectable local backend and fallback.</p>
                        </div>
                        <button
                            type="button"
                            onClick={async () => {
                                const next = { ...codexCliConfig, enabled: !codexCliConfig.enabled };
                                await saveCodexCliConfig(next);
                            }}
                            className={`w-11 h-6 rounded-full relative transition-colors ${codexCliConfig.enabled ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                        >
                            <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${codexCliConfig.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="space-y-1">
                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">可执行文件</span>
                            <input
                                value={codexCliConfig.path}
                                onChange={e => setCodexCliConfig(prev => ({ ...prev, path: e.target.value }))}
                                onBlur={() => saveCodexCliConfig()}
                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                                placeholder="codex"
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide">Timeout (ms)</span>
                            <input
                                type="number"
                                value={codexCliConfig.timeoutMs}
                                onChange={e => setCodexCliConfig(prev => ({ ...prev, timeoutMs: Number(e.target.value) }))}
                                onBlur={() => saveCodexCliConfig()}
                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                                min={1000}
                            />
                        </label>
                        <CodexCliModelField
                            label="普通模型"
                            value={codexCliConfig.model}
                            placeholder="gpt-5.5"
                            onChange={(model) => setCodexCliConfig(prev => ({ ...prev, model }))}
                            onSelect={(model) => saveCodexCliConfig({ ...codexCliConfig, model })}
                            onSave={() => saveCodexCliConfig()}
                        />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                        <div className="min-h-5">
                            {codexCliStatus === 'success' && (
                                <div className="flex items-center gap-2 text-xs text-green-400">
                                    <CheckCircle size={14} />
                                    <span>检测到 Codex CLI</span>
                                </div>
                            )}
                            {codexCliStatus === 'error' && (
                                <div className="flex items-center gap-2 text-xs text-red-400">
                                    <AlertCircle size={14} />
                                    <span>{codexCliError}</span>
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={handleTestCodexCli}
                            disabled={codexCliStatus === 'testing'}
                            className="flex items-center gap-2 px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary transition-colors disabled:opacity-60"
                        >
                            {codexCliStatus === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                            Test CLI
                        </button>
                    </div>
                </div>
            </div>

            {/* Local (Ollama) Providers — hidden by default */}
            {false && (
            <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h3 className="text-sm font-bold text-text-primary mb-1">Local Models (Ollama)</h3>
                        <p className="text-xs text-text-secondary">Run open-source models locally.</p>
                    </div>
                    <button
                        onClick={async () => {
                            setIsRefreshingOllama(true);
                            await checkOllama(false);
                            setTimeout(() => setIsRefreshingOllama(false), 500);
                        }}
                        className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors"
                        title="刷新 Ollama"
                        disabled={isRefreshingOllama}
                    >
                        <RefreshCw size={18} className={isRefreshingOllama ? "animate-spin" : ""} />
                    </button>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                    {ollamaStatus === 'checking' && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                            <span className="animate-spin">⏳</span> Checking for Ollama...
                        </div>
                    )}

                    {ollamaStatus === 'fixing' && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                            <span className="animate-spin">🔧</span> Attempting to auto-fix connection...
                        </div>
                    )}

                    {ollamaStatus === 'not-found' && (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 text-xs text-red-400">
                                <AlertCircle size={14} />
                                <span>未检测到 Ollama</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <p className="text-xs text-text-secondary">
                                    Ensure Ollama is running (`ollama serve`).
                                </p>
                                <button
                                    onClick={handleFixOllama}
                                    className="text-[10px] bg-bg-elevated hover:bg-bg-input px-2 py-1 rounded border border-border-subtle"
                                >
                                    Auto-Fix Connection
                                </button>
                            </div>
                        </div>
                    )}

                    {ollamaStatus === 'detected' && ollamaModels.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-xs text-green-400 mb-3">
                                <CheckCircle size={14} />
                                <span>Ollama 已连接</span>
                            </div>

                            <div className="grid grid-cols-1 gap-2">
                                {ollamaModels.map(model => (
                                    <div key={model} className="flex items-center justify-between p-2 bg-bg-input rounded-lg border border-border-subtle">
                                        <span className="text-xs text-text-primary font-mono">{model}</span>
                                        <span className="text-[10px] text-bg-elevated bg-text-secondary px-1.5 py-0.5 rounded-full font-bold">本地</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {ollamaStatus === 'detected' && ollamaModels.length === 0 && (
                        <div className="text-xs text-text-secondary">
                            Ollama is running but no models found. Run `ollama pull llama3` to get started.
                        </div>
                    )}
                </div>
            </div>
            )}

            {/* Custom Providers */}
            <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-bold text-text-primary">自定义提供商</h3>
                            <span className="px-1.5 py-0 rounded-full text-[7px] font-bold bg-yellow-500/10 text-yellow-500 uppercase tracking-widest border border-yellow-500/20 leading-loose mt-0.5">实验性</span>
                        </div>
                        <p className="text-xs text-text-secondary">Add your own AI endpoints via cURL.</p>
                    </div>
                    {!isEditingCustom && (
                        <button
                            onClick={handleNewProvider}
                            className="flex items-center gap-2 px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary transition-colors"
                        >
                            <Plus size={14} /> Add Provider
                        </button>
                    )}
                </div>

                {isEditingCustom ? (
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle animated fadeIn">
                        <h4 className="text-sm font-bold text-text-primary mb-4">{editingProvider ? 'Edit Provider' : 'New Provider'}</h4>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">提供商名称</label>
                                <input
                                    type="text"
                                    value={customName}
                                    onChange={(e) => setCustomName(e.target.value)}
                                    placeholder="我的自定义 LLM"
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">cURL Command</label>
                                <div className="relative">
                                    <textarea
                                        value={customCurl}
                                        onChange={(e) => setCustomCurl(e.target.value)}
                                        placeholder={`curl https://api.openai.com/v1/chat/completions ... "content": "{{TEXT}}"`}
                                        className="w-full h-32 bg-bg-input border border-border-subtle rounded-lg p-4 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary transition-colors resize-none leading-relaxed"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">
                                    Response JSON Path <span className="text-text-tertiary normal-case font-normal">(Optional)</span>
                                </label>
                                <input
                                    type="text"
                                    value={customResponsePath}
                                    onChange={(e) => setCustomResponsePath(e.target.value)}
                                    placeholder="例如 choices[0].message.content"
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors font-mono"
                                />
                                <p className="text-[10px] text-text-secondary mt-1">
                                    Dot notation path to the answer text in the JSON response. If empty, the full JSON is returned.
                                </p>
                            </div>

                            <div className="bg-bg-elevated/30 rounded-lg overflow-hidden border border-border-subtle mt-4">
                                <div className="px-4 py-3 bg-bg-elevated/50 border-b border-border-subtle flex items-center justify-between">
                                    <h5 className="block text-xs font-medium text-text-primary uppercase tracking-wide">
                                        Configuration Guide
                                    </h5>
                                </div>

                                <div className="p-4 space-y-4">
                                    <div>
                                        <p className="text-xs text-text-secondary mb-2 font-medium">可用变量</p>
                                        <div className="grid grid-cols-1 gap-2">
                                            <div className="flex items-center gap-2 text-xs">
                                                <code className="bg-bg-input px-1.5 py-0.5 rounded text-text-primary font-mono border border-border-subtle">{"{{TEXT}}"}</code>
                                                <span className="text-text-tertiary">Combined System + Context + Message (Recommended)</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs">
                                                <code className="bg-bg-input px-1.5 py-0.5 rounded text-text-primary font-mono border border-border-subtle">{"{{IMAGE_BASE64}}"}</code>
                                                <span className="text-text-tertiary">Screenshot data (if available)</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-xs text-text-secondary mb-2 font-medium">示例</p>
                                        <div className="space-y-3">
                                            {/* Ollama Example */}
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">Local (Ollama)</div>
                                                <div className="bg-bg-input p-2.5 rounded-lg border border-border-subtle overflow-x-auto group relative">
                                                    <code className="font-mono text-[10px] text-text-primary whitespace-pre block">
                                                        curl http://localhost:11434/api/generate -d '{"{"}"model": "llama3", "prompt": "{`{{TEXT}}`}"{"}"}'
                                                    </code>
                                                </div>
                                            </div>

                                            {/* OpenAI Example */}
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">OpenAI 兼容</div>
                                                <div className="bg-bg-input p-2.5 rounded-lg border border-border-subtle overflow-x-auto">
                                                    <code className="font-mono text-[10px] text-text-primary whitespace-pre block">
                                                        {`curl https://api.openai.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "{{TEXT}}"}
    ],
    "temperature": 0.7
  }'`}
                                                    </code>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {curlError && (
                                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                    <span>{curlError}</span>
                                </div>
                            )}

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    onClick={() => setIsEditingCustom(false)}
                                    className="px-4 py-2 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveCustom}
                                    className="px-4 py-2 rounded-lg text-xs font-medium bg-accent-primary text-white hover:bg-accent-secondary transition-colors flex items-center gap-2"
                                >
                                    <Save size={14} /> Save Provider
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {customProviders.length === 0 ? (
                            <div className="text-center py-8 bg-bg-item-surface rounded-xl border border-border-subtle border-dashed">
                                <p className="text-xs text-text-tertiary">No custom providers added yet.</p>
                            </div>
                        ) : (
                            customProviders.map((provider) => (
                                <div key={provider.id} className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle flex items-center justify-between group">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-bg-input flex items-center justify-center text-text-secondary font-mono text-xs font-bold">
                                            {provider.name.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-medium text-text-primary">{provider.name}</h4>
                                            <p className="text-[10px] text-text-tertiary font-mono truncate max-w-[200px] opacity-60">
                                                {provider.curlCommand.substring(0, 30)}...
                                            </p>
                                            {provider.responsePath && (
                                                <p className="text-[9px] text-text-tertiary font-mono opacity-40 mt-0.5">
                                                    path: {provider.responsePath}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => handleEditProvider(provider)}
                                            className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                                            title="编辑"
                                        >
                                            <Edit2 size={14} />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteCustom(provider.id)}
                                            className="p-1.5 rounded-lg text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                            title="删除"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

            {/* Screen Understanding — vision-first routing */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">屏幕理解</h3>
                    <p className="text-xs text-text-secondary mb-2">Pick how Natively reads what is on your screen. All paths use the vision-capable AI provider directly; OCR is no longer used.</p>
                </div>
                <div className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle flex flex-col gap-2">
                    {([
                        {
                            value: 'vision_first' as const,
                            label: 'Vision first',
                            description: 'Recommended. Try every configured vision provider in order; first success wins.',
                        },
                        {
                            value: 'vision_only' as const,
                            label: 'Vision only',
                            description: 'Stricter. Require a vision-capable provider; never silently drop the screenshot.',
                        },
                        {
                            value: 'private_vision' as const,
                            label: 'Private vision (local only)',
                            description: 'Use a local vision model (Ollama) only. Never call cloud vision. Clear error if no local provider is configured.',
                        },
                    ]).map(({ value, label, description }) => {
                        const selected = screenUnderstandingMode === value;
                        return (
                            <div
                                key={value}
                                onClick={() => {
                                    setScreenUnderstandingMode(value);
                                    window.electronAPI?.setScreenUnderstandingMode?.(value);
                                }}
                                className={`px-3 py-2 rounded-lg border cursor-pointer transition-colors ${selected ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-border-subtle hover:border-border-muted bg-bg-elevated/50'}`}
                                role="radio"
                                aria-checked={selected}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex flex-col">
                                        <span className={`text-xs font-semibold ${selected ? 'text-emerald-300' : 'text-text-primary'}`}>{label}</span>
                                        <span className="text-[11px] text-text-secondary leading-snug mt-0.5">{description}</span>
                                    </div>
                                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${selected ? 'border-emerald-400 bg-emerald-400' : 'border-border-muted'}`} />
                                </div>
                            </div>
                        );
                    })}
                    <div className="flex items-center justify-between pt-2 mt-1 border-t border-border-subtle">
                        <div className="flex flex-col">
                            <span className="text-xs text-text-primary font-semibold">技术面试直接视角</span>
                            <span className="text-[11px] text-text-secondary leading-snug mt-0.5">Use the highest-resolution image profile so code text stays sharp in interview mode.</span>
                        </div>
                        <div
                            onClick={() => {
                                const next = !technicalInterviewVisionFirst;
                                setTechnicalInterviewVisionFirst(next);
                                const api: any = window.electronAPI;
                                if (api?.setTechnicalInterviewVisionFirst) {
                                    api.setTechnicalInterviewVisionFirst(next);
                                } else {
                                    window.electronAPI?.setTechnicalInterviewDirectVision?.(next);
                                }
                            }}
                            className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer shrink-0 ${technicalInterviewVisionFirst ? 'bg-emerald-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                            role="switch"
                            aria-checked={technicalInterviewVisionFirst}
                        >
                            <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${technicalInterviewVisionFirst ? 'translate-x-4' : 'translate-x-0'}`} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Cloud Provider Data Scopes — fail-closed cloud share controls */}
            <div className="space-y-5" data-testid="cloud-provider-data-scopes">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">云提供商数据范围</h3>
                    <p className="text-xs text-text-secondary mb-2">Control what data cloud AI providers can access. Disabled types are handled locally for privacy.</p>
                </div>
                <div className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle flex flex-col gap-2">
                    {([
                        { key: 'transcript', label: 'Transcripts' },
                        { key: 'screenshots', label: 'Screenshots' },
                        { key: 'reference_files', label: 'Reference files' },
                        { key: 'profile_history', label: 'Profile history' },
                        { key: 'embeddings', label: 'Cloud embeddings' },
                        { key: 'post_call_summary', label: 'Post-call summaries' },
                    ] as const).map(({ key, label }) => {
                        const allowed = providerDataScopes[key] !== false;
                        return (
                            <div key={key} className="flex items-center justify-between">
                                <span className="text-xs text-text-secondary">{label}</span>
                                <div
                                    onClick={() => {
                                        const next = { ...providerDataScopes, [key]: !allowed };
                                        setProviderDataScopes(next);
                                        window.electronAPI?.setProviderDataScopes?.(next);
                                    }}
                                    className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${allowed ? 'bg-emerald-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                    role="switch"
                                    aria-checked={allowed}
                                    aria-label={`Allow ${label} to cloud providers`}
                                >
                                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${allowed ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                            </div>
                        );
                    })}
                    <div className="flex items-start gap-2 mt-1 pt-3 border-t border-border-subtle">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-tertiary shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                        <p className="text-[11px] text-text-tertiary leading-relaxed">When a data type is disabled, Natively falls back to the best available local model to keep that data on-device.</p>
                    </div>
                </div>
            </div>

            {/* Local ONNX Models */}
            <LocalModelsPanel />
            </div>
        </div>
    );
};
