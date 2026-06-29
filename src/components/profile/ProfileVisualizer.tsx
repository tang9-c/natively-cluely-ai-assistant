import React from 'react';
import { BriefcaseBusiness, FileText, Sparkles, UserRound } from 'lucide-react';

interface ProfileVisualizerProps {
    profileData: {
        identity?: { name?: string; email?: string };
        summary?: string;
        experiencePreview?: Array<{
            title?: string;
            organization?: string;
            start?: string;
            end?: string;
            description?: string;
        }>;
        experienceCount?: number;
        projectCount?: number;
        nodeCount?: number;
        skills?: string[];
        hasActiveJD?: boolean;
        activeJD?: {
            title?: string;
            company?: string;
            level?: string;
            technologies?: string[];
        };
    } | null;
}

function compactDateRange(start?: string, end?: string): string {
    if (!start && !end) return '';
    if (start && end) return `${start} - ${end}`;
    return start || end || '';
}

export const ProfileVisualizer: React.FC<ProfileVisualizerProps> = ({ profileData }) => {
    const experiences = profileData?.experiencePreview ?? [];
    const skills = profileData?.skills ?? [];
    const activeJD = profileData?.activeJD;

    if (!profileData) {
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
                    <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
                        {profileData.summary || '已加载可用于实时回答的身份、经验和技能线索。'}
                    </p>
                </div>
                <div className="shrink-0 rounded-full border border-border-subtle bg-bg-input px-2.5 py-1 text-[10px] font-semibold text-text-secondary">
                    {profileData.nodeCount ?? 0} 节点
                </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-border-subtle bg-bg-input/45 px-3 py-2">
                    <p className="text-[10px] font-semibold text-text-tertiary">经验</p>
                    <p className="mt-1 text-base font-bold text-text-primary">{profileData.experienceCount ?? 0}</p>
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-input/45 px-3 py-2">
                    <p className="text-[10px] font-semibold text-text-tertiary">项目</p>
                    <p className="mt-1 text-base font-bold text-text-primary">{profileData.projectCount ?? 0}</p>
                </div>
                <div className="rounded-md border border-border-subtle bg-bg-input/45 px-3 py-2">
                    <p className="text-[10px] font-semibold text-text-tertiary">技能</p>
                    <p className="mt-1 text-base font-bold text-text-primary">{skills.length}</p>
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

            {profileData.hasActiveJD && activeJD && (
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
