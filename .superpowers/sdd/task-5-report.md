# Task 5 Report: 统一录音质量门槛

## 完成内容

- 在 `speakerAudioUtils.ts` 定义并导出 `SPEAKER_RECORDING_QUALITY_POLICY`，由 `measureAudioQuality` 使用该策略。
- 新增 `speaker-verification:get-quality-policy` IPC，并经 preload 与渲染端 `ElectronAPI` 类型暴露。
- `SpeakerVerificationSettings` 启动时加载策略；IPC 不可用或失败时回退到同值的内部默认策略，并显示提示。
- 录音质量提示继续根据策略显示剩余时长、音量和有效语音比例。
- 删除前端独立阈值常量与同步注释。

## 验证

- `rtk proxy npm run build:electron`
- `rtk proxy node --test src/components/__tests__/SpeakerVerificationSettings.test.mjs`
- `rtk proxy node --test electron/services/__tests__/SpeakerVerificationIpcSettings.test.mjs`

## 备注

- 构建过程中仍会出现既有的 `pdf.worker.mjs not found` 提示；构建成功，且与本任务无关。
