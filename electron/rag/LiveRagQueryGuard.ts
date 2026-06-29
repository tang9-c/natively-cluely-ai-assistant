const CONTROL_COMMANDS = new Set([
    '结束',
    '结束会议',
    '结束会话',
    '停止',
    '停止会议',
    '退出',
    'end',
    'stop',
    'quit',
]);

function normalizeControlQuery(query: string): string {
    return query
        .trim()
        .toLowerCase()
        .replace(/[\s。！？.!?,，、；;：:]+/g, '');
}

export function shouldUseLiveRagQuery(query: unknown): boolean {
    if (typeof query !== 'string') return false;
    const trimmed = query.trim();
    if (!trimmed) return false;
    return !CONTROL_COMMANDS.has(normalizeControlQuery(trimmed));
}

export function isRecoverableLiveRagError(message: unknown): boolean {
    if (typeof message !== 'string') return false;
    return (
        message.includes('NO_RELEVANT_CONTEXT') ||
        message.includes('NO_MEETING_EMBEDDINGS') ||
        message.includes('Worker exited with code') ||
        (message.includes('Worker request') && message.includes('timed out'))
    );
}
