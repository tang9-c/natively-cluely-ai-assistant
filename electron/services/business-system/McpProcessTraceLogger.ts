import { redactForLog } from '../../utils/redactForLog';
import { isVerboseLogging } from '../../verboseLog';

interface TraceSink {
    log(line: string): void;
    warn(line: string): void;
}

interface McpProcessTraceLoggerConfig {
    isVerbose?: () => boolean;
    sink?: TraceSink;
}

const SAFE_DETAIL_KEYS = new Set([
    'traceId', 'stage', 'provider', 'model', 'sourceId', 'hostname', 'toolName',
    'toolCount', 'schemaBytes', 'argumentShape', 'resultShape', 'durationMs',
    'status', 'errorCode', 'turn', 'callIndex', 'toolCalls',
]);
const SAFE_FAILURE_KEYS = new Set([
    'traceId', 'stage', 'provider', 'model', 'sourceId', 'hostname', 'toolName',
    'status', 'errorCode', 'turn', 'callIndex', 'toolCalls', 'durationMs',
]);

function pickSafe(payload: Record<string, unknown>, keys: Set<string>): Record<string, unknown> {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
        if (keys.has(key)) safe[key] = value;
    }
    return safe;
}

export class McpProcessTraceLogger {
    private readonly isVerbose: () => boolean;
    private readonly sink: TraceSink;

    constructor(config: McpProcessTraceLoggerConfig = {}) {
        this.isVerbose = config.isVerbose || isVerboseLogging;
        this.sink = config.sink || { log: console.log, warn: console.warn };
    }

    success(event: string, payload: Record<string, unknown>): void {
        if (!this.isVerbose()) return;
        this.sink.log(redactForLog(['[MCP]', event, pickSafe(payload, SAFE_DETAIL_KEYS)]));
    }

    failure(event: string, payload: Record<string, unknown>): void {
        this.sink.warn(redactForLog(['[MCP]', event, pickSafe(payload, SAFE_FAILURE_KEYS)]));
    }
}
