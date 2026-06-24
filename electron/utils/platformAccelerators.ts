export function formatAcceleratorForPlatform(
  accel: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const commandOrControl = platform === 'darwin' ? 'Cmd' : 'Ctrl';

  return accel
    .replace(/CommandOrControl/g, commandOrControl)
    .replace(/Command/g, 'Cmd')
    .replace(/Control/g, 'Ctrl');
}

export function quitAcceleratorForPlatform(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'darwin' ? 'Command+Q' : 'Ctrl+Q';
}
