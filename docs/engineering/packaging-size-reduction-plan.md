# Packaging Size Reduction Plan

## Summary

Reduce GitHub build artifacts, installer size, and installed app disk usage without running real packaging locally. Local work is limited to configuration, scripts, and static tests. Real build and size verification happen in GitHub Actions because the local machine does not have enough free disk space.

## Key Changes

- Split macOS release packaging into separate Intel x64 and Apple Silicon arm64 workflows.
- Build only the native module architecture required by each workflow through `NATIVELY_NATIVE_TARGETS`.
- Keep the existing `node_modules` packaging shape for safety, but exclude source maps, compiled tests, and obvious build-only packages.
- Disable production Electron sourcemaps and stop compiling Electron test files into `dist-electron`.
- Add a CI size audit script that writes `release/size-report.txt` after packaging.

## Validation

- Do not run `npm run build`, `npm run build:native`, or `electron-builder` locally.
- Run static Node tests for packaging configuration and workflows.
- Let GitHub Actions produce installers and size reports.

## Assumptions

- Local Whisper, local embedding, RAG, SQLite, PDF/DOCX parsing, and screenshot processing remain supported.
- `@huggingface/transformers`, `onnxruntime-node`, `sharp`, `better-sqlite3`, `sqlite-vec`, `keytar`, and `sherpa-onnx-node` stay packaged until runtime audits prove they can be moved or downloaded on demand.
