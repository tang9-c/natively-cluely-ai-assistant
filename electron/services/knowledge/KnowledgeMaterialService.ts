import * as crypto from 'crypto';
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
}

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md', '.markdown']);
const CHILD_TARGET_CHARS = 900;
const PARENT_WINDOW = 1;

export class KnowledgeMaterialService {
    private readonly materialRagRetriever: MaterialRagRetriever;

    constructor(
        private readonly db: DatabaseManager,
        private readonly embeddingPipeline?: EmbeddingPipeline | null,
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
                materials.push(await this.uploadFile(filePath));
            } catch (error: any) {
                errors.push({ filePath, error: error?.message || 'unknown_error' });
            }
        }
        return { materials, errors };
    }

    async uploadFile(filePath: string): Promise<any> {
        const ext = path.extname(filePath).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) {
            throw new Error(`Unsupported file type "${ext}". Supported formats: PDF, DOCX, TXT, MD.`);
        }

        const fileName = path.basename(filePath);
        const rawText = await DocumentTextExtractor.extract(filePath);
        const fileHash = crypto.createHash('sha256').update(rawText).digest('hex');
        const materialId = `mat_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        this.db.upsertKnowledgeMaterial({
            id: materialId,
            fileName,
            title: fileName,
            mimeOrExt: ext,
            fileHash,
            status: 'queued',
        });

        await this.indexMaterial(materialId, rawText);
        return this.db.getKnowledgeMaterial(materialId);
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
        this.db.deleteKnowledgeMaterial(materialId);
    }

    async search(query: string, options: { limit?: number } = {}): Promise<KnowledgeMaterialSearchResult[]> {
        const limit = options.limit ?? 6;
        const rows = this.db.getKnowledgeMaterialChunks({ withEmbeddingsOnly: false });
        if (rows.length === 0) return [];

        const sources: MaterialRagSource[] = rows.map((row: any) => ({
            id: `${row.material_id}:${row.id}`,
            title: row.title || row.file_name || 'Uploaded material',
            text: row.cleaned_text,
            parentText: row.parent_text || row.cleaned_text,
            scope: 'global',
            sourceType: 'uploaded_material',
            sourcePriority: 1,
            chunkId: row.id,
            embedding: row.embedding ? blobToVector(row.embedding) : undefined,
        }));
        const result = await this.materialRagRetriever.retrieve({
            query,
            sources,
            filters: { scopes: ['global'] },
            topK: limit,
            format: 'none',
        });

        return result.chunks.map((chunk) => ({
                sourceType: 'uploaded_material' as const,
                sourceId: String(chunk.sourceId).split(':')[0],
                chunkId: Number(chunk.chunkId ?? chunk.chunkIndex),
                score: chunk.score,
                title: chunk.title,
                text: chunk.text,
                parentText: chunk.parentText,
            }));
    }

    getHealth(): { materialCount: number; queue: { pending: number; processing: number; completed: number; failed: number } } {
        return {
            materialCount: this.db.listKnowledgeMaterials().filter((material) => material.status === 'complete').length,
            queue: this.db.getMaterialQueueStatus(),
        };
    }

    private async indexMaterial(materialId: string, text: string): Promise<void> {
        this.db.updateKnowledgeMaterialStatus(materialId, 'indexing');
        try {
            const chunks = buildParentChildChunks(materialId, text);
            const chunkIds = this.db.replaceKnowledgeMaterialChunks(materialId, chunks);
            if (this.embeddingPipeline?.isReady() && chunkIds.length > 0) {
                const embeddings = await this.embeddingPipeline.getEmbeddings(chunks.map((chunk) => chunk.cleanedText));
                embeddings.forEach((embedding, index) => {
                    this.db.setKnowledgeMaterialChunkEmbedding(chunkIds[index], embedding);
                });
            }
            const status: MaterialStatus = 'complete';
            this.db.updateKnowledgeMaterialStatus(materialId, status);
        } catch (error: any) {
            this.db.updateKnowledgeMaterialStatus(materialId, 'failed', {
                code: 'index_failed',
                message: error?.message || 'Could not index material.',
            });
            throw error;
        }
    }
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
