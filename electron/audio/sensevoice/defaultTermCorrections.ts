import { sanitizeSenseVoiceTerms } from './termCorrection';
import type { SenseVoiceTermEntry } from './types';

export const DEFAULT_SENSEVOICE_TERM_CORRECTIONS: SenseVoiceTermEntry[] = sanitizeSenseVoiceTerms([
  {
    id: 'industrial-mes-supplier',
    canonical: 'MES供应商',
    variants: ['麦供应商', '卖供应商'],
    enabled: true,
  },
  {
    id: 'industrial-mes-system',
    canonical: 'MES系统',
    variants: ['麦系统', 'M S系统', 'M E S系统'],
    enabled: true,
  },
  {
    id: 'industrial-mes',
    canonical: 'MES',
    variants: ['M E S'],
    enabled: true,
  },
  {
    id: 'industrial-plm',
    canonical: 'PLM',
    variants: ['皮诶勒姆', '批艾勒姆', '屁艾勒姆', '听阿勒姆', 'TA乐姆', 'P L M'],
    enabled: true,
  },
  {
    id: 'industrial-product-lifecycle-management',
    canonical: '产品生命周期管理',
    variants: ['产品声明周期管理'],
    enabled: true,
  },
  {
    id: 'industrial-qms',
    canonical: 'QMS',
    variants: ['Q M S', '扣艾姆艾斯'],
    enabled: true,
  },
  {
    id: 'industrial-quality-management-system',
    canonical: '质量管理系统',
    variants: ['质量管你系统'],
    enabled: true,
  },
  {
    id: 'industrial-erp',
    canonical: 'ERP',
    variants: ['E R P', '一二P', '一二批', '伊阿皮'],
    enabled: true,
  },
  {
    id: 'industrial-enterprise-resource-planning',
    canonical: '企业资源计划',
    variants: ['企业资源规划'],
    enabled: true,
  },
  {
    id: 'industrial-alm',
    canonical: 'ALM',
    variants: ['A L M'],
    enabled: true,
  },
  {
    id: 'industrial-application-lifecycle-management',
    canonical: '应用生命周期管理',
    variants: ['应用生命管理', '应用声明周期管理'],
    enabled: true,
  },
  {
    id: 'industrial-cad',
    canonical: 'CAD',
    variants: ['C A D', '卡的', '凯德'],
    enabled: true,
  },
  {
    id: 'industrial-cae',
    canonical: 'CAE',
    variants: ['C A E', 'C A 一'],
    enabled: true,
  },
  {
    id: 'industrial-cam',
    canonical: 'CAM',
    variants: ['C A M', '看姆'],
    enabled: true,
  },
  {
    id: 'industrial-creo',
    canonical: 'Creo',
    variants: ['克里奥', '克瑞欧', '可瑞欧'],
    enabled: true,
  },
  {
    id: 'industrial-ptc-creo',
    canonical: 'PTC Creo',
    variants: ['PTC克瑞欧', 'PTC可瑞欧', 'PTCCreo'],
    enabled: true,
  },
  {
    id: 'industrial-windchill',
    canonical: 'Windchill',
    variants: ['温彻', '温切尔', '温秋', '温球', '温桥', 'Wind Chill', 'Winchill', 'Win Chill'],
    enabled: true,
  },
  {
    id: 'industrial-ptc-windchill',
    canonical: 'PTC Windchill',
    variants: ['PTC温切尔', 'PTC温秋', 'PTC温球'],
    enabled: true,
  },
  {
    id: 'industrial-feigenbaum-qms',
    canonical: 'Feigenbaum QMS',
    variants: ['FeigenbaumQMS', '费根鲍姆QMS', '飞根鲍姆QMS', '费根宝姆QMS', '费根包姆QMS'],
    enabled: true,
  },
  {
    id: 'industrial-bom',
    canonical: 'BOM',
    variants: ['B O M', '包姆', '爆木', '波姆'],
    enabled: true,
  },
  {
    id: 'industrial-bill-of-materials',
    canonical: '物料清单',
    variants: ['物料亲单'],
    enabled: true,
  },
  {
    id: 'industrial-eco',
    canonical: 'ECO',
    variants: ['E C O', '一西欧'],
    enabled: true,
  },
  {
    id: 'industrial-engineering-change-order',
    canonical: '工程变更单',
    variants: ['工程变改单'],
    enabled: true,
  },
  {
    id: 'industrial-ecr',
    canonical: 'ECR',
    variants: ['E C R'],
    enabled: true,
  },
  {
    id: 'industrial-engineering-change-request',
    canonical: '工程变更请求',
    variants: ['工程变更需求'],
    enabled: true,
  },
  {
    id: 'industrial-apqp',
    canonical: 'APQP',
    variants: ['A P Q P', 'AP QP', 'A P Q 批'],
    enabled: true,
  },
  {
    id: 'industrial-ppap',
    canonical: 'PPAP',
    variants: ['P P A P', '批批AP', 'PP APP'],
    enabled: true,
  },
  {
    id: 'industrial-spc',
    canonical: 'SPC',
    variants: ['S P C', 'SP See'],
    enabled: true,
  },
  {
    id: 'industrial-fmea',
    canonical: 'FMEA',
    variants: ['F M E A', 'F M E 呀', 'F M E A分析'],
    enabled: true,
  },
  {
    id: 'industrial-mbd',
    canonical: 'MBD',
    variants: ['M B D', 'MBD模型'],
    enabled: true,
  },
  {
    id: 'industrial-cfd',
    canonical: 'CFD',
    variants: ['C F D', 'CFD防真'],
    enabled: true,
  },
  {
    id: 'industrial-fluid-simulation',
    canonical: '流体仿真',
    variants: ['流体防真', '流体方针'],
    enabled: true,
  },
  {
    id: 'industrial-fluid-dynamics-simulation',
    canonical: '流体力学仿真',
    variants: ['流体力学防真'],
    enabled: true,
  },
  {
    id: 'industrial-mechanical-simulation',
    canonical: '力学仿真',
    variants: ['力学防真'],
    enabled: true,
  },
  {
    id: 'industrial-structural-mechanical-simulation',
    canonical: '结构力学仿真',
    variants: ['结构力学防真'],
    enabled: true,
  },
  {
    id: 'industrial-structural-simulation',
    canonical: '结构仿真',
    variants: ['结构防真'],
    enabled: true,
  },
  {
    id: 'industrial-thermal-simulation',
    canonical: '热仿真',
    variants: ['热防真'],
    enabled: true,
  },
  {
    id: 'industrial-ai-agent',
    canonical: 'AI智能体',
    variants: ['A I智能体', 'AI Agent', 'AI代理'],
    enabled: true,
  },
  {
    id: 'industrial-agent',
    canonical: '智能体',
    variants: ['智能替', '智能提'],
    enabled: true,
  },
  {
    id: 'industrial-knowledge-base',
    canonical: '知识库',
    variants: ['知识哭', '知识酷'],
    enabled: true,
  },
  {
    id: 'industrial-workflow',
    canonical: '工作流',
    variants: ['工作留', 'Work Flow', 'workflow'],
    enabled: true,
  },
  {
    id: 'industrial-drawing',
    canonical: '图纸',
    variants: ['图子', '图质'],
    enabled: true,
  },
  {
    id: 'industrial-engineering-drawing',
    canonical: '工程图纸',
    variants: ['工程图子'],
    enabled: true,
  },
  {
    id: 'industrial-2d-drawing',
    canonical: '二维图',
    variants: ['二维图子', '二位图'],
    enabled: true,
  },
  {
    id: 'industrial-3d-drawing',
    canonical: '三维图',
    variants: ['三维图子', '三位图'],
    enabled: true,
  },
  {
    id: 'industrial-traceability',
    canonical: '追溯',
    variants: ['追朔', '追诉'],
    enabled: true,
  },
  {
    id: 'industrial-automation',
    canonical: '自动化',
    variants: ['自动画', '自动话'],
    enabled: true,
  },
]);

export function mergeSenseVoiceTermCorrections(userTerms: unknown): SenseVoiceTermEntry[] {
  const mergedByCanonical = new Map<string, SenseVoiceTermEntry>();

  for (const term of DEFAULT_SENSEVOICE_TERM_CORRECTIONS) {
    mergedByCanonical.set(term.canonical.toLowerCase(), term);
  }

  for (const term of sanitizeSenseVoiceTerms(userTerms)) {
    mergedByCanonical.set(term.canonical.toLowerCase(), term);
  }

  return [...mergedByCanonical.values()];
}
