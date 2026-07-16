import fs from 'fs';
import path from 'path';
import { sanitizeSttQualityDiagnostic, type SttQualityDiagnostic } from '../audio/SttQualityDiagnostics';

export interface SttQualityAcceptanceContext {
    enabled: boolean;
    userDataDir?: string;
    diagnosticsPath?: string;
    reason?: string;
}

export interface SttQualityAcceptanceInput {
    userDataDir?: string;
    diagnosticsPath?: string;
}

function realpathIfExists(target: string): string | null {
    try {
        return fs.realpathSync(target);
    } catch {
        return null;
    }
}

function isUnder(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveSttQualityAcceptanceContext(input: SttQualityAcceptanceInput = {
    userDataDir: process.env.NATIVELY_STT_QUALITY_USER_DATA_DIR,
    diagnosticsPath: process.env.NATIVELY_STT_QUALITY_DIAGNOSTICS_PATH,
}): SttQualityAcceptanceContext {
    if (!input.userDataDir || !input.diagnosticsPath) {
        return { enabled: false, reason: 'not_configured' };
    }
    const requestedUserData = path.resolve(input.userDataDir);
    if (!isUnder('/private/tmp', requestedUserData)) {
        return { enabled: false, reason: 'user_data_not_private_tmp' };
    }
    const markerPath = path.join(requestedUserData, '.cueup-stt-quality-isolated');
    if (!fs.existsSync(markerPath)) {
        return { enabled: false, reason: 'missing_isolation_marker' };
    }
    const canonicalUserData = realpathIfExists(requestedUserData);
    if (!canonicalUserData || !isUnder('/private/tmp', canonicalUserData)) {
        return { enabled: false, reason: 'user_data_realpath_invalid' };
    }
    const diagnosticsDir = path.join(canonicalUserData, 'quality-diagnostics');
    const requestedDiagnostics = path.resolve(input.diagnosticsPath);
    const diagnosticsParent = path.dirname(requestedDiagnostics);
    fs.mkdirSync(diagnosticsParent, { recursive: true });
    const canonicalDiagnosticsParent = realpathIfExists(diagnosticsParent);
    if (!canonicalDiagnosticsParent || !isUnder(diagnosticsDir, canonicalDiagnosticsParent)) {
        return { enabled: false, reason: 'diagnostics_path_escaped' };
    }
    return {
        enabled: true,
        userDataDir: canonicalUserData,
        diagnosticsPath: path.join(canonicalDiagnosticsParent, path.basename(requestedDiagnostics)),
    };
}

export class SttQualityDiagnosticsCollector {
    private readonly context: SttQualityAcceptanceContext;

    constructor(context: SttQualityAcceptanceContext = resolveSttQualityAcceptanceContext()) {
        this.context = context;
    }

    get enabled(): boolean {
        return this.context.enabled === true && !!this.context.diagnosticsPath;
    }

    write(value: unknown): boolean {
        if (!this.enabled || !this.context.diagnosticsPath) return false;
        const diagnostic = sanitizeSttQualityDiagnostic(value) as SttQualityDiagnostic | null;
        if (!diagnostic) return false;
        fs.mkdirSync(path.dirname(this.context.diagnosticsPath), { recursive: true });
        fs.appendFileSync(this.context.diagnosticsPath, `${JSON.stringify(diagnostic)}\n`);
        return true;
    }
}
