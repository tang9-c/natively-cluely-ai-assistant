import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle, FolderOpen, RefreshCw, Sparkles } from 'lucide-react';
import type {
    SkillActivation,
    SkillSettings,
    SkillSummary,
    SkillWatcherSettings,
    SkillWatcherSuggestion,
} from '../../types/electron';

export const SkillsSettings: React.FC = () => {
    const [skills, setSkills] = useState<SkillSummary[]>([]);
    const [skillsPath, setSkillsPath] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [skillSettings, setSkillSettings] = useState<SkillSettings>({
        defaultActiveSkillIds: [],
        skillsAutoTriggerEnabled: true,
    });
    const [activations, setActivations] = useState<SkillActivation[]>([]);
    const [watcherSettings, setWatcherSettings] = useState<SkillWatcherSettings>({
        skillsWatcherEnabled: false,
        skillsWatcherAutoActivateThreshold: 0.86,
        skillsWatcherSuggestThreshold: 0.65,
    });
    const [watcherSuggestions, setWatcherSuggestions] = useState<SkillWatcherSuggestion[]>([]);

    const loadWatcherState = useCallback(async () => {
        if (typeof window.electronAPI?.skillsGetWatcherSettings !== 'function') {
            throw new Error('技能转录监听设置桥接不可用。');
        }
        if (typeof window.electronAPI?.skillsListWatcherSuggestions !== 'function') {
            throw new Error('技能转录监听建议桥接不可用。');
        }

        const [settings, suggestions] = await Promise.all([
            window.electronAPI.skillsGetWatcherSettings(),
            window.electronAPI.skillsListWatcherSuggestions(),
        ]);
        setWatcherSettings(settings);
        setWatcherSuggestions(Array.isArray(suggestions) ? suggestions : []);
    }, []);

    const loadSkills = useCallback(async () => {
        setLoading(true);
        try {
            if (typeof window.electronAPI?.skillsRefresh !== 'function') {
                setStatus('未检测到技能 IPC 桥接，window.electronAPI 上可能缺少 preload 暴露。');
                setSkills([]);
                return;
            }
            const list = await window.electronAPI.skillsRefresh();
            setSkills(Array.isArray(list) ? list : []);

            if (typeof window.electronAPI?.skillsGetSettings !== 'function') {
                setStatus('未检测到技能设置桥接，window.electronAPI 上可能缺少 preload 暴露。');
                return;
            }
            if (typeof window.electronAPI?.skillsListActivations !== 'function') {
                setStatus('未检测到技能激活桥接，window.electronAPI 上可能缺少 preload 暴露。');
                return;
            }

            const settings = await window.electronAPI.skillsGetSettings();
            setSkillSettings({
                defaultActiveSkillIds: Array.isArray(settings?.defaultActiveSkillIds) ? settings.defaultActiveSkillIds : [],
                skillsAutoTriggerEnabled: settings?.skillsAutoTriggerEnabled !== false,
            });

            const active = await window.electronAPI.skillsListActivations();
            setActivations(Array.isArray(active) ? active : []);
            await loadWatcherState();
            setStatus(null);
        } catch (error: any) {
            setStatus(error?.message || '无法加载技能。');
        } finally {
            setLoading(false);
        }
    }, [loadWatcherState]);

    useEffect(() => {
        loadSkills();
    }, [loadSkills]);

    useEffect(() => {
        if (typeof window.electronAPI?.onSkillWatcherSuggestionCreated !== 'function') {
            return;
        }
        return window.electronAPI.onSkillWatcherSuggestionCreated(({ suggestion }) => {
            setWatcherSuggestions((current) => [
                suggestion,
                ...current.filter((item) => item.id !== suggestion.id),
            ]);
        });
    }, []);

    const openFolder = async () => {
        try {
            if (typeof window.electronAPI?.skillsOpenFolder !== 'function') {
                setStatus('未检测到技能 IPC 桥接，window.electronAPI 上可能缺少 preload 暴露。');
                return;
            }
            const result = await window.electronAPI.skillsOpenFolder();
            if (result?.path) setSkillsPath(result.path);
            if (!result?.success && result?.error) setStatus(result.error);
        } catch (error: any) {
            setStatus(error?.message || '无法打开技能文件夹。');
        }
    };

    const saveSkillSettings = async (next: SkillSettings) => {
        if (typeof window.electronAPI?.skillsSetSettings !== 'function') {
            setStatus('未检测到技能设置桥接，window.electronAPI 上可能缺少 preload 暴露。');
            return;
        }

        setSkillSettings(next);
        const result = await window.electronAPI.skillsSetSettings(next);
        if (!result?.success) {
            setStatus(result?.error || '无法保存技能设置。');
            await loadSkills();
        } else {
            setStatus(null);
        }
    };

    const toggleDefaultSkill = async (skillId: string) => {
        const current = new Set(skillSettings.defaultActiveSkillIds);
        if (current.has(skillId)) {
            current.delete(skillId);
        } else {
            current.add(skillId);
        }

        await saveSkillSettings({
            ...skillSettings,
            defaultActiveSkillIds: Array.from(current),
        });
    };

    const toggleAutoTrigger = async () => {
        await saveSkillSettings({
            ...skillSettings,
            skillsAutoTriggerEnabled: !skillSettings.skillsAutoTriggerEnabled,
        });
    };

    const updateWatcherSettings = async (next: SkillWatcherSettings) => {
        if (typeof window.electronAPI?.skillsSetWatcherSettings !== 'function') {
            setStatus('技能转录监听设置桥接不可用。');
            return;
        }

        setWatcherSettings(next);
        const result = await window.electronAPI.skillsSetWatcherSettings(next);
        if (!result?.success || !result.settings) {
            setStatus(result?.error || '无法更新转录监听设置。');
            await loadWatcherState();
            return;
        }
        setWatcherSettings(result.settings);
        setStatus(null);
    };

    const acceptWatcherSuggestion = async (suggestionId: string) => {
        if (typeof window.electronAPI?.skillsAcceptWatcherSuggestion !== 'function') {
            setStatus('技能转录监听接受桥接不可用。');
            return;
        }

        const result = await window.electronAPI.skillsAcceptWatcherSuggestion(suggestionId);
        if (!result?.success) {
            setStatus(result?.error || '无法接受监听建议。');
        }
        await loadSkills();
    };

    const dismissWatcherSuggestion = async (suggestionId: string) => {
        if (typeof window.electronAPI?.skillsDismissWatcherSuggestion !== 'function') {
            setStatus('技能转录监听忽略桥接不可用。');
            return;
        }

        const result = await window.electronAPI.skillsDismissWatcherSuggestion(suggestionId);
        if (!result?.success) {
            setStatus(result?.error || '无法忽略监听建议。');
        }
        await loadWatcherState();
    };

    const deactivateSkill = async (skillId: string, scope?: SkillActivation['scope']) => {
        if (typeof window.electronAPI?.skillsDeactivate !== 'function') {
            setStatus('技能停用桥接不可用。');
            return;
        }

        const result = await window.electronAPI.skillsDeactivate(skillId, scope);
        if (!result?.success) {
            setStatus(result?.error || '无法停用技能。');
        }
        await loadSkills();
    };

    return (
        <div className="space-y-5 animated fadeIn select-text pb-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-text-primary mb-1">技能</h3>
                    <p className="text-xs text-text-secondary">
                        本地 SKILL.md 指令，可从悬浮窗下拉菜单调用，也可输入 $技能名 或 /技能名 调用。
                    </p>
                </div>
                <button
                    onClick={loadSkills}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle transition-all duration-200 text-xs font-medium text-text-secondary hover:text-text-primary active:scale-95 mt-1 disabled:opacity-60"
                >
                    <RefreshCw size={13} strokeWidth={2.5} className={loading ? 'animate-spin' : ''} />
                    刷新
                </button>
            </div>

            <div className="bg-bg-card rounded-xl border border-border-subtle p-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <FolderOpen size={15} className="text-text-secondary" />
                            <h4 className="text-sm font-semibold text-text-primary">技能文件夹</h4>
                        </div>
                        <p className="text-xs text-text-secondary">
                            在这里添加包含 SKILL.md 的文件夹。当前版本会读取技能说明，脚本和素材暂不自动导入。
                        </p>
                        {skillsPath && (
                            <p className="mt-2 text-[11px] text-text-tertiary font-mono truncate">{skillsPath}</p>
                        )}
                    </div>
                    <button
                        onClick={openFolder}
                        className="px-4 py-2 rounded-lg bg-bg-input hover:bg-bg-elevated border border-border-subtle text-xs font-medium text-text-primary transition-colors shrink-0"
                    >
                        打开文件夹
                    </button>
                </div>
            </div>

            <div className="bg-bg-card rounded-lg border border-border-subtle p-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-text-primary">自动触发</h4>
                        <p className="text-xs text-text-secondary mt-1">
                            在实时建议中识别类似“把这段改得更自然”或“润色一下”的短语，并自动套用对应技能。
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={toggleAutoTrigger}
                        className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${skillSettings.skillsAutoTriggerEnabled ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                        role="switch"
                        aria-checked={skillSettings.skillsAutoTriggerEnabled}
                        aria-label="技能自动触发"
                    >
                        <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${skillSettings.skillsAutoTriggerEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                </div>
            </div>

            <div className="bg-bg-card rounded-lg border border-border-subtle p-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-text-primary">转录监听</h4>
                        <p className="text-xs text-text-secondary mt-1">
                            高置信度时临时激活技能；中等置信度时先询问确认。
                        </p>
                        <p className="mt-2 text-[11px] text-text-tertiary">
                            自动激活 {Math.round(watcherSettings.skillsWatcherAutoActivateThreshold * 100)}% · 建议确认 {Math.round(watcherSettings.skillsWatcherSuggestThreshold * 100)}%
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => updateWatcherSettings({
                            ...watcherSettings,
                            skillsWatcherEnabled: !watcherSettings.skillsWatcherEnabled,
                        })}
                        className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${watcherSettings.skillsWatcherEnabled ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                        role="switch"
                        aria-checked={watcherSettings.skillsWatcherEnabled}
                        aria-label="转录监听"
                    >
                        <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${watcherSettings.skillsWatcherEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                </div>
            </div>

            {status && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    {status}
                </div>
            )}

            {watcherSuggestions.length > 0 && (
                <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-text-primary">监听建议</h4>
                    {watcherSuggestions.map((suggestion) => (
                        <div key={suggestion.id} className="bg-bg-card rounded-lg border border-border-subtle p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm text-text-primary truncate">{suggestion.skillId}</p>
                                    <p className="text-xs text-text-secondary">
                                        置信度 {Math.round(suggestion.confidence * 100)}% · {suggestion.reason}
                                    </p>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <button
                                        type="button"
                                        className="px-2.5 py-1.5 rounded-lg border border-accent-primary/40 bg-accent-primary/15 text-[11px] font-medium text-accent-primary"
                                        onClick={() => acceptWatcherSuggestion(suggestion.id)}
                                    >
                                        接受
                                    </button>
                                    <button
                                        type="button"
                                        className="px-2.5 py-1.5 rounded-lg border border-border-subtle bg-bg-input text-[11px] font-medium text-text-secondary hover:text-text-primary"
                                        onClick={() => dismissWatcherSuggestion(suggestion.id)}
                                    >
                                        忽略
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="space-y-2">
                {skills.map((skill) => {
                    const isDefault = skillSettings.defaultActiveSkillIds.includes(skill.id);
                    const runtimeActivation = activations.find((activation) => activation.skillId === skill.id);
                    const isRuntimeActive = Boolean(runtimeActivation);

                    return (
                        <div key={skill.id} className="bg-bg-card rounded-lg border border-border-subtle p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0 flex items-start gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center shrink-0">
                                        <Sparkles size={15} className="text-accent-primary" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h4 className="text-sm font-semibold text-text-primary truncate">{skill.name}</h4>
                                            <span className="px-1.5 py-0.5 rounded-md border border-border-subtle bg-bg-input text-[10px] text-text-tertiary">
                                                {skill.id}
                                            </span>
                                        </div>
                                        <p className="text-xs text-text-secondary leading-relaxed">{skill.description}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {isRuntimeActive && (
                                        <button
                                            type="button"
                                            onClick={() => deactivateSkill(skill.id, runtimeActivation?.scope)}
                                            className="px-2 py-1 rounded-md border border-green-500/20 bg-green-500/10 text-[11px] text-green-400 hover:bg-green-500/15"
                                        >
                                            已激活 · 取消
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => toggleDefaultSkill(skill.id)}
                                        className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${isDefault ? 'border-accent-primary/40 bg-accent-primary/15 text-accent-primary' : 'border-border-subtle bg-bg-input text-text-secondary hover:text-text-primary'}`}
                                    >
                                        {isDefault ? '默认开启' : '默认关闭'}
                                    </button>
                                    <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                                        <CheckCircle size={13} className="text-green-500" />
                                        {skill.source === 'builtin' ? '内置' : '本地'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {!loading && skills.length === 0 && (
                    <div className="bg-bg-card rounded-lg border border-border-subtle p-6 text-center">
                        <Sparkles size={20} className="mx-auto mb-2 text-text-tertiary" />
                        <p className="text-sm font-medium text-text-primary">未找到技能</p>
                        <p className="text-xs text-text-secondary mt-1">打开技能文件夹，并添加一个包含 SKILL.md 的文件夹。</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SkillsSettings;
