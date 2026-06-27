# Technical Spec — Datacraft 系统设计题

> **Scenario DocSubtype**: `technical-spec`
> **场景模式**: Technical Interview
> **用途**:Master transcript 段 2 中面试官说"为什么选 PostgreSQL 而不是 Cassandra"时,Natively 应基于本规格给出深度技术回答。

---

## 系统设计题

### 题目:设计一个短链生成器(bit.ly 克隆)

**功能需求**

1. 用户输入长 URL,系统返回短链(如 `https://short.ly/abc123`)
2. 访问短链自动 302 跳转到原 URL
3. 支持自定义短链
4. 提供点击量统计

**非功能需求**

| 指标 | 目标 |
|---|---|
| 峰值 QPS | 100,000 写 + 1,000,000 读 |
| 平均延迟 | 读 < 10ms,写 < 50ms |
| 可用性 | 99.99% |
| 数据保留 | 永久(用户不主动删除) |
| 全球部署 | 至少 3 个大区(美东/美西/欧盟) |

**容量估算**

- 长 URL 平均长度 200 bytes
- 短码长度 7 字符(62^7 ≈ 3.5 万亿,够用)
- 每年新增短链 100 亿条
- 存储:100B × 200B = 20TB/年
- 读 / 写比 = 10:1(热门短链)

## 评估维度

| 维度 | 关键问题 |
|---|---|
| **可扩展性** | 如何支持 100K QPS 写、1M QPS 读?分库分表策略? |
| **容错性** | 单个机房故障如何应对?数据如何备份? |
| **延迟** | 全球用户访问,如何保证 < 10ms? |
| **数据模型** | 短码生成策略(发号器 vs 哈希 vs 自增)? |
| **安全性** | 如何防止恶意短链(钓鱼/垃圾)? |

## 短码生成策略对比

### 1. 哈希(MD5/SHA-1 取前 7 字符)

**优点**:无状态,简单
**缺点**:碰撞概率高(生日悖论),需要重试或加盐

### 2. 自增 ID + Base62 编码

**优点**:无碰撞,可推算
**缺点**:发号器是单点(需要分布式发号器如 Snowflake)

### 3. 分布式发号器(Snowflake / Leaf)

**优点**:趋势递增,无碰撞
**缺点**:依赖时钟,跨机房需要协调

### 4. 预生成 + 缓存

**优点**:写入路径短,只用查缓存
**缺点**:预生成浪费(只用到一部分)

## 典型答案要点

### 短码生成

```python
# Snowflake 风格发号器
class Snowflake:
    def __init__(self, datacenter_id, worker_id):
        self.timestamp = 0
        self.sequence = 0
        self.datacenter_id = datacenter_id  # 5 bits
        self.worker_id = worker_id  # 5 bits
        self.sequence_bits = 12
        self.max_sequence = 4096

    def next_id(self):
        ts = int(time.time() * 1000)
        if ts == self.timestamp:
            self.sequence = (self.sequence + 1) & self.max_sequence
        else:
            self.sequence = 0
        self.timestamp = ts
        return ((ts - EPOCH) << 22) | (self.datacenter_id << 17) | (self.worker_id << 12) | self.sequence

# Base62 编码
def base62_encode(num):
    chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    result = []
    while num > 0:
        result.append(chars[num % 62])
        num //= 62
    return ''.join(reversed(result))
```

### 存储

- **写路径**:Snowflake → Base62 编码 → 写 Postgres 分片表
- **读路径**:Redis 缓存(热门短链)→ 回源 Postgres
- **分片策略**:按短码前缀分 64 个库,每个库分 16 张表

### 容灾

- **主备**:Postgres 同步复制 + Redis Sentinel
- **跨机房**:美东主,美西从(异步复制,延迟 100ms 可接受)
- **降级**:Redis 挂掉时直接读 Postgres(增加延迟但可用)

### 安全

- 黑名单:定期同步 Google Safe Browsing API
- 限频:同一 IP 写不超过 10 QPS
- 人工审核:被多次举报的短链进入审核队列

## Natively 应回答的样例

当用户(候选人)在面试中说"我们用 Postgres 单机分区表"时,Natively 应基于本规格追问:

> "100K QPS 写单机分区表会扛不住,你提到分区表是按 user_id 哈希,但短链服务通常是按短码前缀分,这点你考虑过吗?另外全球部署需要多机房同步,Postgres 的逻辑复制延迟你测过吗?"

---

## 关联材料

- 评分卡:`./rubric.md`
- 练习题:`./practice_problem.md`