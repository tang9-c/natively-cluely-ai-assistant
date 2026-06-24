type ExecAsync = (command: string) => Promise<{ stdout: string; stderr: string }>;

export function extractNumericPids(stdout: string): string[] {
  return Array.from(new Set(
    stdout
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => /^\d+$/.test(token)),
  ));
}

export function getPortLookupCommand(platform: NodeJS.Platform, port: number): string {
  if (platform === 'win32') {
    return `netstat -ano | findstr :${port}`;
  }
  return `lsof -t -i:${port}`;
}

export function getKillCommand(platform: NodeJS.Platform, pid: string): string {
  if (!/^\d+$/.test(pid)) {
    throw new Error(`Invalid PID: ${pid}`);
  }
  if (platform === 'win32') {
    return `taskkill /F /PID ${pid}`;
  }
  return `kill -9 ${pid}`;
}

export async function killProcessesOnPort(
  port: number,
  execAsync: ExecAsync,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  let stdout = '';
  try {
    const result = await execAsync(getPortLookupCommand(platform, port));
    stdout = result.stdout;
  } catch (e: any) {
    if (e?.code === 1 || e?.message?.includes('exit code 1')) {
      return;
    }
    throw e;
  }

  for (const pid of extractNumericPids(stdout)) {
    await execAsync(getKillCommand(platform, pid));
  }
}
