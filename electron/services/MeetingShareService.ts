import { marked, type Token } from 'marked';
import type { Meeting } from '../../shared/meetingEdits';
import { normalizeMeetingActionItems } from '../../shared/meetingActionItems';

export interface MinutesBlock {
  kind: 'title' | 'heading' | 'paragraph' | 'bullet';
  text: string;
}
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const titleKey = (title: string) => title.trim().replace(/[：:]$/, '').toLowerCase();
const PRIVATE_TITLE = /辅导|私人问答|私密|跟进草稿|完整转录|coaching|private (?:q\s*&\s*a|questions?|analysis)|follow[ -]?up draft|(?:full )?transcript|AI 使用记录/i;
const ACTION_TITLES = new Set(['行动项', '下一步', '后续行动', 'action items', 'next steps']);
const FACT_TITLES = new Map([
  ...['概要', '概述', '会议概要', '会议概述', 'summary', 'overview', 'meeting overview'].map(title => [title, 'overview'] as const),
  ...['要点', '关键要点', 'key points'].map(title => [title, 'keyPoints'] as const),
  ...['决策', '决策项', '结论', '会议结论', 'decisions'].map(title => [title, 'decisions'] as const),
]);
const PLACEHOLDER = /^(?:see detailed summary|generating summary\.{3}|generating summary…|processing\.{3}|processing…)$/i;
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const decodeEntities = (text: string) => text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  if (!code.startsWith('#')) return named[code.toLowerCase()] || entity;
  const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
  return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
});
function inlineText(tokens: Token[]): string {
  return tokens.map(token => {
    if (token.type === 'html' || token.type === 'image') return '';
    if (token.type === 'br') return '\n';
    if ('tokens' in token && token.tokens) return inlineText(token.tokens);
    return 'text' in token ? decodeEntities(token.text) : '';
  }).join('');
}

/** Parse formatting only. Explicit private sections are filtered; ordinary prose is not classified. */
function markdownBlocks(markdown: string): MinutesBlock[] {
  const result: MinutesBlock[] = [];
  let skipDepth: number | undefined;
  const visit = (tokens: Token[], bullet = false) => {
    for (const token of tokens) {
      const pseudoHeading = token.type === 'paragraph' && /^\s*(?:\*\*[^\n]+\*\*|__[^\n]+__)\s*[：:]?\s*$/.test(token.raw);
      if (token.type === 'heading' || pseudoHeading) {
        const depth = token.type === 'heading' ? token.depth : 2;
        if (skipDepth !== undefined && depth > skipDepth) continue;
        skipDepth = undefined;
        const title = inlineText('tokens' in token ? token.tokens || [] : []);
        if (PRIVATE_TITLE.test(title) || ACTION_TITLES.has(titleKey(title))) skipDepth = depth;
        continue;
      }
      if (skipDepth !== undefined) continue;
      if (token.type === 'list') {
        for (const item of token.items) visit(item.tokens, true);
      } else if (token.type === 'blockquote') visit(token.tokens, bullet);
      else if (token.type === 'paragraph' || token.type === 'text' || token.type === 'code') {
        const text = clean('tokens' in token && token.tokens ? inlineText(token.tokens) : decodeEntities(token.text));
        for (const line of text.split(/\n+/).filter(Boolean)) result.push({ kind: bullet ? 'bullet' : 'paragraph', text: line });
      } else if (token.type === 'table') {
        for (const row of [token.header, ...token.rows]) {
          const text = row.map(cell => inlineText(cell.tokens)).join(' | ');
          if (text.trim()) result.push({ kind: 'paragraph', text });
        }
      }
    }
  };
  // Legacy templates use standalone bold labels instead of Markdown headings.
  const labeled = markdown.replace(/^(?:\*\*([^\n]+)\*\*|__([^\n]+)__)\s*[：:]?\s*$/gm, (_line, stars: string, underscores: string) => `## ${stars || underscores}`);
  visit(marked.lexer(labeled));
  return result;
}

export function buildMeetingMinutes(meeting: Meeting): { blocks: MinutesBlock[]; text: string; html: string } {
  const summary = normalizeMeetingActionItems(meeting.detailedSummary || { actionItems: [], keyPoints: [] });
  const content: MinutesBlock[] = [];
  const seen = new Set<string>();
  const unique = (blocks: MinutesBlock[]) => blocks.filter(block => {
    const key = block.text.trim().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const addSection = (title: string, blocks: MinutesBlock[]) => {
    const values = unique(blocks);
    if (values.length) content.push({ kind: 'heading', text: title }, ...values);
  };
  const sections = (summary.sections || []).filter(section => FACT_TITLES.has(titleKey(section.title)) && !PRIVATE_TITLE.test(section.title));
  const sectionBlocks = (category: string) => sections.filter(section => FACT_TITLES.get(titleKey(section.title)) === category)
    .flatMap(section => section.bullets.flatMap(value => markdownBlocks(value).map(block => ({ ...block, kind: 'bullet' as const }))));
  const legacy = typeof meeting.detailedSummary?.overview === 'string' || meeting.editState?.editedSummaryFields.includes('overview') ? '' : clean(meeting.summary);
  const overview = clean(summary.overview) || (PLACEHOLDER.test(legacy) ? '' : legacy);
  addSection('会议概述', [...markdownBlocks(overview), ...sectionBlocks('overview')]);
  addSection('关键要点', [...(summary.keyPoints || []).flatMap(value => markdownBlocks(value).map(block => ({ ...block, kind: 'bullet' as const }))), ...sectionBlocks('keyPoints')]);
  addSection('决策项', [...(summary.decisions || []).flatMap(value => markdownBlocks(value).map(block => ({ ...block, kind: 'bullet' as const }))), ...sectionBlocks('decisions')]);
  const actions: MinutesBlock[] = [];
  for (const item of summary.actionItemsStructured) {
    // Keep canonical user rows (even identical text with different owners) intact.
    const text = markdownBlocks(item.text).map(block => block.text).join(' ');
    if (!text) continue;
    actions.push({ kind: 'bullet', text });
    if (clean(item.owner)) actions.push({ kind: 'paragraph', text: `负责人：${clean(item.owner)}` });
    if (clean(item.deadline)) actions.push({ kind: 'paragraph', text: `截止日期：${clean(item.deadline)}` });
  }
  if (actions.length) content.push({ kind: 'heading', text: '行动项' }, ...actions);
  if (!content.length) throw new Error('summary_not_ready');
  const parsedDate = new Date(meeting.date);
  const date = Number.isNaN(parsedDate.getTime()) ? clean(meeting.date) : parsedDate.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const blocks: MinutesBlock[] = [{ kind: 'title', text: clean(meeting.title) || '会议纪要' }, { kind: 'paragraph', text: `日期：${date}` }, ...content];
  let listOpen = false;
  let html = '';
  for (const block of blocks) {
    if (block.kind === 'bullet' && !listOpen) { html += '<ul>'; listOpen = true; }
    if (block.kind !== 'bullet' && listOpen) { html += '</ul>'; listOpen = false; }
    const tag = block.kind === 'title' ? 'h1' : block.kind === 'heading' ? 'h2' : block.kind === 'bullet' ? 'li' : 'p';
    html += `<${tag}>${escapeHtml(block.text)}</${tag}>`;
  }
  if (listOpen) html += '</ul>';
  return { blocks, text: blocks.map(block => `${block.kind === 'bullet' ? '• ' : ''}${block.text}`).join('\n'), html };
}
