import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    detailedSummary?: {
        actionItems: string[];
        keyPoints: string[];
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
}

const PAGE_WIDTH_PX = 794;
const PAGE_HEIGHT_PX = 1123;
const PAGE_PADDING_PX = 56;
const PDF_WIDTH_MM = 210;
const PDF_HEIGHT_MM = 297;

const EXPORT_FONT_STACK = [
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    '"PingFang SC"',
    '"Hiragino Sans GB"',
    '"Microsoft YaHei"',
    '"Noto Sans CJK SC"',
    '"Noto Sans SC"',
    'Arial',
    'sans-serif',
].join(', ');

const splitLongText = (text: string): string[] => {
    const chunks: string[] = [];
    const maxLength = 700;
    let remaining = text;

    while (remaining.length > maxLength) {
        const window = remaining.slice(0, maxLength);
        const breakAt = Math.max(
            window.lastIndexOf('\n'),
            window.lastIndexOf('。'),
            window.lastIndexOf('！'),
            window.lastIndexOf('？'),
            window.lastIndexOf('. '),
            window.lastIndexOf('? '),
            window.lastIndexOf('! '),
            window.lastIndexOf(' '),
        );
        const splitAt = breakAt > 200 ? breakAt + 1 : maxLength;
        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
    }

    if (remaining) {
        chunks.push(remaining);
    }

    return chunks;
};

const addTextBlock = (
    blocks: HTMLElement[],
    text: string | undefined,
    className: string,
) => {
    const normalized = (text ?? '').trim();
    if (!normalized) return;

    splitLongText(normalized).forEach(chunk => {
        const element = document.createElement('div');
        element.className = className;
        element.textContent = chunk;
        blocks.push(element);
    });
};

const addSectionTitle = (blocks: HTMLElement[], title: string) => {
    addTextBlock(blocks, title, 'section-title');
};

const formatTimestamp = (timestamp: number): string => {
    if (!Number.isFinite(timestamp)) return '';

    return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

const buildBlocks = (meeting: Meeting): HTMLElement[] => {
    const blocks: HTMLElement[] = [];

    addTextBlock(blocks, meeting.title, 'title');
    addTextBlock(blocks, `${meeting.date} - ${meeting.duration}`, 'meta');

    if (meeting.summary) {
        addSectionTitle(blocks, 'Summary');
        addTextBlock(blocks, meeting.summary, 'paragraph');
    }

    if (meeting.detailedSummary?.actionItems?.length) {
        addSectionTitle(blocks, 'Action Items');
        meeting.detailedSummary.actionItems.forEach(item => {
            addTextBlock(blocks, `- ${item}`, 'list-item');
        });
    }

    if (meeting.detailedSummary?.keyPoints?.length) {
        addSectionTitle(blocks, 'Key Points');
        meeting.detailedSummary.keyPoints.forEach(point => {
            addTextBlock(blocks, `- ${point}`, 'list-item');
        });
    }

    if (meeting.transcript?.length) {
        addSectionTitle(blocks, 'Transcript');
        meeting.transcript.forEach(entry => {
            const timeStr = formatTimestamp(entry.timestamp);
            addTextBlock(blocks, `${entry.speaker}${timeStr ? ` [${timeStr}]` : ''}`, 'speaker');
            addTextBlock(blocks, entry.text, 'paragraph transcript-text');
        });
    }

    if (meeting.usage?.length) {
        addSectionTitle(blocks, 'AI Usage & Interactions');
        meeting.usage.forEach(item => {
            if (item.type === 'chat' && item.question && item.answer) {
                addTextBlock(blocks, `Q: ${item.question}`, 'speaker');
                addTextBlock(blocks, `A: ${item.answer}`, 'paragraph');
            } else if (item.type === 'assist' && item.answer) {
                addTextBlock(blocks, 'Assist:', 'speaker');
                addTextBlock(blocks, item.answer, 'paragraph');
            } else if (item.type === 'followup_questions' && item.items?.length) {
                addTextBlock(blocks, 'Follow-up Questions:', 'speaker');
                item.items.forEach(question => {
                    addTextBlock(blocks, `- ${question}`, 'list-item');
                });
            }
        });
    }

    return blocks;
};

const createPage = () => {
    const page = document.createElement('div');
    page.className = 'natively-pdf-page';
    return page;
};

const createRenderRoot = () => {
    const root = document.createElement('div');
    root.style.position = 'fixed';
    root.style.left = '-10000px';
    root.style.top = '0';
    root.style.width = `${PAGE_WIDTH_PX}px`;
    root.style.background = '#ffffff';
    root.style.color = '#111827';
    root.style.fontFamily = EXPORT_FONT_STACK;
    root.style.zIndex = '-1';

    const style = document.createElement('style');
    style.textContent = `
        .natively-pdf-page {
            box-sizing: border-box;
            width: ${PAGE_WIDTH_PX}px;
            min-height: ${PAGE_HEIGHT_PX}px;
            padding: ${PAGE_PADDING_PX}px;
            background: #ffffff;
            color: #111827;
            font-family: ${EXPORT_FONT_STACK};
            line-height: 1.55;
            overflow: hidden;
            word-break: break-word;
            overflow-wrap: anywhere;
        }
        .natively-pdf-page .title {
            margin: 0 0 10px;
            color: #111827;
            font-size: 26px;
            font-weight: 700;
            line-height: 1.25;
        }
        .natively-pdf-page .meta {
            margin: 0 0 26px;
            color: #6b7280;
            font-size: 13px;
            line-height: 1.35;
        }
        .natively-pdf-page .section-title {
            margin: 22px 0 8px;
            color: #111827;
            font-size: 18px;
            font-weight: 700;
            line-height: 1.35;
        }
        .natively-pdf-page .paragraph,
        .natively-pdf-page .list-item {
            margin: 0 0 10px;
            color: #374151;
            font-size: 13px;
            line-height: 1.65;
            white-space: pre-wrap;
        }
        .natively-pdf-page .speaker {
            margin: 12px 0 4px;
            color: #374151;
            font-size: 13px;
            font-weight: 700;
            line-height: 1.4;
        }
        .natively-pdf-page .transcript-text {
            color: #4b5563;
        }
    `;

    root.appendChild(style);
    document.body.appendChild(root);
    return root;
};

const paginateBlocks = (root: HTMLElement, blocks: HTMLElement[]) => {
    const pages: HTMLElement[] = [];
    let page = createPage();
    root.appendChild(page);
    pages.push(page);

    blocks.forEach(block => {
        page.appendChild(block);

        if (page.scrollHeight > PAGE_HEIGHT_PX && page.childElementCount > 1) {
            page.removeChild(block);
            page = createPage();
            root.appendChild(page);
            pages.push(page);
            page.appendChild(block);
        }
    });

    return pages;
};

const safePdfFilename = (title: string): string => {
    const normalized = title
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 80);

    return `${normalized || 'meeting'}.pdf`;
};

export const generateMeetingPDF = async (meeting: Meeting): Promise<void> => {
    const root = createRenderRoot();

    try {
        const pages = paginateBlocks(root, buildBlocks(meeting));
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        for (let index = 0; index < pages.length; index += 1) {
            const canvas = await html2canvas(pages[index], {
                backgroundColor: '#ffffff',
                logging: false,
                scale: 2,
                useCORS: true,
                windowWidth: PAGE_WIDTH_PX,
                windowHeight: PAGE_HEIGHT_PX,
            });

            if (index > 0) {
                doc.addPage();
            }

            doc.addImage(
                canvas.toDataURL('image/png'),
                'PNG',
                0,
                0,
                PDF_WIDTH_MM,
                PDF_HEIGHT_MM,
                undefined,
                'FAST',
            );
        }

        doc.save(safePdfFilename(meeting.title));
    } finally {
        root.remove();
    }
};
