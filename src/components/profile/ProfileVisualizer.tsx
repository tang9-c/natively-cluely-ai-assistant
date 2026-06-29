import React from 'react';
import { BriefcaseBusiness, FileText, Sparkles, UserRound } from 'lucide-react';

import type {
    NormalizedProfileVisualizerData,
    ProfileVisualizerData,
} from './types';

interface ProfileVisualizerProps {
    profileData: ProfileVisualizerData | null;
}

export function getUniqueSkills(skills?: string[]): string[] {
    const unique: string[] = [];
    const seen = new Set<string>();

    for (const skill of skills ?? []) {
        const normalized = skill.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        unique.push(normalized);
    }

    return unique;
}

export function getHiddenExperienceCount(profileData?: ProfileVisualizerData | null): number {
    if (!profileData) return 0;
    const total = Math.max(0, profileData.experienceCount ?? 0);
    const shown = Array.isArray(profileData.experiencePreview)
        ? profileData.experiencePreview.length
        : 0;
    return Math.max(0, total - shown);
}

export function normalizeProfileVisualizerData(
    profileData?: ProfileVisualizerData | null,
): NormalizedProfileVisualizerData {
    const skills = getUniqueSkills(profileData?.skills);
    const experiences = Array.isArray(profileData?.experiencePreview)
        ? profileData.experiencePreview
        : [];

    return {
        isActive: profileData !== null && profileData !== undefined,
        displayName: profileData?.identity?.name?.trim() || '身份未命名',
        email: profileData?.identity?.email?.trim() || undefined,
        summary: profileData?.summary?.trim() || undefined,
        experienceCount: Math.max(0, profileData?.experienceCount ?? 0),
        projectCount: Math.max(0, profileData?.projectCount ?? 0),
        nodeCount: Math.max(0, profileData?.nodeCount ?? 0),
        skills,
        skillCount: skills.length,
        experiences,
        hiddenExperienceCount: getHiddenExperienceCount(profileData),
        hasActiveJD: Boolean(profileData?.hasActiveJD && profileData?.activeJD),
        activeJD: profileData?.activeJD,
    };
}

function compactDateRange(start?: string, end?: string): string {
    if (!start && !end) return '';
    if (start && end) return `${start} - ${end}`;
    return start || end || '';
}

export const ProfileVisualizer: React.FC<ProfileVisualizerProps> = ({ profileData }) => {
    const normalized = normalizeProfileVisualizerData(profileData);
    const experiences = normalized.experiences;
    const skills = normalized.skills;
    const activeJD = normalized.activeJD;

    if (!normalized.isActive) {
        return (
            <section className="rounded-lg border border-dashed border-border-subtle bg-bg-input/30 p-5">
                <div className="flex items-center gap-3 text-text-secondary">
                    <UserRound size={16} className="text-text-tertiary" />
                    <div>
                        <h4 className="text-sm font-bold text-text-primary">Profile 智能未激活</h4>
                        <p className="mt-1 text-[11px] leading-relaxed">
                            上传简历或填写专业身份后，会议中的 Profile 线索会在这里显示。
                        </p>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="rounded-lg border border-border-subtle bg-bg-surface/50 p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Sparkles size={15} className="text-accent-primary" />
                        <h4 className="text-sm font-bold text-text-primary">Profile 智能</h4>
                    </div>
                    <p className="mt-1 text-[12px] font-semibold text-text-primary">
                        {normalized.displayName}
                    </p>
                    {normalized.email && (
                        <p className="mt-0.5 text-[10px] text-text-tertiary">
                            {normalized.email}
                        </p>
                    )}
                    <p className="mt-1.5 text-[11px] leading-relaxed text-text-secondary">
                        {normalized.summary || '已加载可用于实时回答的身份、经验和技能线索。'}
                    </p>
                </div>
                <div className="shrink-0 rounded-full border border-border-subtle bg-bg-input px-2.5 py-1 text-[10px] font-semibold text-text-secondary">
                    {normalized.nodeCount} 节点
                </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-border-subtle bg-bg-input/45 px-3 py-2">
                    <p className="text-[10px] font-semibold text-text-tertiary">经验</p>
                    <p className="mt-1 text-base font-bold text-text-primary">{normalized.experienceCount}</p>
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-input/45 px-3 py-2">
                    <p className="text-[10px] font-semibold text-text-tertiary">项目</p>
                    <p className="mt-1 text-base font-bold text-text-primary">{normalized.projectCount}</p>
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-input/45 px-3 py-2">
                    <p className="text-[10px] font-semibold text-text-tertiary">技能</p>
                    <p className="mt-1 text-base font-bold text-text-primary">{normalized.skillCount}</p>
                </div>
            </div>

            {experiences.length > 0 && (
                <div className="mt-4">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-text-primary">
                        <BriefcaseBusiness size={13} className="text-text-tertiary" />
                        经验线索
                    </div>
                    <div className="space-y-2">
                        {experiences.map((experience, index) => (
                            <div key={`${experience.title}-${experience.organization}-${index}`} className="rounded-md border border-border-subtle bg-bg-input/35 px-3 py-2">
                                <div className="flex items-start justify-between gap-3">
                                    <p className="min-w-0 truncate text-[12px] font-semibold text-text-primary">
                                        {[experience.title, experience.organization].filter(Boolean).join(' · ') || '未命名经验'}
                                    </p>
                                    <span className="shrink-0 text-[10px] text-text-tertiary">
                                        {compactDateRange(experience.start, experience.end)}
                                    </span>
                                </div>
                                {experience.description && (
                                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-secondary">
                                        {experience.description}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                    {normalized.hiddenExperienceCount > 0 && (
                        <p className="mt-2 text-[10px] font-medium text-text-tertiary">
                            另有 {normalized.hiddenExperienceCount} 条经验未显示
                        </p>
                    )}
                </div>
            )}

            {skills.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                    {skills.slice(0, 12).map((skill) => (
                        <span key={skill} className="rounded-md border border-border-subtle bg-bg-input px-2 py-1 text-[10px] font-medium text-text-secondary">
                            {skill}
                        </span>
                    ))}
                </div>
            )}

            {normalized.hasActiveJD && activeJD && (
                <div className="mt-4 rounded-md border border-border-subtle bg-bg-input/35 px-3 py-2">
                    <div className="flex items-center gap-2 text-[11px] font-bold text-text-primary">
                        <FileText size={13} className="text-text-tertiary" />
                        目标职位
                    </div>
                    <p className="mt-1 text-[12px] font-semibold text-text-primary">
                        {[activeJD.title, activeJD.company].filter(Boolean).join(' @ ')}
                    </p>
                    {(activeJD.technologies?.length ?? 0) > 0 && (
                        <p className="mt-1 text-[11px] text-text-secondary">
                            {activeJD.technologies?.slice(0, 5).join(' / ')}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
};

export default ProfileVisualizer;
