import { marked, type Token } from 'marked';
import type { Meeting } from '../../shared/meetingEdits';
import { normalizeMeetingActionItems } from '../../shared/meetingActionItems';

export interface MinutesBlock {
  kind: 'title' | 'heading' | 'paragraph' | 'bullet';
  text: string;
}
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const titleKey = (title: string) => title.trim().replace(/^(?:\d+[.)、]\s*|[一二三四五六七八九十]+[、.]\s*)/, '').replace(/[：:]$/, '').toLowerCase();
const PRIVATE_TITLE = /^(?:辅导(?:建议|评价|洞察)?|改进空间|回答质量|表现出色之处|待学习领域|问题与回答|私人(?:问答|分析)|私密|跟进草稿|完整转录|coaching(?: insights| advice| evaluation)?|private (?:q\s*&\s*a|questions?|analysis)|follow[ -]?up draft|(?:full )?transcript|ai 使用记录)$/i;
const isPrivateTitle = (title: string) => PRIVATE_TITLE.test(titleKey(title)
  .replace(/\s*[（(](?:仅自己可见|仅本人可见|仅供自己查看|仅供本人查看|仅供自己|仅供本人|private|only me)[）)]$/, '').trim());
const ACTION_TITLES = new Set(['行动项', '下一步', '后续行动', 'action items', 'next steps']);
const FACT_TITLES = new Map([
  ...['摘要', '概览', '概要', '概述', '会议概要', '会议概述', 'summary', 'overview', 'meeting overview'].map(title => [title, 'overview'] as const),
  ...['要点', '关键要点', 'key points'].map(title => [title, 'keyPoints'] as const),
  ...['已做决策', '决策', '决策项', '结论', '会议结论', 'decisions'].map(title => [title, 'decisions'] as const),
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
function markdownBlocks(markdown: string, legacyActions?: string[]): MinutesBlock[] {
  type Section = 'facts' | 'private' | 'actions';
  const sectionFor = (title: string): Section | undefined => isPrivateTitle(title) ? 'private'
    : ACTION_TITLES.has(titleKey(title)) ? 'actions' : FACT_TITLES.has(titleKey(title)) ? 'facts' : undefined;
  const visit = (tokens: Token[], section: Section = 'facts', bullet = false, withinHeading = false): MinutesBlock[] => {
    if (section === 'private' || (section === 'actions' && !legacyActions)) return [];
    const result: MinutesBlock[] = [];
    let labelSection: Section = section;
    const append = (text: string) => {
      if (labelSection === 'private') return;
      for (const line of clean(text).split(/\n+/).filter(Boolean)) {
        if (labelSection === 'actions') legacyActions?.push(line);
        else result.push({ kind: bullet ? 'bullet' : 'paragraph', text: line });
      }
    };
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.type === 'heading') {
        let end = index + 1;
        while (end < tokens.length && !(tokens[end].type === 'heading' && (tokens[end] as { depth: number }).depth <= token.depth)) end++;
        const title = inlineText(token.tokens);
        // Real heading boundaries own their entire subtree, including bold labels.
        const inherited = withinHeading && labelSection !== 'facts' ? labelSection : section;
        const named = sectionFor(title);
        const kind = inherited === 'private' || named === 'private' ? 'private' : inherited === 'actions' ? 'actions' : named || inherited;
        const children = visit(tokens.slice(index + 1, end), kind, bullet, true);
        if (children.length && kind === 'facts' && !FACT_TITLES.has(titleKey(title))) result.push({ kind: 'heading', text: title });
        result.push(...children); index = end - 1;
      } else if (token.type === 'paragraph' && !bullet) {
        // Old bold-only templates are interpreted inside their real container, never promoted to headings.
        let lines: string[] = [];
        const flush = () => { append(inlineText(marked.Lexer.lexInline(lines.join('\n')))); lines = []; };
        for (const line of token.raw.trimEnd().split('\n')) {
          const label = /^(?:\*\*([^\n]+)\*\*|__([^\n]+)__)\s*[：:]?\s*$/.exec(line);
          const next = label && sectionFor(label[1] || label[2]);
          if (next) { flush(); labelSection = section === 'actions' && next === 'facts' ? 'actions' : next; }
          else lines.push(line);
        }
        flush();
      } else if (labelSection === 'private') continue;
      else if (token.type === 'list') {
        for (const item of token.items) result.push(...visit(item.tokens, labelSection, true, withinHeading));
      } else if (token.type === 'blockquote') result.push(...visit(token.tokens, labelSection, bullet, withinHeading));
      else if (token.type === 'text' || token.type === 'code' || token.type === 'paragraph') {
        append('tokens' in token && token.tokens ? inlineText(token.tokens) : decodeEntities(token.text));
      } else if (token.type === 'table') {
        for (const row of [token.header, ...token.rows]) append(row.map((cell: { tokens: Token[] }) => inlineText(cell.tokens)).join(' | '));
      }
    }
    return result;
  };
  return visit(marked.lexer(markdown));
}

export function buildMeetingMinutes(meeting: Meeting): { blocks: MinutesBlock[]; text: string; html: string } {
  const rawSummary = meeting.detailedSummary || { actionItems: [], keyPoints: [] };
  const legacy = typeof meeting.detailedSummary?.overview === 'string' || meeting.editState?.editedSummaryFields.includes('overview') ? '' : clean(meeting.summary);
  const overview = clean(rawSummary.overview) || (PLACEHOLDER.test(legacy) ? '' : legacy);
  const legacyActions = (rawSummary.schemaVersion || 0) < 3 ? [] as string[] : undefined;
  const overviewBlocks = markdownBlocks(overview, legacyActions);
  const summary = normalizeMeetingActionItems(legacyActions?.length
    ? { ...rawSummary, actionItems: [...(rawSummary.actionItems || []), ...legacyActions] } : rawSummary);
  const content: MinutesBlock[] = [];
  const seen = new Set<string>();
  const unique = (blocks: MinutesBlock[]) => blocks.filter(block => {
    const key = block.text.trim().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const addSection = (title: string, blocks: MinutesBlock[]) => {
    const deduplicated = unique(blocks);
    const values = deduplicated.filter((block, index) => block.kind !== 'heading' || (deduplicated[index + 1] && deduplicated[index + 1].kind !== 'heading'));
    if (values.length) content.push({ kind: 'heading', text: title }, ...values);
  };
  const sections = (summary.sections || []).filter(section => FACT_TITLES.has(titleKey(section.title)) && !isPrivateTitle(section.title));
  const sectionBlocks = (category: string) => sections.filter(section => FACT_TITLES.get(titleKey(section.title)) === category)
    .flatMap(section => section.bullets.flatMap(value => markdownBlocks(value).map(block => ({ ...block, kind: 'bullet' as const }))));
  addSection('会议概述', [...overviewBlocks, ...sectionBlocks('overview')]);
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
