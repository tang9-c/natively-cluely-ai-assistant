// Entirely fictional schema-v37 meeting inputs. Return fresh objects so tests
// may edit them without contaminating other cases; no production imports.
const date = '2026-10-01T09:00:00.000Z';
const task = '提供星舟项目接口清单';

function meeting(name, detailedSummary, transcript = []) {
  return {
    id: `v28-fictional-${name}`,
    title: '虚构星舟项目讨论',
    date,
    duration: '20:00',
    summary: '讨论虚构项目的接口与交付安排。',
    detailedSummary,
    transcript,
    isProcessed: true,
  };
}

export function createV28MeetingFixtures() {
  const stringsOnly = meeting('strings-only', {
    actionItems: [task, '确认演示时间'], keyPoints: ['接口范围待核实'],
  });
  const structuredOnly = meeting('structured-only', {
    schemaVersion: 2, actionItems: [], keyPoints: [],
    actionItemsStructured: [{ id: 'structured-1', text: task, owner: '虚构林青', deadline: '2026-10-08' }],
  });
  const duplicateItems = meeting('duplicate-items', {
    schemaVersion: 2, actionItems: [task, '确认演示时间。'], keyPoints: [],
    actionItemsStructured: [
      { id: 'duplicate-1', text: `${task}。`, owner: '虚构林青' },
      { id: 'duplicate-2', text: '确认演示时间' },
    ],
  });
  const conflictingOwners = meeting('conflicting-owners', {
    schemaVersion: 2, actionItems: [task], keyPoints: [],
    actionItemsStructured: [
      { id: 'conflict-1', text: task, owner: '虚构林青', deadline: '2026-10-08' },
      { id: 'conflict-2', text: task, owner: '虚构陈禾', deadline: '2026-10-09' },
    ],
  });
  const generating = {
    ...meeting('generating', { actionItems: [], keyPoints: [] }, [
      { speaker: 'user', text: '虚构项目需要补充接口清单。', timestamp: 1000 },
    ]),
    title: 'Processing...', summary: 'Generating summary...', isProcessed: false,
  };
  const longTranscript = meeting('5000-segments', { actionItems: [], keyPoints: [] },
    Array.from({ length: 5000 }, (_, index) => ({
      speaker: index % 2 ? 'interviewer' : 'user',
      text: `虚构讨论第 ${index + 1} 段，核对星舟项目条目。`,
      timestamp: index * 1000, startTimestampMs: index * 1000, endTimestampMs: index * 1000 + 900,
    })));
  const manualIdentity = meeting('manual-identity', { actionItems: [], keyPoints: [] }, [
    {
      speaker: 'user', text: '这是虚构其他参会者通过共享麦克风的发言。', timestamp: 1000,
      speakerIdentityCorrection: { isMe: false, source: 'user', correctedAt: 1790845201000 },
    },
    {
      speaker: 'interviewer', text: '这是虚构本人通过系统音源的发言。', timestamp: 2000,
      speakerIdentityCorrection: { isMe: true, source: 'user', correctedAt: 1790845202000 },
    },
  ]);
  return { stringsOnly, structuredOnly, duplicateItems, conflictingOwners, generating, longTranscript, manualIdentity };
}
