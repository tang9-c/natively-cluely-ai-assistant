# Contributing to CueUp

First off, thank you for considering contributing to CueUp! It's people like you that make CueUp such a great tool.

Following these guidelines helps to communicate that you respect the time of the developers managing and developing this open source project. In return, they should reciprocate that respect in addressing your issue, assessing changes, and helping you finalize your pull requests.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Pull Requests](#pull-requests)
- [Development Workflow](#development-workflow)
  - [Prerequisites](#prerequisites)
  - [Local Development](#local-development)
  - [Architecture Overview](#architecture-overview)
- [Styleguides](#styleguides)
  - [Git Commit Messages](#git-commit-messages)

## Code of Conduct

This project and everyone participating in it is governed by the [CueUp Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to tangdu@feigenbaum.ai.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the issue tracker as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- Use a clear and descriptive title for the issue to identify the problem.
- Describe the exact steps which reproduce the problem in as many details as possible.
- Provide specific examples to demonstrate the steps.
- Describe the behavior you observed after following the steps and point out what exactly is the problem with that behavior.
- Explain which behavior you expected to see instead and why.
- Include screenshots and animated GIFs which show you following the described steps and clearly demonstrate the problem.
- Specify your OS version.
- Specify your Node/Npm versions.

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When you are creating an enhancement suggestion, please include:

- Use a clear and descriptive title for the issue to identify the suggestion.
- Provide a step-by-step description of the suggested enhancement in as many details as possible.
- Provide specific examples to demonstrate the steps.
- Describe the current behavior and explain which behavior you expected to see instead and why.
- Explain why this enhancement would be useful to most CueUp users.

### Pull Requests

- Fill in the required template
- Do not include issue numbers in the PR title
- Include screenshots and animated GIFs in your pull request whenever possible.
- Follow the TypeScript and React styleguides.
- Document new code based on the Documentation Styleguide.
- End all files with a newline.

## Development Workflow

### Prerequisites

- Node.js 22 (the version used by the current packaging workflows)
- Git
- Rust (required for native audio capture compilation)

### Local Development

1. Fork the repo and create your branch from the repository default branch, currently `ci/intel-mac-workflow`.
2. Clone your fork locally: `git clone https://github.com/YOUR_USERNAME/natively-cluely-ai-assistant.git`
3. Install dependencies: `npm install`
4. Use in-app settings for providers; `.env` is optional for development. Never commit real credentials.
5. Start the development server: `npm start`

If you've added code that should be tested, add tests.
If you've changed APIs, update the documentation.
Ensure the test suite passes.

For prompt, RAG, context selection, dynamic action rules, realtime LLM paths, business-system context, speaker/screen context, trace, or metrics changes, run the context quality gate before submitting:

```bash
npm run test:quality:changed
npm run test:quality:gate
```

For repeated local validation after a fresh Electron build, use:

```bash
npm run build:electron
npm run test:quality:gate:no-build
```

For initial setup, system-audio permissions, audio recovery or screenshot authorization changes, run:

```bash
npm run test:system-audio-permissions
npm run test:system-audio-permissions:e2e
```

The first command is shared by all three release workflows. The second runs real production renderer chunks over `file://` with an isolated test-adapter main process. For other first-run UI or semantic status-color changes, also run `npm run test:e2e:production`. Do not claim these checks prove real macOS TCC authorization, voiced capture, or installer acceptance. See [permission contracts](docs/testing/system-audio-permissions.md) and [theme tokens](docs/design/semantic-status-colors.md).

Before submitting documentation changes, verify local links and package-script names, compare behavior with source/tests, and keep historical QA results distinct from current behavior. Start from the [documentation index](docs/README.md); the current release procedure is in [RELEASE.md](docs/RELEASE.md).

### Architecture Overview

CueUp uses a modern stack consisting of:

- **Frontend**: React 19, Vite, TypeScript, TailwindCSS
- **Backend/Desktop**: Electron
- **Native Audio**: Rust (`napi-rs` for zero-copy ABI transfers)
- **Database**: SQLite (local storage with `sqlite-vec` for RAG)

Not all settings are database rows: `settings.json` stores application settings and first-run progress; `credentials.enc` currently contains restricted-permission plaintext JSON, despite its extension. SEC-01 is the accepted non-blocking risk. Preserve that distinction in code, docs and reports.

When contributing, ensure you understand which context (Main Process, Renderer Process, or Native/Rust addon) your code will run in, and use the IPC correctly for communication.

## Styleguides

### Git Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line
- Consider starting the commit message with an applicable emoji:
  - 🎨 `:art:` when improving the format/structure of the code
  - 🐎 `:racehorse:` when improving performance
  - 🚱 `:non-potable_water:` when plugging memory leaks
  - 📝 `:memo:` when writing docs
  - 🐧 `:penguin:` when fixing something on Linux
  - 🍎 `:apple:` when fixing something on macOS
  - 🏁 `:checkered_flag:` when fixing something on Windows
  - 🐛 `:bug:` when fixing a bug
  - 🔥 `:fire:` when removing code or files
  - 💚 `:green_heart:` when fixing the CI build
  - ✅ `:white_check_mark:` when adding tests
  - 🔒 `:lock:` when dealing with security
  - ⬆️ `:arrow_up:` when upgrading dependencies
  - ⬇️ `:arrow_down:` when downgrading dependencies

Thank you for contributing to CueUp!
