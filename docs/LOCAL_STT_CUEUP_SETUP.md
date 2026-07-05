# Archived WhisperLive Local STT Setup

> **Current status:** This document describes the older WhisperLive-based `Local STT` development path. The current CueUp speech setup is centered on **Local SenseVoice**, **QCLOUD API**, and **Doubao AUC**. Use the in-app Help & Settings guide or the README speech-provider section for the maintained setup path.
>
> The old `npm run test:local-stt` command is no longer present in `package.json`; use the current provider-specific tests such as `electron/services/__tests__/LocalSenseVoiceSTT.test.mjs`, `electron/services/__tests__/QCloudApiSpeechChannel.test.mjs`, or `electron/services/__tests__/DoubaoAucRestSTT.test.mjs` when validating speech changes.

This guide is for running the CueUp source tree that includes the new `Local STT` provider. Your already-installed CueUp app will not have this feature until you build and run this modified project or package a new installer from it.

## 1. Prerequisites

Install these first:

- Node.js 22 LTS. Avoid Node 23.x for this project because some dependencies warn that they support `^20.19.0 || ^22.13.0 || >=24`, not Node 23.
- npm, included with Node.
- Rust toolchain from `https://www.rust-lang.org/tools/install`, needed for the native audio module.
- Visual Studio C++ Build Tools, if the Rust installer prompts for MSVC build tools.
- Python 3.10+ for local tooling used by the repo.

On Windows, use PowerShell from the project root:

```powershell
cd C:\path\to\natively-cluely-ai-assistant
```

## 2. Install Dependencies

Run a normal install so postinstall scripts can rebuild native packages, download bundled local models, and patch Electron metadata:

```powershell
npm install
```

The `EBADENGINE` warnings mean your Node version is outside a dependency's supported range. If you see warnings with `current: { node: 'v23.x' }`, install Node 22 LTS and rerun `npm install`.

If native-module build errors mention `spawn cargo ENOENT`, Cargo is missing from your `PATH`. Install Rust, restart PowerShell, then verify:

```powershell
cargo --version
rustc --version
```

If those commands work, run:

```powershell
npm run build:native
```

## 3. Verify the Build

Run the same checks used for the local-STT implementation:

```powershell
npm run typecheck:electron
npx tsc --noEmit
npm run build
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/LocalSenseVoiceSTT.test.mjs electron/services/__tests__/QCloudApiSpeechChannel.test.mjs electron/services/__tests__/DoubaoAucRestSTT.test.mjs
```

These current speech tests cover the maintained Local SenseVoice, QCLOUD API, and Doubao AUC paths. The archived WhisperLive flow is not covered by a package script anymore.

## 4. Run CueUp in Development Mode

For day-to-day testing, run:

```powershell
npm run app:dev
```

This starts Vite and then launches Electron. Use this mode first to confirm Local STT works before packaging an installer.

## 5. Configure Local STT in CueUp

1. Start WhisperLive separately. See [WHISPERLIVE_LOCAL_STT_SETUP.md](./WHISPERLIVE_LOCAL_STT_SETUP.md).
2. Open CueUp.
3. Go to Settings -> Audio -> Speech Provider.
4. Select `Local STT`.
5. Use:
   - Adapter: `WhisperLive WebSocket`
   - Server URL: `ws://127.0.0.1:9090`
   - Model: `small` to start
   - Server VAD: enabled
   - Audio Format: `Float32`
6. Click `Save`.
7. Click `Test Connection`.

When `Test Connection` says connected, start a meeting or audio capture flow. CueUp opens separate local STT streams for system audio and microphone, so WhisperLive must allow at least two clients.

## 6. Package a Local Installer

After development mode works, build a packaged app:

```powershell
npm run app:build
```

On Windows, the installer/portable artifacts are written under `release/`.

If packaging fails on the native module, run this first and retry:

```powershell
npm run build:native
npm run app:build
```

## 7. Expected Behavior

- Local STT failures are intentionally quiet in the overlay.
- Settings -> Audio -> `Test Connection` is the place to diagnose local endpoint problems.
- CueUp does not start, install, or supervise WhisperLive. WhisperLive must be running before you use Local STT.
- `Float32` works with the default WhisperLive server.
- `PCM16` only works if WhisperLive is started with `--raw_pcm_input`.

## 8. Quick Troubleshooting

- `Test Connection` fails: confirm WhisperLive is running on port `9090`.
- Transcription is blank: start with `Float32`, model `small`, and Server VAD enabled.
- It disconnects mid-meeting: increase WhisperLive `--max_connection_time`.
- Only one channel works: run WhisperLive with `--max_clients 4` or higher.
- Existing installed app lacks Local STT: run this source build with `npm run app:dev` or install the new packaged artifact from `release/`.
- `Electron failed to install correctly`: the Electron binary did not download or unpack correctly. Delete `node_modules\electron`, reinstall Electron, then rerun dev mode:

```powershell
Remove-Item -Recurse -Force node_modules\electron
npm install electron@33.2.0 --save-dev
npm run app:dev
```

If this keeps happening, switch to Node 22 LTS, delete `node_modules` and `package-lock.json`, then run `npm install` again.
