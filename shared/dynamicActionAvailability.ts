export type DynamicActionAvailabilityStatus =
  | 'available'
  | 'cloud_unavailable'
  | 'local_fallback';

export type DynamicActionAvailabilityReason =
  | 'cloud_recovered'
  | 'cloud_unavailable'
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
  if (arbitrationStatuses.includes('cloud_unavailable')) {
    return dynamicActionAvailabilityFromArbitration('cloud_unavailable', observedAt);
  }
  if (arbitrationStatuses.includes('local_fallback_cloud_unavailable')) {
    return dynamicActionAvailabilityFromArbitration(
      'local_fallback_cloud_unavailable',
      observedAt,
    );
  }
  if (arbitrationStatuses.includes('cloud_used')) {
    return dynamicActionAvailabilityFromArbitration('cloud_used', observedAt);
  }
  return null;
}
