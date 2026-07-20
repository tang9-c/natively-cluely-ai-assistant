# Task 4 Report

## STATUS
PASS

## 修改内容
- `ActionArtifact` 现在支持 `recruiting` 并透传可选 `sourceIntent`；仅复用已有 dynamic-action usage metadata，不从 transcript 或 answer 推断。
- `MeetingPersistence` 按 `actionId` 合并并保留首个有效的 `sourceIntent`。
- `PostCallWorkflow` 生成仅供内部使用的 `AcceptedRecruitingRecord[]`，保存 action/parent/source intent、180 字符上限 summary、missing fields、evaluation 和 grounding status。
- Recruiting coaching 仅生成内部 evidence/gap/interest/policy insights；`strong_fit_signal` 对外文字固定为 `Candidate expressed interest`。
- `followUpDraft` 不接收 recruiting records，并且 recruiting mode 只保留无敏感词的 logistics next steps，避免 transcript action extraction 泄漏内部评估内容。
- Sales、FDE、team-meet 的 existing carryover 及 focused tests 保持通过。

## TDD
- 红测确认 recruiting artifacts 被旧 `ARTIFACT_MODES` 过滤、`sourceIntent` 未透传、post-call 不存在 `acceptedRecruitingRecords`。
- 绿测覆盖 artifact builder、MeetingPersistence 按 actionId 合并、中文/英文 no-leak、内部 records 和 coaching insight 保留。

## 验证
- `rtk npm run build:electron:tsc`：通过。
- `rtk node --test electron/services/__tests__/DynamicActionArtifactBuilder.test.mjs electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs electron/services/__tests__/PostCallWorkflow.test.mjs`：49/49 通过。
- `rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/__tests__/MeetingPersistence.test.mjs`：22/22 通过。
- `rtk git diff --check`：通过。

## 自审
- 确认 `acceptedRecruitingRecords` 未传入 `buildFollowUpDraft()`。
- 未新增 DB、UI 或 persistence subsystem；未修改 `.tmp/`。

## 提交
- `9f834325c2754f2317d9cae422dabacd3f62389f` `feat(recruiting): keep candidate evidence in internal post-call coaching`

## Reviewer Fix Addendum
- `IntelligenceEngine.recordDynamicActionUsage()` 现在在 transcript-evidence 与非 transcript placeholder metadata 中统一写入 `modeTemplateType` 和 `sourceIntent`；transcript-evidence 的 metadata 仍不包含 `retrievalQuery`、`latestTurn` 或 raw evidence。
- 已完成的 transcript-evidence answer metadata 同样保留 `modeTemplateType` 与 `sourceIntent`。
- Artifact builder 只从匹配 usage metadata 读取 `sourceIntent`，不再回退到 action 字段；无 usage source intent 时，artifact 不带该字段。
- Recruiting follow-up 改为固定的 candidate-safe draft，不读取 overview、action items、key points、sections 或 accepted records。
- 新增真实 `acceptDynamicAction()` usage 到 `MeetingPersistence -> artifact builder -> PostCallWorkflow` 的 recruiting provenance 回归测试，以及 adversarial candidate-follow-up 输入覆盖。

## Reviewer Fix 验证
- `rtk npm run build:electron:tsc`：通过。
- `rtk node --test electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs electron/services/__tests__/DynamicActionArtifactBuilder.test.mjs electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs electron/services/__tests__/PostCallWorkflow.test.mjs`：74/74 通过。
- `rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/__tests__/MeetingPersistence.test.mjs`：22/22 通过。
- `rtk git diff --check`：通过。

## Reviewer Fix 提交
- `48a917e9014967a86531afc2b45df95c3a7798ed` `fix(recruiting): isolate post-call follow-up provenance`
