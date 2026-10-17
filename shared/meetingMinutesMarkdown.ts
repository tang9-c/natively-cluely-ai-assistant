import { marked, type Token } from 'marked';

export interface MinutesBlock {
  kind: 'title' | 'heading' | 'paragraph' | 'bullet';
  text: string;
}
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
export const titleKey = (title: string) => title.trim().replace(/^(?:\d+[.)、]\s*|[一二三四五六七八九十]+[、.]\s*)/, '').replace(/[：:]$/, '').toLowerCase();
const PRIVATE_TITLE = /^(?:辅导(?:建议|评价|洞察)?|改进空间|回答质量|表现出色之处|待学习领域|问题与回答|私人(?:问答|分析)|私密|跟进草稿|完整转录|coaching(?: insights| advice| evaluation)?|private (?:q\s*&\s*a|questions?|analysis)|follow[ -]?up draft|(?:full )?transcript|ai 使用记录)$/i;
export const isPrivateTitle = (title: string) => PRIVATE_TITLE.test(titleKey(title)
  .replace(/\s*[（(](?:仅自己可见|仅本人可见|仅供自己查看|仅供本人查看|仅供自己|仅供本人|private|only me)[）)]$/, '').trim());
const ACTION_TITLES = new Set(['行动项', '下一步', '后续行动', 'action items', 'next steps']);
export const FACT_TITLES = new Map([
  ...['摘要', '概览', '概要', '概述', '会议概要', '会议概述', 'summary', 'overview', 'meeting overview'].map(title => [title, 'overview'] as const),
  ...['要点', '关键要点', 'key points'].map(title => [title, 'keyPoints'] as const),
  ...['已做决策', '决策', '决策项', '结论', '会议结论', 'decisions'].map(title => [title, 'decisions'] as const),
]);
const decodeEntities = (text: string) => text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  if (!code.startsWith('#')) return named[code.toLowerCase()] || entity;
  const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
  return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
});
function inlineText(tokens: Token[] = []): string {
  return tokens.map(token => {
    if (token.type === 'html' || token.type === 'image') return '';
    if (token.type === 'br') return '\n';
    if ('tokens' in token && token.tokens) return inlineText(token.tokens);
    return 'text' in token ? decodeEntities(token.text) : '';
  }).join('');
}

/** Parse formatting only. Explicit private sections are filtered; ordinary prose is not classified. */
export function markdownBlocks(markdown: string, legacyActions?: string[]): MinutesBlock[] {
  type Section = 'facts' | 'private' | 'actions';
  const sectionFor = (title: string): Section | undefined => isPrivateTitle(title) ? 'private'
    : ACTION_TITLES.has(titleKey(title)) ? 'actions' : FACT_TITLES.has(titleKey(title)) ? 'facts' : undefined;
  const visit = (tokens: Token[] = [], section: Section = 'facts', bullet = false, withinHeading = false): MinutesBlock[] => {
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
