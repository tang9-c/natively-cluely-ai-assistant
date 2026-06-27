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
            throw new Error('Skills watcher settings bridge is unavailable.');
        }
        if (typeof window.electronAPI?.skillsListWatcherSuggestions !== 'function') {
            throw new Error('Skills watcher suggestions bridge is unavailable.');
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
                setStatus('Skills IPC bridge not detected on window.electronAPI — preload may be missing.');
                setSkills([]);
                return;
            }
            const list = await window.electronAPI.skillsRefresh();
            setSkills(Array.isArray(list) ? list : []);

            if (typeof window.electronAPI?.skillsGetSettings !== 'function') {
                setStatus('Skills settings bridge not detected on window.electronAPI — preload may be missing.');
                return;
            }
            if (typeof window.electronAPI?.skillsListActivations !== 'function') {
                setStatus('Skills activation bridge not detected on window.electronAPI — preload may be missing.');
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
            setStatus(error?.message || 'Could not load skills.');
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
                setStatus('Skills IPC bridge not detected on window.electronAPI — preload may be missing.');
                return;
            }
            const result = await window.electronAPI.skillsOpenFolder();
            if (result?.path) setSkillsPath(result.path);
            if (!result?.success && result?.error) setStatus(result.error);
        } catch (error: any) {
            setStatus(error?.message || 'Could not open skills folder.');
        }
    };

    const saveSkillSettings = async (next: SkillSettings) => {
        if (typeof window.electronAPI?.skillsSetSettings !== 'function') {
            setStatus('Skills settings bridge not detected on window.electronAPI — preload may be missing.');
            return;
        }

        setSkillSettings(next);
        const result = await window.electronAPI.skillsSetSettings(next);
        if (!result?.success) {
            setStatus(result?.error || 'Could not save skill settings.');
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
            setStatus('Skills watcher settings bridge is unavailable.');
            return;
        }

        setWatcherSettings(next);
        const result = await window.electronAPI.skillsSetWatcherSettings(next);
        if (!result?.success || !result.settings) {
            setStatus(result?.error || 'Could not update watcher settings.');
            await loadWatcherState();
            return;
        }
        setWatcherSettings(result.settings);
        setStatus(null);
    };

    const acceptWatcherSuggestion = async (suggestionId: string) => {
        if (typeof window.electronAPI?.skillsAcceptWatcherSuggestion !== 'function') {
            setStatus('Skills watcher accept bridge is unavailable.');
            return;
        }

        const result = await window.electronAPI.skillsAcceptWatcherSuggestion(suggestionId);
        if (!result?.success) {
            setStatus(result?.error || 'Could not accept watcher suggestion.');
        }
        await loadSkills();
    };

    const dismissWatcherSuggestion = async (suggestionId: string) => {
        if (typeof window.electronAPI?.skillsDismissWatcherSuggestion !== 'function') {
            setStatus('Skills watcher dismiss bridge is unavailable.');
            return;
        }

        const result = await window.electronAPI.skillsDismissWatcherSuggestion(suggestionId);
        if (!result?.success) {
            setStatus(result?.error || 'Could not dismiss watcher suggestion.');
        }
        await loadWatcherState();
    };

    const deactivateSkill = async (skillId: string, scope?: SkillActivation['scope']) => {
        if (typeof window.electronAPI?.skillsDeactivate !== 'function') {
            setStatus('Skills deactivate bridge is unavailable.');
            return;
        }

        const result = await window.electronAPI.skillsDeactivate(skillId, scope);
        if (!result?.success) {
            setStatus(result?.error || 'Could not deactivate skill.');
        }
        await loadSkills();
    };

    return (
        <div className="space-y-5 animated fadeIn select-text pb-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-text-primary mb-1">技能</h3>
                    <p className="text-xs text-text-secondary">
                        Local SKILL.md instructions that can be invoked from the overlay dropdown or by typing $skill-name or /skill-name.
                    </p>
                </div>
                <button
                    onClick={loadSkills}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle transition-all duration-200 text-xs font-medium text-text-secondary hover:text-text-primary active:scale-95 mt-1 disabled:opacity-60"
                >
                    <RefreshCw size={13} strokeWidth={2.5} className={loading ? 'animate-spin' : ''} />
                    Refresh
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
                            Add a folder containing a SKILL.md file here. Scripts and assets are ignored in this v1.
                        </p>
                        {skillsPath && (
                            <p className="mt-2 text-[11px] text-text-tertiary font-mono truncate">{skillsPath}</p>
                        )}
                    </div>
                    <button
                        onClick={openFolder}
                        className="px-4 py-2 rounded-lg bg-bg-input hover:bg-bg-elevated border border-border-subtle text-xs font-medium text-text-primary transition-colors shrink-0"
                    >
                        Open Folder
                    </button>
                </div>
            </div>

            <div className="bg-bg-card rounded-lg border border-border-subtle p-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-text-primary">自动触发</h4>
                        <p className="text-xs text-text-secondary mt-1">
                            Detect short phrases like “humanize this” or “润色一下” during real-time suggestions.
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
                        <h4 className="text-sm font-semibold text-text-primary">Transcript watcher</h4>
                        <p className="text-xs text-text-secondary mt-1">
                            High confidence activates temporarily. Medium confidence asks first.
                        </p>
                        <p className="mt-2 text-[11px] text-text-tertiary">
                            Auto {Math.round(watcherSettings.skillsWatcherAutoActivateThreshold * 100)}% · Suggest {Math.round(watcherSettings.skillsWatcherSuggestThreshold * 100)}%
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
                        aria-label="Transcript watcher"
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
                    <h4 className="text-sm font-semibold text-text-primary">Watcher suggestions</h4>
                    {watcherSuggestions.map((suggestion) => (
                        <div key={suggestion.id} className="bg-bg-card rounded-lg border border-border-subtle p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm text-text-primary truncate">{suggestion.skillId}</p>
                                    <p className="text-xs text-text-secondary">
                                        Confidence {Math.round(suggestion.confidence * 100)}% · {suggestion.reason}
                                    </p>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <button
                                        type="button"
                                        className="px-2.5 py-1.5 rounded-lg border border-accent-primary/40 bg-accent-primary/15 text-[11px] font-medium text-accent-primary"
                                        onClick={() => acceptWatcherSuggestion(suggestion.id)}
                                    >
                                        Accept
                                    </button>
                                    <button
                                        type="button"
                                        className="px-2.5 py-1.5 rounded-lg border border-border-subtle bg-bg-input text-[11px] font-medium text-text-secondary hover:text-text-primary"
                                        onClick={() => dismissWatcherSuggestion(suggestion.id)}
                                    >
                                        Dismiss
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
                                            Active · Cancel
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => toggleDefaultSkill(skill.id)}
                                        className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${isDefault ? 'border-accent-primary/40 bg-accent-primary/15 text-accent-primary' : 'border-border-subtle bg-bg-input text-text-secondary hover:text-text-primary'}`}
                                    >
                                        {isDefault ? 'Default on' : 'Default off'}
                                    </button>
                                    <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                                        <CheckCircle size={13} className="text-green-500" />
                                        {skill.source === 'builtin' ? 'Built-in' : 'Local'}
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
                        <p className="text-xs text-text-secondary mt-1">Open the skills folder and add a folder with SKILL.md.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SkillsSettings;
