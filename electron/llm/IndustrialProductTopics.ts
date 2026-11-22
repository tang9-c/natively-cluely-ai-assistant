// Product-line vocabulary for the industrial software we sell and support:
// Creo, CATIA, SolidWorks (CAD), Abaqus (CAE), CST (EM simulation),
// Windchill (PLM) and Feigenbaum QMS. A term alone is not a card moment; it
// must sit next to a question or pain word, or be a pain phrase by itself.

const PRODUCT_TERMS_ZH = [
    'Creo', 'CATIA', 'SolidWorks', 'Abaqus', '(?<![A-Za-z])CST(?![A-Za-z])', 'Windchill',
    '参数化', '大装配', '装配体', '工程图', '出图', '改型设计', '曲面', '钣金', '模具', '非标设备', '主机厂数据',
    '有限元', '网格', '接触分析', '接触设置', '非线性', '大变形', '材料模型', '动力学', '显式', '隐式',
    '电磁仿真', '天线', '射频', 'EMC', 'S ?参数', '高速互连', '信号完整性',
    '图文档', '工程变更', '来料检验', '制程质量', '客诉', '供应商质量', '质量体系',
].join('|');

const ASK_OR_PAIN_ZH = [
    '怎么', '如何', '能不能', '能否', '可不可以', '支持', '有没有', '慢', '卡顿', '卡死', '很卡', '崩溃', '报错',
    '不收敛', '收敛不了', '精度', '对比', '区别', '效率', '耗时', '对不上', '问题', '痛点',
].join('|');

const PAIN_PHRASES_ZH = [
    '不收敛', '收敛困难', '网格划分(?:怎么|如何|很慢|太慢)', '大装配(?:很|太|比较)?(?:慢|卡)', '出图(?:很|太)?慢',
    '仿真.{0,8}(?:试验|实验|测试).{0,8}(?:对不上|偏差大|不一致)', 'EMC 整改', '信号完整性问题',
].join('|');

const PRODUCT_TERMS_EN = 'Creo|CATIA|SolidWorks|Abaqus|CST|Windchill|large assembl(?:y|ies)|sheet metal|meshing|mesh|nonlinear|convergence|antennas?|EMC|S-parameters?|signal integrity';
const ASK_OR_PAIN_EN = 'how|support|slow|crash(?:es)?|errors?|converge|accuracy|compare|vs|difference|performance';

export const PRODUCT_TOPIC_PATTERNS: RegExp[] = [
    new RegExp(`(?:${PRODUCT_TERMS_ZH}).{0,30}(?:${ASK_OR_PAIN_ZH})|(?:${ASK_OR_PAIN_ZH}).{0,30}(?:${PRODUCT_TERMS_ZH})`, 'i'),
    new RegExp(PAIN_PHRASES_ZH, 'i'),
    new RegExp(`\\b(?:${PRODUCT_TERMS_EN})\\b.{0,60}\\b(?:${ASK_OR_PAIN_EN})\\b|\\b(?:${ASK_OR_PAIN_EN})\\b.{0,60}\\b(?:${PRODUCT_TERMS_EN})\\b|\\bfails? to converge\\b|\\bconvergence (?:issue|problem)s?\\b`, 'i'),
];

export function mentionsProductTopic(text: string): boolean {
    return PRODUCT_TOPIC_PATTERNS.some((pattern) => pattern.test(text));
}
