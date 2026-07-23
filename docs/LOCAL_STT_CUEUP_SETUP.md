# Archived WhisperLive Local STT Setup

> **Current status (Archived):** This document describes the older WhisperLive-based `Local STT` development path. The current CueUp speech setup is centered on **Local SenseVoice**, **QCLOUD API**, and **Doubao AUC**. Use the in-app **Help & Settings → 音频语音转文字提供商设置** section or the README speech-provider section for the maintained setup path. Do **not** resurrect the WhisperLive adapter — it is not wired into the current SpeechProvider registry.
>
> The old `npm run test:local-stt` command is no longer present in `package.json`; use the current provider-specific tests such as `electron/services/__tests__/LocalSenseVoiceSTT.test.mjs`, `electron/services/__tests__/QCloudApiSpeechChannel.test.mjs`, or `electron/services/__tests__/DoubaoAucRestSTT.test.mjs` when validating speech changes.

This guide is retained only as historical context for the CueUp source tree that previously included a standalone WhisperLive `Local STT` provider. The WhisperLive companion document (`WHISPERLIVE_LOCAL_STT_SETUP.md`) is no longer shipped in this repository and **does not exist** at the previously linked path — any reference to it is intentionally removed below. Your already-installed CueUp app will not have a working `Local STT (WhisperLive)` option until (and unless) the project re-introduces it through the current provider pipeline.

## 1. Prerequisites

Install these first if you still want to browse the historic build commands:

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

## 3. Verify the Build (Current Speech Paths)

Run the checks used for the maintained speech providers (Local SenseVoice / QCLOUD API / Doubao AUC):

```powershell
npm run typecheck:electron
npx tsc --noEmit
npm run build
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/LocalSenseVoiceSTT.test.mjs electron/services/__tests__/QCloudApiSpeechChannel.test.mjs electron/services/__tests__/DoubaoAucRestSTT.test.mjs
```

These current speech tests cover the maintained Local SenseVoice, QCLOUD API, and Doubao AUC paths. The archived WhisperLive flow is intentionally **not** covered by a package script and is not part of the recommended setup path.

## 4. Run CueUp in Development Mode

For day-to-day testing, run:

```powershell
npm run app:dev
```

This starts Vite and then launches Electron. Use this mode first to confirm the current speech providers work before packaging an installer.

## 5. Configure Speech-to-Text in CueUp (Maintained Path)

Open CueUp and navigate **Settings → 音频** (Audio). Pick whichever provider best matches your meeting:

| Provider | When to choose it | Notes |
| --- | --- | --- |
| **Local SenseVoice** | Default for Chinese-first local meetings; do not want raw audio sent to the cloud. | Model is downloaded inside the app on first use; ensure the SenseVoice model is installed in the Local Models panel. |
| **QCLOUD API** | Need cloud Chinese-first transcription with speaker separation. | Reuses the QCLOUD key already configured under **Settings → AI Providers**. |
| **Doubao AUC** | Longer meetings that need speaker separation, sentence-level info, or emotion metadata from the cloud. | Requires a Doubao speech key saved in CueUp. |

Click **Test Connection** after switching providers to confirm the key/credentials are accepted. The audio routing (microphone / speaker loopback / language / accent) is controlled on the same page; see the in-app Help & Settings guide for details.

If you specifically need the historic WhisperLive flow, do **not** enable it through CueUp — the binary path is not part of the maintained app and the companion install guide has been removed from this repository. Use the maintained providers above instead.

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

## 7. Expected Behaviour (Current Speech Providers)

- Provider failures are intentionally quiet in the overlay; surface details via the Settings → 音频 → **Test Connection** button.
- CueUp does not auto-start or supervise any third-party STT daemon for the maintained providers.
- Switching providers does not require restarting CueUp — the next capture session uses the new selection.

## 8. Quick Troubleshooting

- **No provider selected**: open Settings → 音频 and choose one of Local SenseVoice / QCLOUD API / Doubao AUC. The dropdown defaults to Local SenseVoice.
- **Cloud provider test fails**: confirm the relevant key (QCLOUD or Doubao) is saved under Settings → AI Providers and has permission for STT.
- **Local SenseVoice missing**: open the Local Models panel and download the SenseVoice model.
- **Transcription is empty or in the wrong language**: pick the matching language/accent on the audio settings card.
- **`Electron failed to install correctly`**: the Electron binary did not download or unpack correctly. Delete `node_modules\electron`, reinstall Electron, then rerun dev mode:

```powershell
Remove-Item -Recurse -Force node_modules\electron
npm install electron@42.6.0 --save-dev
npm run app:dev
```

If this keeps happening, switch to the project-supported Node version, delete `node_modules`, then run `npm install` again.
