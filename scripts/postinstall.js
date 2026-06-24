const { spawnSync } = require('child_process');

function run(command, args, options = {}) {
  console.log(`[postinstall] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...options.env,
    },
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run('npm', ['rebuild', 'sharp'], {
  env: { SHARP_IGNORE_GLOBAL_LIBVIPS: '1' },
});

run('npx', ['electron-rebuild', '-f', '-w', 'better-sqlite3,keytar,sherpa-onnx-node']);
run('node', ['scripts/download-models.js']);
run('node', ['scripts/ensure-sqlite-vec.js']);

if (process.platform === 'darwin') {
  run('node', ['scripts/ensure-sherpa-onnx-darwin.js']);
  run('node', ['scripts/patch-electron-plist.js']);
} else {
  console.log(`[postinstall] Skipping macOS-only postinstall steps on ${process.platform}.`);
}
