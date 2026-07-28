export type DynamicActionAvailabilityStatus =
  | 'available'
  | 'cloud_unavailable'
  | 'selected_model_unavailable'
  | 'selected_model_not_configured'
  | 'scope_denied'
  | 'local_fallback';

export type DynamicActionAvailabilityReason =
  | 'cloud_recovered'
  | 'cloud_unavailable'
  | 'selected_model_unavailable'
  | 'selected_model_not_configured'
  | 'provider_scope_denied'
  | 'local_fallback_cloud_unavailable';

export interface DynamicActionAvailabilityEvent {
  status: DynamicActionAvailabilityStatus;
  reason: DynamicActionAvailabilityReason;
  observedAt: number;
}

export function dynamicActionAvailabilityFromArbitration(
  arbitrationStatus: string | undefined,
  observedAt = Date.now(),
): DynamicActionAvailabilityEvent | null {
  if (arbitrationStatus === 'cloud_unavailable') {
    return { status: 'cloud_unavailable', reason: 'cloud_unavailable', observedAt };
  }
  if (arbitrationStatus === 'selected_model_unavailable') {
    return {
      status: 'selected_model_unavailable',
      reason: 'selected_model_unavailable',
      observedAt,
    };
  }
  if (arbitrationStatus === 'selected_model_not_configured') {
    return {
      status: 'selected_model_not_configured',
      reason: 'selected_model_not_configured',
      observedAt,
    };
  }
  if (arbitrationStatus === 'local_only_by_privacy') {
    return { status: 'scope_denied', reason: 'provider_scope_denied', observedAt };
  }
  if (arbitrationStatus === 'local_fallback_cloud_unavailable') {
    return {
      status: 'local_fallback',
      reason: 'local_fallback_cloud_unavailable',
      observedAt,
    };
  }
  if (arbitrationStatus === 'cloud_used') {
    return { status: 'available', reason: 'cloud_recovered', observedAt };
  }
  return null;
}

export function dynamicActionAvailabilityFromArbitrations(
  arbitrationStatuses: readonly string[],
  observedAt = Date.now(),
): DynamicActionAvailabilityEvent | null {
  if (arbitrationStatuses.includes('selected_model_not_configured')) {
    return dynamicActionAvailabilityFromArbitration('selected_model_not_configured', observedAt);
  }
  if (arbitrationStatuses.includes('selected_model_unavailable')) {
    return dynamicActionAvailabilityFromArbitration('selected_model_unavailable', observedAt);
  }
  if (arbitrationStatuses.includes('cloud_unavailable')) {
    return dynamicActionAvailabilityFromArbitration('cloud_unavailable', observedAt);
  }
  if (arbitrationStatuses.includes('local_fallback_cloud_unavailable')) {
    return dynamicActionAvailabilityFromArbitration(
      'local_fallback_cloud_unavailable',
      observedAt,
    );
  }
  if (arbitrationStatuses.includes('local_only_by_privacy')) {
    return dynamicActionAvailabilityFromArbitration('local_only_by_privacy', observedAt);
  }
  if (arbitrationStatuses.includes('cloud_used')) {
    return dynamicActionAvailabilityFromArbitration('cloud_used', observedAt);
  }
  return null;
}
