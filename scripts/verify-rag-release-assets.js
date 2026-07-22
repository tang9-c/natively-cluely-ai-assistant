const fs = require('fs');
const path = require('path');

const MODEL_ROOT = 'resources/models/Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const COMMON_ASSETS = [
  `${MODEL_ROOT}/config.json`,
  `${MODEL_ROOT}/tokenizer.json`,
  `${MODEL_ROOT}/tokenizer_config.json`,
  `${MODEL_ROOT}/onnx/model_int8.onnx`,
  'node_modules/bindings/package.json',
  'node_modules/bindings/bindings.js',
  'node_modules/file-uri-to-path/package.json',
  'node_modules/file-uri-to-path/index.js',
];

function sqliteVecAsset(platform, arch) {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return `node_modules/sqlite-vec-darwin-${arch}/vec0.dylib`;
  }
  if (platform === 'win32' && arch === 'x64') {
    return 'node_modules/sqlite-vec-windows-x64/vec0.dll';
  }
  throw new Error(`Unsupported RAG release target: ${platform}/${arch}`);
}

function validateRagReleaseAssets({ rootDir, platform, arch }) {
  const assets = [...COMMON_ASSETS, sqliteVecAsset(platform, arch)];
  return assets.filter((relativePath) => !fs.existsSync(path.join(rootDir, relativePath)));
}

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

if (require.main === module) {
  const platform = readArg('platform', process.platform);
  const arch = readArg('arch', process.arch);
  const errors = validateRagReleaseAssets({ rootDir: path.resolve(__dirname, '..'), platform, arch });
  if (errors.length > 0) {
    console.error(`[verify-rag-release-assets] Missing ${platform}/${arch} assets:`);
    for (const relativePath of errors) console.error(`- ${relativePath}`);
    process.exit(1);
  }
  console.log(`[verify-rag-release-assets] ${platform}/${arch} assets ready`);
}

module.exports = { validateRagReleaseAssets };
