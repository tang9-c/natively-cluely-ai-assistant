import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronRight,
  Lock,
  Plus,
  Save,
  Settings,
  Trash2,
  X,
} from 'lucide-react';

interface ModesSettingsBaseProps {
  onClose: () => void;
  isPremium: boolean;
  isLoaded: boolean;
  isTrialActive: boolean;
  onOpenNativelyAPI: () => void;
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
  isPremium,
}) => {
  const [modes, setModes] = useState<ModeItem[]>([]);
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [noteSections, setNoteSections] = useState<NoteSection[]>([]);
  const [editedName, setEditedName] = useState('');
  const [editedContext, setEditedContext] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeModeId, setActiveModeId] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

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

  const handleSetActive = async (modeId: string) => {
    const mode = modes.find((m) => m.id === modeId);
    if (!mode) return;
    if (mode.isActive) return;
    if (!isPremium && mode.templateType !== 'general') {
      setSaveError('切换到高级模式需要 Pro 订阅');
      return;
    }
    const result = await window.electronAPI?.modesSetActive?.(modeId);
    if (result?.error === 'pro_required') {
      setSaveError('切换到高级模式需要 Pro 订阅');
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
    if (!isPremium && selectedMode.templateType !== 'general') {
      setSaveError('编辑高级模式需要 Pro 订阅');
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await window.electronAPI?.modesUpdate?.(selectedMode.id, {
        name: editedName.trim(),
        customContext: editedContext.trim(),
      });
      if (result?.error) {
        setSaveError(result.error === 'pro_required' ? '需要 Pro 订阅' : result.error);
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
    if (!isPremium) {
      setSaveError('删除模式需要 Pro 订阅');
      return;
    }
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

  const canEditSelected = isPremium || selectedMode?.templateType === 'general';

  return (
    <div className="flex flex-col h-full bg-[#141414] text-text-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2.5">
          <Settings size={16} className="text-text-secondary" />
          <h2 className="text-sm font-semibold">模式设置</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-white/5 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — mode list */}
        <div className="w-[260px] border-r border-white/5 flex flex-col shrink-0">
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
            {modes.map((mode) => {
              const isSelected = mode.id === selectedModeId;
              const isActive = mode.id === activeModeId;
              const isGeneral = mode.templateType === 'general';
              const isLocked = !isGeneral && !isPremium;
              return (
                <button
                  key={mode.id}
                  onClick={() => setSelectedModeId(mode.id)}
                  className={`w-full rounded-xl px-3 py-2.5 flex items-center gap-2.5 transition-all duration-200 text-left ${
                    isSelected
                      ? 'bg-bg-item-active text-text-primary'
                      : 'hover:bg-bg-item-surface text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">
                        {mode.name}
                      </span>
                      {isLocked && (
                        <Lock size={10} className="opacity-40 shrink-0" />
                      )}
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
          <div className="p-2 border-t border-white/5 shrink-0">
            <button
              onClick={() => {
                if (!isPremium) {
                  setSaveError('创建新模式需要 Pro 订阅');
                  return;
                }
                // In a full implementation this would open a create modal.
                // For the base version we just show the locked message.
              }}
              disabled={!isPremium}
              className={`w-full rounded-xl px-3 py-2.5 flex items-center justify-center gap-2 text-xs font-medium transition-all duration-200 ${
                isPremium
                  ? 'bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20'
                  : 'bg-white/5 text-text-tertiary cursor-not-allowed'
              }`}
            >
              <Plus size={14} />
              <span>创建新模式</span>
              {!isPremium && <Lock size={10} className="opacity-50" />}
            </button>
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
                        : 'bg-white/5 text-text-secondary hover:bg-white/10 hover:text-text-primary'
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
                    disabled={!canEditSelected}
                    className={`w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all ${
                      !canEditSelected ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  />
                  {!canEditSelected && (
                    <p className="text-[10px] text-amber-500/80 mt-1 flex items-center gap-1">
                      <Lock size={10} />
                      编辑此模式需要 Pro 订阅
                    </p>
                  )}
                </div>

                {/* Custom context */}
                <div>
                  <label className="block text-[11px] font-medium text-text-secondary uppercase tracking-wide mb-1.5">
                    自定义上下文
                  </label>
                  <textarea
                    value={editedContext}
                    onChange={(e) => setEditedContext(e.target.value)}
                    disabled={!canEditSelected}
                    rows={6}
                    placeholder="输入自定义指令，让 AI 更好地适应你的需求..."
                    className={`w-full bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/50 transition-all resize-none ${
                      !canEditSelected ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
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
              <div className="shrink-0 px-5 py-3 border-t border-white/5 flex items-center justify-between">
                <button
                  onClick={handleDelete}
                  disabled={!isPremium}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 ${
                    isPremium
                      ? 'text-red-400 hover:bg-red-500/10'
                      : 'text-text-tertiary cursor-not-allowed'
                  }`}
                >
                  <Trash2 size={13} />
                  删除
                  {!isPremium && <Lock size={10} className="opacity-40" />}
                </button>
                <div className="flex items-center gap-2">
                  {hasChanges && (
                    <span className="text-[10px] text-text-tertiary">有未保存的更改</span>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving || !canEditSelected}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all duration-200 ${
                      hasChanges && canEditSelected && !isSaving
                        ? 'bg-accent-primary text-white hover:bg-accent-primary/90 active:scale-[0.96]'
                        : 'bg-white/5 text-text-tertiary cursor-not-allowed'
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
