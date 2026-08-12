import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, HardDrive, RefreshCw, Trash2 } from 'lucide-react';
import type {
  DownloadedModelKind,
  StorageUsageCategory,
  StorageUsageItem,
  StorageUsageSummary,
} from '../../types/electron';

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
};

const reasonText = (item: StorageUsageItem): string | null => {
  if (item.reason === 'model_in_use') return '会议正在使用此模型';
  if (item.reason === 'managed_elsewhere') return '请在本地模型设置中管理';
  if (item.reason === 'migration_incomplete') return '迁移尚未完整验证，不能清理';
  if (item.reason === 'unsafe_symbolic_link') return '路径安全检查未通过';
  return null;
};

const CategoryRow = ({ label, category }: { label: string; category: StorageUsageCategory }) => (
  <div className="flex items-center justify-between py-2 text-xs">
    <span className="text-text-secondary">{label}</span>
    <span className="font-medium tabular-nums text-text-primary">{formatBytes(category.bytes)}</span>
  </div>
);

export const StorageManagement: React.FC = () => {
  const [summary, setSummary] = useState<StorageUsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await window.electronAPI.getStorageUsage());
    } catch {
      setError('无法读取存储空间，请重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deleteModel = async (item: StorageUsageItem) => {
    const separator = item.id.indexOf(':');
    if (separator < 0 || !item.removable) return;
    const kind = item.id.slice(0, separator) as DownloadedModelKind;
    const modelId = item.id.slice(separator + 1);
    if (!window.confirm(`删除已下载模型“${item.label}”？需要再次使用时可以重新下载。`)) return;
    setDeletingId(item.id);
    try {
      const result = await window.electronAPI.deleteDownloadedModel(kind, modelId);
      if (!result.success) {
        setError(result.error === 'model_in_use' ? '会议正在使用该模型，结束会议后再试。' : '模型删除失败，请重试。');
        return;
      }
      await refresh();
    } catch {
      setError('模型删除失败，请重试。');
    } finally {
      setDeletingId(null);
    }
  };

  const deleteLegacy = async (item: StorageUsageItem) => {
    if (!item.removable) return;
    if (!window.confirm(`删除“${item.label}”？当前 CueUp 数据不会被删除，此操作无法撤销。`)) return;
    setDeletingId(item.id);
    try {
      const result = await window.electronAPI.deleteLegacyData(item.id);
      if (!result.success) {
        setError(result.error === 'migration_incomplete' ? '旧版数据迁移尚未完整验证，已取消清理。' : '旧版数据删除失败，请重试。');
        return;
      }
      await refresh();
    } catch {
      setError('旧版数据删除失败，请重试。');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="rounded-xl border border-border-subtle bg-bg-card p-5" data-testid="storage-management">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-item-surface text-text-secondary">
            <HardDrive size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text-primary">存储空间</h3>
            <p className="mt-0.5 text-xs text-text-secondary">查看本地模型、缓存和经过验证的旧版数据占用</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md bg-bg-item-surface px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {summary && (
        <>
          <div className="mt-4 divide-y divide-border-subtle/60 rounded-lg border border-border-subtle px-3">
            <CategoryRow label="应用内置模型" category={summary.appModels} />
            <CategoryRow label="已下载模型" category={summary.downloadedModels} />
            <CategoryRow label="应用缓存" category={summary.caches} />
            <CategoryRow label="旧版数据" category={summary.legacyData} />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-text-secondary">预计可释放</span>
            <span className="font-semibold text-emerald-500">{formatBytes(summary.reclaimableBytes)}</span>
          </div>

          {[...summary.downloadedModels.items, ...summary.legacyData.items].map(item => {
            const isLegacy = !item.id.includes(':');
            const reason = reasonText(item);
            return (
              <div key={item.id} className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-bg-item-surface px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-text-primary">{item.label}</p>
                  <p className="mt-0.5 text-[11px] text-text-tertiary">
                    {formatBytes(item.bytes)}{reason ? ` · ${reason}` : ''}
                  </p>
                </div>
                {item.removable && (
                  <button
                    type="button"
                    disabled={deletingId === item.id}
                    onClick={() => void (isLegacy ? deleteLegacy(item) : deleteModel(item))}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <Trash2 size={12} /> {deletingId === item.id ? '删除中' : '删除'}
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          <AlertCircle size={14} /> {error}
        </div>
      )}
    </section>
  );
};
