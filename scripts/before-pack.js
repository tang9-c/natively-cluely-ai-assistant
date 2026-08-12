const { Arch } = require('builder-util');

const PLATFORM_PACKAGE_NAMES = {
  darwin: { native: 'darwin', sherpa: 'darwin', sqliteVec: 'darwin' },
  linux: { native: 'linux', sherpa: 'linux', sqliteVec: 'linux' },
  win32: { native: 'win32', sherpa: 'win', sqliteVec: 'windows' },
};

async function beforePack(context) {
  const arch = typeof context.arch === 'number' ? Arch[context.arch] : context.arch;
  const platform = context.electronPlatformName;
  const packageNames = PLATFORM_PACKAGE_NAMES[platform];
  if (!packageNames || !['arm64', 'x64'].includes(arch)) {
    throw new Error(`Unsupported package target: ${platform}-${arch}`);
  }

  process.env.NATIVELY_PACKAGE_PLATFORM = packageNames.native;
  process.env.NATIVELY_SHERPA_PLATFORM = packageNames.sherpa;
  process.env.NATIVELY_SQLITE_VEC_PLATFORM = packageNames.sqliteVec;
  console.log(`[Package Filter] Selected native payloads for ${platform}-${arch}`);
}

module.exports = beforePack;
