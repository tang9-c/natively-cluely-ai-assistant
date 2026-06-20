/**
 * Shared mode template metadata used by both the settings panel and the main
 * interface. Keep this file dependency-free so it can be imported from any
 * renderer module without pulling in Electron-specific code.
 */

export const MODE_TEMPLATE_LABELS: Record<string, string> = {
  general: '通用',
  sales: '销售',
  recruiting: '招聘',
  'team-meet': '团队会议',
  'looking-for-work': '求职',
  'technical-interview': '技术面试',
  lecture: '讲座',
};

/**
 * Default mode names that match the data seeded by ModesManager. When a mode
 * still has its default name, the UI shows the localized template label instead.
 */
export const DEFAULT_MODE_NAMES: Record<string, string> = {
  general: '通用',
  sales: '销售',
  recruiting: '招聘',
  'team-meet': '团队会议',
  'looking-for-work': '求职',
  'technical-interview': '技术面试',
  lecture: '讲座',
};

export const getModeDisplayName = (mode: {
  name: string;
  templateType: string;
}): string => {
  const templateLabel = MODE_TEMPLATE_LABELS[mode.templateType];
  const defaultName = DEFAULT_MODE_NAMES[mode.templateType];
  if (templateLabel && mode.name === defaultName) return templateLabel;
  return mode.name;
};
