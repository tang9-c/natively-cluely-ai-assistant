import { useEffect, useRef, useState } from 'react';
import type { Meeting, MeetingEditRequest, MeetingEditResult, MeetingSummaryPatch } from '../../shared/meetingEdits';
import { normalizeMeetingActionItems, isValidMeetingActionText } from '../../shared/meetingActionItems';

type Field = keyof MeetingSummaryPatch | `text:${string}`;
type Status = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict' | 'invalid';
interface Bridge {
    applyMeetingEdit(request: MeetingEditRequest): Promise<MeetingEditResult>;
    getMeetingDetails(id: string): Promise<Meeting | null>;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const project = (meeting: Meeting): Meeting => ({ ...meeting,
    detailedSummary: normalizeMeetingActionItems(meeting.detailedSummary || { actionItems: [], keyPoints: [] }) });
const valueAt = (meeting: Meeting, field: Field) => field.startsWith('text:')
    ? meeting.transcript?.find(entry => entry.segmentId === field.slice(5))?.text
    : field === 'title' ? meeting.title : meeting.detailedSummary?.[field as keyof MeetingSummaryPatch & keyof NonNullable<Meeting['detailedSummary']>];

/** One queue owns every edit to this meeting, including transcript identity edits. */
export function createMeetingAutosave(initial: Meeting, bridge: Bridge) {
    let saved = project(initial);
    const drafts = new Map<Field, { base: unknown; value: unknown }>();
    let status: Status = 'idle';
    let failedOperation: MeetingEditRequest['operation'] | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sectionTitleEditing = false;
    let queue = Promise.resolve(true);
    let flushPromise: Promise<boolean> | undefined;
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach(listener => listener());
    const view = () => {
        const meeting = { ...saved, transcript: saved.transcript?.map(entry => ({ ...entry })), detailedSummary: { ...saved.detailedSummary! } };
        for (const [field, draft] of drafts) {
            if (field.startsWith('text:')) {
                const entry = meeting.transcript?.find(entry => entry.segmentId === field.slice(5));
                if (entry) entry.text = draft.value as string;
            } else if (field === 'title') meeting.title = draft.value as string;
            else (meeting.detailedSummary as any)[field] = draft.value;
        }
        // Keep intermediate input intact; only saved responses use the canonical projection.
        meeting.detailedSummary.actionItems = (meeting.detailedSummary.actionItemsStructured || []).map(item => item.text);
        return meeting;
    };
    const cancelTimer = () => { clearTimeout(timer); timer = undefined; };
    const enqueue = (work: () => Promise<boolean>) => {
        const next = queue.then(work, work);
        queue = next.catch(() => false);
        return next;
    };
    const refresh = (meeting: Meeting) => {
        if (meeting.id !== saved.id || (meeting.editState?.meetingRevision ?? 0) < (saved.editState?.meetingRevision ?? 0)) return;
        saved = project(meeting);
        notify();
    };
    const flush = (): Promise<boolean> => {
        cancelTimer();
        if (failedOperation) return Promise.resolve(false);
        if (sectionTitleEditing && drafts.has('sections')) return Promise.resolve(false);
        if (flushPromise) return flushPromise.then(ok => ok && drafts.size ? flush() : ok);
        flushPromise = enqueue(async () => {
            while (drafts.size) {
                if (status === 'conflict') return false;
                const textEntry = [...drafts].find(([field]) => field.startsWith('text:'));
                const batch = new Map(textEntry ? [textEntry] : [...drafts]);
                if (textEntry && !(textEntry[1].value as string).trim()) { status = 'invalid'; notify(); return false; }
                const actions = batch.get('actionItemsStructured')?.value as MeetingSummaryPatch['actionItemsStructured'];
                if (actions?.some(item => !isValidMeetingActionText(item.text))) { status = 'invalid'; notify(); return false; }
                if (sectionTitleEditing && batch.has('sections')) return false;
                if ([...batch].some(([field, draft]) => !equal(valueAt(saved, field), draft.base) && !equal(valueAt(saved, field), draft.value))) {
                    status = 'conflict'; notify(); return false;
                }
                const patch = Object.fromEntries([...batch].map(([field, draft]) => [field, draft.value])) as MeetingSummaryPatch;
                const operation: MeetingEditRequest['operation'] = textEntry
                    ? { type: 'text', segmentId: textEntry[0].slice(5), text: textEntry[1].value as string }
                    : { type: 'summary', patch };
                status = 'saving'; notify();
                try {
                    let result = await bridge.applyMeetingEdit({ meetingId: saved.id,
                        expectedRevision: saved.editState?.meetingRevision ?? 0, operation });
                    if (!result.ok && result.error === 'conflict') {
                        const latest = await bridge.getMeetingDetails(saved.id);
                        if (!latest) { status = 'error'; notify(); return false; }
                        const projected = project(latest);
                        const changed = [...batch].some(([field, draft]) => !equal(valueAt(projected, field), draft.base));
                        refresh(latest);
                        if (changed) { status = 'conflict'; notify(); return false; }
                        result = await bridge.applyMeetingEdit({ meetingId: saved.id,
                            expectedRevision: saved.editState?.meetingRevision ?? 0, operation });
                    }
                    if (!result.ok) { status = result.error === 'conflict' ? 'conflict' : 'error'; notify(); return false; }
                    const superseded = (saved.editState?.meetingRevision ?? 0) > result.revision;
                    refresh(result.meeting);
                    let conflictingResponse = false;
                    for (const [field, draft] of batch) {
                        if (superseded && !equal(valueAt(saved, field), draft.value)) { conflictingResponse = true; continue; }
                        const current = drafts.get(field);
                        if (current === draft) drafts.delete(field);
                        else if (current) current.base = valueAt(saved, field);
                    }
                    if (conflictingResponse) { status = 'conflict'; notify(); return false; }
                    notify();
                } catch { status = 'error'; notify(); return false; }
            }
            status = 'saved'; notify(); return true;
        }).finally(() => { flushPromise = undefined; });
        return flushPromise;
    };
    const runOperation = async (operation: MeetingEditRequest['operation']): Promise<boolean> => {
        const previousFailure = failedOperation;
        failedOperation = undefined;
        if (!await flush()) { failedOperation = previousFailure; return false; }
        return enqueue(async () => {
            status = 'saving'; notify();
            try {
                const result = await bridge.applyMeetingEdit({ meetingId: saved.id,
                    expectedRevision: saved.editState?.meetingRevision ?? 0, operation });
                if (!result.ok) { failedOperation = operation; status = 'error'; notify(); return false; }
                refresh(result.meeting); status = drafts.size ? 'pending' : 'saved'; notify(); return true;
            } catch { failedOperation = operation; status = 'error'; notify(); return false; }
        });
    };
    return {
        snapshot: () => ({ meeting: view(), status }),
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        refresh,
        text(segmentId: string, text: string) {
            const field: Field = `text:${segmentId}`;
            if (!saved.transcript?.some(entry => entry.segmentId === segmentId)) return;
            const previous = drafts.get(field);
            if (equal(previous ? previous.value : valueAt(saved, field), text)) return;
            drafts.set(field, { base: previous ? previous.base : valueAt(saved, field), value: text });
            if (failedOperation) status = 'error';
            else if (status !== 'conflict') status = 'pending';
            notify(); cancelTimer(); timer = setTimeout(() => { void flush(); }, 600);
        },
        patch(patch: MeetingSummaryPatch) {
            let changed = false;
            for (const [field, value] of Object.entries(patch) as [Field, unknown][]) {
                const previous = drafts.get(field);
                if (equal(previous ? previous.value : valueAt(saved, field), value)) continue;
                drafts.set(field, { base: previous ? previous.base : valueAt(saved, field), value });
                changed = true;
            }
            if (!changed) return;
            if (failedOperation) status = 'error';
            else if (status !== 'conflict') status = 'pending';
            notify(); cancelTimer();
            timer = setTimeout(() => { void flush(); }, 600);
        },
        setSectionTitleEditing(editing: boolean) { sectionTitleEditing = editing; },
        flush,
        operation: runOperation,
        retry: () => failedOperation ? runOperation(failedOperation) : flush(),
        async keepLocal() {
            for (const [field, draft] of drafts) draft.base = valueAt(saved, field);
            status = 'pending'; return flush();
        },
        async reload() {
            try {
                const latest = await bridge.getMeetingDetails(saved.id);
                if (!latest) return false;
                drafts.clear(); failedOperation = undefined; saved = project(latest); status = 'idle'; notify(); return true;
            } catch { status = 'error'; notify(); return false; }
        },
        reportSaveFailure() { status = 'error'; notify(); },
        dispose: cancelTimer,
    };
}

export function useMeetingAutosave(initial: Meeting) {
    const controllerRef = useRef<ReturnType<typeof createMeetingAutosave> | null>(null);
    if (!controllerRef.current) controllerRef.current = createMeetingAutosave(initial, window.electronAPI);
    const controller = controllerRef.current;
    const [snapshot, setSnapshot] = useState(controller.snapshot);
    useEffect(() => controller.subscribe(() => setSnapshot(controller.snapshot())), [controller]);
    useEffect(() => { controller.refresh(initial); }, [initial, controller]);
    useEffect(() => window.electronAPI?.onMeetingCloseRequest?.(async timedOut => {
        if (timedOut) { controller.reportSaveFailure(); return false; }
        (document.activeElement as HTMLElement | null)?.blur();
        return controller.flush();
    }), [controller]);
    useEffect(() => {
        const remove = window.electronAPI?.onMeetingsUpdated?.(() => {
            void window.electronAPI.getMeetingDetails(initial.id).then(meeting => {
                if (meeting) controller.refresh(meeting);
            }).catch(() => {});
        });
        return () => { remove?.(); controller.dispose(); };
    }, [controller, initial.id]);
    return { ...snapshot, controller };
}
