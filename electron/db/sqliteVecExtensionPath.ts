import fs from 'fs';
import path from 'path';
import * as sqliteVec from 'sqlite-vec';

interface ResolveOptions {
  getLoadablePath?: () => string;
  requireResolve?: (id: string) => string;
  existsSync?: (candidate: string) => boolean;
  platform?: NodeJS.Platform;
  arch?: string;
}

function platformArtifact(platform: NodeJS.Platform, arch: string): { packageName: string; suffix: string } {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return { packageName: `sqlite-vec-darwin-${arch}`, suffix: 'dylib' };
  }
  if (platform === 'win32' && arch === 'x64') {
    return { packageName: 'sqlite-vec-windows-x64', suffix: 'dll' };
  }
  if (platform === 'linux' && (arch === 'arm64' || arch === 'x64')) {
    return { packageName: `sqlite-vec-linux-${arch}`, suffix: 'so' };
  }
  throw new Error(`Unsupported sqlite-vec platform: ${platform}/${arch}`);
}

export function resolveSqliteVecExtensionPath(options: ResolveOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const getLoadablePath = options.getLoadablePath ?? sqliteVec.getLoadablePath;
  const requireResolve = options.requireResolve ?? require.resolve;
  const existsSync = options.existsSync ?? fs.existsSync;
  const artifact = platformArtifact(platform, arch);

  let rawPath: string;
  try {
    rawPath = getLoadablePath();
  } catch {
    const sqliteVecEntry = requireResolve('sqlite-vec');
    const nodeModulesDir = path.dirname(path.dirname(sqliteVecEntry));
    rawPath = path.join(nodeModulesDir, artifact.packageName, `vec0.${artifact.suffix}`);
  }

  const diskPath = rawPath.replace('app.asar', 'app.asar.unpacked');
  if (!existsSync(diskPath)) {
    throw new Error(`sqlite-vec extension not found for ${platform}/${arch}`);
  }
  return diskPath.replace(/\.(dylib|so|dll)$/, '');
}
