import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2, Upload } from 'lucide-react';

export function KnowledgeMaterialsSettings() {
  const [materials, setMaterials] = useState<any[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshMaterials = useCallback(async () => {
    const result = await window.electronAPI?.knowledgeListMaterials?.();
    if (result?.success) {
      setMaterials(result.materials || []);
    }
  }, []);

  useEffect(() => {
    refreshMaterials().catch(() => {});
  }, [refreshMaterials]);

  const uploadMaterials = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const selected = await window.electronAPI?.knowledgeSelectMaterials?.();
      if (!selected || selected.cancelled) return;
      if (!selected.success || !selected.filePaths?.length) {
        setStatus(selected.error || '没有选择文件');
        return;
      }
      const result = await window.electronAPI?.knowledgeUploadMaterials?.(selected.filePaths);
      const failed = result?.errors?.length || 0;
      setStatus(failed > 0 ? `已上传 ${result?.materials?.length || 0} 个，失败 ${failed} 个` : '资料已加入索引');
      await refreshMaterials();
    } catch (error: any) {
      setStatus(error?.message || '资料上传失败');
    } finally {
      setBusy(false);
    }
  }, [refreshMaterials]);

  const deleteMaterial = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const result = await window.electronAPI?.knowledgeDeleteMaterial?.(id);
      setStatus(result?.success ? '资料已删除' : (result?.error || '删除失败'));
      await refreshMaterials();
    } finally {
      setBusy(false);
    }
  }, [refreshMaterials]);

  const reindexMaterial = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const result = await window.electronAPI?.knowledgeReindexMaterial?.(id);
      setStatus(result?.success ? '已重新索引' : (result?.error || '重新索引失败'));
      await refreshMaterials();
    } finally {
      setBusy(false);
    }
  }, [refreshMaterials]);

  return (
    <div data-testid="knowledge-materials-card" className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center shrink-0">
            <Upload size={15} className="text-accent-primary" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-text-primary">资料库</h4>
            <p className="text-[11px] text-text-tertiary">
              上传 PDF、DOCX、Markdown 或 TXT，让会议回答可以引用本地资料。
            </p>
          </div>
        </div>
        <button
          onClick={uploadMaterials}
          disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all duration-200 disabled:opacity-60"
        >
          <Upload size={14} />
          上传资料
        </button>
      </div>

      {status && (
        <div className="rounded-xl border border-border-subtle bg-bg-input px-3.5 py-2.5 text-xs text-text-secondary">
          {status}
        </div>
      )}

      <div className="rounded-xl border border-border-subtle bg-bg-input overflow-hidden">
        {materials.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-secondary">
            暂无资料
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {materials.map((material) => {
              const title = material.title || material.file_name || material.fileName || material.id;
              const materialStatus = material.status || 'queued';
              return (
                <div key={material.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">{title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-text-tertiary">
                      <span>{materialStatus}</span>
                      {material.error_message && <span className="text-red-400">{material.error_message}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => reindexMaterial(material.id)}
                      disabled={busy}
                      className="p-1.5 rounded-lg border border-border-subtle bg-bg-component hover:bg-bg-elevated text-text-secondary hover:text-text-primary disabled:opacity-60"
                      title="重新索引"
                    >
                      <RefreshCw size={13} />
                    </button>
                    <button
                      onClick={() => deleteMaterial(material.id)}
                      disabled={busy}
                      className="p-1.5 rounded-lg border border-border-subtle bg-bg-component hover:bg-bg-elevated text-text-secondary hover:text-red-400 disabled:opacity-60"
                      title="删除"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
