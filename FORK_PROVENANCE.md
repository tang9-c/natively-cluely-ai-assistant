# Fork Provenance and Upstream Sync Freeze

Last reviewed: 2026-07-25

This document records the current provenance basis for this fork and the
temporary freeze on syncing code, assets, or documentation from the upstream
Natively repository.

This is an engineering compliance record, not legal advice.

## Upstream Sync Freeze

Upstream synchronization is frozen as of 2026-07-25.

- Do not add an `upstream` remote for routine development.
- Do not merge, cherry-pick, copy, or port code, assets, UI text, docs, release
  notes, or configuration from upstream `main` or upstream releases without a
  license review.
- Any future upstream import must record the exact upstream commit, file list,
  license at that commit, and reviewer approval in this file or a follow-up
  provenance note.

Current local remote configuration at review time:

```text
origin  https://github.com/tang9-c/natively-cluely-ai-assistant.git
```

No `upstream` remote was configured in this working copy at review time.

## Fork Base

Current branch reviewed:

```text
ci/intel-mac-workflow
HEAD: 81ac79466e79192a5a9ce498995035281a4b4b90
```

The closest verified common base between current `HEAD` and local tag `v2.7.0`
is:

```text
5aa651f9a2dde005a56f0754f8c735a79fd623ef
2026-05-26 15:59:11 +0530
Author: evinjohnn <evinjohnignatious@gmail.com>
Subject: fix(coaching): gate live-negotiation coaching by active mode (issue #272)
```

At that base commit, the repository `LICENSE` file is the GNU Affero General
Public License version 3:

```text
GNU AFFERO GENERAL PUBLIC LICENSE
Version 3, 19 November 2007
```

License file SHA-256 at the fork base:

```text
8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef
```

Note: the base `package.json` declared `ISC`, while the base `LICENSE` file was
AGPL-3.0. This fork aligned the package metadata and fork notice to AGPL-3.0 in
later fork-side commits.

## Upstream License Change

The current upstream `main` license reviewed on 2026-07-25 is:

```text
Natively Personal Use Source License v1.0
Effective Date: June 1st 2026
```

Current upstream `main` `LICENSE` SHA-256 at review time:

```text
0d7335ae49584f8cfde77047769eaefb7b8f1b1ed4e1885a2ad96e1227941009
```

The current upstream license states that it applies only to versions released by
Natively AI Private Limited on or after its effective date and does not
retroactively remove rights already granted under a previous license.

## Audit Findings

Commands and checks run on 2026-07-25:

- `git remote -v`
- `git merge-base HEAD v2.7.0`
- `git merge-base --is-ancestor v2.7.0 HEAD`
- `git rev-list --left-right --count v2.7.0...HEAD`
- `git show <fork-base>:LICENSE | shasum -a 256`
- `git log <fork-base>..HEAD --format=...`
- `git log <fork-base>..HEAD --format='%an <%ae>' | sort | uniq -c`
- `rg "Natively Personal Use Source License|Personal Use Source|source-available|licensing@natively|June 1st 2026|June 1, 2026" .`
- `curl https://raw.githubusercontent.com/Natively-AI-assistant/natively-cluely-ai-assistant/main/LICENSE`

Summary:

- The current working copy has no configured `upstream` remote.
- The current branch does not descend directly from local tag `v2.7.0`; its
  verified common base with `v2.7.0` is the 2026-05-26 commit above.
- The fork base `LICENSE` file is AGPL-3.0 with SHA-256
  `8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef`.
- Since the verified fork base, current branch history contains 1007 fork-side
  commits authored by `tang9-c` and AI-generated assistant identities; no
  upstream author commits were found in `<fork-base>..HEAD`.
- A repository text search found no copy of the new upstream personal-use
  license terms or related markers in this working tree.
- The current upstream `main` license is different from the fork-base license
  and is not treated as a source for this fork.

Limitations:

- This audit verifies Git ancestry, recorded commit authorship, local remote
  configuration, license file hashes, and text markers. It cannot conclusively
  prove that no post-change upstream code was manually copied outside Git
  history.
- Before commercial distribution or hosted service use, perform a file-level
  provenance review for high-risk areas such as UI text, assets, release notes,
  branding, and recently added features.

## Modification Scope After Fork Base

The current branch has substantial fork-side changes after the verified base:

```text
932 files changed, 1154550 insertions(+), 92898 deletions(-)
```

Major fork-side change areas include:

- AGPL fork notice and package license metadata alignment.
- CueUp/Natively product wording, settings, onboarding, and help text changes.
- Electron LLM routing, QCLOUD, meeting summary, skills, search, RAG, and
  dynamic-action behavior.
- Local STT, SenseVoice, Doubao AUC, Whisper, audio segmentation, and diagnostics.
- Meeting persistence, profile intelligence, material knowledge, and trust UX.
- Release workflows, packaging scripts, test fixtures, QA reports, and
  engineering plans.

## Trademark/Branding Policy

The external product brand for this fork is CueUp.

- `Natively` is used only for upstream provenance, license history, and
  compatibility references.
- `Natively` must not be used as this fork's application name, package name,
  installer name, advertising name, primary product heading, or logo.
- CueUp is an independent fork and is not affiliated with, endorsed by,
  sponsored by, or authorized by Natively or Natively AI Private Limited.
- The CueUp logo direction is a simple C-shaped sound wave. Do not use an
  `N` lettermark, circled `N`, or Natively-like mark in user-visible surfaces.
- Internal compatibility identifiers such as provider id `natively`, legacy
  settings keys, and migration paths may remain until a separate migration plan
  removes them safely.

## Future Review Gate

Before importing anything from upstream after 2026-06-01, record:

- Upstream commit hash and date.
- Upstream `LICENSE` content hash at that commit.
- Files copied or ported.
- Whether the material is code, asset, docs, UI text, or configuration.
- Compatibility decision and reviewer.
- Whether separate written permission from Natively is required.
