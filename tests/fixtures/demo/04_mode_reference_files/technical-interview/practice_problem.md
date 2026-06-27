# Practice Problem — LRU Cache + 并发扩展

> **Scenario DocSubtype**: `practice-problem`
> **场景模式**: Technical Interview
> **用途**:Master transcript 段 2 中面试官说"写一下代码"时,Natively 应基于本练习题给出脚手架或边界 case 提示。

---

## 题目描述

实现一个 **LRU(Least Recently Used)缓存**,支持 `get` 和 `put` 两个操作,时间复杂度均为 O(1)。

```
LRUCache(int capacity): 初始化,设置缓存容量
int get(int key): 如果 key 存在,返回值并标记为最近使用;否则返回 -1
void put(int key, int value): 如果 key 存在,更新值并标记为最近使用;否则插入。容量满时淘汰最久未使用的 key
```

## 示例

```python
cache = LRUCache(2)
cache.put(1, 1)
cache.put(2, 2)
cache.get(1)       # 返回 1
cache.put(3, 3)    # 淘汰 key 2
cache.get(2)       # 返回 -1
cache.put(4, 4)    # 淘汰 key 1
cache.get(1)       # 返回 -1
cache.get(3)       # 返回 3
cache.get(4)       # 返回 4
```

## 标准答案(双向链表 + 哈希表)

```python
class DLinkedNode:
    def __init__(self, key=0, value=0):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None


class LRUCache:
    def __init__(self, capacity: int):
        self.cache = {}  # key -> node
        self.capacity = capacity
        # 哨兵节点,避免边界判断
        self.head = DLinkedNode()
        self.tail = DLinkedNode()
        self.head.next = self.tail
        self.tail.prev = self.head

    def _add_to_head(self, node):
        node.prev = self.head
        node.next = self.head.next
        self.head.next.prev = node
        self.head.next = node

    def _remove_node(self, node):
        node.prev.next = node.next
        node.next.prev = node.prev

    def _move_to_head(self, node):
        self._remove_node(node)
        self._add_to_head(node)

    def _pop_tail(self):
        node = self.tail.prev
        self._remove_node(node)
        return node

    def get(self, key: int) -> int:
        if key not in self.cache:
            return -1
        node = self.cache[key]
        self._move_to_head(node)
        return node.value

    def put(self, key: int, value: int) -> None:
        if key in self.cache:
            node = self.cache[key]
            node.value = value
            self._move_to_head(node)
        else:
            if len(self.cache) == self.capacity:
                removed = self._pop_tail()
                del self.cache[removed.key]
            new_node = DLinkedNode(key, value)
            self.cache[key] = new_node
            self._add_to_head(new_node)
```

## 边界 Case 列表(测试用例)

| Case | 输入 | 期望 |
|---|---|---|
| 容量为 0 | `LRUCache(0).put(1,1)` | 不报错,get(1) 返回 -1 |
| 容量为 1,反复 put | `put(1,1), put(2,2), get(1)` | get(1) 返回 -1 |
| 重复 put 同一个 key | `put(1,1), put(1,2), get(1)` | 返回 2 |
| get 不存在的 key | `get(99)` | 返回 -1 |
| LRU 顺序正确 | 多次 get 后,最近 get 的应该在 head | 验证链表顺序 |

## 扩展题(加分项)

### 扩展 1:并发安全

如果多线程同时调用 `get` 和 `put`,如何保证一致?

**方案对比**

| 方案 | 优点 | 缺点 |
|---|---|---|
| 全局读写锁 | 简单 | 性能差 |
| 分段锁 | 性能好 | 实现复杂 |
| 无锁(CAS) | 性能最好 | 实现极复杂 |
| sync 包(Language-level) | 代码简洁 | 依赖运行时 |

**推荐答案**:用读写锁,`get` 加读锁(可并发),`put` 加写锁(独占)。

```python
import threading

class LRUCacheConcurrent:
    def __init__(self, capacity: int):
        self.cache = {}
        self.capacity = capacity
        self.lock = threading.RWLock()
        # ... 双向链表同上

    def get(self, key):
        with self.lock.read():
            if key not in self.cache:
                return -1
            node = self.cache[key]
            # _move_to_head 需要写锁!
            with self.lock.write():
                self._move_to_head(node)
            return node.value
```

### 扩展 2:TTL 支持

为每个 key 加过期时间,get 时检查是否过期。

### 扩展 3:分布式 LRU

多个节点协同淘汰,常见的做法:
- Redis:用 sorted set + 时间戳
- Memcached:LRU 是内置的
- 自研:中心化协调器 + gossip 协议

## Natively 应提供的实时辅助

### 当候选人开始写代码时

> "建议提示候选人:
> 1. 双向链表节点的 prev/next 引用,边界 case 怎么处理?
> 2. 哨兵节点的好处(避免 head/tail 为空时的判断)
> 3. get 操作的副作用:把节点移到 head 是必要的吗?"

### 当候选人写完基础版本时

> "扩展追问:
> - 如果容量是 0 怎么办?(LRUCache(0) 行为?)
> - 如果重复 put 同一个 key?(应更新值并移动到 head)
> - 并发场景如何处理?(读写锁 / 分段锁 / 无锁)"

---

## 关联材料

- 技术规格:`./technical_spec.md`
- 评分卡:`./rubric.md`