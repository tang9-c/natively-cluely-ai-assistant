import React, { useEffect, useState } from 'react';
import { Check, Save, User } from 'lucide-react';

import type { MasterProfile } from './types';

const EMPTY_PROFILE: MasterProfile = {
    displayName: '',
    headline: '',
    summary: '',
    contactInfo: '',
    experience: '',
    skills: '',
};

export function MasterProfileSection() {
    const [profile, setProfile] = useState<MasterProfile>(EMPTY_PROFILE);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let mounted = true;
        window.electronAPI?.profileGetMasterProfile?.()
            .then((result) => {
                if (!mounted || !result?.success) return;
                setProfile({ ...EMPTY_PROFILE, ...(result.profile ?? {}) });
            })
            .catch(() => {
                if (mounted) setError('主档案加载失败');
            });
        return () => {
            mounted = false;
        };
    }, []);

    const updateField = (key: keyof MasterProfile, value: string) => {
        setSaved(false);
        setError('');
        setProfile((current) => ({ ...current, [key]: value }));
    };

    const saveProfile = async () => {
        setSaving(true);
        setError('');
        try {
            const result = await window.electronAPI?.profileUpdateMasterProfile?.(profile);
            if (!result?.success) {
                setError(result?.error || '保存失败');
                return;
            }
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (event: any) {
            setError(event?.message || '保存失败');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="rounded-lg border border-border-subtle bg-bg-surface/50 p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-input text-text-tertiary">
                        <User size={19} />
                    </div>
                    <div className="min-w-0">
                        <h4 className="text-sm font-bold text-text-primary">主档案</h4>
                        <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
                            记录跨场景稳定复用的身份、背景和偏好，LLM 会把它作为档案上下文的一部分。
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={saveProfile}
                    disabled={saving}
                    className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border-subtle bg-bg-input px-3 py-2 text-[11px] font-semibold text-text-primary transition-colors hover:bg-bg-surface disabled:cursor-progress disabled:opacity-60"
                >
                    {saved ? <Check size={13} className="text-emerald-500" /> : <Save size={13} />}
                    {saving ? '保存中' : saved ? '已保存' : '保存'}
                </button>
            </div>

            {error && (
                <div className="mb-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-500">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                    value={profile.displayName || ''}
                    onChange={(event) => updateField('displayName', event.target.value)}
                    placeholder="姓名、客户名、团队名或讲者名"
                    className="rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-xs text-text-primary placeholder-text-tertiary outline-none transition-colors focus:border-accent-primary/50"
                />
                <input
                    value={profile.headline || ''}
                    onChange={(event) => updateField('headline', event.target.value)}
                    placeholder="一句话定位"
                    className="rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-xs text-text-primary placeholder-text-tertiary outline-none transition-colors focus:border-accent-primary/50"
                />
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <textarea
                    value={profile.summary || ''}
                    onChange={(event) => updateField('summary', event.target.value)}
                    placeholder="背景摘要、当前目标、重要约束"
                    rows={4}
                    className="rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-xs leading-relaxed text-text-primary placeholder-text-tertiary outline-none transition-colors focus:border-accent-primary/50"
                />
                <textarea
                    value={profile.skills || ''}
                    onChange={(event) => updateField('skills', event.target.value)}
                    placeholder="技能、卖点、主题关键词或团队能力"
                    rows={4}
                    className="rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-xs leading-relaxed text-text-primary placeholder-text-tertiary outline-none transition-colors focus:border-accent-primary/50"
                />
            </div>
        </section>
    );
}
