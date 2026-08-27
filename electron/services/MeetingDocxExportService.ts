import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  PageBreak,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import type { Meeting } from '../db/DatabaseManager';
import { resolveEffectiveSpeaker } from '../../shared/speakerIdentity';

export interface MeetingDocxExportOptions {
  includeTranscript: boolean;
}

export function resolveDocxFont(platform: NodeJS.Platform | string): string {
  if (platform === 'darwin') return 'Arial Unicode MS';
  if (platform === 'win32') return 'Microsoft YaHei';
  return 'Noto Sans CJK SC';
}

const SUMMARY_PLACEHOLDERS = new Set([
  'see detailed summary',
  'generating summary...',
  'generating summary…',
  'processing...',
  'processing…',
]);

const LEGACY_ENGLISH_FOLLOW_UP_PATTERN = /\b(?:Hi,|Hi team,|Thanks for the conversation today\.|Next steps:|Decisions:|Blockers:|Best,|I will follow up if anything else is needed\.)\b/i;
const LEGACY_ENGLISH_COACHING_PATTERN = /\b(?:Objection may need|conversation included|Next step was not explicit|Consider ending|captured|follow-up|needs follow-up|Confirm|Review these moments)\b/i;

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nonEmptyStrings(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map(cleanText).filter(Boolean)
    : [];
}

function effectiveLegacySummary(meeting: Meeting): string {
  const summary = cleanText(meeting.summary);
  return summary && !SUMMARY_PLACEHOLDERS.has(summary.toLowerCase()) ? summary : '';
}

export function hasExportableMeetingSummary(meeting: Meeting): boolean {
  const summary = meeting.detailedSummary;
  if (summary) {
    const hasDetailedContent = Boolean(
      cleanText(summary.overview)
      || nonEmptyStrings(summary.keyPoints).length
      || nonEmptyStrings(summary.decisions).length
      || nonEmptyStrings(summary.actionItems).length
      || (summary.actionItemsStructured || []).some(item => cleanText(item?.text))
      || nonEmptyStrings(summary.openQuestions).length
      || (summary.sections || []).some(section => nonEmptyStrings(section?.bullets).length)
      || cleanText(summary.followUpDraft)
      || (summary.coachingInsights || []).some(insight => cleanText(insight?.title) || cleanText(insight?.detail))
    );
    if (hasDetailedContent) return true;
  }
  return Boolean(effectiveLegacySummary(meeting));
}

function formatElapsedTime(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) return '';
  const totalSeconds = Math.floor(timestampMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function heading(text: string, level: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2): Paragraph {
  return new Paragraph({
    text,
    heading: level,
    keepNext: true,
  });
}

function bodyParagraph(text: string, options: { italic?: boolean; indent?: number } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, italics: options.italic })],
    indent: options.indent ? { left: options.indent } : undefined,
  });
}

function bulletParagraph(text: string): Paragraph {
  return new Paragraph({
    text,
    numbering: { reference: 'meeting-summary-bullets', level: 0 },
  });
}

function addList(children: Paragraph[], title: string, items: unknown): void {
  const values = nonEmptyStrings(items);
  if (!values.length) return;
  children.push(heading(title, HeadingLevel.HEADING_1));
  values.forEach(item => children.push(bulletParagraph(item)));
}

function formatMeetingDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return cleanText(date);
  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildDocumentChildren(meeting: Meeting, options: MeetingDocxExportOptions): Paragraph[] {
  if (!hasExportableMeetingSummary(meeting)) {
    throw new Error('summary_not_ready');
  }

  const summary = meeting.detailedSummary;
  const children: Paragraph[] = [
    new Paragraph({
      text: cleanText(meeting.title) || '会议纪要',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
    }),
    bodyParagraph(`日期：${formatMeetingDate(meeting.date)}    时长：${cleanText(meeting.duration) || '未知'}`, { italic: true }),
  ];

  const overview = cleanText(summary?.overview) || effectiveLegacySummary(meeting);
  if (overview) {
    children.push(heading('会议概述', HeadingLevel.HEADING_1), bodyParagraph(overview));
  }

  addList(children, '关键要点', summary?.keyPoints);
  addList(children, '决策项', summary?.decisions);

  const structuredActions = (summary?.actionItemsStructured || [])
    .filter(item => cleanText(item?.text));
  if (structuredActions.length) {
    children.push(heading(summary?.actionItemsTitle || '行动项', HeadingLevel.HEADING_1));
    structuredActions.forEach(item => {
      children.push(bulletParagraph(cleanText(item.text)));
      if (cleanText(item.owner)) children.push(bodyParagraph(`负责人：${cleanText(item.owner)}`, { indent: 720 }));
      if (cleanText(item.deadline)) children.push(bodyParagraph(`截止日期：${cleanText(item.deadline)}`, { indent: 720 }));
      if (Number.isFinite(item.sourceTimestamp)) {
        children.push(bodyParagraph(`来源：${formatElapsedTime(item.sourceTimestamp as number)}`, { indent: 720 }));
      }
    });
  } else {
    addList(children, summary?.actionItemsTitle || '行动项', summary?.actionItems);
  }

  addList(children, '待确认事项', summary?.openQuestions);

  const sections = (summary?.sections || [])
    .map(section => ({ title: cleanText(section?.title), bullets: nonEmptyStrings(section?.bullets) }))
    .filter(section => section.title && section.bullets.length);
  if (sections.length) {
    children.push(heading('模式分区摘要', HeadingLevel.HEADING_1));
    sections.forEach(section => {
      children.push(heading(section.title, HeadingLevel.HEADING_2));
      section.bullets.forEach(item => children.push(bulletParagraph(item)));
    });
  }

  const followUpDraft = cleanText(summary?.followUpDraft);
  if (followUpDraft && !LEGACY_ENGLISH_FOLLOW_UP_PATTERN.test(followUpDraft)) {
    children.push(heading('跟进草稿', HeadingLevel.HEADING_1), bodyParagraph(followUpDraft));
  }

  const coachingInsights = (summary?.coachingInsights || []).filter(insight => {
    const text = `${cleanText(insight?.title)}\n${cleanText(insight?.detail)}`.trim();
    return text && !LEGACY_ENGLISH_COACHING_PATTERN.test(text);
  });
  if (coachingInsights.length) {
    children.push(heading('辅导建议', HeadingLevel.HEADING_1));
    coachingInsights.forEach(insight => {
      const title = cleanText(insight.title);
      const detail = cleanText(insight.detail);
      children.push(bulletParagraph(title && detail ? `${title}：${detail}` : title || detail));
      const evidence = cleanText(insight.evidence);
      if (evidence) children.push(bodyParagraph(`依据：${evidence}`, { indent: 720, italic: true }));
    });
  }

  const transcript = (meeting.transcript || []).filter(entry => {
    const speaker = cleanText(entry?.speaker).toLowerCase();
    return cleanText(entry?.text) && !['system', 'ai', 'assistant', 'model'].includes(speaker);
  });
  if (options.includeTranscript && transcript.length) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(heading('完整转录', HeadingLevel.HEADING_1));
    transcript.forEach(entry => {
      const speaker = resolveEffectiveSpeaker(entry) === 'user' ? '我' : '对方';
      const timestamp = formatElapsedTime(entry.timestamp);
      children.push(bodyParagraph(`${speaker}${timestamp ? ` [${timestamp}]` : ''}`, { italic: true }));
      children.push(bodyParagraph(cleanText(entry.text)));
    });
  }

  return children;
}

export async function buildMeetingDocxBuffer(
  meeting: Meeting,
  options: MeetingDocxExportOptions,
): Promise<Buffer> {
  const documentFont = resolveDocxFont(process.platform);
  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: documentFont, size: 22, color: '202124' },
          paragraph: { spacing: { after: 120, line: 300 } },
        },
      },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: documentFont, size: 36, bold: true, color: '111827' },
          paragraph: { spacing: { before: 0, after: 160 }, outlineLevel: 0 },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: documentFont, size: 28, bold: true, color: '1F4D78' },
          paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: documentFont, size: 24, bold: true, color: '374151' },
          paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 1 },
        },
      ],
    },
    numbering: {
      config: [{
        reference: 'meeting-summary-bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: { indent: { left: 720, hanging: 360 }, spacing: { after: 80, line: 300 } },
            run: { font: documentFont },
          },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },
      children: buildDocumentChildren(meeting, options),
    }],
  });

  return Buffer.from(await Packer.toBuffer(document));
}

export function safeDocxFilename(title: string, includeTranscript: boolean): string {
  let safeTitle = cleanText(title)
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 70);
  if (!safeTitle) safeTitle = 'meeting';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safeTitle)) safeTitle += '_';
  return `${safeTitle}-${includeTranscript ? '完整会议档案' : '会议纪要'}.docx`;
}
