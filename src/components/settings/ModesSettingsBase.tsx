import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import {
  DEFAULT_MODE_NAMES,
  getModeDisplayName,
  MODE_TEMPLATE_LABELS,
} from '../../lib/modeTemplateMeta';

interface ModesSettingsBaseProps {
  onClose: () => void;
}

interface ModeItem {
  id: string;
  name: string;
  templateType: string;
  customContext: string;
  intentKeywords: IntentKeywordSetting[];
  isActive: boolean;
  createdAt: string;
}

interface IntentKeywordSetting {
  intent: string;
  keywordsCsv: string;
}

interface NoteSection {
  id: string;
  modeId: string;
  title: string;
  description: string;
  sortOrder: number;
}

const INTENT_LABELS: Record<string, string> = {
  clarification: '澄清解释',
  follow_up: '继续追问',
  deep_dive: '深入展开',
  behavioral: '行为问题',
  example_request: '具体例子',
  summary_probe: '总结确认',
  coding: '代码实现',
  request_example: '要求举例',
  seize_signal: '购买信号',
  handle_objection: '异议处理',
  discovery_probe: '需求发现',
  capture_action: '行动项',
  capture_decision: '决策',
  capture_risk: '风险阻塞',
  status_update: '状态更新',
  explain_concept: '概念解释',
  render_formula: '公式推导',
  answer_class_question: '课堂提问',
};

const INTENT_DESCRIPTIONS: Record<string, string> = {
  clarification: '对方要求解释、澄清或说明',
  follow_up: '对方追问后续或结果',
  deep_dive: '对方要求更深入说明',
  behavioral: '对方询问过往经历或故事',
  example_request: '对方要求具体例子',
  summary_probe: '对方在总结或确认理解',
  coding: '对方要求代码、算法或实现',
  request_example: '面试官要求候选人举具体例子',
  seize_signal: '客户表达推进、采购或签约意向',
  handle_objection: '客户提出价格、竞品、预算等异议',
  discovery_probe: '客户讨论痛点、流程、ROI 或需求',
  capture_action: '会议中出现负责人、截止时间或待办',
  capture_decision: '会议中确认决策或共识',
  capture_risk: '会议中出现风险、依赖或阻塞',
  status_update: '对方询问进度、状态或负责人',
  explain_concept: '讲座中引入术语、概念或定义',
  render_formula: '讲座中出现公式、方程或推导',
  answer_class_question: '讲师向全班提问',
};

function normalizeKeywordsCsv(csv: string): string {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of csv.split(',')) {
    const keyword = raw.trim();
    if (!keyword) continue;
    const key = keyword.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(keyword);
  }
  return normalized.join(',');
}

function serializeIntentKeywords(rows: IntentKeywordSetting[]): string {
  return JSON.stringify(
    [...rows]
      .map((row) => ({ intent: row.intent, keywordsCsv: normalizeKeywordsCsv(row.keywordsCsv) }))
      .sort((a, b) => a.intent.localeCompare(b.intent)),
  );
}

export const ModesSettingsBase: React.FC<ModesSettingsBaseProps> = ({
  onClose,
}) => {
  const [modes, setModes] = useState<ModeItem[]>([]);
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [noteSections, setNoteSections] = useState<NoteSection[]>([]);
  const [editedName, setEditedName] = useState('');
  const [editedContext, setEditedContext] = useState('');
  const [editedIntentKeywords, setEditedIntentKeywords] = useState<IntentKeywordSetting[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeModeId, setActiveModeId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newSectionDesc, setNewSectionDesc] = useState('');
  const [sectionError, setSectionError] = useState<string | null>(null);
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
        intentKeywords: m.intentKeywords ?? [],
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
      setEditedIntentKeywords(selectedMode.intentKeywords ?? []);
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
        intentKeywords: editedIntentKeywords.map((row) => ({
          intent: row.intent,
          keywordsCsv: normalizeKeywordsCsv(row.keywordsCsv),
        })),
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

  const handleIntentKeywordChange = (intent: string, keywordsCsv: string) => {
    setEditedIntentKeywords((prev) =>
      prev.map((row) => (row.intent === intent ? { ...row, keywordsCsv } : row)),
    );
  };

  const handleResetIntentKeywords = async () => {
    if (!selectedMode) return;
    const result = await window.electronAPI?.modesResetIntentKeywords?.(selectedMode.id);
    if (result?.error) {
      setSaveError(result.error);
      return;
    }
    if (result?.intentKeywords) {
      setEditedIntentKeywords(result.intentKeywords);
    }
    await loadModes();
    setSaveError(null);
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
      editedContext.trim() !== selectedMode.customContext ||
      serializeIntentKeywords(editedIntentKeywords) !== serializeIntentKeywords(selectedMode.intentKeywords ?? []));

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
                        {getModeDisplayName(mode)}
                      </span>
                    </div>
                    <div className="text-[10px] text-text-tertiary mt-0.5">
                      {MODE_TEMPLATE_LABELS[mode.templateType] ?? mode.templateType}
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
                    {Object.entries(MODE_TEMPLATE_LABELS).map(([type, label]) => {
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
                    <h3 className="text-sm font-semibold">{getModeDisplayName(selectedMode)}</h3>
                    <p className="text-[11px] text-text-tertiary mt-0.5">
                      {MODE_TEMPLATE_LABELS[selectedMode.templateType] ?? selectedMode.templateType}
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

                {/* Intent keywords */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <label className="block text-[11px] font-medium text-text-secondary uppercase tracking-wide">
                        意图词
                      </label>
                      <p className="text-[10px] text-text-tertiary mt-0.5">
                        多个词用英文逗号分隔
                      </p>
                    </div>
                    <button
                      onClick={handleResetIntentKeywords}
                      className="flex items-center gap-1 text-[11px] font-medium text-text-secondary hover:text-accent-primary transition-colors"
                    >
                      <RotateCcw size={12} />
                      恢复默认意图词
                    </button>
                  </div>
                  <div className="space-y-2">
                    {editedIntentKeywords.map((row) => (
                      <div
                        key={row.intent}
                        className="bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-3 mb-1.5">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-text-primary">
                              {INTENT_LABELS[row.intent] ?? row.intent}
                            </div>
                            <div className="text-[10px] text-text-tertiary">
                              {INTENT_DESCRIPTIONS[row.intent] ?? row.intent}
                            </div>
                          </div>
                        </div>
                        <textarea
                          value={row.keywordsCsv}
                          onChange={(e) => handleIntentKeywordChange(row.intent, e.target.value)}
                          rows={2}
                          placeholder="例如：太贵,预算不够,竞品"
                          className="w-full bg-transparent text-[11px] text-text-secondary placeholder:text-text-tertiary outline-none resize-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Note sections */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[11px] font-medium text-text-secondary uppercase tracking-wide">
                      笔记分区
                    </label>
                    <button
                      onClick={() => {
                        setAddingSection((prev) => !prev);
                        setSectionError(null);
                      }}
                      className="flex items-center gap-1 text-[11px] font-medium text-accent-primary hover:text-accent-primary/80 transition-colors"
                    >
                      <Plus size={12} />
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
                        className="overflow-hidden mb-2"
                      >
                        <div className="bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 space-y-2">
                          <input
                            type="text"
                            value={newSectionTitle}
                            onChange={(e) => setNewSectionTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddNoteSection();
                            }}
                            placeholder="分区标题"
                            className="w-full bg-transparent text-xs font-medium text-text-primary placeholder:text-text-tertiary outline-none"
                          />
                          <textarea
                            value={newSectionDesc}
                            onChange={(e) => setNewSectionDesc(e.target.value)}
                            rows={2}
                            placeholder="分区描述（告诉 AI 这里该放什么内容）"
                            className="w-full bg-transparent text-[11px] text-text-secondary placeholder:text-text-tertiary outline-none resize-none"
                          />
                          <div className="flex items-center justify-between">
                            {sectionError && (
                              <span className="text-[11px] text-red-400">{sectionError}</span>
                            )}
                            <div className="flex-1" />
                            <button
                              onClick={handleAddNoteSection}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-accent-primary text-white hover:bg-accent-primary/90 transition-all"
                            >
                              <Check size={11} strokeWidth={3} />
                              保存
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="space-y-2">
                    {noteSections.map((section) => (
                      <motion.div
                        key={section.id}
                        layout
                        className="bg-bg-input border border-border-subtle rounded-xl px-3.5 py-2.5 group"
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <input
                              type="text"
                              defaultValue={section.title}
                              onBlur={(e) =>
                                handleUpdateNoteSection(section.id, e.target.value, section.description)
                              }
                              className="w-full bg-transparent text-xs font-medium text-text-primary placeholder:text-text-tertiary outline-none focus:ring-0"
                            />
                            <textarea
                              defaultValue={section.description}
                              onBlur={(e) =>
                                handleUpdateNoteSection(section.id, section.title, e.target.value)
                              }
                              rows={2}
                              placeholder="分区描述"
                              className="w-full bg-transparent text-[11px] text-text-secondary placeholder:text-text-tertiary outline-none focus:ring-0 resize-none"
                            />
                          </div>
                          <button
                            onClick={() => handleDeleteNoteSection(section.id, section.title)}
                            className="shrink-0 p-1 rounded-md text-text-tertiary hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                            title="删除分区"
                          >
                            <Trash2 size={13} />
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
