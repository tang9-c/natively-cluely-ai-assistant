# Audio Fixtures

测试用音频文件存放目录。**注意:本目录已被 `.gitignore` 排除**,不进入版本控制。

## 为什么 gitignored

- 包含真实对话(隐私考虑)
- 文件体积较大(1.8MB / 60秒)

## 现有 fixture

### `real-conversation-2p-60s.wav`

| 属性 | 值 |
|------|-----|
| 时长 | 60 秒(从 60s 截取至 120s) |
| 采样率 | 16 kHz |
| 通道 | mono |
| 编码 | PCM 16-bit little-endian |
| 大小 | 1.8 MB |
| 说话人 | 2 人真实对话 |
| 语言 | 中文(普通话) |
| 主题 | 电信运营商签约(贵州/云南移动) |

**验证过的 Doubao AUC 输出**(作为 baseline):
- Speaker distribution: `{ '1': 1, '2': 1 }`
- Utterances: 2
- 查询耗时: 8 次轮询(~10-15 秒)
- 说话人 1: 40-28600ms(贵州签约情况询问)
- 说话人 2: 30510-59950ms(因为疫情未完全复工回复)

## 如何获取

该文件来源于 **Mandarin Chinese Conversational Speech Corpus (Web Meeting)** 数据集。

具体源文件:
```
20200327_2P_lenovo_xiaomi8_69301.wav
```

从原始 8kHz mono WAV(总时长约 30 分钟)截取 60 秒并重采样:

```bash
# 1. 下载数据集(需有访问权限)
# 2. 放置原始文件到 ~/Downloads/
SOURCE=~/Downloads/Mandarin_Chinese_Conversational_Speech_Corpus_Web_Meeting/WAV/20200327_2P_lenovo_xiaomi8_69301.wav

# 3. 截取 + 转码
ffmpeg -ss 60 -i "$SOURCE" \
  -t 60 -acodec pcm_s16le -ar 16000 -ac 1 \
  tests/fixtures/audio/real-conversation-2p-60s.wav
```

## 使用

```bash
# 直接用 fixture(无需传路径)
DOUBAO_API_KEY=your-key npm run test:doubao-auc:real

# 指定 fixture + 中文
DOUBAO_API_KEY=your-key \
  npm run test:doubao-auc:real -- --language zh-CN

# 使用其他音频文件
DOUBAO_API_KEY=your-key \
  npm run test:doubao-auc:real -- /path/to/your/audio.wav
```

## 添加新 fixture 的建议

1. **优先使用真实对话语料**(比 TTS 合成语音更接近实际场景)
2. **格式**: 16 kHz mono PCM 16-bit WAV(ASR 行业标准)
3. **时长**: 30-120 秒足够测试,过长会拖慢轮询
4. **多说话人**: 2-4 人最优(太少测不出分离能力,太多增加复杂度)
5. **命名规范**: `<场景>-<人数>p-<时长>s.wav`,例如:
   - `meeting-3p-90s.wav`
   - `interview-2p-120s.wav`
   - `lecture-1p-60s.wav`
6. **必须更新本 README**,记录 fixture 的元数据和验证结果