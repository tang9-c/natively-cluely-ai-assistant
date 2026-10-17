import { useState } from 'react';
import type { NativeAudioTranscriptPayload } from '../../../shared/transcriptIpc';
import { SpeakerIdentityMenu } from './SpeakerIdentityMenu';

export function LiveSpeakerIdentity({ segments }: { segments: NativeAudioTranscriptPayload[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const finals = segments.filter(segment => segment.final && segment.segmentId);
  if (!finals.length) return null;
  return <div className="no-drag relative px-4 text-xs text-text-secondary">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>纠正发言身份</button>
    {open && <div className="max-h-64 overflow-auto rounded-lg border border-white/10 p-3" style={{ backgroundColor: 'var(--bg-primary, #202024)' }}>
      <p className="mb-2 text-text-tertiary">点击标签修改；已合并片段的修改适用于整段。</p>
      {finals.slice(-20).map(segment => <div key={segment.segmentId} className="mb-3">
        <SpeakerIdentityMenu segment={segment} disabled={busy} onChange={async identity => {
          if (!segment.sessionGeneration || busy) return false;
          setBusy(true); setError('');
          try {
            const result = await window.electronAPI.speakerVerificationSetSessionOverride({ segmentId: segment.segmentId!,
              sessionGeneration: segment.sessionGeneration, action: identity === 'me' ? 'force_me' : identity === 'other' ? 'force_not_me' : identity === 'unknown' ? 'force_unknown' : 'clear' });
            if (!result.success) setError('身份修改失败，请重试。');
            return result.success;
          } catch { setError('身份修改失败，请重试。'); return false; }
          finally { setBusy(false); }
        }} />
        <p className="mt-1 select-text whitespace-pre-wrap">{segment.text}</p>
      </div>)}
      {error && <p role="status">{error}</p>}
    </div>}
  </div>;
}
