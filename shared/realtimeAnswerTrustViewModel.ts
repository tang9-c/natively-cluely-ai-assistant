export type TrustSeverity = 'ok' | 'info' | 'warning' | 'error';

export type CitationStatus = 'candidate' | 'ok' | 'stale-citation' | 'missing-citation' | 'unsupported-citation' | 'none';

export interface AnswerSourceStatusLike {
    ragReady?: boolean;
    ragAttempted?: boolean;
    embeddingReady?: boolean;
    uploadedMaterialHitCount?: number;
    citationCount?: number;
    screenContextStatus?: 'available' | 'failed' | 'blocked' | 'not_used' | string;
    transcriptStatus?: 'used' | 'not_used' | string;
}

export interface AnswerContextUsedLike {
    currentTranscript?: boolean;
    shortTermHistory?: boolean;
    uploadedDocumentRag?: boolean;
    historicalMeetings?: boolean;
    longTermMemory?: boolean;
    enterpriseKnowledge?: boolean;
    businessSystemContext?: boolean;
    screenContext?: boolean;
}

export interface AnswerCitationLike {
    citationId?: string;
    sourceId?: string;
    sourceType?: string;
    title?: string | null;
}

export interface AnswerTraceLike {
    contextUsed?: AnswerContextUsedLike;
    sourceStatus?: AnswerSourceStatusLike;
    citations?: AnswerCitationLike[];
    degradedReason?: string | null;
    degraded_reason?: string | null;
}

export interface LatestAnswerTrustInput {
    trace?: AnswerTraceLike | null;
    sourceStatusFallback?: AnswerSourceStatusLike | null;
    citations?: AnswerCitationLike[];
    citationStatus?: CitationStatus;
    citationPreviewMessage?: string | null;
    degradedReason?: string | null;
    forbiddenFixture?: Record<string, string>;
}

export interface LatestAnswerTrustExplanation {
    usedUploadedMaterial: boolean;
    materialHitCount: number;
    citationCount: number;
    primaryMessages: string[];
    sourceLabels: string[];
    degradedMessages: string[];
    reasonCodes: string[];
    citationStatus: CitationStatus;
    hasCitationCandidate: boolean;
}

export interface MaterialStatusInput {
    id: string;
    title?: string | null;
    file_name?: string | null;
    fileName?: string | null;
    status: 'queued' | 'indexing' | 'complete' | 'failed' | 'deleted' | string;
    errorCode?: string | null;
    error_code?: string | null;
    errorMessage?: string | null;
    error_message?: string | null;
}

export interface MaterialStatusExplanation {
    label: string;
    message: string;
    severity: TrustSeverity;
    canReindex: boolean;
    primaryActionLabel?: string;
}

export interface DynamicActionTrustInput {
    type: string;
    semanticGate?: {
        decision: 'pass' | 'reject' | 'defer' | 'fast_path';
        actionType: string;
        semanticIntent?: string;
        confidence: number;
        reasons: string[];
        regexCandidates: string[];
        rejectedCandidates: string[];
        usedLocalIntentModel: boolean;
        usedCloudArbitration: boolean;
        semanticProvider: 'local_intent' | 'cloud_llm' | 'rule_fast_path' | 'unavailable';
        arbitrationStatus: 'cloud_used' | 'local_only_by_privacy' | 'local_fallback_cloud_unavailable' | 'cloud_unavailable' | 'selected_model_unavailable' | 'selected_model_not_configured' | 'local_only_not_needed';
        degradedReason?: string;
        upgradedByRepeatedEvidence: boolean;
    };
}

export interface DynamicActionExplanation {
    message: string;
    traceComplete: boolean;
    severity: TrustSeverity;
}

export interface AnswerQualityMetricsLike {
    shownCount: number;
    copiedCount: number;
    acceptedCount: number;
    ignoredCount: number;
    regeneratedCount: number;
    averageLatencyMs: number | null;
    p95LatencyMs: number | null;
    citationHitRate: number;
    userAcceptanceRate: number;
    regenerationRate: number;
    ragHitRate: number;
    noContextAnswerRate: number;
}

export interface RealtimeDiagnosticsInput {
    metrics: AnswerQualityMetricsLike;
    sourceStatusCounts?: Record<string, number>;
    degradedReasons?: Record<string, number>;
    traceSampleSize?: number;
    eventSampleSize?: number;
}

export interface RealtimeDiagnosticsSummary {
    source: 'persisted';
    sampleSize: number;
    traceSampleSize: number;
    eventSampleSize: number;
    insufficientData: boolean;
    metrics: AnswerQualityMetricsLike;
    degradedReasons: Record<string, number>;
    sourceStatusCounts: Record<string, number>;
    messages: string[];
}

const LOW_SAMPLE_THRESHOLD = 5;

const TRUST_REASON_COPY: Record<string, string> = {
    no_relevant_uploaded_material: '没有匹配到相关上传资料。',
    uploaded_material_rag_failed: '资料检索失败，这条回答没有使用上传资料。',
    embedding_not_configured: '未配置语义检索。CueUp 会对上传资料使用关键词匹配。',
    embedding_unavailable: '未配置语义检索，CueUp 已使用关键词匹配。',
    embedding_failed: '资料文本可用，但语义索引失败。CueUp 仍可尝试关键词匹配。',
    hybrid_threw: '这次语义检索失败，CueUp 已使用关键词匹配。',
    screen_context_scope_blocked: '屏幕上下文因权限被阻止。',
    screen_context_failed: '屏幕上下文不可用。',
    provider_scope_denied: '当前隐私设置阻止了相关上下文发送给服务商。',
    trace_persistence_failed: '本次回答诊断未保存。',
};

const MATERIAL_FAILURE_COPY: Record<string, string> = {
    unsupported_file_type: '暂不支持此格式。请导出为 PDF 或 Markdown 后重新上传。',
    binary_text_file: '这个 TXT 文件像是二进制内容。请上传可读的 TXT、PDF、DOCX 或 Markdown 文件。',
    pdf_parser_component_missing: 'PDF 解析组件缺失，请更新或重新安装 CueUp 后重试。',
    pdf_parse_timeout: 'PDF 解析超时，请重试；如果仍失败，请拆分文件后重新上传。',
    pdf_worker_failed: 'PDF 解析进程异常，请重试上传。',
    pdf_access_failed: 'CueUp 无法继续读取该 PDF，请重新选择文件后上传。',
    pptx_render_timeout: 'PPTX 渲染超时，请重试；如果仍失败，请拆分文件后重新上传。',
    pptx_render_process_start_failed: 'PPTX 渲染进程无法启动，请重启 CueUp 后重试。',
    pptx_render_process_crashed: 'PPTX 渲染进程异常退出，请重试上传。',
    pptx_render_child_failed: 'PPTX 渲染失败，请重试上传。',
    pptx_render_failed: 'PPTX 渲染失败，请重试上传。',
    pptx_input_access_failed: 'CueUp 无法读取所选 PPTX，请重新选择文件后上传。',
    pptx_render_input_read_failed: 'PPTX 临时副本读取失败，请重试上传。',
    pptx_renderer_dependency_missing: 'PPTX 渲染组件缺失，请更新或重新安装 CueUp 后重试。',
    parse_failed: 'CueUp 无法读取这个文件。请重新导出或上传更干净的副本。',
    empty_document: '没有找到可读取文本。请上传包含可选中文本的文档。',
    embedding_failed: '资料文本已索引，但语义检索失败。CueUp 会尝试降级为关键词匹配。',
    index_interrupted: '上次资料索引因 CueUp 异常退出而中断，请重新上传该文件。',
};

export function mapTrustReasonToCopy(reason?: string | null): string | null {
    if (!reason) return null;
    return TRUST_REASON_COPY[reason] ?? null;
}

function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

export function buildLatestAnswerTrustExplanation(input: LatestAnswerTrustInput): LatestAnswerTrustExplanation {
    const trace = input.trace ?? {};
    const sourceStatus = trace.sourceStatus ?? input.sourceStatusFallback ?? {};
    const citations = input.citations ?? trace.citations ?? [];
    const citationStatus = input.citationStatus ?? (citations.length > 0 ? 'candidate' : 'none');
    const materialCitationCount = citations.filter((citation) => citation.sourceType === 'uploaded_material').length;
    const materialHitCount = Math.max(Number(sourceStatus.uploadedMaterialHitCount ?? 0), materialCitationCount);
    const reasonCodes = unique([
        input.degradedReason ?? '',
        trace.degradedReason ?? '',
        trace.degraded_reason ?? '',
        citationStatus === 'stale-citation' ? 'stale_citation' : '',
        citationStatus === 'missing-citation' ? 'missing_citation' : '',
        citationStatus === 'unsupported-citation' ? 'unsupported_citation' : '',
    ]);
    const primaryMessages: string[] = [];
    const sourceLabels: string[] = [];
    const degradedMessages: string[] = [];

    if (trace.contextUsed?.currentTranscript) sourceLabels.push('当前会议');
    if (trace.contextUsed?.shortTermHistory) sourceLabels.push('短期历史');
    if (trace.contextUsed?.businessSystemContext) sourceLabels.push('业务系统');
    if (trace.contextUsed?.screenContext) sourceLabels.push('屏幕');

    if (materialHitCount > 0) {
        sourceLabels.push('上传资料');
        const title = citations.find((citation) => citation.sourceType === 'uploaded_material')?.title;
        primaryMessages.push(title ? `已使用上传资料：${title}。` : `已使用上传资料：${materialHitCount} 条。`);
    } else if (sourceStatus.ragAttempted || reasonCodes.includes('no_relevant_uploaded_material')) {
        primaryMessages.push('没有匹配到相关上传资料。');
    }

    if (citationStatus === 'ok') primaryMessages.push('已确认引用可打开。');
    if (citationStatus === 'stale-citation') degradedMessages.push('引用片段已过期，请重新生成回答。');
    if (citationStatus === 'missing-citation') degradedMessages.push('引用片段暂时不可用。');
    if (citationStatus === 'unsupported-citation') degradedMessages.push('此引用类型暂不支持预览。');
    if (input.citationPreviewMessage && citationStatus !== 'ok') degradedMessages.push(input.citationPreviewMessage);

    for (const reason of reasonCodes) {
        const copy = mapTrustReasonToCopy(reason);
        if (copy) degradedMessages.push(copy);
    }
    if (sourceStatus.embeddingReady === false && !reasonCodes.includes('embedding_unavailable')) {
        degradedMessages.push(TRUST_REASON_COPY.embedding_unavailable);
        reasonCodes.push('embedding_unavailable');
    }

    return {
        usedUploadedMaterial: materialHitCount > 0,
        materialHitCount,
        citationCount: citations.length,
        primaryMessages: unique(primaryMessages),
        sourceLabels: unique(sourceLabels),
        degradedMessages: unique(degradedMessages),
        reasonCodes: unique(reasonCodes),
        citationStatus,
        hasCitationCandidate: citations.some((citation) => Boolean(citation.citationId)),
    };
}

export function explainMaterialStatus(material: MaterialStatusInput): MaterialStatusExplanation {
    const status = material.status;
    const code = material.errorCode ?? material.error_code ?? '';
    if (status === 'complete' && code === 'pptx_partial_pages') {
        return {
            label: '处理完成，但有缺页',
            message: material.errorMessage ?? material.error_message ?? '部分页面内容提取失败，其余页面已可用于回答。',
            severity: 'warning',
            canReindex: true,
            primaryActionLabel: '重新索引',
        };
    }
    if (status === 'complete') {
        return {
            label: '已完成',
            message: '资料已可用于回答。重新索引会基于已提取文本重建索引。',
            severity: 'ok',
            canReindex: true,
            primaryActionLabel: '重新索引',
        };
    }
    if (status === 'queued') {
        return { label: '排队中', message: '资料正在等待索引。', severity: 'info', canReindex: false };
    }
    if (status === 'indexing') {
        return { label: '索引中', message: '资料正在索引。', severity: 'info', canReindex: false };
    }
    if (status === 'deleted') {
        return { label: '已删除', message: '资料已删除，不会再用于回答。', severity: 'info', canReindex: false };
    }
    return {
        label: '索引失败',
        message: MATERIAL_FAILURE_COPY[code] ?? (material.errorMessage ?? material.error_message ?? '资料索引失败。请重新上传新文件。'),
        severity: code === 'embedding_failed' ? 'warning' : 'error',
        canReindex: false,
        primaryActionLabel: '重新上传新文件',
    };
}

export function explainDynamicAction(action: DynamicActionTrustInput): DynamicActionExplanation {
    const gate = action.semanticGate;
    if (!gate) {
        return { message: '基于会议信号触发。', traceComplete: false, severity: 'info' };
    }
    if (gate.decision === 'pass' || gate.decision === 'fast_path') {
        return { message: '已通过语义门控。', traceComplete: true, severity: 'ok' };
    }
    return { message: '基于会议信号触发。', traceComplete: false, severity: 'info' };
}

export function buildRealtimeDiagnosticsSummary(input: RealtimeDiagnosticsInput): RealtimeDiagnosticsSummary {
    const traceSampleSize = input.traceSampleSize ?? input.metrics.shownCount;
    const eventSampleSize = input.eventSampleSize ?? input.metrics.shownCount;
    const sampleSize = Math.max(traceSampleSize, eventSampleSize);
    const insufficientData = sampleSize < LOW_SAMPLE_THRESHOLD;
    return {
        source: 'persisted',
        sampleSize,
        traceSampleSize,
        eventSampleSize,
        insufficientData,
        metrics: { ...input.metrics },
        degradedReasons: { ...(input.degradedReasons ?? {}) },
        sourceStatusCounts: { ...(input.sourceStatusCounts ?? {}) },
        messages: insufficientData ? ['样本不足，暂不展示趋势判断。'] : [],
    };
}
