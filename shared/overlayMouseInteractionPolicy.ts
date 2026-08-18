export interface OverlayMouseInteractionInput {
  platform: NodeJS.Platform;
  manualPassthrough: boolean;
  automaticInteractive: boolean;
}

export interface OverlayMouseInteractionPolicy {
  ignoreMouseEvents: boolean;
  forward: boolean;
}

export function resolveOverlayMouseInteractionPolicy(
  input: OverlayMouseInteractionInput,
): OverlayMouseInteractionPolicy {
  const ignoreMouseEvents =
    input.manualPassthrough || (input.platform === 'win32' && !input.automaticInteractive);

  return {
    ignoreMouseEvents,
    forward: ignoreMouseEvents,
  };
}
