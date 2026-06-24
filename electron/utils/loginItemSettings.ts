type Platform = NodeJS.Platform;

interface LoginAppLike {
  getPath(name: 'exe'): string;
  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    openAsHidden?: boolean;
    path?: string;
    args?: string[];
  }): void;
  getLoginItemSettings(settings?: { path?: string; args?: string[] }): {
    openAtLogin?: boolean;
    executableWillLaunchAtLogin?: boolean;
  };
}

export function setOpenAtLoginForPlatform(
  app: LoginAppLike,
  openAtLogin: boolean,
  platform: Platform = process.platform,
): void {
  if (platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: false,
      path: app.getPath('exe'),
      args: [],
    });
    return;
  }

  app.setLoginItemSettings({
    openAtLogin,
    openAsHidden: false,
    path: app.getPath('exe'),
  });
}

export function getOpenAtLoginForPlatform(
  app: LoginAppLike,
  platform: Platform = process.platform,
): boolean {
  const query: { path: string; args: string[] } | undefined = platform === 'win32'
    ? { path: app.getPath('exe'), args: [] }
    : undefined;
  const settings = app.getLoginItemSettings(query);

  if (platform === 'win32') {
    return Boolean(settings.executableWillLaunchAtLogin ?? settings.openAtLogin);
  }

  return Boolean(settings.openAtLogin);
}
