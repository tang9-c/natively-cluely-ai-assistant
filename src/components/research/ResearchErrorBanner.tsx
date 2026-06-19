// src/components/research/ResearchErrorBanner.tsx
//
// Generic red banner for research-pipeline errors. Surfaces the
// human-readable message plus the structured error code (so the
// user can attach it to a bug report). For Tavily credential
// problems we route the user to Settings rather than offering a
// pointless retry.

interface Props {
  error: string;
  errorCode?: string | null;
  onRetry?: () => void;
  onConfigureKey?: () => void;
}

export function ResearchErrorBanner({ error, errorCode, onRetry, onConfigureKey }: Props) {
  const showConfigureKey = errorCode === 'TAVILY_KEY_MISSING' || errorCode === 'TAVILY_INVALID_KEY';
  return (
    <div role="alert" className="rounded-lg p-4 bg-red-500/10 border border-red-500/30 text-red-300">
      <p className="font-medium mb-2">{error}</p>
      {errorCode && <p className="text-xs text-red-400 mb-3">code: {errorCode}</p>}
      <div className="flex gap-2">
        {showConfigureKey && onConfigureKey && (
          <button onClick={onConfigureKey} className="text-sm underline">
            前往 Settings 配置
          </button>
        )}
        {onRetry && !showConfigureKey && (
          <button onClick={onRetry} className="text-sm underline">
            重试
          </button>
        )}
      </div>
    </div>
  );
}
