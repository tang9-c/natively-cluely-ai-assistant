/**
 * Ensures both macOS sherpa-onnx platform packages are present in node_modules,
 * even when the current CPU does not match the target release architecture.
 *
 * sherpa-onnx-node loads prebuilt optional packages such as
 * sherpa-onnx-darwin-x64/sherpa-onnx.node at runtime. npm skips optional deps
 * whose "cpu" field does not match the host, so an arm64 CI runner packaging
 * an Intel build can otherwise ship without the x64 SenseVoice native binary.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SHERPA_ONNX_VERSION = '1.13.2';

const packages = [
  'sherpa-onnx-darwin-arm64',
  'sherpa-onnx-darwin-x64',
];

if (process.platform !== 'darwin') {
  console.log('[ensure-sherpa-onnx-darwin] Non-macOS host, skipping.');
  process.exit(0);
}

for (const pkg of packages) {
  const pkgDir = path.join(__dirname, '..', 'node_modules', pkg);
  const addonPath = path.join(pkgDir, 'sherpa-onnx.node');
  if (fs.existsSync(addonPath)) {
    console.log(`[ensure-sherpa-onnx-darwin] ${pkg} already present, skipping.`);
    continue;
  }

  console.log(`[ensure-sherpa-onnx-darwin] ${pkg} missing — fetching...`);
  try {
    const tarball = execSync(`npm pack ${pkg}@${SHERPA_ONNX_VERSION} --pack-destination /tmp`, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf-8',
    }).trim();
    const tarPath = path.join('/tmp', tarball);

    fs.rmSync(pkgDir, { recursive: true, force: true });
    fs.mkdirSync(pkgDir, { recursive: true });
    execSync(`tar xzf "${tarPath}" --strip-components=1 -C "${pkgDir}"`, { stdio: 'inherit' });
    fs.unlinkSync(tarPath);

    if (!fs.existsSync(addonPath)) {
      throw new Error(`missing sherpa-onnx.node after extracting ${pkg}`);
    }

    console.log(`[ensure-sherpa-onnx-darwin] ${pkg} installed successfully.`);
  } catch (e) {
    console.warn(`[ensure-sherpa-onnx-darwin] Warning: could not install ${pkg}:`, e.message);
  }
}
