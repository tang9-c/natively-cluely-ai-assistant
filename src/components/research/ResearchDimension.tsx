// src/components/research/ResearchDimension.tsx
//
// Collapsible card for a single dimension of the dossier
// (financials, business, strategy, etc.). Renders the summary
// paragraph plus a bulleted list of facts, where each bullet can
// optionally carry a citation index that links to the matching
// source row in the dossier.

interface Bullet {
  text: string;
  citation?: number;
}

interface Dimension {
  summary: string;
  details: Bullet[];
  confidence: 'high' | 'medium' | 'low';
}

interface Props {
  title: string;
  subtitle?: string;
  dimension: Dimension;
  sources: Array<{ index: number; title: string; url: string }>;
  defaultOpen?: boolean;
}

const CONFIDENCE_LABEL = {
  high: { text: 'high', color: 'text-green-400' },
  medium: { text: 'medium', color: 'text-yellow-400' },
  low: { text: 'low', color: 'text-red-400' },
};

export function ResearchDimension({ title, subtitle, dimension, sources, defaultOpen = true }: Props) {
  const c = CONFIDENCE_LABEL[dimension.confidence];
  return (
    <details open={defaultOpen} className="border-b border-border py-3">
      <summary className="cursor-pointer font-medium text-text-primary flex items-baseline gap-2 list-none">
        <span>{title}</span>
        {subtitle && <span className="text-sm text-text-muted">{subtitle}</span>}
        <span className={`ml-auto text-xs ${c.color}`}>confidence: {c.text}</span>
      </summary>
      <div className="mt-3 space-y-3 text-sm text-text-secondary">
        {dimension.summary && <p className="text-text-primary">{dimension.summary}</p>}
        {dimension.details.length > 0 && (
          <ul className="list-disc pl-5 space-y-1">
            {dimension.details.map((b, i) => {
              const src = b.citation != null ? sources.find((s) => s.index === b.citation) : null;
              return (
                <li key={i}>
                  {b.text}
                  {src && (
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 text-accent-primary text-xs"
                    >
                      [{b.citation}]
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
