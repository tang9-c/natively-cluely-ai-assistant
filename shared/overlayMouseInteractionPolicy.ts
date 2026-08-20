export interface OverlayMouseInteractionInput {
  platform: NodeJS.Platform;
  manualPassthrough: boolean;
  automaticInteractive: boolean;
}

export interface OverlayMouseInteractionPolicy {
  ignoreMouseEvents: boolean;
  forward: boolean;
}

export function supportsOverlayAutomaticHitTesting(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin';
}

export function resolveOverlayMouseInteractionPolicy(
  input: OverlayMouseInteractionInput,
): OverlayMouseInteractionPolicy {
  const ignoreMouseEvents =
    input.manualPassthrough ||
    (supportsOverlayAutomaticHitTesting(input.platform) && !input.automaticInteractive);

  return {
    ignoreMouseEvents,
    forward: ignoreMouseEvents,
  };
}
