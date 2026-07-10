# Dynamic Action Replay Audio Fixtures

These WAV files are synthetic meeting-style replay assets generated with macOS
system voices and normalized to 16 kHz mono PCM.

They are not real customer recordings. They exist to exercise the real-meeting
failure modes that text fixtures cannot cover well:

- mixed Chinese and English speech
- multiple speakers
- old-topic pollution
- ASR-prone terms such as ECO, ECN, CAPA, NCR, and 8D
- internal/customer identity mismatch
- missing owner, date, or artifact details
- recruiting candidate concerns, experience probes, and interviewer/candidate
  identity mismatch

The default replay runner verifies asset presence and can execute deterministic
fixture-backed STT replay through the same `replay-manifest.json` entries.
Separate real-STT replay stages exist for FDE and recruiting to validate the
same audio assets through the live QCLOUD API speech path.

## Files

| File | Mode | Coverage |
| --- | --- | --- |
| `sales-pricing-objection-zh-001.wav` | sales | pricing objection, old-topic pollution, internal context |
| `sales-case-proof-mixed-001.wav` | sales | case proof request, mixed language, old-topic pollution |
| `sales-internal-price-identity-001.wav` | sales | internal/customer identity mismatch, pricing false-positive guard |
| `fde-plm-qms-risk-mixed-001.wav` | fde | PLM/QMS, CAPA traceability, audit log, readonly boundary |
| `fde-asr-eco-capa-001.wav` | fde | ASR-prone ECO/ECN/8D terms, missing acceptance criteria |
| `team-action-item-multi-speaker-001.wav` | team-meet | multi-speaker action item, blocker, owner/date/artifact gap |
| `recruiting-candidate-concern-zh-001.wav` | recruiting | candidate visa/start-date concern, speaker identity |
| `recruiting-experience-probe-en-001.wav` | recruiting | English experience probe, backend ownership |
| `recruiting-identity-mismatch-mixed-001.wav` | recruiting | internal/candidate identity mismatch, false-positive guard |
