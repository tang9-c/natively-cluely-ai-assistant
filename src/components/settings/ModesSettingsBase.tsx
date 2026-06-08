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
import { useResolvedTheme } from '../../hooks/useResolvedTheme';

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
  const createDropdownRef = useRef<HTMLDivElement>(null);
  const hasLoadedRef = useRef(false);
  const isLight = useResolvedTheme() === 'light';

  const selectedMode = modes.find((m) => m.id === selectedModeId) ?? null;

  const loadModes = useCallback(async () => {
    try {
      const all = await window.electronAPI?.modesGetAll?.();
      if (!all) return;
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
        setSelectedModeId(active?.id ?? mapped[0]?.id ?? null);
      }
    } catch {
      // ignore
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

  const hasChanges =
    selectedMode &&
    (editedName.trim() !== selectedMode.name ||
      editedContext.trim() !== selectedMode.customContext);

  return (
    <div className="flex flex-col h-full bg-bg-main text-text-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-2.5">
          <Settings size={16} className="text-text-secondary" />
          <h2 className="text-sm font-semibold">模式设置</h2>
        </div>
        <button
          onClick={onClose}
          className={`p-1.5 rounded-lg text-text-tertiary hover:text-text-primary transition-colors ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/5'}`}
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — mode list */}
        <div className="w-[260px] border-r border-border-subtle flex flex-col shrink-0">
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
            {modes.map((mode) => {
              const isSelected = mode.id === selectedModeId;
              const isActive = mode.id === activeModeId;
              return (
                <button
                  key={mode.id}
                  onClick={() => setSelectedModeId(mode.id)}
                  className={`w-full rounded-xl px-3 py-2.5 flex items-center gap-2.5 transition-all duration-200 text-left ${
                    isSelected
                      ? 'bg-bg-item-active text-text-primary'
                      : `hover:bg-bg-item-surface text-text-secondary hover:text-text-primary`
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">
                        {mode.name}
                      </span>
                    </div>
                    <div className="text-[10px] text-text-tertiary mt-0.5">
                      {TEMPLATE_LABELS[mode.templateType] ?? mode.templateType}
                    </div>
                  </div>
                  {isActive && (
                    <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-accent-primary bg-accent-primary/10 px-1.5 py-0.5 rounded-md">
                      <Check size={10} strokeWidth={3} />
                      活跃
                    </span>
                  )}
                  <ChevronRight
                    size={14}
                    className={`shrink-0 opacity-40 ${isSelected ? 'opacity-100' : ''}`}
                  />
                </button>
              );
            })}
          </div>

          {/* Create mode button */}
          <div className="p-2 border-t border-border-subtle shrink-0 relative" ref={createDropdownRef}>
            <button
              onClick={() => {
                setCreateError(null);
                setIsCreating((prev) => !prev);
              }}
              className="w-full rounded-xl px-3 py-2.5 flex items-center justify-center gap-2 text-xs font-medium transition-all duration-200 bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20"
            >
              <Plus size={14} />
              <span>创建新模式</span>
              <ChevronDown
                size={14}
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
                  className="absolute left-2 right-2 bottom-full mb-1.5 bg-bg-elevated border border-border-subtle rounded-xl shadow-2xl overflow-hidden z-50"
                >
                  <div className="p-1.5 space-y-0.5">
                    {Object.entries(TEMPLATE_LABELS).map(([type, label]) => {
                      const exists = modes.some((m) => m.templateType === type);
                      return (
                        <button
                          key={type}
                          onClick={() => handleCreate(type, label)}
                          disabled={exists}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${
                            exists
                              ? 'text-text-tertiary cursor-not-allowed opacity-50'
                              : `text-text-secondary hover:text-text-primary ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/5'}`
                          }`}
                        >
                          <div className="font-medium">{label}</div>
                          <div className="text-[10px] text-text-tertiary mt-0.5">
                            {exists ? '已存在' : type}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {createError && (
                    <div className="px-3 pb-2 text-[11px] text-red-400">
                      {createError}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right panel — mode details */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedMode ? (
            <>
              <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
                {/* Active toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">{selectedMode.name}</h3>
                    <p className="text-[11px] text-text-tertiary mt-0.5">
                      {TEMPLATE_LABELS[selectedMode.templateType] ?? selectedMode.templateType}
                    </p>
                  </div>
                  <button
                    onClick={() => handleSetActive(selectedMode.id)}
                    disabled={selectedMode.id === activeModeId}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 ${
                      selectedMode.id === activeModeId
                        ? 'bg-accent-primary/10 text-accent-primary cursor-default'
                        : `${isLight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/5 hover:bg-white/10'} text-text-secondary hover:text-text-primary`
                    }`}
                  >
                    {selectedMode.id === activeModeId ? '当前活跃' : '设为活跃'}
                  </button>
                </div>

                {/* Name input */}
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary uppercase tracking-wide mb-1.5">
                    模式名称
                  </label>
                  <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all"
                  />
                </div>

                {/* Custom context */}
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary uppercase tracking-wide mb-1.5">
                    自定义上下文
                  </label>
                  <textarea
                    value={editedContext}
                    onChange={(e) => setEditedContext(e.target.value)}
                    rows={6}
                    placeholder="输入自定义指令，让 AI 更好地适应你的需求..."
                    className="w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all resize-none"
                  />
                </div>

                {/* Note sections */}
                {noteSections.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-medium text-text-secondary uppercase tracking-wide mb-2">
                      笔记分区
                    </label>
                    <div className="space-y-2">
                      {noteSections.map((section) => (
                        <div
                          key={section.id}
                          className="bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5"
                        >
                          <div className="text-xs font-medium text-text-primary">
                            {section.title}
                          </div>
                          <div className="text-[11px] text-text-tertiary mt-0.5">
                            {section.description}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error message */}
                <AnimatePresence>
                  {saveError && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5 text-xs text-red-400"
                    >
                      {saveError}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer actions */}
              <div className="shrink-0 px-5 py-3 border-t border-border-subtle flex items-center justify-between">
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 size={13} />
                  删除
                </button>
                <div className="flex items-center gap-2">
                  {hasChanges && (
                    <span className="text-[10px] text-text-tertiary">有未保存的更改</span>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all duration-200 ${
                      hasChanges && !isSaving
                        ? 'bg-accent-primary text-white hover:bg-accent-primary/90 active:scale-[0.96]'
                        : `${isLight ? 'bg-black/5' : 'bg-white/5'} text-text-tertiary cursor-not-allowed`
                    }`}
                  >
                    {isSaving ? (
                      <>
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                        >
                          <Save size={13} />
                        </motion.div>
                        保存中...
                      </>
                    ) : (
                      <>
                        <Save size={13} />
                        保存
                      </>
                    )}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
              选择一个模式以查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModesSettingsBase;
