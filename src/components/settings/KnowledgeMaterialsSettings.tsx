import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Trash2, Upload } from 'lucide-react';

const MATERIAL_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  indexing: '索引中',
  complete: '已完成',
  failed: '索引失败',
  deleted: '已删除',
};

function isBatchSettled(materials: any[], ids: string[]) {
  const byId = new Map(materials.map((material) => [material.id, material]));
  return ids.every((id) => {
    const status = byId.get(id)?.status;
    return status === 'complete' || status === 'failed' || status === 'deleted';
  });
}

function summarizeUploadResult(result: any) {
  const materials = result?.materials || [];
  const transportFailures = result?.errors?.length || 0;
  const failedMaterials = materials.filter((material: any) => material.status === 'failed').length;
  const queuedMaterials = materials.filter((material: any) => material.status === 'queued' || material.status === 'indexing').length;
  const completeMaterials = materials.filter((material: any) => material.status === 'complete').length;
  const failed = transportFailures + failedMaterials;

  if (failed > 0 && queuedMaterials > 0) {
    return `已加入 ${queuedMaterials} 个资料索引队列，${failed} 个失败`;
  }
  if (failed > 0) {
    return `资料上传完成，${failed} 个失败`;
  }
  if (completeMaterials > 0 && queuedMaterials === 0) {
    return `已完成 ${completeMaterials} 个资料索引`;
  }
  return '资料已加入索引队列';
}

export function KnowledgeMaterialsSettings() {
  const [materials, setMaterials] = useState<any[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [embeddingReady, setEmbeddingReady] = useState<boolean | null>(null);
  const [materialEmbeddingFailed, setMaterialEmbeddingFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const pollingRef = useRef<number | null>(null);

  const refreshMaterials = useCallback(async () => {
    const result = await window.electronAPI?.knowledgeListMaterials?.();
    if (result?.success) {
      setMaterials(result.materials || []);
      return result.materials || [];
    }
    return [];
  }, []);

  const refreshContextHealth = useCallback(async () => {
    const result = await window.electronAPI?.getContextHealth?.();
    if (result) {
      setEmbeddingReady(Boolean(result.embeddingReady));
      setMaterialEmbeddingFailed((result.materialQueue?.failed || 0) > 0);
    }
  }, []);

  useEffect(() => {
    refreshMaterials().catch(() => {});
    refreshContextHealth().catch(() => {});
  }, [refreshContextHealth, refreshMaterials]);

  useEffect(() => () => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startUploadPolling = useCallback((materialIds: string[]) => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
    }
    if (materialIds.length === 0) return;

    let attempts = 0;
    pollingRef.current = window.setInterval(async () => {
      attempts += 1;
      const latestMaterials = await refreshMaterials();
      if (isBatchSettled(latestMaterials, materialIds) || attempts >= 30) {
        if (pollingRef.current) {
          window.clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setBusy(false);
      }
    }, 1000);
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
      const materialIds = (result?.materials || []).map((material: any) => material.id).filter(Boolean);
      setStatus(summarizeUploadResult(result));
      await refreshMaterials();
      await refreshContextHealth();
      startUploadPolling(materialIds);
    } catch (error: any) {
      setStatus(error?.message || '资料上传失败');
      setBusy(false);
    } finally {
      if (!pollingRef.current) {
        setBusy(false);
      }
    }
  }, [refreshContextHealth, refreshMaterials, startUploadPolling]);

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
            <p className="mt-1 text-[11px] text-text-tertiary">
              PPTX 即将支持；当前请先导出为 PDF 或 Markdown 后上传。
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

      {embeddingReady === false && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-100">
          资料仍可上传，但检索将降级为关键词匹配，回答可能不稳定。
        </div>
      )}

      {embeddingReady === true && materialEmbeddingFailed && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-100">
          部分资料的向量索引失败；资料仍可检索，但会降级为关键词匹配。
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
              const errorMessage = material.error_message || material.errorMessage;
              const canReindex = materialStatus === 'complete';
              return (
                <div key={material.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">{title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-text-tertiary">
                      <span>{MATERIAL_STATUS_LABELS[materialStatus] || materialStatus}</span>
                      {errorMessage && <span className="text-red-400">{errorMessage}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => reindexMaterial(material.id)}
                      disabled={busy || !canReindex}
                      className="p-1.5 rounded-lg border border-border-subtle bg-bg-component hover:bg-bg-elevated text-text-secondary hover:text-text-primary disabled:opacity-60"
                      title={canReindex ? '重新索引' : '仅已完成资料可重新索引'}
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
