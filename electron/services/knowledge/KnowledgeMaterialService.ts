import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseManager, type KnowledgeMaterialChunkInput } from '../../db/DatabaseManager';
import { EmbeddingPipeline } from '../../rag/EmbeddingPipeline';
import { DocumentTextExtractor } from '../profile/DocumentTextExtractor';
import { MaterialRagRetriever, type MaterialRagSource } from './MaterialRagRetriever';

type MaterialStatus = 'queued' | 'indexing' | 'complete' | 'failed' | 'deleted';

export interface KnowledgeMaterialSearchResult {
    sourceType: 'uploaded_material';
    sourceId: string;
    chunkId: number;
    score: number;
    title: string;
    text: string;
    parentText: string;
    fileHash?: string;
    materialUpdatedAt?: string;
}

export interface KnowledgeMaterialSearchResponse {
    hits: KnowledgeMaterialSearchResult[];
    degradedReason?: 'embedding_unavailable' | 'hybrid_threw';
}

interface KnowledgeMaterialSearchOptions {
    limit?: number;
    candidateLimit?: number;
}

interface PptxQCloudAvailability {
    hasNativelyApiKey: boolean;
    activeProvider: string;
    available: boolean;
}

interface KnowledgeMaterialServiceOptions {
    getQCloudAvailability?: () => Promise<PptxQCloudAvailability>;
    createPptxIngestionService?: (
        indexPreparedChunks: (materialId: string, chunks: KnowledgeMaterialChunkInput[]) => Promise<void>,
    ) => {
        ingest(materialId: string, filePath: string): Promise<void>;
    };
}

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md', '.markdown', '.pptx']);
const CHILD_TARGET_CHARS = 900;
const PARENT_WINDOW = 1;

export class KnowledgeMaterialService {
    private readonly materialRagRetriever: MaterialRagRetriever;
    private static indexQueue: Promise<void> = Promise.resolve();
    private static cancelledMaterialIds = new Set<string>();

    constructor(
        private readonly db: DatabaseManager,
        private readonly embeddingPipeline?: EmbeddingPipeline | null,
        private readonly options: KnowledgeMaterialServiceOptions = {},
    ) {
        this.materialRagRetriever = new MaterialRagRetriever(embeddingPipeline);
    }

    listMaterials(): any[] {
        return this.db.listKnowledgeMaterials();
    }

    async uploadFiles(filePaths: string[]): Promise<{ materials: any[]; errors: Array<{ filePath: string; error: string }> }> {
        const materials: any[] = [];
        const errors: Array<{ filePath: string; error: string }> = [];
        for (const filePath of filePaths) {
            try {
                await this.assertUploadAllowed(filePath);
                materials.push(await this.createMaterialRecord(filePath));
            } catch (error: any) {
                errors.push({ filePath, error: error?.message || 'unknown_error' });
            }
        }
        for (const material of materials) {
            const filePath = material.__filePath;
            delete material.__filePath;
            if (material.status === 'queued' && filePath) {
                this.enqueueIndexMaterialFromFile(material.id, filePath);
            }
        }
        return { materials, errors };
    }

    async uploadFile(filePath: string): Promise<any> {
        await this.assertUploadAllowed(filePath);
        const material = await this.createMaterialRecord(filePath);
        const indexableFilePath = material.__filePath;
        delete material.__filePath;
        if (material.status === 'queued' && indexableFilePath) {
            this.enqueueIndexMaterialFromFile(material.id, indexableFilePath);
        }
        return material;
    }

    async createMaterialRecord(filePath: string): Promise<any> {
        const ext = path.extname(filePath).toLowerCase();
        const fileName = path.basename(filePath);
        const materialId = `mat_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        let fileHash = `pending_${crypto.randomBytes(8).toString('hex')}`;
        try {
            const stat = fs.statSync(filePath);
            fileHash = crypto
                .createHash('sha256')
                .update(`${fileName}:${stat.size}:${stat.mtimeMs}`)
                .digest('hex');
        } catch {
            // Keep a pending hash so the failed material record can still be listed.
        }

        if (!SUPPORTED_EXTENSIONS.has(ext)) {
            this.db.upsertKnowledgeMaterial({
                id: materialId,
                fileName,
                title: fileName,
                mimeOrExt: ext || 'unknown',
                fileHash,
                status: 'failed',
                errorCode: 'unsupported_file_type',
                errorMessage: '不支持的文件类型。当前支持 PDF、DOCX、Markdown 和 TXT。',
            });
            return this.db.getKnowledgeMaterial(materialId);
        }

        this.db.upsertKnowledgeMaterial({
            id: materialId,
            fileName,
            title: fileName,
            mimeOrExt: ext,
            fileHash,
            status: 'queued',
        });
        KnowledgeMaterialService.cancelledMaterialIds.delete(materialId);

        return {
            ...(this.db.getKnowledgeMaterial(materialId) ?? {}),
            __filePath: filePath,
        };
    }

    async reindexMaterial(materialId: string): Promise<any> {
        const material = this.db.getKnowledgeMaterial(materialId);
        if (!material) throw new Error('material_not_found');
        // The first implementation keeps extracted text only in chunks, so reindex
        // reconstructs from parent/child chunk text. Upload again for a pristine parse.
        const chunks = this.db.getKnowledgeMaterialChunks({ withEmbeddingsOnly: false })
            .filter((chunk: any) => chunk.material_id === materialId);
        const text = chunks.map((chunk: any) => chunk.cleaned_text).join('\n\n').trim();
        if (!text) throw new Error('material_has_no_indexable_text');
        await this.indexMaterial(materialId, text);
        return this.db.getKnowledgeMaterial(materialId);
    }

    deleteMaterial(materialId: string): void {
        KnowledgeMaterialService.cancelledMaterialIds.add(materialId);
        this.db.deleteKnowledgeMaterial(materialId);
    }

    async search(query: string, options: KnowledgeMaterialSearchOptions = {}): Promise<KnowledgeMaterialSearchResult[]> {
        return (await this.searchWithDiagnostics(query, options)).hits;
    }

    async searchWithDiagnostics(query: string, options: KnowledgeMaterialSearchOptions = {}): Promise<KnowledgeMaterialSearchResponse> {
        const limit = options.limit ?? 6;
        const candidateLimit = options.candidateLimit ?? 200;
        const candidateReader = (this.db as any).getKnowledgeMaterialCandidateChunks;
        const rows = typeof candidateReader === 'function'
            ? candidateReader.call(this.db, query, { ...options, limit, candidateLimit, withEmbeddingsOnly: false })
            : this.db.getKnowledgeMaterialChunks({ withEmbeddingsOnly: false }).slice(0, candidateLimit);
        if (rows.length === 0) return { hits: [] };

        const sources: MaterialRagSource[] = rows.map((row: any) => ({
            id: `${row.material_id}:${row.id}`,
            title: row.title || row.file_name || 'Uploaded material',
            text: row.cleaned_text,
            parentText: row.parent_text || row.cleaned_text,
            scope: 'global',
            sourceType: 'uploaded_material',
            sourcePriority: 1,
            chunkId: row.id,
            fileHash: row.file_hash,
            materialUpdatedAt: row.material_updated_at,
            embedding: row.embedding ? blobToVector(row.embedding) : undefined,
        }));
        const result = await this.materialRagRetriever.retrieve({
            query,
            sources,
            filters: { scopes: ['global'] },
            topK: limit,
            format: 'none',
        });

        return {
            hits: result.chunks.map((chunk) => ({
                sourceType: 'uploaded_material' as const,
                sourceId: String(chunk.sourceId).split(':')[0],
                chunkId: Number(chunk.chunkId ?? chunk.chunkIndex),
                score: chunk.score,
                title: chunk.title,
                text: chunk.text,
                parentText: chunk.parentText,
                fileHash: chunk.fileHash,
                materialUpdatedAt: chunk.materialUpdatedAt,
            })),
            degradedReason: result.degradedReason,
        };
    }

    getHealth(): { materialCount: number; queue: { pending: number; processing: number; completed: number; failed: number } } {
        return {
            materialCount: this.db.listKnowledgeMaterials().filter((material) => material.status === 'complete').length,
            queue: this.db.getMaterialQueueStatus(),
        };
    }

    private async indexMaterial(materialId: string, text: string): Promise<void> {
        await this.indexPreparedChunks(materialId, buildParentChildChunks(materialId, text));
    }

    private async indexPreparedChunks(materialId: string, chunks: KnowledgeMaterialChunkInput[]): Promise<void> {
        if (!this.isMaterialIndexable(materialId)) return;
        this.db.updateKnowledgeMaterialStatus(materialId, 'indexing');
        try {
            if (chunks.length === 0) {
                throw createMaterialIndexError('empty_document', '文档没有可索引的文本。');
            }
            if (!this.isMaterialIndexable(materialId)) return;
            const chunkIds = this.db.replaceKnowledgeMaterialChunks(materialId, chunks);
            if (this.embeddingPipeline?.isReady() && chunkIds.length > 0) {
                try {
                    const embeddings = await this.embeddingPipeline.getEmbeddings(chunks.map((chunk) => chunk.cleanedText));
                    if (!this.isMaterialIndexable(materialId)) return;
                    embeddings.forEach((embedding, index) => {
                        this.db.setKnowledgeMaterialChunkEmbedding(chunkIds[index], embedding);
                    });
                } catch (embeddingError: any) {
                    this.db.markKnowledgeMaterialEmbeddingsFailed?.(materialId, embeddingError?.message || 'embedding_failed');
                    // Keep the text index usable. MaterialRagRetriever will report
                    // embedding_unavailable and fall back to lexical retrieval.
                }
            }
            const status: MaterialStatus = 'complete';
            if (!this.isMaterialIndexable(materialId)) return;
            this.db.updateKnowledgeMaterialStatus(materialId, status);
        } catch (error: any) {
            if (!this.isMaterialIndexable(materialId)) return;
            const classifiedCode = classifyMaterialIndexError(error);
            error.code = error?.code || (classifiedCode === 'parse_failed' ? 'index_failed' : classifiedCode);
            this.db.updateKnowledgeMaterialStatus(materialId, 'failed', {
                code: error.code,
                message: toUserFacingMaterialError(error),
            });
            throw error;
        }
    }

    private async indexMaterialFromFile(materialId: string, filePath: string): Promise<void> {
        try {
            if (!this.isMaterialIndexable(materialId)) return;
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.pptx') {
                const service = this.options.createPptxIngestionService
                    ? this.options.createPptxIngestionService((id, chunks) => this.indexPreparedChunks(id, chunks))
                    : this.createDefaultPptxIngestionService();
                await service.ingest(materialId, filePath);
                return;
            }
            const rawText = await DocumentTextExtractor.extract(filePath);
            if (!this.isMaterialIndexable(materialId)) return;
            await this.indexMaterial(materialId, rawText);
        } catch (error: any) {
            if (!this.isMaterialIndexable(materialId)) return;
            this.db.updateKnowledgeMaterialStatus(materialId, 'failed', {
                code: classifyMaterialIndexError(error),
                message: toUserFacingMaterialError(error),
            });
        }
    }

    private async assertUploadAllowed(filePath: string): Promise<void> {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.ppt') {
            throw new Error('暂不支持旧版 .ppt，请另存为 .pptx 后上传。');
        }
        if (ext === '.pptm') {
            throw new Error('暂不支持含宏 PPT，请另存为 .pptx 后上传。');
        }
        if (ext !== '.pptx') return;
        const availability = await this.checkPptxQCloudAvailability();
        if (!availability.hasNativelyApiKey || availability.activeProvider !== 'natively' || !availability.available) {
            throw new Error('PPTX 知识源需要先配置并选择 QCLOUD API。');
        }
    }

    private async checkPptxQCloudAvailability(): Promise<PptxQCloudAvailability> {
        if (this.options.getQCloudAvailability) return this.options.getQCloudAvailability();
        const { CredentialsManager } = require('../CredentialsManager');
        const cm = CredentialsManager.getInstance();
        const activeProvider = cm.getDefaultModel?.() || '';
        const hasNativelyApiKey = Boolean(cm.getNativelyApiKey?.());
        return {
            hasNativelyApiKey,
            activeProvider,
            available: hasNativelyApiKey && activeProvider === 'natively',
        };
    }

    private createDefaultPptxIngestionService(): { ingest(materialId: string, filePath: string): Promise<void> } {
        const { LLMHelper } = require('../../LLMHelper');
        const { PptxIngestionService } = require('./pptx/PptxIngestionService');
        const { PptxSlideRenderer } = require('./pptx/PptxSlideRenderer');
        const { PptxVisionDescriptor } = require('./pptx/PptxVisionDescriptor');
        const llmHelper = new LLMHelper();
        llmHelper.setModel('natively');
        return new PptxIngestionService(
            new PptxSlideRenderer(),
            new PptxVisionDescriptor(llmHelper),
            (id: string, chunks: KnowledgeMaterialChunkInput[]) => this.indexPreparedChunks(id, chunks),
        );
    }

    private enqueueIndexMaterialFromFile(materialId: string, filePath: string): void {
        KnowledgeMaterialService.indexQueue = KnowledgeMaterialService.indexQueue
            .catch((): void => undefined)
            .then(() => this.indexMaterialFromFile(materialId, filePath));
    }

    private isMaterialIndexable(materialId: string): boolean {
        if (KnowledgeMaterialService.cancelledMaterialIds.has(materialId)) return false;
        return Boolean(this.db.getKnowledgeMaterial(materialId));
    }
}

function classifyMaterialIndexError(error: any): string {
    if (error?.code) return error.code;
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('pptx_too_many_slides')) return 'pptx_too_many_slides';
    if (message.includes('pptx_invalid_file')) return 'pptx_invalid_file';
    if (message.includes('pptx_render_failed')) return 'pptx_render_failed';
    if (message.includes('pptx_markdown_empty')) return 'pptx_markdown_empty';
    if (message.includes('pptx_enhance_')) return 'pptx_enhance_invalid_json';
    if (message.includes('unsupported file type')) return 'unsupported_file_type';
    if (message.includes('empty')) return 'empty_document';
    if (message.includes('binary')) return 'binary_text_file';
    if (message.includes('embedding')) return 'embedding_failed';
    return 'parse_failed';
}

function toUserFacingMaterialError(error: any): string {
    const code = classifyMaterialIndexError(error);
    if (code === 'unsupported_file_type') return '不支持的文件类型。当前支持 PDF、DOCX、PPTX、Markdown 和 TXT。';
    if (code === 'empty_document') return '文档没有可索引的文本。';
    if (code === 'binary_text_file') return 'TXT 文件看起来是二进制内容，无法作为文本资料索引。';
    if (code === 'embedding_failed') return '资料文本已读取，但向量索引失败。';
    if (code === 'pptx_too_many_slides') return 'PPTX 页数超过 200，请拆分后上传。';
    if (code === 'pptx_invalid_file') return 'PPTX 文件已损坏或不是有效的 PowerPoint 文件。';
    if (code === 'pptx_render_failed') return 'PPTX 内容提取失败，请另存为标准 .pptx 后重试。';
    if (code === 'pptx_markdown_empty' || code === 'pptx_enhance_invalid_json' || code === 'pptx_enhance_invalid_questions') {
        return 'PPTX 内容提取失败，请稍后重试。';
    }
    if (code === 'parse_failed') return '文档解析失败，请确认文件未损坏。';
    return error?.message || '资料索引失败。';
}

function createMaterialIndexError(code: string, message: string): Error & { code?: string } {
    const error = new Error(message) as Error & { code?: string };
    error.code = code;
    return error;
}

function blobToVector(blob: Buffer): number[] {
    const vector: number[] = [];
    for (let offset = 0; offset + 4 <= blob.byteLength; offset += 4) {
        vector.push(blob.readFloatLE(offset));
    }
    return vector;
}

function buildParentChildChunks(materialId: string, text: string): KnowledgeMaterialChunkInput[] {
    const paragraphs = text
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    const childTexts: string[] = [];
    let current = '';
    for (const paragraph of paragraphs.length ? paragraphs : [text]) {
        if ((current + '\n' + paragraph).length > CHILD_TARGET_CHARS && current.trim()) {
            childTexts.push(current.trim());
            current = paragraph;
        } else {
            current = current ? `${current}\n${paragraph}` : paragraph;
        }
    }
    if (current.trim()) childTexts.push(current.trim());

    return childTexts.map((child, index) => {
        const parentParts = childTexts.slice(Math.max(0, index - PARENT_WINDOW), index + PARENT_WINDOW + 1);
        return {
            materialId,
            chunkIndex: index,
            parentChunkIndex: index,
            cleanedText: child,
            parentText: parentParts.join('\n\n'),
            tokenCount: Math.max(1, Math.ceil(child.length / 4)),
            metadata: { parentWindow: PARENT_WINDOW },
        };
    });
}
