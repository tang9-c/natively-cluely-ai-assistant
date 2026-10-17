import type { Meeting } from '../../shared/meetingEdits';
import { normalizeMeetingActionItems } from '../../shared/meetingActionItems';
import { markdownBlocks, FACT_TITLES, titleKey, isPrivateTitle, type MinutesBlock } from '../../shared/meetingMinutesMarkdown';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const PLACEHOLDER = /^(?:see detailed summary|generating summary\.{3}|generating summary…|processing\.{3}|processing…)$/i;
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function buildMeetingMinutes(meeting: Meeting): { blocks: MinutesBlock[]; text: string; html: string } {
  const rawSummary = meeting.detailedSummary || { actionItems: [], keyPoints: [] };
  const legacy = typeof meeting.detailedSummary?.overview === 'string' || meeting.editState?.editedSummaryFields.includes('overview') ? '' : clean(meeting.summary);
  const overview = clean(rawSummary.overview) || (PLACEHOLDER.test(legacy) ? '' : legacy);
  const overviewBlocks = markdownBlocks(overview);
  const summary = normalizeMeetingActionItems(rawSummary, false, overview);
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
