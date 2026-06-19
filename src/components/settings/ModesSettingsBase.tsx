import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  Save,
  Settings,
  Trash2,
  X,
} from 'lucide-react';

interface ModesSettingsBaseProps {
  onClose: () => void;
}

interface ModeItem {
  id: string;
  name: string;
  templateType: string;
  customContext: string;
  isActive: boolean;
  createdAt: string;
}

interface NoteSection {
  id: string;
  modeId: string;
  title: string;
  description: string;
  sortOrder: number;
}

const TEMPLATE_LABELS: Record<string, string> = {
  general: '通用',
  sales: '销售',
  recruiting: '招聘',
  'team-meet': '团队会议',
  'looking-for-work': '求职',
  'technical-interview': '技术面试',
  lecture: '讲座',
};

const DEFAULT_TEMPLATE_NAMES: Record<string, string> = {
  general: 'General',
  sales: 'Sales',
  recruiting: 'Recruiting',
  'team-meet': 'Team Meet',
  'looking-for-work': 'Looking for work',
  'technical-interview': 'Technical Interview',
  lecture: 'Lecture',
};

const getModeDisplayName = (mode: Pick<ModeItem, 'name' | 'templateType'>): string => {
  const templateLabel = TEMPLATE_LABELS[mode.templateType];
  const defaultName = DEFAULT_TEMPLATE_NAMES[mode.templateType];
  if (templateLabel && mode.name === defaultName) return templateLabel;
  return mode.name;
};

export const ModesSettingsBase: React.FC<ModesSettingsBaseProps> = ({
  onClose,
}) => {
  const [modes, setModes] = useState<ModeItem[]>([]);
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [noteSections, setNoteSections] = useState<NoteSection[]>([]);
  const [editedName, setEditedName] = useState('');
  const [editedContext, setEditedContext] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeModeId, setActiveModeId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newSectionDesc, setNewSectionDesc] = useState('');
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const createDropdownRef = useRef<HTMLDivElement>(null);
  const hasLoadedRef = useRef(false);

  const selectedMode = modes.find((m) => m.id === selectedModeId) ?? null;

  const loadModes = useCallback(async () => {
    try {
      setLoadError(null);
      const all = await window.electronAPI?.modesGetAll?.();
      if (!all) {
        setLoadError('模式 IPC 未就绪，请稍后重试。');
        setModes([]);
        return;
      }
      const mapped: ModeItem[] = all.map((m) => ({
        id: m.id,
        name: m.name,
        templateType: m.templateType,
        customContext: m.customContext,
        isActive: m.isActive,
        createdAt: m.createdAt,
      }));
      setModes(mapped);
      const active = mapped.find((m) => m.isActive);
      setActiveModeId(active?.id ?? null);
      if (!hasLoadedRef.current) {
        hasLoadedRef.current = true;
        setSelectedModeId(mapped[0]?.id ?? active?.id ?? null);
      }
    } catch (error: any) {
      setLoadError(error?.message ?? '模式列表加载失败');
      setModes([]);
    }
  }, []);

  const loadNoteSections = useCallback(async (modeId: string) => {
    try {
      const sections = await window.electronAPI?.modesGetNoteSections?.(modeId);
      setNoteSections(sections ?? []);
    } catch {
      setNoteSections([]);
    }
  }, []);

  useEffect(() => {
    loadModes();
    const unsub = window.electronAPI?.onModeChanged?.(
      (data: { id: string | null; name: string | null }) => {
        setActiveModeId(data.id);
        setModes((prev) =>
          prev.map((m) => ({
            ...m,
            isActive: data.id ? m.id === data.id : false,
          })),
        );
      },
    );
    return () => unsub?.();
  }, [loadModes]);

  useEffect(() => {
    if (selectedMode) {
      setEditedName(selectedMode.name);
      setEditedContext(selectedMode.customContext);
      loadNoteSections(selectedMode.id);
      setSaveError(null);
    }
  }, [selectedModeId, selectedMode, loadNoteSections]);

  // Close create dropdown on outside click
  useEffect(() => {
    if (!isCreating) return;
    const handleClick = (e: MouseEvent) => {
      if (createDropdownRef.current && !createDropdownRef.current.contains(e.target as Node)) {
        setIsCreating(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isCreating]);

  const handleCreate = async (templateType: string, name: string) => {
    setCreateError(null);
    try {
      const result = await window.electronAPI?.modesCreate?.({ name, templateType });
      if (result?.error) {
        setCreateError(result.error);
      } else if (result?.success && result.mode) {
        await loadModes();
        setSelectedModeId(result.mode.id);
        setIsCreating(false);
      }
    } catch (e: any) {
      setCreateError(e.message ?? '创建失败');
    }
  };

  const handleSetActive = async (modeId: string) => {
    const mode = modes.find((m) => m.id === modeId);
    if (!mode) return;
    if (mode.isActive) return;
    const result = await window.electronAPI?.modesSetActive?.(modeId);
    if (result?.error) {
      setSaveError(result.error);
      return;
    }
    setActiveModeId(modeId);
    setModes((prev) =>
      prev.map((m) => ({ ...m, isActive: m.id === modeId })),
    );
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!selectedMode) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await window.electronAPI?.modesUpdate?.(selectedMode.id, {
        name: editedName.trim(),
        customContext: editedContext.trim(),
      });
      if (result?.error) {
        setSaveError(result.error);
      } else {
        await loadModes();
      }
    } catch (e: any) {
      setSaveError(e.message ?? '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedMode) return;
    const ok = window.confirm(`确定要删除模式 "${selectedMode.name}" 吗？此操作不可撤销。`);
    if (!ok) return;
    try {
      const result = await window.electronAPI?.modesDelete?.(selectedMode.id);
      if (result?.error) {
        setSaveError(result.error);
      } else {
        await loadModes();
        setSelectedModeId(modes.find((m) => m.templateType === 'general')?.id ?? null);
      }
    } catch (e: any) {
      setSaveError(e.message ?? '删除失败');
    }
  };

  const handleAddNoteSection = async () => {
    if (!selectedMode) return;
    const title = newSectionTitle.trim();
    const desc = newSectionDesc.trim();
    if (!title) {
      setSectionError('标题不能为空');
      return;
    }
    try {
      const result = await window.electronAPI?.modesAddNoteSection?.(selectedMode.id, title, desc);
      if (result?.error) {
        setSectionError(result.error);
      } else {
        setNewSectionTitle('');
        setNewSectionDesc('');
        setAddingSection(false);
        setSectionError(null);
        await loadNoteSections(selectedMode.id);
      }
    } catch (e: any) {
      setSectionError(e.message ?? '添加失败');
    }
  };

  const handleUpdateNoteSection = async (id: string, title: string, description: string) => {
    if (!selectedMode) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    try {
      await window.electronAPI?.modesUpdateNoteSection?.(id, {
        title: trimmedTitle,
        description: description.trim(),
      });
      await loadNoteSections(selectedMode.id);
    } catch {
      // ignore
    }
  };

  const handleDeleteNoteSection = async (id: string, title: string) => {
    if (!selectedMode) return;
    const ok = window.confirm(`确定要删除笔记分区 "${title}" 吗？`);
    if (!ok) return;
    try {
      await window.electronAPI?.modesDeleteNoteSection?.(id);
      await loadNoteSections(selectedMode.id);
    } catch {
      // ignore
    }
  };

  const hasChanges =
    selectedMode &&
    (editedName.trim() !== selectedMode.name ||
      editedContext.trim() !== selectedMode.customContext);

  return (
    <div className="flex h-full flex-col bg-[#f7f7f8] text-[#111827]">
      {/* Header */}
      <div className="flex h-[118px] shrink-0 items-center justify-between border-b border-[#dedfe2] px-12">
        <div className="flex items-center gap-7">
          <Settings size={30} strokeWidth={2.4} className="text-[#6b7280]" />
          <h2 className="text-[28px] font-semibold leading-none text-[#111827]">模式设置</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-3 text-[#9ca3af] transition-colors hover:bg-black/[0.04] hover:text-[#6b7280]"
          aria-label="关闭模式设置"
        >
          <X size={30} strokeWidth={2.1} />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — mode list */}
        <div className="flex w-[508px] shrink-0 flex-col border-r border-[#dedfe2]">
          <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-6 py-4">
            {loadError && (
              <div className="rounded-[22px] border border-red-200 bg-red-50 px-6 py-5 text-[16px] text-red-600">
                <div className="font-semibold">模式列表加载失败</div>
                <div className="mt-2 leading-relaxed text-red-500">{loadError}</div>
                <button
                  onClick={loadModes}
                  className="mt-4 rounded-xl bg-red-100 px-4 py-2 text-[15px] font-semibold text-red-600 hover:bg-red-200"
                >
                  重试
                </button>
              </div>
            )}

            {!loadError && modes.length === 0 && (
              <div className="rounded-[22px] border border-[#dedfe2] bg-white px-6 py-6 text-[16px] text-[#6b7280]">
                <div className="font-semibold text-[#374151]">暂无模式</div>
                <div className="mt-2 leading-relaxed">默认模式尚未初始化，请刷新列表。</div>
                <button
                  onClick={loadModes}
                  className="mt-4 rounded-xl bg-[#e9efff] px-4 py-2 text-[15px] font-semibold text-[#2563eb] hover:bg-[#dbe7ff]"
                >
                  刷新
                </button>
              </div>
            )}

            {!loadError && modes.map((mode) => {
              const isSelected = mode.id === selectedModeId;
              const isActive = mode.id === activeModeId;
              return (
                <button
                  key={mode.id}
                  onClick={() => setSelectedModeId(mode.id)}
                  className={`flex h-[103px] w-full items-center gap-6 rounded-[22px] px-6 text-left transition-colors duration-150 ${
                    isSelected
                      ? 'bg-[#e7ecfb] text-[#111827]'
                      : 'text-[#6b7280] hover:bg-black/[0.035] hover:text-[#374151]'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="truncate text-[24px] font-semibold leading-none">
                        {getModeDisplayName(mode)}
                      </span>
                    </div>
                    <div className="mt-3 text-[20px] leading-none text-[#9ca3af]">
                      {TEMPLATE_LABELS[mode.templateType] ?? mode.templateType}
                    </div>
                  </div>
                  {isActive && (
                    <span className="inline-flex shrink-0 items-center gap-2 text-[20px] font-semibold leading-none text-[#2563eb]">
                      <Check size={21} strokeWidth={3} />
                      活跃
                    </span>
                  )}
                  <ChevronRight
                    size={28}
                    strokeWidth={2.2}
                    className="shrink-0 text-[#b8bec8]"
                  />
                </button>
              );
            })}
          </div>

          {/* Create mode button */}
          <div className="relative flex h-[105px] shrink-0 items-center border-t border-[#dedfe2] px-[162px]" ref={createDropdownRef}>
            <button
              onClick={() => {
                setCreateError(null);
                setIsCreating((prev) => !prev);
              }}
              className="flex items-center justify-center gap-4 whitespace-nowrap rounded-2xl px-0 py-3 text-[22px] font-semibold leading-none text-[#2563eb] transition-colors hover:text-[#1d4ed8]"
            >
              <Plus size={26} strokeWidth={2.1} />
              <span>创建新模式</span>
              <ChevronDown
                size={22}
                className={`transition-transform duration-200 ${isCreating ? 'rotate-180' : ''}`}
              />
            </button>

            <AnimatePresence>
              {isCreating && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full left-6 right-6 z-50 mb-3 overflow-hidden rounded-[22px] border border-[#dedfe2] bg-white shadow-2xl"
                >
                  <div className="space-y-1 p-2">
                    {Object.entries(TEMPLATE_LABELS).map(([type, label]) => {
                      const exists = modes.some((m) => m.templateType === type);
                      return (
                        <button
                          key={type}
                          onClick={() => handleCreate(type, label)}
                          disabled={exists}
                          className={`w-full rounded-[16px] px-5 py-4 text-left text-[18px] transition-colors ${
                            exists
                              ? 'cursor-not-allowed text-[#b8bec8]'
                              : 'text-[#4b5563] hover:bg-[#f3f4f6] hover:text-[#111827]'
                          }`}
                        >
                          <div className="font-medium">{label}</div>
                          <div className="mt-1 text-[14px] text-[#9ca3af]">
                            {exists ? '已存在' : type}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {createError && (
                    <div className="px-5 pb-4 text-[15px] text-red-500">
                      {createError}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right panel — mode details */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedMode ? (
            <>
              <div className="custom-scrollbar flex-1 space-y-10 overflow-y-auto px-10 py-10">
                {/* Active toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-[28px] font-semibold leading-none text-[#111827]">{getModeDisplayName(selectedMode)}</h3>
                    <p className="mt-4 text-[23px] leading-none text-[#9ca3af]">
                      {TEMPLATE_LABELS[selectedMode.templateType] ?? selectedMode.templateType}
                    </p>
                  </div>
                  <button
                    onClick={() => handleSetActive(selectedMode.id)}
                    disabled={selectedMode.id === activeModeId}
                    className={`h-[55px] rounded-[16px] px-7 text-[20px] font-semibold transition-colors duration-150 ${
                      selectedMode.id === activeModeId
                        ? 'cursor-default bg-[#eef0f4] text-[#8b93a1]'
                        : 'bg-[#eceef2] text-[#6b7280] hover:bg-[#e2e5ea] hover:text-[#374151]'
                    }`}
                  >
                    设为活跃
                  </button>
                </div>

                {/* Name input */}
                <div>
                  <label className="mb-4 block text-[23px] font-semibold leading-none text-[#6b7280]">
                    模式名称
                  </label>
                  <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="h-[82px] w-full rounded-[22px] border border-[#dedfe2] bg-white px-7 text-[30px] font-normal text-[#111827] outline-none transition-colors placeholder:text-[#a8afbb] focus:border-[#9bb8ff] focus:ring-4 focus:ring-[#2563eb]/10"
                  />
                </div>

                {/* Custom context */}
                <div>
                  <label className="mb-4 block text-[23px] font-semibold leading-none text-[#6b7280]">
                    自定义上下文
                  </label>
                  <textarea
                    value={editedContext}
                    onChange={(e) => setEditedContext(e.target.value)}
                    rows={7}
                    placeholder="输入自定义指令，让 AI 更好地适应你的需求..."
                    className="h-[274px] w-full resize-none rounded-[22px] border border-[#dedfe2] bg-white px-7 py-6 text-[25px] leading-relaxed text-[#111827] outline-none transition-colors placeholder:text-[#a8afbb] focus:border-[#9bb8ff] focus:ring-4 focus:ring-[#2563eb]/10"
                  />
                </div>

                {/* Note sections */}
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <label className="block text-[23px] font-semibold leading-none text-[#6b7280]">
                      笔记分区
                    </label>
                    <button
                      onClick={() => {
                        setAddingSection((prev) => !prev);
                        setSectionError(null);
                      }}
                      className="flex items-center gap-3 text-[22px] font-semibold leading-none text-[#2563eb] transition-colors hover:text-[#1d4ed8]"
                    >
                      <Plus size={25} strokeWidth={2.2} />
                      {addingSection ? '取消' : '添加分区'}
                    </button>
                  </div>

                  <AnimatePresence>
                    {addingSection && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.15 }}
                        className="mb-5 overflow-hidden"
                      >
                        <div className="space-y-4 rounded-[22px] border border-[#dedfe2] bg-white px-7 py-6">
                          <input
                            type="text"
                            value={newSectionTitle}
                            onChange={(e) => setNewSectionTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddNoteSection();
                            }}
                            placeholder="分区标题"
                            className="w-full bg-transparent text-[22px] font-semibold text-[#111827] outline-none placeholder:text-[#a8afbb]"
                          />
                          <textarea
                            value={newSectionDesc}
                            onChange={(e) => setNewSectionDesc(e.target.value)}
                            rows={2}
                            placeholder="分区描述（告诉 AI 这里该放什么内容）"
                            className="w-full resize-none bg-transparent text-[19px] leading-relaxed text-[#6b7280] outline-none placeholder:text-[#a8afbb]"
                          />
                          <div className="flex items-center justify-between">
                            {sectionError && (
                              <span className="text-[16px] text-red-500">{sectionError}</span>
                            )}
                            <div className="flex-1" />
                            <button
                              onClick={handleAddNoteSection}
                              className="flex items-center gap-2 rounded-xl bg-[#2563eb] px-5 py-2.5 text-[17px] font-semibold text-white transition-colors hover:bg-[#1d4ed8]"
                            >
                              <Check size={16} strokeWidth={3} />
                              保存
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="space-y-[18px]">
                    {noteSections.map((section) => (
                      <motion.div
                        key={section.id}
                        layout
                        className="group rounded-[22px] border border-[#dedfe2] bg-white px-7 py-7"
                      >
                        <div className="flex items-start gap-5">
                          <div className="min-w-0 flex-1 space-y-5">
                            <input
                              type="text"
                              defaultValue={section.title}
                              onBlur={(e) =>
                                handleUpdateNoteSection(section.id, e.target.value, section.description)
                              }
                              className="w-full bg-transparent text-[24px] font-semibold leading-none text-[#111827] outline-none placeholder:text-[#a8afbb] focus:ring-0"
                            />
                            <textarea
                              defaultValue={section.description}
                              onBlur={(e) =>
                                handleUpdateNoteSection(section.id, section.title, e.target.value)
                              }
                              rows={2}
                              placeholder="分区描述"
                              className="w-full resize-none bg-transparent text-[22px] leading-relaxed text-[#6b7280] outline-none placeholder:text-[#a8afbb] focus:ring-0"
                            />
                          </div>
                          <button
                            onClick={() => handleDeleteNoteSection(section.id, section.title)}
                            className="shrink-0 rounded-xl p-2 text-[#b8bec8] opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                            title="删除分区"
                          >
                            <Trash2 size={20} />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* Error message */}
                <AnimatePresence>
                  {saveError && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="rounded-[18px] border border-red-200 bg-red-50 px-6 py-4 text-[17px] text-red-600"
                    >
                      {saveError}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer actions */}
              <div className="flex h-[105px] shrink-0 items-center justify-between border-t border-[#dedfe2] px-16">
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-4 rounded-2xl px-0 py-3 text-[22px] font-semibold leading-none text-[#ef4444] transition-colors hover:text-[#dc2626]"
                >
                  <Trash2 size={25} strokeWidth={2.1} />
                  删除
                </button>
                <div className="flex items-center gap-2">
                  {hasChanges && (
                    <span className="mr-3 text-[16px] text-[#9ca3af]">有未保存的更改</span>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving}
                    className={`flex h-[62px] items-center gap-4 rounded-[22px] px-8 text-[22px] font-semibold leading-none transition-colors duration-150 ${
                      hasChanges && !isSaving
                        ? 'bg-[#2563eb] text-white hover:bg-[#1d4ed8] active:scale-[0.98]'
                        : 'cursor-not-allowed bg-[#eceef2] text-[#9ca3af]'
                    }`}
                  >
                    {isSaving ? (
                      <>
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                        >
                          <Save size={24} />
                        </motion.div>
                        保存中...
                      </>
                    ) : (
                      <>
                        <Save size={24} />
                        保存
                      </>
                    )}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[22px] text-[#9ca3af]">
              选择一个模式以查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModesSettingsBase;
