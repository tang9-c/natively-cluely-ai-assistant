import type { OnboardingStateResult, ValidationOutcome, ValidationTarget } from '../../shared/onboarding';
export function onboardingErrorText(code?: string): string {
  const messages: Record<string, string> = {
    model_load_failed: '模型加载失败，请重试或重新下载。', model_missing: '模型尚未下载。',
    permission_denied: '权限未开启，请检查系统设置。', device_missing: '设备不可用，请重新选择。',
    credentials_missing: '尚未保存所选服务的密钥或凭据，请先完成配置。',
    authentication_failed: '鉴权失败，请检查密钥与服务权限。', model_unavailable: '模型不可用，请检查模型权限或额度。',
    scope_denied: '当前全局策略不允许 AI 使用转写文本，请修改策略或稍后继续。',
    unsupported_check: '引导暂不能验证此配置，请返回原设置或选择支持的服务。',
    busy: '会议、设备或模型正在使用中，请稍后重试。', timeout: '检查超时，请重试。',
    stale_config: '配置已变化，请重新检查。', network_error: '网络检查失败，请检查连接后重试。',
    storage_failed: '未能保存进度或配置，请重试。', cancelled: '检查已取消。',
    initialization_required: '初始设置尚未初始化，请重新打开初始设置。',
    schema_unsupported: '初始设置记录来自较新版本，请更新应用后重试。',
    invalid_request: '设置信息已变化，请刷新当前页面后重试。',
    forbidden: '此窗口不能执行该检查，请返回首页中的初始设置。',
  };
  return messages[code ?? ''] ?? '未收到明确的检查结果，请刷新当前页面后重新验证。';
}
export async function validateSavedOnboarding(input: {
  target: ValidationTarget; refresh(): Promise<OnboardingStateResult>;
  validate(revision: number): Promise<ValidationOutcome>;
}): Promise<ValidationOutcome> {
  try {
    const state = await input.refresh();
    if (!state.success) return state;
    return await input.validate(state.snapshot.progress.configRevision[input.target]);
  } catch { return { success: false, errorCode: 'network_error', messageKey: 'onboarding.network_error' }; }
}
export async function saveAndValidateOnboarding(input: {
  target: ValidationTarget; save(): Promise<boolean>; clear(): void;
  refresh(): Promise<OnboardingStateResult>; validate(revision: number): Promise<ValidationOutcome>;
}): Promise<{ saved: boolean; success: boolean; errorCode?: string }> {
  let saved = false;
  try {
    if (!await input.save()) return { saved, success: false, errorCode: 'storage_failed' };
    saved = true; input.clear();
    const result = await validateSavedOnboarding(input);
    return result.success ? { saved, success: true } : { saved, success: false, errorCode: result.errorCode };
  } catch { return { saved, success: false, errorCode: saved ? 'network_error' : 'storage_failed' }; }
}
