import React, { useState } from 'react';

import { resolveSpeakerIdentity } from '../../../shared/speakerIdentity';
import { SpeakerIdentityMenu, type IdentityChoice } from './SpeakerIdentityMenu';
import type { TranscriptVirtualRow } from '../../../shared/transcriptVirtualization';

interface TranscriptRowProps {
  row: TranscriptVirtualRow;
  onTextChange?: (segmentId: string, text: string) => void;
  onTextBlur?: () => void;
  onIdentityChange?: (ids: string[], identity: IdentityChoice) => Promise<boolean>;
  onSelect?: () => void;
  selecting?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  saving?: boolean;
  formatTime: (timestamp: number) => string;
}

export const TranscriptRow = React.memo(function TranscriptRow({
  row,
  formatTime, onTextChange, onTextBlur, onIdentityChange, onSelect, selecting, selected, onToggle, saving,
}: TranscriptRowProps) {
  const { entry } = row;
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number; variant: string } | null>(null);
  const [canonical, setCanonical] = useState('');
  const [pair, setPair] = useState<{ variant: string; canonical: string } | null>(null);
  const [termStatus, setTermStatus] = useState('');
  const [remembering, setRemembering] = useState(false);
  const editable = Boolean(onTextChange && entry.segmentId && (entry as { isFinal?: boolean }).isFinal !== false && (entry as { final?: boolean }).final !== false);
  const remember = async () => {
    if (!pair || remembering) return;
    setRemembering(true);
    try {
      const result = await window.electronAPI.localSenseVoiceAddTermPair(pair);
      setTermStatus(result.success ? result.enabled ? '已记住，仅对后续 SenseVoice 最终结果生效。' : '已保存但未启用，请在原词表管理页启用。' : result.error || '词对保存失败，请重试。');
      if (result.success) setPair(null);
    } catch { setTermStatus('词对保存失败，请重试。'); }
    finally { setRemembering(false); }
  };
  return (
    <div className="group pb-6" data-transcript-row-key={row.key}>
      <div className="mb-1 flex items-center gap-2">
        {selecting && <input type="checkbox" aria-label="选择发言片段" checked={selected} onChange={onToggle} disabled={saving} />}
        {onIdentityChange && entry.segmentId ? <SpeakerIdentityMenu segment={entry} disabled={saving}
          onChange={identity => onIdentityChange([entry.segmentId!], identity)} onSelect={onSelect} />
          : <span className="text-xs font-semibold text-text-secondary">{resolveSpeakerIdentity(entry).label}</span>}
        <span className="font-mono text-xs text-text-tertiary">
          {entry.timestamp ? formatTime(entry.timestamp) : '0:00'}
        </span>
      </div>
      {editing && editable ? <>
        <textarea autoFocus aria-label="编辑转录" value={entry.text}
          className="w-full resize-y rounded border border-border-subtle bg-transparent p-2 text-[15px] leading-relaxed text-text-secondary"
          onChange={event => { onTextChange?.(entry.segmentId!, event.target.value); setSelection(null); setPair(null); }}
          onSelect={event => { const input = event.currentTarget;
            if (input.selectionEnd > input.selectionStart) { setSelection({ start: input.selectionStart, end: input.selectionEnd, variant: input.value.slice(input.selectionStart, input.selectionEnd) }); setCanonical(''); }
          }} onBlur={onTextBlur} />
        {!entry.text.trim() && <p role="alert" className="text-xs text-red-500">请保留有效转录内容，空白不会删除片段。</p>}
        {selection && <div className="my-2 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <span>修正所选词：{selection.variant}</span>
          <input aria-label="正确词" value={canonical} onChange={event => setCanonical(event.target.value)} className="rounded border border-border-subtle bg-transparent p-1" />
          <button type="button" disabled={!canonical.trim()} onClick={() => {
            const target = canonical.trim();
            onTextChange?.(entry.segmentId!, entry.text.slice(0, selection.start) + target + entry.text.slice(selection.end));
            setPair({ variant: selection.variant, canonical: target }); setSelection(null); setTermStatus('');
          }}>替换所选词</button>
        </div>}
        <button type="button" onClick={() => { onTextBlur?.(); if (entry.text.trim()) setEditing(false); }} className="text-xs text-text-tertiary">完成编辑</button>
      </> : <p tabIndex={editable ? 0 : undefined} role={editable ? 'button' : undefined} aria-label={editable ? '编辑此段转录' : undefined}
        onClick={() => { if (editable) setEditing(true); }} onKeyDown={event => { if (editable && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setEditing(true); } }}
        className="cursor-text select-text text-[15px] leading-relaxed text-text-secondary transition-colors">{editable && !entry.text.trim() ? '空白草稿，点击继续编辑' : entry.text}</p>}
      {pair && <button type="button" disabled={remembering} onClick={remember} className="mt-2 text-xs text-text-secondary">确认记住：{pair.variant} → {pair.canonical}（仅 SenseVoice）</button>}
      {termStatus && <p role="status" className="mt-1 text-xs text-text-secondary">{termStatus}</p>}

    </div>
  );
});
