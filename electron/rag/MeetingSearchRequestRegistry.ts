export class MeetingSearchRequestRegistry {
    private readonly active = new Map<
        string,
        { requestId: string; controller: AbortController }
    >();

    private key(senderId: number, meetingId: string): string {
        return `${senderId}:${meetingId}`;
    }

    start(
        senderId: number,
        meetingId: string,
        requestId: string
    ): AbortController {
        const key = this.key(senderId, meetingId);
        this.active.get(key)?.controller.abort();

        const controller = new AbortController();
        this.active.set(key, { requestId, controller });
        return controller;
    }

    isCurrent(senderId: number, meetingId: string, requestId: string): boolean {
        return this.active.get(this.key(senderId, meetingId))?.requestId === requestId;
    }

    cancel(senderId: number, meetingId: string, requestId: string): boolean {
        const key = this.key(senderId, meetingId);
        const current = this.active.get(key);
        if (!current || current.requestId !== requestId) return false;

        current.controller.abort();
        this.active.delete(key);
        return true;
    }

    finish(senderId: number, meetingId: string, requestId: string): void {
        const key = this.key(senderId, meetingId);
        if (this.active.get(key)?.requestId === requestId) {
            this.active.delete(key);
        }
    }
}
