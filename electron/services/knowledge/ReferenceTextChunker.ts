const DEFAULT_TARGET_CHARS = 900;
const DEFAULT_OVERLAP_CHARS = 120;
const MIN_BOUNDARY_RATIO = 0.6;

export interface ReferenceTextChunkOptions {
    targetChars?: number;
    overlapChars?: number;
}

export function chunkReferenceText(
    content: string,
    options: ReferenceTextChunkOptions = {},
): string[] {
    const text = String(content || '')
        .replace(/[\t\f\v ]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!text) return [];

    const targetChars = Math.max(100, Math.floor(options.targetChars ?? DEFAULT_TARGET_CHARS));
    const overlapChars = Math.max(0, Math.min(
        targetChars - 1,
        Math.floor(options.overlapChars ?? DEFAULT_OVERLAP_CHARS),
    ));
    if (text.length <= targetChars) return [text];

    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        const hardEnd = Math.min(text.length, start + targetChars);
        let end = hardEnd;
        if (hardEnd < text.length) {
            const window = text.slice(start, hardEnd);
            const minimumBoundary = Math.floor(targetChars * MIN_BOUNDARY_RATIO);
            for (let index = window.length - 1; index >= minimumBoundary; index--) {
                if ('\n。！？.!?；;'.includes(window[index])) {
                    end = start + index + 1;
                    break;
                }
            }
        }

        const chunk = text.slice(start, end).trim();
        if (chunk) chunks.push(chunk);
        if (end >= text.length) break;
        start = Math.max(start + 1, end - overlapChars);
    }
    return chunks;
}
