import { DynamicAction, ActionStatus } from './DynamicAction';

export class DynamicActionStore {
    private actions: Map<string, DynamicAction> = new Map();

    addAction(action: DynamicAction): void {
        this.actions.set(action.id, action);
    }

    updateStatus(id: string, status: ActionStatus): void {
        const action = this.actions.get(id);
        if (action) {
            action.status = status;
        }
    }

    getActiveActions(sessionId: string): DynamicAction[] {
        const now = Date.now();
        return Array.from(this.actions.values()).filter(
            (action) =>
                action.sessionId === sessionId &&
                action.status !== 'expired' &&
                action.status !== 'completed' &&
                action.status !== 'dismissed' &&
                (!action.expiresAt || action.expiresAt > now)
        );
    }

    expireStaleActions(sessionId: string, maxAgeMs: number): void {
        const now = Date.now();
        const cutoff = now - maxAgeMs;
        for (const action of this.actions.values()) {
            if (
                action.sessionId === sessionId &&
                action.createdAt < cutoff &&
                action.status === 'candidate'
            ) {
                action.status = 'expired';
            }
        }
    }

    deduplicate(newAction: DynamicAction, windowMs: number = 120000): DynamicAction | null {
        // Debug session 2026-06-23 — three related fixes rolled together:
        //
        // 1. The previous implementation used real wall clock time (`Date.now()`)
        //    for the dedup window, ignoring `newAction.createdAt`. When callers
        //    (notably DynamicActionEngine.assessSignals / detectActions, plus all
        //    unit tests with simulated `now`) set `createdAt` to a synthetic
        //    value, `windowStart` was always anchored to the actual epoch
        //    (~1.7e12) while `existing.createdAt` was a small test number (e.g.
        //    1000). The `existing.createdAt > windowStart` check failed silently
        //    on every duplicate, so 3 identical calls all returned 1 action
        //    each. Using `newAction.createdAt` as the reference time makes the
        //    window caller-stable and matches the documented "within 120s of
        //    the new action" semantics.
        //
        // 2. The previous implementation had an unconditional auto-promotion
        //    branch: if the new action was auto-surface eligible and the existing
        //    was card-only, it expired the old one and let the new one through.
        //    This conflated "deduplicate" with "escalate": when SignalStateTracker
        //    boosted the same trigger's confidence on the second observation
        //    (boost + more evidenceRefs → autoSurfaceEligible flips from card to
        //    auto), the second call leaked through as a new action — directly
        //    violating the regression test "3 identical triggers → 1 stored
        //    action".
        //
        // 3. The right semantic is: inside the dedup window, identical triggers
        //    are duplicates (suppress); different triggers with the same type
        //    (different `latestTurn` text) are escalations (promote). This is
        //    what the two tests assert in concert:
        //      - "3 identical triggers (`太贵了` ×3) → 1 stored action" → suppress
        //      - "T1=`这个价格太高了`, T2=`我们老板肯定会觉得报价太高`" → promote T2
        //    Comparing `latestTurn` is the right discriminator: the buildAction
        //    helper writes the same transcript into both `latestTurn` and the
        //    description prefix, so it reflects exactly what the user just said.
        //    Identical latestTurn = the user is repeating themselves; different
        //    latestTurn = the user is re-asserting with new evidence.
        const now = newAction.createdAt ?? Date.now();
        const windowStart = now - windowMs;

        for (const existing of this.actions.values()) {
            if (
                existing.sessionId === newAction.sessionId &&
                existing.modeId === newAction.modeId &&
                existing.type === newAction.type &&
                existing.status !== 'expired' &&
                existing.status !== 'dismissed' &&
                existing.createdAt > windowStart
            ) {
                // Same trigger phrase, same session, within window → user is
                // repeating themselves; suppress the duplicate. The signal
                // tracker has already accumulated the new evidence into the
                // existing state via its own dedup logic, so no information is
                // lost.
                if (existing.latestTurn === newAction.latestTurn) {
                    return null;
                }
                // Different latestTurn = genuine escalation (e.g., user moved
                // from "this is too expensive" to "my boss will think the price
                // is too high"). Expire the old action and let the new one
                // through. This preserves the auto-surface promotion path that
                // the "auto-surfacing after repeat" test asserts on.
                existing.status = 'expired';
                continue;
            }
        }

        return newAction;
    }

    getAction(id: string): DynamicAction | undefined {
        return this.actions.get(id);
    }

    getAllActions(sessionId: string): DynamicAction[] {
        return Array.from(this.actions.values()).filter(
            (action) => action.sessionId === sessionId
        );
    }
}
