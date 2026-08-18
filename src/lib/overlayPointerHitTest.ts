interface ClosestTarget {
  closest(selector: string): unknown;
}

export function isOverlayInteractiveTarget(target: unknown): boolean {
  if (!target || typeof (target as ClosestTarget).closest !== 'function') return false;
  return Boolean((target as ClosestTarget).closest('[data-overlay-interactive]'));
}
