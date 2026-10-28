# 首次安装引导开发计划

> **执行者要求：** 实现时使用 superpowers:executing-plans 按任务顺序推进；若用户另外授权子代理执行，可使用 superpowers:subagent-driven-development。所有步骤以复选框跟踪。当前已按用户授权完成 T01–T12 的功能实现；T13 开发态自动化与报告已完成，发行验收未完成，SEC-01 凭据明文存储按用户决定为已接受的非阻断风险。T05 的 Codex 使用明确的 unsupported_check 出口，未声明支持安全隔离推理的 CLI 版本。

**Goal：** 用集中式引导完成初始配置，并通过现有流程进入第一次真实会议，提供准确、可恢复的状态与错误反馈。

**Architecture：** 主进程维护引导进度、配置验证回执和只读状态摘要；复用现有权限、凭据、模型管理及会议生命周期。Renderer 在现有 Launcher 中呈现 P0–P6，现有 overlay 呈现 P7；共享纯函数定义通行规则，UI 与 IPC 不各自推断就绪。

**Tech Stack：** 使用仓库已有 React/TypeScript、Electron、Tailwind、Framer Motion、Node test runner、Playwright；版本以 package.json 为准，不新增 UI/状态机/测试框架。

**Spec：** [修正后的产品与技术方案](./2026-10-27-first-run-onboarding.md)，包含第 8 节审查修正对照。

日期：2026-10-27。状态：T01–T12 功能已实现；T13 已运行完整自动化并回填证据，发行验收未完成，SEC-01 为已接受的非阻断风险。T05 支持豆包所选模型验证，Codex 暂为 unsupported_check。规格审查保留在第 6 节，执行证据见第 7、8、9、10、12 节及验收报告。

## 全局约束

- “不新增试用页面、模拟问答、测试会议或另一套录音流程。”
- “本期不新增试用额度、计费或账号系统。”
- “不新增原生窗口、独立会议引擎、自动充值登录、遥测平台或新的用户内容采集。”
- 保持 1200×800 与 600×400 可操作，亮暗主题、键盘焦点、no-drag 与 reduced-motion 均覆盖。
- 已有服务/模型/设备优先，用户明确保存才改设置；不强制迁移旧用户。
- 主进程为进度与验证回执唯一写入方；凭据留在 CredentialsManager，不放普通 settings、localStorage、引导日志或测试 fixture。
- 使用 safeHandle；provider 校验遵守 routeWithScopeFallback/assertProviderDataScopes；验证只允许选中的服务，正常会议回退保持原行为。
- 不以 preload IPC 成功、CLI --version、会议 ready 或 STT connected 作为真实转写成功证据。
- 只修改任务所需文件，保留仓库已有未提交改动；不重构完整 App、SettingsOverlay、main 或 ipcHandlers。
- 分批按授权实施。已完成规则、进度、配置失效、服务验证、电平生命周期、引导 IPC/首次门禁及 P0–P7 的配置与原会议 UI 接线；T13 自动化已执行；发行包、真机和真实服务仍未验收，缺项及 SEC-01 风险接受记录见第 12 节。本批测试使用隔离存储、假 worker/HTTP 与实际 handler/preload，不调用真实账号、不下载模型、不录音。

## 1. 顺序、依赖与完成门槛

执行顺序固定为 T01 → T02 → … → T13；不要按页面同时修改共享入口。

| 任务 | 独立交付物 | 直接依赖 |
|---|---|---|
| T01 | 共享契约与单一通行规则 | 方案 |
| T02 | 持久进度、旧用户识别、状态版本 | T01 |
| T03 | 配置 revision、回执失效、scope 原子更新 | T02 |
| T04 | 模型加载验证、下载任务快照、STT 验证 | T03 |
| T05 | AI 当前模型验证、超时与不支持出口 | T03–T04 |
| T06 | 麦克风电平生命周期与实际设备反馈 | T01 |
| T07 | 完整 IPC、首次门禁、真实会议事实 | T02–T06 |
| T08 | fresh/existing 离线 E2E fixture | T07 |
| T09 | 引导壳、P0/P1/P6、恢复与提示互斥 | T07–T08 |
| T10 | P2/P3 权限、设备和转写配置 | T04/T06/T09 |
| T11 | P4/P4a AI 配置与外部开通 | T03/T05/T09 |
| T12 | P5/P7 真实会议入口与轻提示 | T10–T11 |
| T13 | 全链路回归、跨平台发行验收、文档回填 | T01–T12 |

每个任务按“失败用例 → 最小实现 → 定向测试通过 → 检查 diff”推进。T09–T11 的页面测试仅断言该任务已交付表面；跨 P3→P4→P5 与 P7 的用例统一放 T12，不能提前要求未实现页面通过，也不能加假页面或 skip 来冒充通过。后续实施时可每任务形成独立提交，提交仅包含该任务文件，不混入当前已有改动。未通过的任务不标完成；T13 真机验收未做时不能声称整体完成。

### 测试命令约定

所有路径与命令以仓库根目录为工作目录。新增主进程测试放在现有 npm test 会收集到的 electron/services/__tests__/ 下：

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/OnboardingPolicy.test.mjs
npm run typecheck:electron
npx tsc --noEmit
```

后续各任务使用同样的 Electron-run Node 命令，并替换为任务列出的完整测试文件名。每次源代码改变后先重新 build；build:electron 是 transpile-only，不能替代两项类型检查。新增 shared/*.ts 已被 scripts/electron-build-entrypoints.js 的 development 扫描覆盖，不增加构建系统改造。

E2E 使用：

```bash
npm run test:e2e -- tests/e2e/onboarding.spec.ts
```

Playwright 配置会构建 Electron 并启动 Vite。测试必须使用隔离 userData 和 offlineElectronGuard，不能连接开发者真实账号或读项目 .env。以下测试代码片段是待写入对应测试文件的关键断言，非当前已存在的测试。

## 2. 共享文件结构和契约（T01 定义，后续不得自行改名）

### 文件职责

| 新增文件 | 职责 |
|---|---|
| shared/onboarding.ts | IPC/持久数据类型与纯通行规则，renderer 可直接导入 |
| electron/services/onboarding/OnboardingService.ts | 进度、回执、状态快照、生命周期事实；依赖注入便于测试 |
| electron/services/onboarding/OnboardingValidation.ts | 选择现有 STT/AI 检测执行器，去重、超时、revision 校验和结果归一化 |
| electron/services/onboarding/registerOnboardingHandlers.ts | 新增 safeHandle 注册与 sender 权限校验，减少 ipcHandlers 主文件膨胀 |
| src/hooks/useOnboarding.ts | 先订阅后取快照、拒绝旧 stateRevision、统一导航与 dirty 表单离开行为 |
| src/components/onboarding/OnboardingFlow.tsx | P1–P5/P4a 的壳、步骤栏、固定页脚 |
| src/components/onboarding/PreparationOverview.tsx | P1 概览与 P5 汇总两种视图，使用 mode 属性区分 |
| src/components/onboarding/PermissionsStep.tsx | P2 |
| src/components/onboarding/SpeechStep.tsx | P3 |
| src/components/onboarding/AiServiceStep.tsx | P4 与 P4a 嵌套视图 |
| src/components/onboarding/OnboardingResumeCard.tsx | P6 |
| src/components/onboarding/FirstMeetingHint.tsx | P7 |

不创建每个 UI 小状态一个组件，也不复制第二套 provider/下载器/音频管理器。新增测试文件在各任务中给出；不引入 Vitest 或 React Testing Library。

### 共享类型与函数

T01 在 shared/onboarding.ts 定义下列稳定名称，补全说明中的字段；同文件导出纯函数，避免 main 与 renderer 两份规则：

```ts
export type OnboardingStep = 'overview' | 'permissions' | 'speech' | 'ai' | 'ready';
export type ValidationTarget = 'stt' | 'ai';
export type CheckStatus =
  | 'missing' | 'checking' | 'verified' | 'previously_verified'
  | 'pending_runtime' | 'limited' | 'failed' | 'unsupported';
export interface OnboardingDeviceSelection {
  inputDeviceId?: string;
  outputDeviceId?: string;
}
export interface ValidationReceipt {
  target: ValidationTarget;
  provider: string;
  modelId?: string;
  configRevision: number;
  configIdentity: string; // 非敏感元数据与凭据版本号的稳定标识，不含密钥或其哈希
  checkedAt: number;
  depth: 'model_load' | 'credential_access' | 'model_response';
  result: 'passed' | 'failed';
}
export interface OnboardingProgress {
  version: 1;
  origin: 'fresh' | 'existing';
  lastStep: OnboardingStep;
  deferredAt?: number;
  configurationCompletedAt?: number;
  firstMeetingEnteredAt?: number;
  firstTranscriptReceivedAt?: number;
  meetingHintsDismissed: { transcript: boolean; answer: boolean };
  acceptedSystemAudioLimitation: boolean;
  systemAudioLimitationPlatform?: string;
  configRevision: Record<ValidationTarget, number>;
  validationReceipts: Partial<Record<ValidationTarget, ValidationReceipt>>;
}
export interface StartDecision {
  allowed: boolean;
  recoveryStep?: OnboardingStep;
}
export function requiresFirstRunGate(progress: OnboardingProgress): boolean;
export function isReceiptCurrent(receipt: ValidationReceipt, revision: number, identity: string): boolean;
export function derivePreparationDecision(snapshot: OnboardingSnapshot): StartDecision;
export function deriveFirstRunStartDecision(snapshot: OnboardingSnapshot): StartDecision;
```

OnboardingSnapshot 固定包括：stateRevision、progress、devices、checks（microphone/inputDevice/systemAudio/stt/ai）、meeting（isActive、isStarting、generation、phase、hasTranscript、errorCode/recoveryStep）、downloads。每个 check 使用 CheckStatus，附非敏感 messageKey、错误码、验证时间/深度与权限证据来源；downloads 包含 modelId、running/completed/failed、可选 progress 和脱敏 errorCode。phase 仅为 idle/entering/entered/audio_started/failed；真实转写以 generation 关联事件更新，不把全局历史 firstTranscriptReceivedAt 当成本场状态。

OnboardingErrorCode 使用方案列出的错误枚举，另加 initialization_required、schema_unsupported、invalid_request、forbidden 表达 IPC 生命周期/参数错误，以及 cancelled 表达电平测试已取消；ValidationOutcome 为 success:true（receipt）或 success:false（errorCode、messageKey）判别联合。OnboardingProgressAction 统一以 type 字段区分，仅支持 initialize（legacySeenStartup/legacyPermissionsShown 布尔值）、navigate(step)、defer、acknowledge-system-audio-limitation、dismiss-hint(transcript/answer)；不提供 renderer 写入完成时间、origin、revision 或任意 settings 的接口。

IPC 的初始化/未知版本/存储失败不能伪装成有 progress 的快照。统一结果类型如下；下列接口均在 T01 定义，T07 接线，T09 hook 负责分支处理；内部服务的类型化错误只在 IPC 边界转为结果联合：

```ts
export type OnboardingStateResult =
  | { success: true; snapshot: OnboardingSnapshot }
  | { success: false; errorCode: OnboardingErrorCode; messageKey: string };
getOnboardingState(selection?: OnboardingDeviceSelection): Promise<OnboardingStateResult>;
updateOnboardingProgress(action: OnboardingProgressAction): Promise<OnboardingStateResult>;
validateOnboardingService(input: {
  target: ValidationTarget; expectedRevision: number;
}): Promise<ValidationOutcome>;
onOnboardingStateChanged(callback: (snapshot: OnboardingSnapshot) => void): () => void;
openOnboarding(input?: { step?: OnboardingStep }): Promise<{ success: boolean }>;
onOpenOnboarding(callback: (input: { step?: OnboardingStep }) => void): () => void;
```

约束补充：

- derivePreparationDecision 总是检查当前准备条件，用于 P1/P5 和写配置完成时间；deriveFirstRunStartDecision 只负责首次门禁包装，existing/已完成/活动会议可绕过首次门禁，但不能反向把准备摘要改成全绿。
- pending_runtime 只允许在麦克风/系统音频的“系统不提供被动验证”场景通行；STT/AI 必须有匹配 revision 与 configIdentity 的回执且无已知错误，不能使用 pending_runtime 绕过服务验证。
- 首次完成时间在 navigate('ready') 或 defer 动作时，由主进程刷新已保存的当前选择并执行 derivePreparationDecision 后一次写入；未满足只保存导航/退出，不写完成。只读 get/refresh 不写该时间；验证完成本身不代表用户已完成全部步骤。navigate(ready)/defer 处理前必须已有 Launcher 保存的设备选择；selection 缺失使用系统默认，不继承另一窗口提供的临时值。
- receipt 与任务身份同时包含 target/revision/configIdentity。失败的本次验证必须覆盖先前成功；存储失败不发布新成功，复测中不能启动首次会议。空闲模型释放不改历史回执。
- OnboardingSnapshot 是“全局状态 + 调用方设备投影”：只有 Launcher 的 get(selection) 可更新其临时已保存选择，overlay 无参数读不能覆盖。广播仍使用 Launcher 已确认投影；并发 refresh 以请求代次丢弃旧完成结果，最终 start 使用该次 metadata.audio 再检查。
- stateRevision 只在同一主进程生命周期递增，snapshot/事件字段完全相同；新进程 hook 重置其比较基准。meeting.hasTranscript 每个 generation 重置；不以历史时间戳驱动本场提示。

跨窗口导航接口为原方案“设置中重开/会议错误修复”的必要接线：open-onboarding 仅接受 Launcher/Settings/Overlay 已知窗口 sender 和白名单 step，使用 WindowHelper 显示既有 Launcher，向它发 open-onboarding 事件；不直接写 lastStep、不新建窗口。Launcher 收到事件后通过自己的 applyAction 导航。活动会议期间打开仅查看，配置/验证/电平动作仍受 busy 限制，保留返回会议入口。窗口尚未加载完成时保留最后一个导航请求，ready 后发送一次，避免静默丢请求。

主进程无法自行读取 renderer localStorage：设备选择从现有偏好路径传入状态读取及 startMeeting metadata；校验 ID 长度/类型后重新枚举确认，不信任任意字符串为有效设备。

## 3. 开发任务

### T01：纯规则与共享契约

**文件：** 新增 shared/onboarding.ts；新增 electron/services/__tests__/OnboardingPolicy.test.mjs。
**产出：** 上节全部共享类型、两种结果联合与四个纯函数。
**进度：** 2026-10-27 已完成；实际测试见第 7 节。AI 回执必须为 model_response，本地 STT 回执必须为 model_load。

- [x] 先写基于完整 snapshot 的表驱动测试，覆盖 fresh 未完成、existing、已完成、活动会议、AI 拒绝、系统音频受限、pending_runtime、历史验证和下载进行中。
- [x] 运行定向测试，确认失败来自规则尚未实现。
- [x] 实现纯规则：已活动/正在启动优先复用；仅 fresh 且 configurationCompletedAt 缺失需要首次门禁；缺麦克风/设备→permissions、缺 STT→speech、缺 AI/scope 拒绝→ai；systemAudio 已知缺授权且未确认→permissions。pending_runtime 仅按共享契约的权限特例允许；STT/AI 的 checking/missing/failed/unsupported 不能通过完整首次配置。新增测试：existing 已配置完成但 AI 当前失败，首次门禁仍放行，P5 准备判定必须失败。
- [x] 运行定向测试与两项类型检查；确认纯模块不 import Electron、fs 或 React。

关键断言（测试中定义包含全部字段的 freshProgress fixture）：

```js
assert.equal(requiresFirstRunGate(freshProgress), true);
assert.equal(requiresFirstRunGate({ ...freshProgress, origin: 'existing' }), false);
assert.equal(requiresFirstRunGate({ ...freshProgress, configurationCompletedAt: 1 }), false);
assert.equal(isReceiptCurrent({ target: 'ai', provider: 'doubao',
  configRevision: 2, configIdentity: 'config-a', checkedAt: 1, depth: 'model_response', result: 'passed' }, 3, 'config-a'), false);
```

**验收：** UI 和 main 都可消费同一函数；不把仅存在密钥、合成 connected 或静态 granted 作为 verified。

### T02：持久进度、迁移及只读快照

**文件：** 新增 OnboardingService.ts；修改 electron/services/SettingsManager.ts、electron/db/DatabaseManager.ts；新增 electron/services/__tests__/OnboardingPersistence.test.mjs。
**进度：** 2026-10-27 服务层在 T02 批次完成；引导 IPC 注册及 Renderer 错误界面已由 T07/T09 接通。
**接口：** initialize(legacy): OnboardingSnapshot、getSnapshot(): OnboardingSnapshot（同步读已缓存状态）、refreshChecks(selection?): Promise<OnboardingSnapshot>（异步被动检查权限/设备）、applyAction(action): Promise<OnboardingSnapshot>、subscribe(callback): () => void。初始化前 getSnapshot/refreshChecks 使用类型化 initialization_required 错误；IPC 层映射结果联合，不返回虚构 progress。IPC getOnboardingState 调用 refreshChecks 后包装 success/snapshot 返回；同步测试只使用 getSnapshot。构造依赖包含 load/save、readLegacyEvidence、readChecks、now/platform；T03 增可选只读 readConfiguration 投影；签名类型从 shared 导入，不在模块加载时 app.getPath。

- [x] 用内存存储与假的 now 注入，先写初始化幂等、保存失败、两次重启、非法动作、状态 revision 单调测试。
- [x] 系统音频知情标记仅在当前授权缺失及同一平台有效：平台信息随非敏感进度记录；initialize 平台改变时清除，权限恢复时使本次投影的 accepted 标记立即无效并在下一次进度写入清除。对先恢复再撤销的当次会话重新要求确认，测试覆盖这条序列，不能把旧许可当永久忽略。
- [x] SettingsManager 增加 onboarding?: OnboardingProgress；初始化先读现有状态，之后只接受一次 legacy 证据；必须发生在 P0 写欢迎标记之前。
- [x] DatabaseManager 增加 hasNonDemoMeeting(): boolean，只做存在性查询，排除当前固定 demo-meeting ID，不读取转写。结合非默认已保存服务配置、legacy 布尔标记识别 existing；默认模型常量、seed 数据不作为使用证据。读取失败按 existing 并返回可见诊断，不能无声标 ready。
- [x] getSnapshot 只读；refreshChecks 仅刷新内存检查结果和对应 stateRevision，不写持久完成状态。initialize/applyAction 与服务内部验证/会议事件更新才写持久进度。未初始化读取返回需初始化的受控结果，为 T09 初始化屏提供受控错误；初始化屏及防止 P0 闪现由 T09 接线。
- [x] 保存失败恢复旧持久进度内存镜像、返回 storage_failed；诊断可更新 stateRevision，但不能发布已保存成功。applyAction 对 ready/defer 先刷新设备与配置再判断是否写 configurationCompletedAt；测试仅导航未满足不完成、满足后稍后开始写时间、重复动作不改历史时间。读取未知 schema 返回 schema_unsupported，服务不重写未知文件；UI 非阻塞回原首页并展示检查提示由 T09 消费该错误实现。
- [x] 跑 OnboardingPersistence.test.mjs，验证重建服务实例可恢复回执但显示 previously_verified。

关键存储测试（load/save/now 为测试内闭包）：

```js
const first = service.initialize({ legacySeenStartup: false, legacyPermissionsShown: false });
assert.equal(first.progress.origin, 'fresh');
const again = service.initialize({ legacySeenStartup: true, legacyPermissionsShown: true });
assert.equal(again.progress.origin, 'fresh');
assert.equal(again.progress.version, 1);
```

**验收：** 纯默认安装判 fresh；只有 demo 不判 existing；原欢迎标记判 existing；存储内容无密钥、转写、prompt、响应正文。schema version 无法识别时非阻塞显示检查提示，不擦除未知版本数据。

### T03：配置失效与 scope 原子更新

**文件：** 修改 OnboardingService.ts、SettingsManager.ts、electron/services/CredentialsManager.ts、electron/main.ts、electron/ipcHandlers.ts、electron/preload.ts、src/types/electron.d.ts；新增 electron/services/onboarding/OnboardingConfiguration.ts、electron/services/__tests__/OnboardingConfigRevision.test.mjs；更新 QCloudApiSettings.test.mjs 的受影响 setter 兼容断言。
**进度：** 2026-10-27 已完成；配置身份投影与拥有者订阅集中在 OnboardingConfiguration.ts，main 在 app ready 后创建服务。服务初始化等待 T07 的 legacy 证据，不提前写欢迎或引导状态。
**接口：** OnboardingService.invalidate(target: ValidationTarget): void；SettingsManager 增加同步 patchProviderDataScopes(patch)；旧 set-provider-data-scopes 支持可选 patch 模式，默认保留替换语义。

- [x] 写测试：修改密钥/模型/语言/端点使对应回执失效；修改 AI 不影响 STT 回执；另一个设置窗口改 screenshots 时 transcript patch 不覆盖它。
- [x] 在相关配置的拥有者 setter 统一发配置变更通知，主进程订阅并 invalidate；不要只在引导 UI 或单个 IPC 增 revision。明确包含 STT provider/语言/本地模型、AI 默认模型/相关凭据/Codex 配置、transcript scope。
- [x] 先为本任务涉及的凭据 setter 加“修改副本→写盘→替换内存→发布变更”的提交顺序；现有部分 setter 先改内存再 save，写盘抛错后不得让 getSnapshot 读取未保存的新密钥或配置。为写盘失败后 getter/验证器仍读旧值补测试，仅改相关 setter。
- [x] 服务保存 revision 失败时不得继续信任旧回执：保持当次内存失败状态并返回 storage_failed；后续读取需重新校验非敏感配置签名，不能只比较两个文件里可能写入不一致的整数。非敏感签名含 provider/model/endpoint/runtime/file metadata，凭据更换使用与该凭据同次落盘的随机版本号，不保存或计算凭据明文哈希。将 provider/model/规范化端点/语言/runtime/file metadata/凭据版本形成 configIdentity 写入回执；没有版本号的旧凭据标待验证，显式保存或验证时建立版本，不在被动读取中重写。证书/密钥 URL 参数必须先剔除，不将敏感字段拼入 identity。
- [x] T03 同步修改 electron/preload.ts、src/types/electron.d.ts：setProviderDataScopes(scopes, options?: { mode: 'replace' | 'patch' }) 保持旧一参 replace；新 UI 使用 patch。写行为/IPC 测试证明旧调用兼容与新参数透传。
- [x] patchProviderDataScopes 在主进程同步读-合并-写，允许字段白名单保持现有 scope 六项；保留与 embeddings 刷新的现有副作用。
- [x] 更新旧 setter 兼容测试，跑 OnboardingConfigRevision.test.mjs、CredentialsManager.test.mjs、ScopeLocalFallback.test.mjs。

关键断言：

```js
settings.patchProviderDataScopes({ transcript: false });
assert.equal(settings.get('providerDataScopes').screenshots, false);
assert.equal(settings.get('providerDataScopes').transcript, false);
assert.equal(service.getSnapshot().progress.validationReceipts.ai?.configRevision ===
  service.getSnapshot().progress.configRevision.ai, false);
```

**验收：** 原设置页变更同样失效；失败保存不误报成功；不同 scope 并发更新不丢失；不修改现有全局 scope 默认含义。

### T04：本地模型、活动下载与 STT 验证

**文件：** 新增 OnboardingValidation.ts；修改 electron/main.ts 的 preloadSelectedLocalStt/scheduleAdaptiveLocalSttPreload 接点、electron/ipcHandlers.ts 的本地模型下载与测试 handler；必要的就绪访问修改 electron/services/AdaptivePreloadManager.ts、electron/audio/LocalSttWorkerPool.ts；新增 electron/services/__tests__/OnboardingSpeechValidation.test.mjs。
**进度：** 2026-10-27 已完成；主进程注入执行器，复用池中真实 ready，下载状态不依赖 sender 生命周期；T04 批次未注册向导验证 IPC，后由 T07 接线。
**接口：** OnboardingValidation.validate(target, expectedRevision): Promise<ValidationOutcome>；STT 执行器由 main 注入，不能在 validator 创建音频捕获。活动下载快照由原任务更新。

- [x] 写模型文件存在但 worker 未 ready、60 秒超时、重复请求去重、下载失败、关闭页面后任务恢复、占用模型不能删除的测试。T04 建立公共验证任务控制（active meeting 拒绝、target/revision/identity 去重、60 秒上限、旧结果丢弃），T05 复用，不分别维护两套 timer。STT 原执行器更短超时继续生效，无自动网络重试。
- [x] 从原 local download handler 最小抽取共享任务状态，保留旧 sender 进度事件，同时更新 onboarding 快照；不复制下载器，不增加暂停功能。
- [x] 将现有 SenseVoice lease ready Promise 暴露给明确的用户验证动作；正常启动的被动 schedule 不改成自动重型加载。60 秒超时释放 lease；已 ready 的 lease 复用，空闲释放不抹掉历史加载回执。
- [x] 复用 testSavedSttConnection 对已保存的云端配置检测；将现有 runSttConnectionTest 从 IPC 内提为可调用的局部共享执行器或同域函数，只移动该逻辑，不重写整个 handler 文件。
- [x] SenseVoice、Doubao AUC、已有 QCLOUD 配置须覆盖；历史其他 provider 若现有执行器可安全验证则复用，不能验证返回 unsupported_check。Whisper 检查精确缓存 dtype，未提供可等待运行时结果时不得伪造 model_load 回执。
- [x] 替换模型前在 main 检查 active meeting/下载占用，释放闲置验证资源；配置 revision 改变后忽略晚到 ready/result。
- [x] 跑 OnboardingSpeechValidation.test.mjs 及 AdaptivePreloadManager.test.mjs、LocalSttWorkerPool.test.mjs、LocalSenseVoiceModelDownloader.test.mjs。

关键断言（fake worker lease 和 timer 在该测试文件内实现）：

```js
let settled = false;
const pending = validator.validate('stt', 1).then(result => { settled = true; return result; });
await Promise.resolve();
assert.equal(settled, false);
lease.emit('message', { type: 'ready' });
assert.equal((await pending).success, true);
```

**验收：** 读取快照不下载/加载；显式检查可等待真实模型结果；重载能看到活动下载；测试期间不录音。

### T05：AI 当前配置验证与任务控制

**文件：** 修改 OnboardingValidation.ts、electron/services/CodexCliService.ts、electron/ipcHandlers.ts 的 test-llm-connection 共享执行点；新增 electron/services/__tests__/OnboardingAiValidation.test.mjs；修改现有 CodexCliService.test.mjs。
**进度：** 2026-10-27 已按支持矩阵完成：豆包具备真实模型响应验证路径；Codex 明确 unsupported_check。未交付/宣称 Codex 安全隔离推理成功分支，版本认证依据与边界见第 8 节。
**接口：** 与 T04 同一 validate；CodexCliService.validateInference(config, signal) 目前返回 success:false/errorCode/messageKey，不调用普通 run，不以程序存在判成功。只有之后补齐隔离认证的版本才可增加非空响应成功分支。

- [x] 写测试：当前模型与固定旧测试模型不同、401/额度/网络错误、scope 拒绝时零请求、候选只含目标 provider、没有 --version 假通过、timeout 后不重复子进程。
- [x] 豆包使用已保存 LLM 专用密钥及当前选定 model，发送固定短文本“Reply with OK.”，max_tokens=16；不调用 LLMHelper 的会议上下文组装器。正常服务路由不改，只把配置验证候选限定为目标。
- [x] 服务验证先 scope 校验，再调用执行器；未保存字段不可进入该接口。执行器结果带实际 provider/model，匹配才能签发 model_response 回执。
- [x] Codex 不复用普通 run。已核对本机 exec --help 与官方配置参考，但未获得完整隔离认证，因此当前一律返回 unsupported_check；不执行推理、不创建临时目录、不改写/复制认证文件，不降级为普通 exec。今后若认证支持成功分支，仍须使用空 cwd、read-only、无图片/恢复/工具/用户指令注入且保留已存在认证的专用调用。
- [x] 支持版本集合保持为空：没有将 --help 或 --version 冒充隔离/推理证据。认证保留、用户/项目指令/skills/hooks/MCP/apps 隔离尚未获得真机证据，故不能启用成功分支；也不使用默认服务替自定义 provider/代理通过。该明确不支持出口已自动化验证。
- [x] 无隔离认证时验证方法不启动任何子进程，测试覆盖 enabled/path/model 不会使程序存在变成成功，以及预取消返回 timeout。未来启用成功分支仍必须补齐 --ignore-user-config、--ephemeral、shell_tool/web_search 与 app/MCP/插件工具禁用的实际参数、cwd、工具执行防护和进程/目录清理证据；本批没有执行或声称通过这些成功分支测试。
- [x] 豆包请求只用固定输入并透传 AbortSignal；超时未结束保持 busy。Codex 当前无子进程、不继承额外明文 API key、不触碰现有认证。若未来认证成功分支，仍需证明终止后等待 close、结束兜底及临时目录 cleanup；这些条件不得省略。
- [x] AI 外层最长 60 秒；支持 AbortSignal 的路径实际取消；超时未结束的任务保持 busy，晚到输出不写回执。错误统一脱敏，存储仅时间/配置版本/验证深度。
- [x] 跑 OnboardingAiValidation.test.mjs、CodexCliService.test.mjs、ScopeLocalFallback.test.mjs。

关键断言：

```js
assert.deepEqual(requests.map(r => r.provider), ['doubao']);
assert.equal(requests[0].model, selectedModel);
assert.equal(requests[0].prompt, 'Reply with OK.');
assert.equal(requests[0].tools.length, 0);
assert.equal((await validator.validate('ai', staleRevision)).errorCode, 'stale_config');
```

**验收：** 选中模型不可用时不能让其他模型代替通过；没有用户点击不联网；Codex 不支持隔离的分支有明确出口。不要把 CLI 参数兼容性问题扩成自动安装系统。

参数依据：[官方 CLI 参考](https://developers.openai.com/codex/cli/reference/)、[官方配置参考](https://developers.openai.com/codex/config-reference/)。该参考只证明能力定义，不证明用户安装的所有版本均支持；版本不支持时的行为已固定为 unsupported_check。

### T06：电平检测的实际设备与取消竞态

**文件：** 新增 electron/audio/AudioTestSession.ts；修改 electron/main.ts 的 startAudioTest/_startAudioTestImpl/stopAudioTest、electron/ipcHandlers.ts、electron/preload.ts、src/types/electron.d.ts、src/components/SettingsOverlay.tsx；新增 electron/services/__tests__/OnboardingAudioTestLifecycle.test.mjs。
**进度：** 2026-10-27 已完成；旧设置页同步消费结果/状态并以 operationId 清理，防止异步旧结果及旧 stop 污染新测试。
**接口：** 保留 startAudioTest(deviceId) 老调用；可选附加 operationId；owner 永远由 IPC sender 推导，不接受 renderer 自报 owner；返回 success、actualDeviceId、usedDefaultFallback，新增可订阅的 audio-test-state 仅传运行/失败元信息，不传录音。

- [x] 写授权 Promise 尚未解决时 stop/窗口关闭/会议开始、指定设备失败回退、旧 owner 迟到 stop 的测试。
- [x] T06 同时在 shared/onboarding.ts 定义 AudioTestResult 与 AudioTestState：结果为 success:true（actualDeviceId、usedDefaultFallback、operationId）或 success:false（errorCode、operationId）；事件包含 operationId、running/stopped/failed 与可选 errorCode。preload 新增 onAudioTestState 与 optional operationId 透传，旧 no-arg stop 兼容 sender 当前任务，带代次的 stop 不得停止较新的任务。
- [x] main 内维护测试代次及 sender owner；await 授权后再次检查是否有效。所有开始会议路径在初始化前终止电平检测，开始会议不等待用户继续授权旧测试。
- [x] 设备回退实际返回 default 标识；UI 不把原设备标验证成功。捕获 error 事件映射为脱敏通知，不能只写日志。
- [x] 兼容现有设置页的无 owner 参数调用：由 IPC sender 标识 owner，旧 stop 只停止该 owner 的测试；关闭 owner 窗口释放。
- [x] 跑 OnboardingAudioTestLifecycle.test.mjs 及现有 MeetingStartReliability.test.mjs、SettingsAudioFallbackNotice.test.mjs。

关键断言：

```js
const starting = audioHarness.start('preferred');
audioHarness.stop();
resolvePermission(true);
await starting;
assert.equal(createdCaptures.length, 0);
```

**验收：** 无残留录音、无新测试音频文件；已有会议期间无法启动电平；指定设备与实际设备不一致时调用方能区分。

### T07：IPC 接线、统一首次门禁与会议事实

**进度：** 2026-10-27 已完成；自动化与实现边界见第 9 节。

**文件：** 新增 registerOnboardingHandlers.ts、OnboardingReadiness.ts；修改 electron/main.ts、electron/ipcHandlers.ts、electron/preload.ts、src/types/electron.d.ts、OnboardingService.ts；必要的导航调用只复用 electron/WindowHelper.ts 现有方法；新增 electron/services/__tests__/OnboardingIpc.test.mjs、OnboardingMeetingLifecycle.test.mjs。

- [x] 为白名单 action、非法 sender、无明文响应、先订阅后快照、直接 start-meeting 绕行编写 handler 行为测试。
- [x] registerOnboardingHandlers 接收 { safeHandle, service, validator, getSenderRole, openLauncher, broadcast } 依赖；事件由 main 注入 broadcast，绝不从模块顶层获取 BrowserWindow。known role 白名单验证 sender webContents 身份，不仅检查页面 URL 参数。
- [x] app.whenReady 后装配服务与注入 adapters；不在 import 时获取 userData。注册约定的状态/更新/验证/导航 IPC 及状态事件，get 接受设备选择，主进程重新枚举；导航只能 Launcher 发，overlay 仅允许 dismiss-hint。
- [x] start-meeting 接口保留 success/error，增加 errorCode/recoveryStep。复用 main.startMeeting 的同一 _meetingStartInFlight，将异步 refreshChecks、门禁判定和原 startMeetingInternal 全部放入受保护的同一个 Promise；必须在首次 await 前占用锁，而不是在 handler 中先 await 检查再调用原方法；active 会话仍直接返回原 overlay。Promise 失败在 finally 释放锁；拒绝时定位现有 Launcher。配置完成后退出首次门禁，不能永久阻塞 fresh 来源用户的后续会议。
- [x] 当真实 isActive=true 写 entered；音频初始化回调仅更新 audio_started；首个本代次非空真实 transcript 写 firstTranscriptReceivedAt。现有 connected 不写任何成功证据。
- [x] 异步失败写当前失败摘要，恢复卡优先展示；晚到旧 generation 事件忽略。E2E_SKIP_AUDIO_START、benchmark injection、demo 可更新隔离测试实例中的瞬时 meeting.phase/hasTranscript，但不能写任何真实里程碑；这样 P7 状态可测且不污染持久证据。
- [x] main 持久化故障不得阻止已有会议结束或使会话半启动；返回提示并保留实际运行状态。所有原会议 metadata/retention/窗口切换保持原流程。
- [x] 跑 OnboardingIpc.test.mjs、OnboardingMeetingLifecycle.test.mjs、MeetingStartReliability.test.mjs、MacTccRepairFlow.test.mjs、MacTccRepairSafety.test.mjs，两项类型检查通过。

关键断言：

```js
// freshMissingAi 是测试 harness 的注入快照，不是传给 start-meeting 的 metadata。
const result = await handlers.startMeeting({ audio: {} });
assert.equal(result.success, false);
assert.equal(result.recoveryStep, 'ai');
assert.equal(startCalls, 0);
service.recordMeetingEvent({ kind: 'entered', generation: 1, synthetic: false });
assert.ok(service.getSnapshot().progress.firstMeetingEnteredAt);
assert.equal(service.getSnapshot().progress.firstTranscriptReceivedAt, undefined);
```

T07 定义 recordMeetingEvent 的事件联合：entered/audio-started/failed/transcript/ended，附 generation、synthetic，failed 附 errorCode/recoveryStep；transcript 仅传 hasNonEmptyText，不向服务传文本。ended 清理瞬时 active/starting/hasTranscript，不清历史时间。不新增独立会话管理器。

**验收：** 直接 IPC 与按钮遵循同一规则，旧用户不被新门禁拦截；里程碑区分真实事实。

### T08：可重复的 fresh/existing E2E 基础

**进度：** 2026-10-27 已完成；保留 offlineElectronGuard.mjs 原边界，无需修改其实现。

**文件：** 修改 tests/e2e/fixtures.ts、scripts/electron-build-entrypoints.js；新增 tests/e2e/onboarding.spec.ts、tests/e2e/onboarding-fixtures.ts。如需主进程 adapter 替身，新增 electron/test/onboardingFixtures.ts，仅在 ELECTRON_E2E=1 且非 packaged 且显式 fixture 开关同时满足时注入，不增加生产可调用的任意状态 IPC。

- [x] fixture 在 base.extend 的类型及 options 中同时定义 onboardingMode: existing/fresh 和固定场景名 onboardingScenario；默认空场景不可注入任意 payload。onboarding-fixtures.ts 仅导出固定场景枚举和离线替身配置，fake adapter 与可控时钟由主进程测试文件共享。
- [x] fixture 增加 onboardingMode: existing/fresh 选项，默认 existing 保持原测试语义。existing 证据在 app/renderer 初始化前放入隔离 userData，不能在新 origin 已存后才写旧 localStorage。
- [x] fresh 模式不写欢迎/权限已看过标记，不等待 launcher-container 或新引导页面：T08 阶段仅等待 preload API 可用，P0/P1 可见断言留给 T09；原 shared fixture 现有 reload 路径只用于 existing。增加同一隔离 userData 的 restartApp helper：一次测试内重启不删除目录，测试结束才清理；重新绑定 page/electronApp，防止所谓重启测试实际上新建空目录。
- [x] 如需测试 before-UI 的失败/恢复事件，使用显式开启的 E2E adapter 固定脚本和可控时钟，不暴露任意状态写入 IPC。只在测试进程导入 electron/test/onboardingFixtures.ts，package 构建条件拒绝；即使手动设置 ELECTRON_E2E 也不能在 packaged 加载。
- [x] 使用离线假权限、设备、模型与 AI adapters 驱动真实新 IPC；不伪造 production milestone。用任务本地固定场景生成 fixture，禁止接受任意生产命令/秘密路径。
- [x] 保留 offlineElectronGuard 的网络与文件边界，断言全流程无真实云请求、模型下载、原生录音。测试退出继续清理隔离目录。
- [x] T08 的初始化测试使用 [contract] 分类，T09 及之后新增页面用例分别用 [navigation]/[permissions]/[speech]/[ai]/[meeting] 分类；每任务只运行已交付分组，不加 skip。跑 existing 的 basic-smoke.spec.ts，以及 onboarding.spec.ts 的 [contract] 用例。

关键用法：

```ts
test.use({ onboardingMode: 'fresh' });
test('[contract] fresh 初始化不被旧欢迎标记替换', async ({ page }) => {
  const snapshot = await page.evaluate(async () => {
    await window.electronAPI.updateOnboardingProgress({
      type: 'initialize', legacySeenStartup: false, legacyPermissionsShown: false,
    });
    return window.electronAPI.getOnboardingState();
  });
  expect(snapshot.success).toBe(true);
  if (!snapshot.success) throw new Error(snapshot.errorCode);
  expect(snapshot.snapshot.progress.origin).toBe('fresh');
});
```

**验收：** 同一套脚本可重复运行、不会读取用户真实数据；生产 package 模式不能注入 fixture；旧用例继续进入首页。

### T09：引导壳、P0/P1/P6 与状态订阅

**进度：** 2026-10-27 已完成；T09 批次交付 P0/P1/P6、状态订阅及步骤壳；具体 P2–P5/P4a/P7 UI 的后续完成记录见 T10–T12。

**文件：** 新增 useOnboarding.ts、OnboardingFlow.tsx、PreparationOverview.tsx、OnboardingResumeCard.tsx；修改 src/App.tsx、src/components/StartupSequence.tsx、src/components/Launcher.tsx、src/components/SettingsOverlay.tsx；扩展 onboarding.spec.ts 与现有 Launcher/StartupSequence 内容测试。

- [x] 先写 P0→P1、退出→P6、重启恢复、existing 不强弹、600×400 页脚可达的 E2E 失败用例。
- [x] hook 完成初始化后再决定页面；先订阅后 get，明确处理 OnboardingStateResult 成功/initialization_required/schema_unsupported/storage_failed 分支。schema_unsupported 返回原首页和只读诊断，不启动错误的 fresh 向导。使用 stateRevision 丢弃旧快照，cleanup 去订阅；主进程重启后重置比较基准，读取失败有可重试状态。
- [x] P0 复用品牌/条款；P1 显示证据深度与时间，不自动测试。PreparationOverview 的 mode='overview'/'ready' 复用行布局，不复制规则。
- [x] 壳按方案尺寸、主题 token、no-drag、reduced-motion 实现；步骤可查看，只有明确保存才改变设置。定义 dirty guard 的三动作 save-and-leave/discard/stay；save 失败停留，密钥不加入 hook 持久状态。
- [x] P6 收起状态只影响当前 renderer 展示，不改完成/稍后状态；重启后未完成卡可再次出现。设置中“初始配置”使用 openOnboarding IPC，Settings 窗口不直接发送进度导航；overlay 修复入口也使用此路径。fresh 的旧权限/模式/画像自动提示由新流程接管，existing 只在新引导打开时暂时抑制。
- [x] 跑 onboarding.spec.ts 的 navigation/resize 测试和 basic-smoke.spec.ts；原字符串内容测试调整为真实新语义，不删除旧用户关闭提示回归。

E2E 核心断言：

```ts
await page.getByRole('button', { name: '开始准备', exact: true }).click();
await expect(page.getByRole('heading', { name: /开始前/ })).toBeVisible();
await page.getByRole('button', { name: '稍后继续', exact: true }).click();
await expect(page.getByRole('button', { name: '继续准备', exact: true })).toBeVisible();
```

**验收：** P0/P1/P6 可恢复，未初始化不闪错页面，页面只有一个主要下一步动作，无层叠旧 onboarding。

### T10：P2 权限设备与 P3 语音配置

**进度：** 2026-10-27 已完成；服务层及离线页面测试通过，见第 10 节。
**文件：** 新增 PermissionsStep.tsx、SpeechStep.tsx；修改 OnboardingFlow.tsx、preload/renderer 类型及原 IPC 的最小接点，直接复用已有模型目录/下载接口，未改原 LocalSenseVoiceModelPanel；扩展 onboarding.spec.ts。

- [x] 写 P2 授权拒绝、回焦刷新、设备拔出、实际设备回退、离页停止电平的 E2E；写 P3 文件存在但加载失败、下载时显示可去 AI 的入口、同页恢复后仍进行中的用例。跨 AI/最终摘要跳转延至 T12。
- [x] P2 保存到原 preferredInputDeviceId/preferredOutputDeviceId 路径并在读摘要传入；系统音频按钮写“了解限制，继续准备”，紧邻说明仍可能尝试捕获。不显示 macOS 链接给 Windows。
- [x] P3 默认仅推荐 SenseVoice，不自动保存/下载；“下载模型”包含完成后的加载验证，“检查模型”显式触发已存在文件的验证。model_load 成功才发回执；正在下载可去 P4，P5 不误放行。
- [x] 云 STT 使用已有凭据 setter，先保存再验证保存值；有旧密钥只显示状态与更换，不把掩码提交。云端音频去向/验证样本告知独立于 AI transcript scope。
- [x] 覆盖模型替换 busy、语言不兼容、unsupported_check、下载错误、网络鉴权失败；历史 provider 保留，不搬入词表和其他高级项。
- [x] 跑 onboarding.spec.ts 的 permissions/speech 分组与 T04/T06 定向测试，检查原设置页本地模型操作仍可用。

T10 独立断言（model-load-failed 固定场景，P3 文件存在、模型初始化失败）：

```ts
await page.getByRole('button', { name: '检查模型', exact: true }).click();
await expect(page.getByText('模型加载失败')).toBeVisible();
await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible();
await expect(page.getByRole('button', { name: '继续', exact: true })).toBeDisabled();
```

P3 的“先配置 AI”可在本任务验证其可用条件，但点击后 P4/P5 的跨页断言移至 T12。T10 不为缺失页面补 mock UI；下载和模型状态恢复先通过 T04 的服务测试证明。

**验收：** 无新增录音/STT 试用功能；输入设备和实际测试设备可区分；未完成项不显示成功。

### T11：P4/P4a AI 表单与开通说明

**进度：** 2026-10-27 已完成；Codex 推理仍为明确 unsupported_check，未以程序存在冒充通过。
**文件：** 新增 AiServiceStep.tsx；修改 OnboardingFlow.tsx 并复用现有模型常量和安全 setter，未嵌入或改写 ProviderCard/AIProvidersSettings；扩展 onboarding.spec.ts。不把整个 AIProvidersSettings 渲染进步骤壳。

- [x] 写保存失败留页、验证失败保留已保存状态、未保存字段跳转确认、外部返回不自动成功、scope 拒绝与 unsupported_check 出口的用例。
- [x] 当前服务优先；全新推荐豆包，模型读取应用常量；按 P4 规格展示“已保存/本次通过/上次通过/待验证”。保存按钮的成功回调后清明文，再调用当前 revision 验证。
- [x] transcript 控件表明全局影响与“沿用当前策略（允许）”；以主进程 patch 更新，不覆盖其他 scope，不提供只做转写的新模式。
- [x] P4a 使用方案核对的官方链接，openExternal 只接固定 HTTPS 目标；回到应用保留表单路径，不读剪贴板，不自动判定账号已开通，不自动验证。
- [x] Codex 两行分开显示程序存在与推理验证结果；其他服务不支持时提供原设置入口/选择支持服务，回到引导刷新配置。
- [x] 跑 onboarding.spec.ts 的 ai/provisioning 分组，T03/T05 定向测试；两项类型检查。

关键断言：

```ts
await page.getByRole('button', { name: '我还没有账号或密钥', exact: true }).click();
await page.getByRole('button', { name: '我已准备好，返回填写', exact: true }).click();
await expect(page.getByText('已保存，尚未验证所选模型')).toBeVisible();
```

用例 fixture 预设已保存但未验证的密钥状态；无凭据场景对应断言“尚未配置”，不要用固定文案掩盖条件差异。

**验收：** 无明文回填、离页漏存或保存失败误通过；开通说明不要求 SDK/终端操作；拒绝范围有清晰返回出口。

### T12：P5/P7 与现有真实会议闭环

**进度：** 2026-10-27 已完成；真实入口接通、离线 Electron 回归通过，真实音频/转写留 T13。
**文件：** 新增 FirstMeetingHint.tsx；修改 PreparationOverview.tsx、App.tsx、Launcher.tsx、src/components/NativelyInterface.tsx、useOnboarding.ts；同步调整原 MeetingPreparationPage 的 MeetingStartResult 调用方；新增 tests/e2e/onboarding-meeting.spec.ts，回归 meeting-start-overlay-reliability.spec.ts。

- [x] 写完整 ready→原会议回调、重复点击、已有会议、异步失败回首页、合成 connected 不出现转写成功、两个提示独立关闭的用例。
- [x] P5 使用原 handleStartMeeting 与原 audio metadata/retention；展示当前保留策略及修改入口，返回后刷新。不得自行调用新的 createMeeting 或 setWindowMode 替代主进程现有流程。
- [x] T01 定义 MeetingStartResult = { success:true } | { success:false; error?:string; errorCode?:OnboardingErrorCode; recoveryStep?:OnboardingStep }。T12 将 App.handleStartMeeting 和 Launcher.onStartMeeting 统一改为 Promise<MeetingStartResult>，所有调用方明确检查 result.success；禁止保留 started !== false 判断（失败对象也为 truthy）。先监听状态再启动，避免窗口切换丢失失败。
- [x] P7 只按 entered/audio_started/真实 transcript 显示状态；第一条提示与回答提示分别 dismiss，不强制展开用户关闭的转写，不自动生成回答。
- [x] 异步失败覆盖历史 entered，P6 显示修复卡；任何 start 请求只创建一场；退出/结束沿用现有真实记录策略。
- [x] P5 的“稍后开始”必须调用 defer 并收到 success:true 后返回首页；保存完成时间失败时留在当前摘要显示“未能保存进度”，不可显示永久完成。所有 IPC 错误结果由 hook 统一呈现，不能以 resolved Promise 视为成功。
- [x] 在 T12 添加模型下载中 P3→P4→P5 跨页用例，AI 回执预置有效，点击“先配置 AI”后经壳的步骤导航进入“开始会议”摘要；只显示“继续配置”，不渲染启动按钮，返回 P3 下载进度仍在。不新增方案未要求的 P4“查看准备结果”按钮。
- [x] 新增双窗口状态乱序、重启历史回执及 busy 下禁止配置的集成用例。每个 E2E 标题加 [navigation]/[permissions]/[speech]/[ai]/[meeting] 分类，确保分组命令能精确匹配。
- [x] 跑 onboarding-meeting.spec.ts、meeting-start-overlay-reliability.spec.ts、meeting-audio-recovery.spec.ts 及 T07 单元测试。

关键断言：

```ts
await page.getByRole('button', { name: '开始会议', exact: true }).click();
await expect.poll(async () => {
  return page.evaluate(() => window.electronAPI.getMeetingActive());
}).toBe(true);
```

上述 E2E 开启跳过音频时只证明进入/导航，不能据此断言生产 firstTranscriptReceivedAt。真实转写里程碑用 T07 的非 synthetic 服务级测试证明，再在 T13 发行包确认。

**验收：** 完整 P0–P7 接通，但没有新增试用页、第二个会议引擎或模拟结果。

### T13：整体验收、发布门槛与回填

**进度：** 开发态自动化、UI 检查与报告已完成；整体验收未完成。SEC-01 明文凭据存储已确认，用户后续明确接受此项风险、不作为发布阻断，本轮不扩展加密迁移；真实服务/真机/当前发行包验收保持未完成。详见[验收报告](../qa/2026-10-27-first-run-onboarding-acceptance.md)。

**文件：** 更新本计划复选框、源方案“尚未实现”状态（只有实现后才更新）；新增 docs/qa/2026-10-27-first-run-onboarding-acceptance.md 记录真实执行证据；必要修复只回到对应任务所属文件。

- [x] 运行全部新增 Node 测试、既有相关回归、两项类型检查；记录实际命令、退出码和失败，不把本计划的预期结果当执行结果。
- [x] 验收报告同时记录 discovered/executed/passed/failed/skipped 用例数；现有 basic-smoke 在 CI=true 会跳过，必须在可运行 Electron 的本地环境补跑，不把全跳过当通过。新增 onboarding 必需用例不允许静默 skip；无法运行则标验收未完成。
- [x] 运行完整 onboarding E2E、原 basic smoke/启动可靠性/音频恢复；核对 fresh fixture 没有自动跳过首次流程。无网络、无真实文件泄漏边界断言必须通过。
- [x] 1200×800、600×400、亮/暗主题检查全部页面及 P4a，含错误/下载/未保存内联提示。键盘全流程操作、焦点进入错误字段、no-drag 按钮可点、reduced-motion 下无动画依赖；保存截图到验收报告。
- [ ] 在 macOS 发行包覆盖原生权限拒绝→设置→回焦、系统音频受限→真实会议授权、授权后重启；Windows x64 覆盖设备选择、默认设备回退、系统音频真实输入。支持的 macOS arm64/x64 均验证模型加载，不用开发态 granted 代替。
- [ ] 使用专用账号做一次豆包真实选中模型响应、Codex 支持版本隔离验证、一次真实 STT 与真实会议转写/回答；发生费用与外部调用的步骤只在执行阶段按授权开展，凭据不进报告。记录 CLI 支持/不支持版本，后者必须走明确出口。
- [ ] 重启后历史回执、已有用户升级、修改配置失效、异步音频失败恢复都在发行包复验；再次确认没有独立试用功能。
- [x] 只有全部必需项通过才标交付完成。无法提供目标 OS/账号时标“实现完成，发行验收未完成”，列具体缺项，不代填通过。


最终自动化命令：

```bash
npm run typecheck:electron
npx tsc --noEmit
npm test
npm run test:e2e -- tests/e2e/onboarding.spec.ts tests/e2e/onboarding-meeting.spec.ts tests/e2e/basic-smoke.spec.ts tests/e2e/meeting-start-overlay-reliability.spec.ts tests/e2e/meeting-audio-recovery.spec.ts
```

首次实现结束跑一次全套；后续失败修复只重跑影响范围，最后交付前确保最终代码对应通过结果。新增 UI 原有静态内容测试不会被 npm test 收集，另运行：

```bash
node --test src/components/__tests__/StartupSequenceContent.test.mjs src/components/__tests__/LauncherOnboardingContent.test.mjs
```

**验收：** 每个自动化场景有真实结果，每个发布平台有验收证据；被跳过的真机步骤显式列出。T01–T03 批次当时未执行 T13；当前自动化及未执行项目见第 12 节和验收报告，不能据此视为发行验收通过。

### 分阶段 E2E 命令与结果门槛

T08 只跑契约，T09 开始跑页面；下列标题分类从测试创建时设置，不等到 T12 才添加：

```bash
npm run test:e2e -- tests/e2e/onboarding.spec.ts --grep '\[contract\]'
npm run test:e2e -- tests/e2e/onboarding.spec.ts --grep '\[navigation\]'
npm run test:e2e -- tests/e2e/onboarding.spec.ts --grep '\[(permissions|speech)\]'
npm run test:e2e -- tests/e2e/onboarding.spec.ts --grep '\[ai\]'
```

以上依次对应 T08、T09、T10、T11；T12 跑整个 onboarding.spec.ts 与 onboarding-meeting.spec.ts。每个 --grep 至少匹配一个预期用例，匹配为零也算失败。重启用例必须复用同一 userData；双窗口用例必须操纵真实两个 webContents。fake timer 覆盖 60 秒期限，不让 Electron E2E 的默认 60 秒 test timeout 与待测操作超时正好竞争。

服务级测试片段是关键断言，不是独立可执行文件；各任务先在自己的 .test.mjs 中完整导入 dist-electron 对应模块、建立依赖注入 harness 与 beforeEach 清理，再加入断言。mock 请求记录结构统一为 {provider, model, prompt, tools: []}，不能把实际 HTTP body 的不同字段名当业务断言。Promise/回调任务用可控 deferred，确认监听器已绑定后再发 ready，不使用任意 sleep 或仅一次 Promise.resolve 假定时序。

## 4. 规格覆盖矩阵

| 源方案要求/审查问题 | 开发任务 | 主要证明 |
|---|---|---|
| 统一门禁、无只转写新模式、旧用户兼容 | T01/T02/T07/T09 | Policy/Ipc、fresh/existing E2E |
| P0/P1/P6、退出恢复与旧提示接管 | T08/T09 | onboarding navigation、旧 basic smoke |
| P2、系统音频知情不等于关闭音轨 | T06/T10 | AudioTestLifecycle、权限 E2E、真机 |
| P3、真实加载与下载快照 | T04/T10 | SpeechValidation、下载/加载失败 E2E |
| P4/P4a、无凭据开通、保存/验证分离 | T05/T11 | AiValidation、provisioning E2E |
| scope 全局语义、原子 patch、无隐式验证回退 | T03/T05/T11 | ConfigRevision/AiValidation |
| P5/P7、真实会议入口、真实转写证据 | T07/T12 | MeetingLifecycle、onboarding-meeting、真机 |
| 重启历史回执、配置更换失效 | T02/T03 | Persistence/ConfigRevision、重启验收 |
| 电平授权竞态、设备回退事实 | T06/T10 | AudioTestLifecycle、设备 E2E |
| 超时/占用/旧结果/跨窗口乱序 | T04/T05/T07/T09 | fake timer、revision、双窗口场景 |
| 两条提示独立、未保存字段离开 | T09/T11/T12 | dirty guard 与两次 dismiss E2E |
| 真实保留策略、没有模拟会议 | T12/T13 | 原 metadata/retention、发行包流程 |
| 全页面尺寸/主题/键盘/no-drag | T09–T13 | 屏幕截图、键盘行为断言 |
| 日志与凭据安全、生产不可启用 fixture | T02–T08/T13 | 存储/IPC 断言、package 模式 fixture 拒绝 |
| 配置完成写入、手动 P5 与首次门禁分开 | T01/T02/T07/T12 | Policy/Persistence、defer 保存失败 |
| Settings/Overlay 重开引导 | T07/T09/T12 | openOnboarding sender 校验、双窗口恢复 |
| 初始化/未知 schema/写盘失败结果 | T01/T02/T03/T09 | 结果联合、旧内存不污染、错误 UI |
| 同场状态与历史证据分离 | T07/T12 | synthetic 更新瞬时状态但不持久化里程碑、ended 重置 |
| 权限恢复、平台变化使限制确认失效 | T02/T10 | 平台迁移与授权恢复再撤销用例 |

## 5. 执行前与收尾检查

- [x] 本批执行前确认当前 checkout、AGENTS.md 与未提交修改，逐项对照源方案第 8 节修正；不回退用户已有改动。
- [x] 本批建立基线时只跑与任务相关的现有测试；记录原有失败，新增改动不得将它们伪装为本次通过。
- [ ] 每任务核对新增 API 名称、参数、错误枚举与 shared 定义一致；文档中新增文件应由对应任务创建，不能复制散落的同名类型。
- [ ] 若执行中发现原接口语义与本计划不同，先修正最小受影响设计和测试，不擅自增加 provider/新窗口/新产品模式。
- [ ] 提交或交接时列完成任务、实际测试、尚未完成的发行验收，并链接验收报告；未运行项保留未勾选。

本计划与源方案共同交付：源方案定义页面行为与边界，本文件定义依赖、文件、接口和验证顺序。当前已完成 T01–T12 的支持范围；Codex 的 unsupported_check 边界见第 8 节，最近验收证据见第 12 节，T13 发行验收仍未完成，SEC-01 按用户决定不再作为阻断。


## 6. 2026-10-27 开发计划覆盖审查记录

审查对象为本开发计划对修正方案的覆盖，不是实现验收。以下记录计划审查时发现的问题与文档修正；审查时开发任务均未执行，之后的实现进度以第 3、7 节为准。

| 级别 | 修订前证据/问题 | 修正结果 |
|---|---|---|
| 高 | T10 测试调用 T11 的 AI 页及 T12 的最终摘要，违反逐任务通过的顺序 | T10 仅测 P2/P3，跨页用例移至 T12；依赖表补真实前置任务 |
| 高 | 共享 IPC 承诺总返回 snapshot，但 T02 要返回未初始化、未知 schema、storage_failed | T01 增统一结果联合，T07 映射错误，T09 显式处理，不造假 progress |
| 高 | 要求主进程写 configurationCompletedAt，却无动作触发；首次门禁函数又对旧用户直接放行 | 增独立准备判定；ready/defer 刷新后写完成，历史门禁不充当当前 UI 通过判据 |
| 高 | T03 要比较配置签名与凭据版本，receipt 类型却只有整数 revision | 补 configIdentity、相关 setter 提交顺序、跨文件失败后身份比对及失败回执覆盖测试 |
| 高 | T07 在检查 in-flight 后 await refresh，原 main 直到后续 startMeeting 才占锁 | 把刷新、门禁及启动置于同一原 Promise，首次 await 前占锁；重复并发请求测试 |
| 高 | T12“向后兼容 boolean”未定义结果类型，旧 started !== false 会把失败对象当成功 | 固定 MeetingStartResult 判别联合，全部调用方改 result.success |
| 中 | T03 scope patch 与 T06 电平扩展没有完整 preload/renderer 类型和事件签名 | 补参数兼容、结果/状态类型、operationId，owner 仅由 sender 决定 |
| 中 | 方案要求设置重开与 overlay 修复，任务只写入口，没有跨窗口导航接线 | 增受限 openOnboarding IPC/事件，沿用 WindowHelper，Launcher 自己写导航状态 |
| 高 | T08 fresh 等待 P0，却先于 T09 UI；fixture 每次清目录，不能证明重启恢复 | T08 仅等待 preload，初始化测试分类；新增同 userData restart helper；保留离线边界 |
| 中 | T07 排除 synthetic 所有更新，会使 P7 E2E 无状态；snapshot 缺本场 hasTranscript/ended | 排除的是持久里程碑，测试瞬时状态可测；本代次状态与全局历史分离 |
| 中 | STT 60 秒与去重只在 AI 任务描述，T04 未明确公共任务控制 | T04 建公共控制，T05 复用；补 active/busy/超时/旧结果测试 |
| 中 | Codex --help 能力检测不足以证明工具隔离，也可能丢失自定义 provider 路由 | 明确隔离证据、失败不得降级、配置改变不能代测默认服务；旧版本走既定 unsupported_check |
| 中 | 验收命令未处理零匹配、basic-smoke 的 CI 跳过及真实双窗口/重启证据 | 分组命令、执行计数、零匹配失败、真 userData 重启/双窗口要求纳入 T13 |
| 中 | 权限确认清除、保存失败留页、会话结束后的本场提示重置只有规格描述，任务未落地 | 分别补 T02/T10、T03/T12、T07/T12 与覆盖矩阵 |

本轮文档复核以“每项要求有任务、每个接口有类型/拥有者、每个跨页用例在依赖完成后执行”为通过条件；真机、云服务和应用构建仍未运行，不能据此声明功能通过验收。

## 7. 2026-10-27 T01–T03 实施与验证记录

### 完成范围

- T01：shared/onboarding.ts 提供纯规则、进度/状态/结果契约；区分当前准备判定与首次门禁，拒绝不匹配配置、错误验证深度、活动下载和已知失败。
- T02：依赖注入的 OnboardingService 完成幂等初始化、旧用户证据、持久化恢复、严格动作白名单、只读快照、状态订阅、异步刷新乱序防护、完成时间与系统音频知情标记的生命周期。DatabaseManager 的查询只返回非 demo 会议是否存在；不读取转写。
- T03：配置拥有者保存后通知并失效对应回执；凭据按副本→临时文件→原子替换→更新内存→通知的顺序提交，失败清除临时副本。随机凭据版本与值同次落盘；被动读取不生成版本、不触发 STT 旧配置迁移。配置身份去除端点 userinfo/query/fragment，包含本地运行时版本、文件元数据及 Whisper 分通道模型。正常失效不会误广播 storage_failed，失败保存则不再信任旧成功回执。
- scope 新增 patch 模式，旧一参 replace 保留；主进程广播合并后的值并保留 embeddings 刷新。preload 及 renderer 类型同步更新，行为测试执行实际构建出的 handler 和 preload。

最小文件拆分调整：新增 OnboardingConfiguration.ts 集中配置投影、Settings/Credentials 订阅及持久化适配，使 OnboardingService 保持可注入；main 仅在应用 ready 后创建并持有服务。被动权限/设备适配、引导 IPC、UI 和会议门禁接线仍按 T04–T12 推进，当前没有启用新向导或新启动路径。

### 执行证据

基线命令（改代码前）：

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/CredentialsManager.test.mjs electron/services/__tests__/ScopeLocalFallback.test.mjs
```

结果：退出码 0，41 项通过、0 失败、0 跳过。新增 Policy/Persistence/ConfigRevision 用例先运行失败，确认缺失规则/持久化/配置通知、patch 参数及保存恢复行为；后续边界修正同样先复现失败再修正。旧 QCloudApiSettings 依赖直接赋值源码的断言随本次提交顺序调整为真实 getter/setter 行为，不改变保护手动默认模型及清除密钥后的 STT 回退语义。

最终代码验证命令：

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/Onboarding*.test.mjs electron/services/__tests__/CredentialsManager.test.mjs electron/services/__tests__/ScopeLocalFallback.test.mjs electron/services/__tests__/BusinessSystemCredentials.test.mjs electron/services/__tests__/ScreenUnderstandingMode.test.mjs electron/services/__tests__/QCloudApiSettings.test.mjs electron/db/__tests__/DatabaseManager.connection.test.mjs
npm run typecheck:electron
npx tsc --noEmit
git diff --check
```

结果：以上命令退出码均为 0；定向与相关回归 discovered/executed/passed 均为 130，failed/skipped/cancelled 均为 0。两项 TypeScript 检查通过，diff 无空白错误。ScopeLocalFallback 仍输出基线已有的 Node punycode 弃用提示；故障注入测试中的保存失败日志为预期行为，不是跳过或隐藏失败。

未运行 npm test 全套、Playwright、发行包、真机权限/音频、本地模型加载或真实服务验证；这些不属于本批 T01–T03 的验收。T04–T13 复选框保持未勾选。没有发起真实账号请求、模型下载、录音、提交或推送；保留工作区原有改动。

## 8. 2026-10-27 T04–T06 实施与验证记录

### T04：真实模型就绪、验证任务和下载生命周期

OnboardingValidation 统一 target/revision/configIdentity 的去重、60 秒期限、AbortSignal、活动会议/资源占用、旧结果拒绝和回执提交。超时先返回错误，资源真正结束前仍 busy；不写入迟到成功。失败回执覆盖原成功，凭据版本落盘失败返回 storage_failed 且零外部请求。主进程只在明确验证动作建立旧凭据版本，被动快照不触发加载/请求。

LocalSttWorkerLease 增加 waitUntilReady(signal)，检查真实 ready/error 并清理监听器；显式 SenseVoice/Whisper 验证租用现有 keyed pool、等待 ready、finally 释放，不发送任何音频。Whisper 使用当前平台精确 dtype 检查，并验证分通道实际选择；正常 adaptive preload 仍保留原预热策略，复用同一就绪原语，下载/显式验证期间不重启后台预热。

云端验证复用 ipcHandlers 内抽出的同域 testSavedSttConnection，保留旧 test-saved-stt-connection；现有 Axios 更短超时和 AbortSignal 生效。支持 SenseVoice、Whisper、豆包 AUC、QCLOUD，以及现有可安全检测的 Groq/OpenAI/Azure/IBM；Google、Soniox、ElevenLabs 等没有适当验证适配的配置明确 unsupported_check，避免静默等待或将受限凭据误标通过。AUC 业务失败头即使 HTTP 200 也不通过。

活动下载快照保留在 OnboardingService，可在初始化前积累并在新视图读取；原进度 IPC 保留。Whisper 的 sender 关闭、异常退出和旧 worker 迟到事件不会泄漏/覆盖活动任务。原模型删除、下载替换及 Storage 页删除均调用 main 的资源检查，先拒绝 busy，再释放闲置预热并复查。

### T05：支持矩阵与 Codex 边界

| 路径 | 本批交付状态 | 验证含义 |
|---|---|---|
| 豆包所选已保存模型 | 已实现 model_response 成功/失败路径 | 专用 LLM 密钥、当前模型、固定 Reply with OK.、max_tokens=16；非空响应且没有模型替换才通过 |
| Codex CLI | 已实现明确 unsupported_check 出口 | 不以 --version/--help 或正常 run 代替隔离推理；原正常 Codex 使用路径保留 |
| 其他无适配 AI 服务 | 明确 unsupported_check | 不尝试其他已配置服务，不偷偷切到默认模型 |

AI 执行前调用 assertProviderDataScopes；拒绝 transcript 时零外部请求。请求没有会议上下文、图片、工具或用户内容；网络/鉴权/额度/模型不可用统一为非敏感错误码。旧豆包 test-llm-connection 与新验证共享固定输入的实际请求函数。公共任务控制与 T04 共用，不另建超时或重试系统。

本机只执行只读 `codex --version` 与 `codex exec --help`，版本为 **0.164.0-alpha.11.1**。help 包含 ignore-user-config/ephemeral 等参数，但不构成认证保留及用户/项目指令、skills、hooks、MCP/apps 全隔离的自动化证据。因此本批没有声明任何安全隔离推理支持版本，没有发起 Codex 推理或认证请求，也没有实现未经认证的推理 spawn 分支。将来若要开通该成功分支，必须先取得上述版本证据，再实现并验证参数、空 cwd、工具防护、取消和 cleanup；不能仅删除 unsupported_check 让普通 run 代测。

核查参考：[官方 CLI 参考](https://developers.openai.com/codex/cli/reference/)、[官方配置参考](https://developers.openai.com/codex/config-reference/)。配置参考分别列出 skills、hooks 与工具开关；这些能力的存在不证明所有配置源在 ignore-user-config 后均被隔离。本批验证的是“不支持时有明确出口”，未将真实隔离/真实推理标为通过。

### T06：电平测试的 owner、代次与资源释放

AudioTestSession 只管理现有 MicrophoneCapture 电平测试，main 继续提供原方法。owner 来自 IPC sender，operationId 随 start/stop/result/state 传递；旧无参数 stop 仅影响该 sender 当前任务。待授权期间 stop、owner destroyed 或会议启动均同步使请求失效，权限迟到不能构造捕获；会议只等待已有捕获的实际 destroy，不等待旧授权结果。

指定设备失败时先 await 原捕获 destroy，再打开 default，返回 actualDeviceId/usedDefaultFallback。捕获 error 发送仅含代次与错误码的 failed 事件，不发送录音或原始错误。SettingsOverlay 同步处理失败/回退、订阅状态并按 operationId 清理，迟到结果不再更新已离开的页面；保留既有设置页音频功能。

### 测试与执行证据

改动前基线（退出码 0，78 项通过、0 失败、0 跳过）：

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/AdaptivePreloadManager.test.mjs electron/services/__tests__/LocalSttWorkerPool.test.mjs electron/services/__tests__/LocalSenseVoiceModelDownloader.test.mjs electron/services/__tests__/CodexCliService.test.mjs electron/services/__tests__/ScopeLocalFallback.test.mjs electron/services/__tests__/MeetingStartReliability.test.mjs electron/services/__tests__/SettingsAudioFallbackNotice.test.mjs
```

新增 OnboardingSpeechValidation、OnboardingAiValidation、OnboardingAudioTestLifecycle 均先运行失败，确认缺少对应能力；随后执行最小实现及回归。另先复现并修正 Storage 删除绕过资源检查、旧 worker 退出覆盖新下载、AUC 200 业务失败误通过、历史不支持服务误提示重复保存，以及凭据版本保存失败误分类为网络错误。服务测试使用实际池/lease，接线测试通过 TypeScript AST 执行真实 main/IPC 方法、实际构建出的 preload 与实际设置页 effect，未复制业务判断。

最终代码命令：

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/Onboarding*.test.mjs electron/services/__tests__/AdaptivePreloadManager.test.mjs electron/services/__tests__/LocalSttWorkerPool.test.mjs electron/services/__tests__/LocalSenseVoiceModelDownloader.test.mjs electron/services/__tests__/CodexCliService.test.mjs electron/services/__tests__/ScopeLocalFallback.test.mjs electron/services/__tests__/MeetingStartReliability.test.mjs electron/services/__tests__/SettingsAudioFallbackNotice.test.mjs electron/services/__tests__/StorageUsageService.test.mjs electron/services/__tests__/StorageUsageIpcUi.contract.test.mjs electron/services/__tests__/MeetingPreparationDictation.contract.test.mjs electron/services/__tests__/LocalSenseVoiceSettingsIpc.test.mjs electron/services/__tests__/DoubaoNetworkErrorIpcWiring.test.mjs electron/services/__tests__/CredentialsManager.test.mjs
npm run typecheck:electron
npx tsc --noEmit
git diff --check
```

结果：构建、两项 TypeScript 检查和 diff 检查退出码均为 0；测试 discovered/executed/passed 均为 **229**，failed/skipped/cancelled 均为 0。ScopeLocalFallback 的 punycode 弃用提示沿用基线；故障注入日志不代表隐藏失败。

本批未执行完整 npm test、Playwright、发行包/真机音频、真实模型加载或真实云服务请求；没有模型下载、麦克风录制、提交或推送。本节记录的 T04–T06 批次结束时，T07–T13 未执行，完整引导 IPC、UI 与首次会议门禁尚未启用（后续 T07–T09 进度见第 9 节）；真机与账号验收仍由 T13 记录，不能用当前离线测试代替。


## 9. T07–T09 执行记录（2026-10-27）

本节记录 T07–T09 批次结束时的情况：保留当前 checkout 的 T01–T06 与其他已有改动；该批次未提交、推送，T10–T13 当时未执行。后续 T10–T12 进度见第 10 节。

### 9.1 实际交付

- **T07：** 接通四项引导 IPC 与状态/导航事件；按原生 webContents 身份校验角色并拒绝子 frame，不信任 URL 或 renderer 自报 owner。Launcher 的设备投影由主进程重新枚举，Settings/Overlay 无法替换。重复注册替换订阅，导航等待 Launcher 在订阅后 get 的握手；初始化中的打开请求会排队，不能被默认首页覆盖。
- **T07：** `OnboardingReadiness.ts` 独立读取权限、设备及当前语音配置，单项失败保留其他行。无授权请求、录音、模型加载或联网；开发态静态 granted 不成为运行验证。发行态 macOS 授权恢复会撤销旧受限确认，但系统音频仍为 pending_runtime，不宣称实际捕获成功。
- **T07：** 同一 `_meetingStartInFlight` 在首个 await 前占锁，保护刷新、首次门禁及原启动流程；直接 IPC 无法绕过，active 复用原会话。真实 entered、音频启动、非空本代次 transcript 分开记录；synthetic 只更新瞬时状态，不写历史里程碑。旧代次与失败后的迟到事件不提升状态，结束清瞬时状态。进度写盘失败保留实际会议状态；未知未来 schema 不重写文件、不阻断原会议路径。
- **T08：** 增加固定场景、fresh/existing 选项和同 userData 真正重启 helper；旧用户证据在 renderer 初始化前写入隔离目录。保持原离线网络/文件边界，fresh 不写旧欢迎标记。fixture 仅在非 packaged、ELECTRON_E2E 和显式 fixture 开关三条件同时满足时启用，无任意状态 IPC；共享固定场景与可前进的测试时钟，时钟仅注入测试进程的进度/回执时间，不改变应用全局计时器。构建扫描原本排除 test 目录，故仅为 development 增加固定 fixture 入口，package 入口不变；生产开关拒绝有行为测试。
- **T09：** 交付 P0 欢迎、P1 概览、P6 首页继续卡与步骤壳。先订阅后读取，明确初始化、读写失败重试、未知版本诊断与旧 revision 丢弃。欢迎页保留品牌、条款和本地素材；概览区分未配置/已配置待验证、证据深度与时间，不自动测试。稍后继续先确认保存成功；收起卡片仅本地展示，重启恢复。
- **T09：** 常规设置顶部及现有会议失败提示可重开引导；fresh 接管旧自动权限/模式/画像提示，existing 仅打开向导时抑制。dirty guard 提供保存/放弃/留在此页，保存失败或异常不离开；保存期间禁止重复处理，对话框约束 Tab、Escape 与焦点恢复，不把密钥放入 hook 状态。实际配置表单接入及其端到端保存测试留 T10/T11。

在 T09 批次结束时，permissions/speech/ai 步骤仅复用只读准备摘要和已有设置入口，ready 仅复用汇总；没有伪造配置表单、成功状态或会议按钮。T10/T11 负责具体配置页，T12 负责 P5 开始真实会议与 P7 轻提示；T09 通过不表示这些页面已交付。第一场会议继续走既有 `startMeeting`，没有新增试用功能。

### 9.2 自动化证据

最终代码运行以下构建与定向测试（Electron-run Node 同时执行静态 UI 内容测试）：

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/Onboarding*.test.mjs electron/services/__tests__/MeetingStartReliability.test.mjs electron/services/__tests__/MacTccRepairFlow.test.mjs electron/services/__tests__/MacTccRepairSafety.test.mjs src/components/__tests__/StartupSequenceContent.test.mjs src/components/__tests__/LauncherOnboardingContent.test.mjs
npm run typecheck:electron
npx tsc --noEmit
npm run test:e2e -- tests/e2e/onboarding.spec.ts tests/e2e/basic-smoke.spec.ts
npm run test:e2e -- tests/e2e/onboarding.spec.ts
git diff --check
```

- 构建通过；定向 Node 测试 **151 discovered / 151 executed / 151 passed / 0 failed / 0 skipped**，覆盖现有 T01–T06 引导测试及 T07–T09、启动可靠性和 TCC 回归。
- 两项类型检查通过。
- 实际 Electron 合并运行 **17 discovered / 17 executed / 17 passed / 0 failed / 0 skipped**（onboarding 9 项、basic-smoke 8 项），没有以 CI 跳过替代执行。初始化竞态及对话框补强后，完整 onboarding 文件复跑 **9/9 通过**。
- 红灯阶段确认过缺失 IPC/事实、P0 UI、初始化导航竞态和权限恢复确认问题；修复后通过。Electron 揭示常规设置入口误放入更新中分支，已移到常规设置顶部并复验。两条旧 TCC 源码位置断言改成执行实际权限 reader/提示 effect，保留“不在启动触发授权探测”的行为验证。

### 9.3 UI 检查与剩余范围

已查看本地截图：`.tmp/onboarding-t09-welcome-light.png`、`.tmp/onboarding-t09-overview-light.png`（1200×800 亮色），`.tmp/onboarding-t09-overview-600x400.png`（暗色、reduced-motion）。600×400 内容区滚动，页脚与主按钮位于窗口内，键盘可进入下一步骤；截图仅覆盖本批交付页面，不代替所有后续页面检查。

本批未运行完整 `npm test`、真实原生录音、模型下载/加载、真实云服务请求或跨平台发行包验收。该批次结束时 T10–T13 仍未执行（后续进度见第 10 节），真实权限/设备/会议转写与账号证据继续由后续任务及 T13 验收记录；当前通过结果不能据此宣称完整首次引导已交付。

## 10. T10–T12 执行记录（2026-10-27）

本批仅实施 T10–T12；沿用现有 checkout，保留 T01–T09 和其他已有改动，没有提交或推送。T13 保持未执行；本节不替代发行包及真实服务验收。

### 10.1 实际交付与接口调整

- **T10 / P2：** 新增 `PermissionsStep.tsx`，复用权限读取、麦克风请求、设备枚举、系统设置和电平接口。设备明确保存到原 `preferredInputDeviceId`/`preferredOutputDeviceId`，摘要和原启动回调继续携带这些选择。默认回退显示实际设备并要求用户主动改用；切设备、离页、退出或开始会议清理电平代次，不记录音频。授权拒绝、restricted、回焦刷新、设备缺失和系统音频受限都有对应说明；macOS 设置与疑似失效时的确认修复入口按平台显示，Windows 不出现 macOS 链接。
- **T10 / P3：** 新增 `SpeechStep.tsx`，默认推荐 SenseVoice，但不自动切服务、保存、下载或验证。模型名称/大小/文件状态来自既有目录；下载进度来自主进程快照。显式下载完成后才对同 provider、同配置 revision 的模型加载验证；SenseVoice 与历史 Whisper 分别使用原下载接口，切到 AI 后继续下载与接收完成事件，已变配置不签旧回执。损坏模型可确认替换，实际 busy/资源释放继续由原模型管理负责。历史 Whisper 保留并可选择全局模型；已有每通道覆盖保持原样，不在引导增加高级配置表。
- **T10 / 云 STT：** 复用安全凭据 setter，保存成功后清空输入，再刷新并验证保存值。支持已保存的历史服务；不支持在本表单编辑的认证方式提供原设置入口。明确告知原始音频发送与内置验证样本；credential_access 仅显示凭据访问深度，不当作真实识别。语言、下载、模型加载、鉴权、网络、不支持与 busy 的错误分开呈现。QCLOUD 原 setter 默认有保存前联网检测，本批仅为引导增加 `deferValidation: true` 可选参数，使其先保存再走统一验证；原设置默认检测顺序保持不变，且引导不把 QCLOUD 自动选为 AI 默认服务。
- **T11 / P4：** 新增 `AiServiceStep.tsx`。当前服务优先，默认模型复用 `modelUtils` 常量；明确显示未配置、已保存未验证、本次模型响应通过与历史验证。密钥不回填、不进入 hook/普通 settings/localStorage，安全保存成功后清空；失败保持输入和当前页面。Codex 显示路径、模型、程序检测与推理验证两项状态；不支持隔离仍走 unsupported_check，不宣称程序存在代表登录或推理成功。无适配的历史服务保留并提供原设置/支持服务出口。
- **T11 / scope 与 P4a：** 沿用全局 transcript 策略，缺省按“沿用当前策略（允许）”显示，只有明确修改才以原 setter 的 patch 模式写入；不覆盖其他 scope，不混淆云 STT 原始音频。开通说明仅使用方案已有固定 HTTPS 官方目标；原 openExternal 白名单补齐这 3 个精确目标，非法协议、路径、附加 query/fragment 不获放行，不读取剪贴板、自动检测账号开通或自动验证。子页保持 AI 主步骤，返回按钮可键盘访问；原设置打开前也经过 dirty guard，原设置关闭后重新读取并恢复原步骤。
- **T12 / P5：** 准备摘要复用同一行布局，显示模型、证据深度/时间、设备及实际保留策略；保留策略有修改入口和变更订阅。只有完整准备判定通过才渲染“开始会议”，下载中只显示“继续配置”。按钮调用原 `App.handleStartMeeting`，保留原 audio metadata、retention、窗口和数据流程。App、Launcher、MeetingPreparationPage 的调用契约统一为 `Promise<MeetingStartResult>`，显式检查 `result.success`，失败对象不再被 truthy 判断当作成功；UI 重复点击锁与主进程原 single-flight 共同生效；已有会议即使当前回执被其他窗口失效，仍可返回原会话，不把恢复当前会话当作新会议阻塞。
- **T12 / P6/P7：** 新增 `FirstMeetingHint.tsx`，Overlay 先订阅后读取，按 revision 拒绝旧广播/旧返回。进入、音频初始化完成及本场转写分开显示，connected 不产生转写证据。转写与回答提示独立关闭，不强制打开转写、不自动生成回答；实际错误条优先，并提供对应权限/设备或语音设置入口。原异步音频失败清理抽出 `handleMeetingAudioStartupFailure` 共享执行点，保留实际清理/窗口流程和代次检查；失败返回首页修复卡，重新进入配置后刷新不会把恢复页再次关闭。历史 entered 不掩盖本次失败，新的失败也不会被此前收起卡片隐藏。

`saveAndValidateOnboarding` 仅统一保存→清空明文→读取当前 revision→验证的顺序；没有新增 provider、录音流程或会议引擎。`set-provider-preferred-model` 原来会吞掉保存异常，本批改为返回 success/error，并补齐 preload/renderer 的返回类型、豆包 LLM setter 与既有 Whisper setter 的 renderer 类型。

### 10.2 测试证据

按失败用例推进并实际复验了保存/验证顺序、原接口吞错与 QCLOUD 保存前检测、下载失败重试、恢复页被重复失败快照关闭、原设置绕开 dirty guard、旧音频错误文案与新增入口共存等边界。测试只使用隔离配置、假设备/权限/模型/服务执行器与固定脚本；没有新增生产状态注入 IPC。

最终命令（仓库根目录）：

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/Onboarding*.test.mjs electron/services/__tests__/MeetingStartReliability.test.mjs electron/services/__tests__/MacTccRepairFlow.test.mjs electron/services/__tests__/MacTccRepairSafety.test.mjs electron/services/__tests__/CodexCliService.test.mjs electron/services/__tests__/ScopeLocalFallback.test.mjs electron/services/__tests__/QCloudApiSettings.test.mjs electron/services/__tests__/LocalSenseVoiceSettingsIpc.test.mjs electron/services/__tests__/LocalSenseVoiceModelManager.test.mjs electron/services/__tests__/LocalSenseVoiceModelDownloader.test.mjs src/components/__tests__/StartupSequenceContent.test.mjs src/components/__tests__/LauncherOnboardingContent.test.mjs src/components/__tests__/SettingsAudioFallbackNotice.test.mjs src/components/__tests__/LocalSenseVoiceModelPanel.test.mjs
npm run typecheck:electron
npx tsc --noEmit
npm run test:e2e -- tests/e2e/onboarding.spec.ts tests/e2e/onboarding-meeting.spec.ts tests/e2e/basic-smoke.spec.ts tests/e2e/meeting-start-overlay-reliability.spec.ts tests/e2e/meeting-audio-recovery.spec.ts
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/ExternalUrlIpc.test.mjs
git diff --check
```

- 构建成功；定向 Node **243 discovered / 243 executed / 243 passed / 0 failed / 0 skipped**，包含 T03–T07 的服务层、原设置模型/音频回退与 QCLOUD 回归。
- 两项类型检查通过；diff 检查通过。既有 ExternalUrlIpc.test.mjs 另跑 2/2 通过，合计 245 项定向/回归测试。
- 最终 Electron 联合回归 **42 discovered / 42 executed / 42 passed / 0 failed / 0 skipped**：onboarding 25 项、onboarding-meeting 6 项、basic smoke 8 项、原启动可靠性 2 项、原音频恢复 1 项。
- 中间轮次有错误条 DOM 兼容、外链被既有白名单拦截及 active 会话误被新准备检查阻塞的失败，均修正并复验。另一次运行发生 firstWindow 启动超时；该场景此前及最终联合运行均通过，保留此记录供 T13 观察，未用 skip/自动重试计为通过。
- 新增 `OnboardingForms.test.mjs` 验证保存失败零验证、成功清空后按当前 revision 验证，以及 QCLOUD 新旧调用顺序及官方外链的精确白名单；`OnboardingMeetingUi.test.mjs` 执行实际 Launcher handler 与实际音频失败清理方法，验证失败对象不会误记成功、旧会话失败不会清理新会话。
- E2E 覆盖 P2 拒绝/回焦/设备消失/实际回退/离页停止，P3 加载失败/下载错误/完成后验证/云 STT 深度/语言不兼容/历史 Whisper，P4 保存失败留页/验证失败仍已保存/dirty 三动作/原设置返回/开通返回不自动验证/scope/Codex，P5/P7 原会议入口/并发/active 复用/busy/异步失败/P5 保存失败/提示独立/双 webContents 旧广播/重启历史回执/下载中跨页。

### 10.3 UI 检查与验收边界

E2E 对 P2、P3、P4、P4a、P5 运行 1200×800 亮色和 600×400 暗色/reduced-motion 检查；等待目标步骤与保存状态稳定后截图，避免截到上一步。步骤页脚边界、滚动区域和开通返回的键盘焦点有实际断言。

已查看截图：`.tmp/onboarding-t10-t12-{permissions,speech,ai,ready}-{1200-light,600-dark}.png`、`.tmp/onboarding-t11-provisioning-{1200-light,600-dark}.png`。这些是隔离 fixture 画面，其中服务名和固定历史时间仅用于测试；另查看 `.tmp/onboarding-t12-first-meeting.png` 的 Overlay 首次提示。

本批未执行完整 `npm test`、真实账号/云推理、模型真实下载/加载、原生录音或 macOS/Windows 发行包验收。Electron 的音频启动/转写脚本均为 synthetic，只验证 UI 与瞬时状态，不写真实 firstMeetingEnteredAt/firstTranscriptReceivedAt；非 synthetic 事实另由 T07 服务测试覆盖，T13 仍须用真实会话确认。本期没有新增独立“试用”功能；从准备页进入的仍是原真实会议。


## 11. 引导名称调整（2026-10-27）

用户反馈引导中的“会议准备”与已有会议准备功能容易混淆。本次仅调整首次使用引导文案，历史执行记录保留当时名称；当前 UI 命名以本节为准。

| 位置 | 新文案 |
|---|---|
| 引导、设置重开入口 | 初始设置 |
| 欢迎页标题 / 主按钮 | 先完成初始设置，再开始第一场会议 / 开始设置 |
| 第一步 / 完成汇总页 | 设置概览 / 设置检查 |
| 首页继续入口 / 收起操作 | 继续设置 / 收起设置提示 |
| 未完成提示 | 还需完成 X 项设置 |
| 语音页标题 / 失败恢复入口 | 设置语音识别 / 返回设置 |

原会议准备页面、IPC、持久化字段、配置判定与会议行为不变。“我已准备好”等普通描述继续保留。同步更新产品方案与现有内容/E2E 断言，不增加新测试框架或改名数据结构。

验证：既有内容测试 9/9 通过；onboarding 与 onboarding-meeting 的实际 Electron 回归 31/31 通过，0 失败、0 跳过；`npx tsc --noEmit` 与 `git diff --check` 通过。命令为 `node --test src/components/__tests__/StartupSequenceContent.test.mjs src/components/__tests__/LauncherOnboardingContent.test.mjs` 和 `npm run test:e2e -- tests/e2e/onboarding.spec.ts tests/e2e/onboarding-meeting.spec.ts`。


## 12. T13 执行与未完成验收（2026-10-27）

结论为“功能实现完成，发行验收未完成”，不是 T13 全部通过。完整证据、失败修复、53 张截图索引与未执行项目保存在 [T13 验收报告](../qa/2026-10-27-first-run-onboarding-acceptance.md)。

- `npm test` 首轮 3382 项中 20 项失败；核查后修复与新接线失配的测试提取 harness/源码定位及 IPC contract，未排除测试或添加 skip。最终完整复跑 **3382 executed / 3382 passed / 0 failed / 0 skipped**。
- 原 UI 内容测试另跑 **9/9** 通过。两项类型检查、Electron 生产编译、Renderer 生产编译与 `git diff --check` 通过。生产编译 8 个入口不含 onboarding fixture，输出目录无 fixture 文件，main 没有打入 fixture 实现；恢复开发产物后再运行最终 Electron 回归。
- 最终 Electron 联合回归 **50 discovered / 50 executed / 50 passed / 0 failed / 0 skipped**；其中原 42 项和新增 T13 的 8 项均实际执行，basic smoke 未因 CI 跳过。完整命令在报告中列出。
- UI 覆盖 P0–P7、P4a 的 1200×800/600×400 × 亮/暗四组合，以及错误、下载与未保存状态；53 张 PNG 的实际尺寸和 SHA-256 记录在 `docs/qa/assets/2026-10-27-first-run-onboarding/manifest.json`。纯 Tab/Enter 的设置→原会议→关闭提示→结束流程、Escape 保留输入及错误字段焦点通过。此项勾选仅代表开发态 UI 证据，发行态原生窗口 hit-test/TCC 仍按报告未执行项处理。
- 新增验收用例发现并修复：空 AI/语音密钥不应保存或调用验证；模型/程序路径为空时聚焦对应输入；结束会议按钮补可访问名称。没有添加录音/STT 试用功能，也没有改变原会议回调。

**SEC-01 已接受风险（非阻断）：** `CredentialsManager.saveCredentials(candidate)` 实际仍把 JSON 明文写入 `credentials.enc`，没有 safeStorage 加密。0600、原子 rename 和 `.enc` 扩展名不能证明加密。此前“安全存储”的表述不准确；T03 的已完成内容是原子写入、版本/回执失效，不包含凭据加密。用户后续明确要求“凭据仍明文存储，不要成为阻断”，本报告据此将该项改为已接受的非阻断风险。本轮没有修改存储格式、迁移或读取真实凭据；风险接受不代表已实现加密，也不把功能/格式诊断测试当作加密验证通过。未来加密迁移可单独安排，不作为本轮发布前置条件。

**仍未验收：** 当前源码签名/安装包的权限拒绝→设置→回焦→重启、真实系统音频捕获、macOS x64 和 Windows x64、本地模型真实加载、专用账号豆包模型响应、Codex 支持版本隔离认证、真实 STT/会议转写与回答、发行态回执/升级/失败恢复。当前目录仅有旧 2.7.0 arm64 包，且包中没有初始设置 IPC，不能替代本次验收。具体原因逐项写入报告，未记成通过。

没有提交、推送、部署或安装发行包；保留其他既有工作区改动。


## 13. SEC-01 风险接受决定（2026-10-27）

用户明确决定凭据明文存储不作为阻断，覆盖此前“先记录为阻断”的处置。SEC-01 当前状态为“已接受的已知风险、非发布阻断”，不更改存储实现，不实施迁移；实际仍为明文 JSON，不能标注为已加密。

已同步产品方案、验收报告、证据 manifest 和格式诊断测试名称。`releaseReady` 仍为 false，原因仅为已列出的真机、真实服务及当前发行包验收尚未执行，不再把 SEC-01 列入 blockers。T13 未执行项保持原状态。


## 14. 发布后 Apple Silicon 实机验收（2026-10-27）

已按用户要求下载正式 2.7.18 ARM64 DMG，核对 GitHub digest 并安装到 `/Applications/CueUp.app`；旧 2.7.16 应用保留备份。验收使用独立 fresh userData 和真实发行包，不启用 fixture。

- 实际通过：安装版本/架构/签名完整性、权限与设备页面、电平检查启动/停止、真实 SenseVoice 下载/跨页继续/加载、AI 空密钥焦点、开通说明、未保存修改确认、稍后继续、缺失 AI 时两处会议门禁、真实重启持久化与历史回执。电平值为 0，不能由此推导真实采音或识别质量通过。
- **实际失败 DEVICE-01 / P1**：点击“开始设置”后欢迎层不退场，约 22 秒仍显示 disabled“正在读取…”，后方设置概览已挂载；退出重开才能看见后续流程。仅记录与定位，未修改产品代码。
- 仍未执行：全新设备 TCC、实际有声采集/转写、系统音频、专用真实 AI 账号、完整首次会议、其他架构与暗色/窄屏发行态组合。T13 保持部分验收，不能全量勾选。

详细步骤、工具过渡实例边界、15 张真实截图与缺口见[本机发行包验收](../qa/2026-10-27-first-run-onboarding-device-acceptance.md)。SEC-01 仍为用户已接受的非阻断风险，与本次 DEVICE-01 流程失败独立。


## 15. DEVICE-01 欢迎页不退场修复

状态：源码已修复，production 冷启动回归、本地重新打包的 ARM64 原生坐标点击复验通过；尚未发布修复版本。T13 的其他真实账号、音频和平台缺口保留，不据此全量勾选。

- 根因：欢迎退出动画和后续 React.lazy 主界面共用外层 Suspense，首次挂起使欢迎退出生命周期中断；主界面已经进入概览时，旧欢迎层仍在。
- 实现：`src/App.tsx` 主界面 motion 分支内增加独立 Suspense，仅隔离其 lazy 挂起，保留动画，不增加延时或网络预热。
- 回归：新增 `tests/e2e/onboarding-production.spec.ts`、`playwright.production.config.ts`、fixture 的 rendererMode 选项和 `npm run test:e2e:production`；覆盖 file:// 生产分块冷启动的默认/减少动态效果、欢迎 DOM 真正移除、主按钮像素命中和正常点击后续路径。旧欢迎用例补齐移除断言。
- 结果：未修复 2/2 失败；修复后 production 2/2、原五份 Electron 回归最终 50/50、内容测试 9/9、两套类型检查和生产构建通过。本地 ARM64 目录包签名完整性通过，真实欢迎→概览→权限→首页通过。首轮原套件 49/50 的启动超时及 1/1 单项复跑结果如实保留。
- 验收与四张真实候选包截图见[DEVICE-01 修复记录](../qa/2026-10-27-first-run-onboarding-device-acceptance.md#device-01-根因修复与回归复验)。未替换公开 2.7.18 或 `/Applications` 安装。


## 16. DEVICE-01 修复发布为 2.7.19

2026-10-28 用户授权远程构建 Apple Silicon、Intel Mac、Windows x64 并正式发布。版本升级为 2.7.19，采用仓库现有 draft 汇总流程，在核对同一提交、平台成功结果和完整附件后公开。实际执行及最终发布状态见[2.7.19 发布记录](../testing/2.7.19-build-release.md)。历史 2.7.18 失败与本地候选验证保持原始范围，未执行的人工验收和 SEC-01 已接受风险状态不变。


2.7.19 发布结果：三平台在 `8dee78b7fa07c7432c54bea51a5c16a8b1d4e9e5` 构建全部 success，14 个附件及更新文件核对完成，六个主要公开下载地址返回 200。已正式发布 [CueUp 2.7.19](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/tag/v2.7.19-sha-8dee78b) 并设为 Latest；发布记录和附件清单已保存。其他 T13 人工验收仍不勾选。
