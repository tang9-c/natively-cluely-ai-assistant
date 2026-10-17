import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { resolveSpeakerIdentity, type SpeakerIdentitySegmentLike } from '../../../shared/speakerIdentity';

export type IdentityChoice = 'me' | 'other' | 'unknown' | null;
const choices: Array<[IdentityChoice, string]> = [
  ['me', '标记为我'], ['other', '标记为其他参会者'], ['unknown', '标记为身份未确认'], [null, '恢复自动判断'],
];

export function SpeakerIdentityMenu({ segment, onChange, onSelect, disabled, label }: {
  segment: SpeakerIdentitySegmentLike;
  onChange: (identity: IdentityChoice) => Promise<boolean>;
  onSelect?: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const identity = resolveSpeakerIdentity(segment);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? []);
        if (!items.length) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    };
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  return <div className="relative inline-block" ref={ref}>
    <button ref={trigger} type="button" disabled={disabled || applying} aria-haspopup="menu" aria-expanded={open}
      className="rounded px-1 text-xs font-semibold text-text-secondary hover:bg-white/10 focus-visible:outline focus-visible:outline-2"
      title={identity.detail} onClick={() => setOpen(!open)}>{label ?? identity.label}</button>
    {open && createPortal(<div ref={menuRef} role="menu" aria-label="修改发言身份" className="fixed z-[10000] min-w-52 rounded-lg border border-white/10 p-1 shadow-xl" style={{ backgroundColor: 'var(--bg-primary, #202024)', left: Math.min(trigger.current?.getBoundingClientRect().left ?? 0, window.innerWidth - 230), top: Math.max(4, Math.min((trigger.current?.getBoundingClientRect().bottom ?? 0) + 4, window.innerHeight - 290)) }}>
      <p className="px-2 py-1 text-xs text-text-tertiary">{identity.detail}</p>
      {((segment.rawSegmentIds?.length ?? 0) > 1 || (segment.coalescedFromCount ?? 0) > 1) && <p className="max-w-64 px-2 py-1 text-xs text-text-tertiary">此段已合并，修改适用于整段</p>}
      {choices.map(([value, text], index) => <button key={text} type="button" role="menuitem" autoFocus={index === 0} disabled={disabled || applying}
        className="block w-full rounded px-2 py-2 text-left text-xs text-text-primary hover:bg-white/10 focus-visible:outline focus-visible:outline-2"
        onClick={async () => {
          if (applying) return;
          setApplying(true); setError('');
          try {
            if (await onChange(value)) { setOpen(false); trigger.current?.focus(); }
            else setError('修改未保存，请重试。');
          } catch { setError('修改未保存，请重试。'); }
          finally { setApplying(false); }
        }}>{text}</button>)}
      {error && <p role="status" className="px-2 py-1 text-xs text-text-secondary">{error}</p>}
      {onSelect && <button disabled={applying} type="button" role="menuitem" className="block w-full rounded px-2 py-2 text-left text-xs text-text-primary hover:bg-white/10"
        onClick={() => { onSelect(); setOpen(false); }}>选择多段</button>}
    </div>, document.body)}
  </div>;
}
