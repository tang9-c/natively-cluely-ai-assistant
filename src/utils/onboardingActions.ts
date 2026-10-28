import type { OnboardingStateResult, ValidationOutcome, ValidationTarget } from '../../shared/onboarding';
export function onboardingErrorText(code?: string): string {
  const messages: Record<string, string> = {
    model_load_failed: '模型加载失败，请重试或重新下载。', model_missing: '模型尚未下载。',
    permission_denied: '权限未开启，请检查系统设置。', device_missing: '设备不可用，请重新选择。',
    authentication_failed: '鉴权失败，请检查密钥与服务权限。', model_unavailable: '模型不可用，请检查模型权限或额度。',
    scope_denied: '当前全局策略不允许 AI 使用转写文本，请修改策略或稍后继续。',
    unsupported_check: '引导暂不能验证此配置，请返回原设置或选择支持的服务。',
    busy: '会议、设备或模型正在使用中，请稍后重试。', timeout: '检查超时，请重试。',
    stale_config: '配置已变化，请重新检查。', network_error: '网络检查失败，请检查连接后重试。',
    storage_failed: '未能保存进度或配置，请重试。', cancelled: '检查已取消。',
  };
  return messages[code ?? ''] ?? '操作未完成，请重试。';
}
export async function saveAndValidateOnboarding(input: {
  target: ValidationTarget; save(): Promise<boolean>; clear(): void;
  refresh(): Promise<OnboardingStateResult>; validate(revision: number): Promise<ValidationOutcome>;
}): Promise<{ saved: boolean; success: boolean; errorCode?: string }> {
  let saved = false;
  try {
    if (!await input.save()) return { saved, success: false, errorCode: 'storage_failed' };
    saved = true; input.clear();
    const state = await input.refresh();
    if (!state.success) return { saved, success: false, errorCode: state.errorCode };
    const result = await input.validate(state.snapshot.progress.configRevision[input.target]);
    return result.success ? { saved, success: true } : { saved, success: false, errorCode: result.errorCode };
  } catch { return { saved, success: false, errorCode: saved ? 'network_error' : 'storage_failed' }; }
}
