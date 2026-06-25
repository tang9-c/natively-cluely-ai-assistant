import * as crypto from 'crypto';
import * as path from 'path';
import { DatabaseManager, type KnowledgeMaterialChunkInput } from '../../db/DatabaseManager';
import { EmbeddingPipeline } from '../../rag/EmbeddingPipeline';
import { keywordCoverage } from '../../rag/RagLexical';
import { DocumentTextExtractor } from '../profile/DocumentTextExtractor';

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
    constructor(
        private readonly db: DatabaseManager,
        private readonly embeddingPipeline?: EmbeddingPipeline | null,
    ) {}

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

        let queryEmbedding: number[] | null = null;
        if (this.embeddingPipeline?.isReady()) {
            try {
                queryEmbedding = await this.embeddingPipeline.getEmbeddingForQuery(query);
            } catch {
                queryEmbedding = null;
            }
        }

        const scored = rows.map((row: any) => {
            const lexical = keywordCoverage(query, row.cleaned_text);
            const vector = queryEmbedding && row.embedding
                ? cosine(queryEmbedding, blobToVector(row.embedding))
                : 0;
            const score = (0.4 * lexical) + (0.6 * vector);
            return { row, score };
        });

        return scored
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(({ row, score }) => ({
                sourceType: 'uploaded_material' as const,
                sourceId: row.material_id,
                chunkId: row.id,
                score: Number(score.toFixed(4)),
                title: row.title || row.file_name || 'Uploaded material',
                text: row.cleaned_text,
                parentText: row.parent_text || row.cleaned_text,
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

function blobToVector(blob: Buffer): number[] {
    const vector: number[] = [];
    for (let offset = 0; offset + 4 <= blob.byteLength; offset += 4) {
        vector.push(blob.readFloatLE(offset));
    }
    return vector;
}

function cosine(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}
