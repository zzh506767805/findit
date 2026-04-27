# FindIt v2 — Agent 驱动方案

## 1. 产品定位

一个有记忆的家庭助手。拍照时它自己去了解你的家、对比历史、识别变化；问东西时它自己查库、看照片、给出精确回答。用户能看到它"思考"的全过程。

## 2. 核心体验

### 两个页面

| 页面 | 名称 | 核心功能 | 底部操作 |
|------|------|---------|---------|
| 助手 | 助手 | 对话式交互：拍照记录 + 问东西在哪 | 输入框 + 拍照按钮 |
| 空间 | 我的家 | 浏览已记录的空间/位置/容器/物品 | 拍照按钮 |

顶部 tab 切换，不用底部 tab。

### 助手页

```
┌──────────────────────────────┐
│  FindIt                  [⚙] │
│  ┌──────┐ ┌──────┐          │
│  │▪助手  │ │ 我的家│          │
│  └──────┘ └──────┘          │
├──────────────────────────────┤
│                              │
│  对话流区域                   │
│                              │
│  👤 [拍的照片]                │
│                              │
│  🤖 ┌─ Agent 工作流 ────────┐│
│     │ 🔍 查看已有空间...     ││
│     │ → 卧室、书房、厨房     ││
│     │ 🔍 查看卧室的位置...   ││
│     │ → 梳妆台、床上、窗边   ││
│     │ 🖼 查看梳妆台旧照片... ││
│     │ → [缩略图]            ││
│     │ 💭 对比新旧照片...     ││
│     └────────────────────────┘│
│                              │
│  🤖 这是卧室梳妆台。和上次   │
│     比，透明收纳盒里多了一瓶  │
│     香水，其他物品还在原位。  │
│                              │
│     📦 透明收纳盒            │
│        🆕 香水 · 方形玻璃瓶  │
│        ✅ 口红 · 眉笔 · 发圈 │
│     散放                     │
│        ✅ 纸巾包             │
│     ❓ 未发现                │
│        小剪刀（上次在这里）   │
│                              │
│     [确认保存]  [修改]       │
│                              │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                              │
│  👤 口红在哪                 │
│                              │
│  🤖 ┌─ Agent 工作流 ────────┐│
│     │ 🔍 搜索"口红"...      ││
│     │ → 找到 1 条记录        ││
│     │ 🖼 查看证据照片...     ││
│     └────────────────────────┘│
│                              │
│  🤖 口红在卧室梳妆台的透明   │
│     收纳盒里。照片右上角那个  │
│     粉色管状物就是。          │
│     ┌──────────────────┐     │
│     │  [证据照片]        │     │
│     └──────────────────┘     │
│     4月25日记录               │
│                              │
├──────────────────────────────┤
│ [📷] [帮我找...           🔍]│
└──────────────────────────────┘
```

### 我的家页

```
┌──────────────────────────────┐
│  FindIt                  [⚙] │
│  ┌──────┐ ┌──────┐          │
│  │ 助手  │ │▪我的家│          │
│  └──────┘ └──────┘          │
├──────────────────────────────┤
│                              │
│  🏠 3个空间 · 21件物品       │
│                              │
│  ┌────────────────────────┐  │
│  │ 卧室              12件 │  │
│  │ 梳妆台 · 床上 · 窗边椅子│  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ 书房               6件 │  │
│  │ 书桌 · 书架            │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ 厨房               3件 │  │
│  │ 冰箱 · 灶台旁          │  │
│  └────────────────────────┘  │
│                              │
├──────────────────────────────┤
│  [📷 拍照记录]               │
└──────────────────────────────┘
```

点进空间 → 位置详情：

```
┌──────────────────────────────┐
│  ← 卧室                12件 │
├──────────────────────────────┤
│                              │
│  梳妆台                      │
│  ┌────────────────────────┐  │
│  │      [照片大图]          │  │
│  └────────────────────────┘  │
│  📦 透明收纳盒               │
│     口红 · 眉笔 · 发圈 · 剪刀│
│  📦 黄色笔筒                 │
│     化妆刷                   │
│  散放：纸巾包                │
│  4月25日                     │
│                              │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─    │
│                              │
│  窗边椅子                    │
│  ┌────────────────────────┐  │
│  │      [照片大图]          │  │
│  └────────────────────────┘  │
│  散放：靠垫                  │
│  4月25日                     │
│                              │
├──────────────────────────────┤
│  [📷 拍这个房间]             │
└──────────────────────────────┘
```

### 空间页拍照

空间页底部"拍照记录"或"拍这个房间"点击后，进入拍照 → 照片直接送入 agent。识别过程以全屏卡片展示 agent 工作流：

```
┌──────────────────────────────┐
│  ← 识别中                    │
├──────────────────────────────┤
│                              │
│  ┌────────────────────────┐  │
│  │      [刚拍的照片]        │  │
│  └────────────────────────┘  │
│                              │
│  🔍 查看已有空间...          │
│     → 卧室、书房、厨房       │
│                              │
│  🔍 查看卧室的位置...        │  ← 逐步出现
│     → 梳妆台(8件)、床上(9件) │     流式展示
│                              │
│  🖼 查看梳妆台旧照片...      │
│     → [旧照片缩略图]         │
│                              │
│  💭 对比新旧照片...          │
│                              │
│  ✅ 识别完成                 │
│                              │
│  位置：卧室 / 梳妆台         │
│                              │
│  📦 透明收纳盒               │
│     🆕 香水                  │
│     ✅ 口红 · 眉笔 · 发圈   │
│  散放                        │
│     ✅ 纸巾包                │
│                              │
│  [确认保存]  [修改]          │
└──────────────────────────────┘
```

agent 工作流的每一步都实时展示给用户，让用户感受到 AI 在"理解你的家"，而不只是在标注图片。

---

## 3. 三层数据结构

```
空间 (Space)     — 房间级别：卧室、书房、厨房
  └── 位置 (Position) — 家具/区域：梳妆台、书桌、冰箱
        └── 容器 (Container) — 可选：透明收纳盒、第二层抽屉
              └── 物品 (Item)
```

容器存在 item_records 里作为文字字段，不单独建表。物品可以散放（无容器）。

### 数据模型

```sql
-- 空间（房间）
CREATE TABLE spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,             -- "卧室"
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 位置（家具/区域）
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,             -- "梳妆台"
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 照片
CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  position_id UUID REFERENCES positions(id),
  blob_url TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 物品（唯一，一个口红就是一条）
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,             -- "口红"
  description TEXT,               -- "粉色管状，MAC品牌"（不变的特征）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 物品记录（每次拍照确认产生一条，是物品的位置历史）
CREATE TABLE item_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  item_id UUID REFERENCES items(id),
  position_id UUID REFERENCES positions(id),
  media_asset_id UUID REFERENCES media_assets(id),
  container TEXT,                 -- "透明收纳盒"，可为空表示散放
  note TEXT,                      -- 本次观察备注，如"快用完了"
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_spaces_user ON spaces(user_id);
CREATE INDEX idx_positions_space ON positions(space_id);
CREATE INDEX idx_items_user ON items(user_id);
CREATE INDEX idx_items_name ON items(user_id, name);
CREATE INDEX idx_item_records_user ON item_records(user_id, recorded_at DESC);
CREATE INDEX idx_item_records_item ON item_records(item_id, recorded_at DESC);
CREATE INDEX idx_item_records_position ON item_records(position_id, recorded_at DESC);
```

查询路径拼接：`{space.name} / {position.name} / {container}里`

---

## 4. Agent 设计

### 一个 Agent，两种模式

```
HomeMemoryAgent
  ├── 识别模式（收到照片时）
  │   系统提示 + 照片 + 工具 → 建议保存
  └── 查找模式（收到文字时）
      系统提示 + 问题 + 工具 → 回答 + 证据
```

### 系统提示

```text
你是 FindIt 家庭记忆助手。你管理用户家中物品的位置记录。

你有两种工作模式：

【识别模式】当用户发来照片时：
1. 先用 list_spaces 和 list_positions 了解用户家的已有结构。
2. 判断照片属于哪个空间和位置。如果是已有位置，用已有名称。
3. 如果该位置有历史照片，用 view_photo 查看旧照片，对比变化。
4. 识别照片中的物品，按容器分组。
5. 标注每个物品的状态：existing（已有）、new（新增）、missing（上次有但现在没看到）。
6. 调用 suggest_save 提交建议，等待用户确认。

【查找模式】当用户问"XX在哪"时：
1. 用 search_items 搜索物品记录。
2. 如果需要确认，用 view_photo 查看证据照片。
3. 用自然中文回答，包含完整位置路径和记录时间。
4. 如果能在照片中指出物品具体位置，描述出来。

识别规则：
- 物品名称用用户日后会搜的词，不用视觉描述词（"口红"而非"粉色管状物"）。
- 如果能辨认品牌/型号，优先用品牌名。
- 容器本身不作为物品记录，但作为物品的归属信息。
- 衣物、大件家具等不适合"找"的东西，可以跳过或标记低优先级。
- 看不清的物品不要猜，放到 uncertain 里。
- 不要编造数据库里没有的信息。
```

### 工具集

```json
[
  {
    "type": "function",
    "name": "list_spaces",
    "description": "列出用户家中所有空间（房间），返回每个空间的名称、位置数量和物品总数。",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "type": "function",
    "name": "list_positions",
    "description": "列出某个空间下所有位置（家具/区域），返回每个位置的名称、物品数量和最近照片ID。",
    "parameters": {
      "type": "object",
      "properties": {
        "space_name": { "type": "string" }
      },
      "required": ["space_name"]
    }
  },
  {
    "type": "function",
    "name": "get_position_items",
    "description": "获取某个位置的所有物品记录，按容器分组，包含最近照片ID。",
    "parameters": {
      "type": "object",
      "properties": {
        "position_id": { "type": "string" }
      },
      "required": ["position_id"]
    }
  },
  {
    "type": "function",
    "name": "view_photo",
    "description": "查看一张照片。用于对比新旧照片、验证物品是否存在、或为查找结果提供视觉证据。",
    "parameters": {
      "type": "object",
      "properties": {
        "media_asset_id": { "type": "string" },
        "question": {
          "type": "string",
          "description": "可选，查看照片时想确认的问题"
        }
      },
      "required": ["media_asset_id"]
    }
  },
  {
    "type": "function",
    "name": "search_items",
    "description": "按物品名称搜索所有记录，返回物品名、位置路径、容器、记录时间和照片ID。",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string" }
      },
      "required": ["query"]
    }
  },
  {
    "type": "function",
    "name": "suggest_save",
    "description": "提交识别结果建议。不会直接保存，需要用户确认后才写入数据库。",
    "parameters": {
      "type": "object",
      "properties": {
        "space": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "is_new": { "type": "boolean" }
          },
          "required": ["name", "is_new"]
        },
        "position": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "is_new": { "type": "boolean" },
            "description": { "type": "string" }
          },
          "required": ["name", "is_new"]
        },
        "containers": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "items": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "name": { "type": "string" },
                    "description": { "type": "string" },
                    "status": {
                      "type": "string",
                      "enum": ["existing", "new", "missing"]
                    }
                  },
                  "required": ["name", "status"]
                }
              }
            },
            "required": ["name", "items"]
          }
        },
        "loose_items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "description": { "type": "string" },
              "status": {
                "type": "string",
                "enum": ["existing", "new", "missing"]
              }
            },
            "required": ["name", "status"]
          }
        },
        "uncertain_items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "description": { "type": "string" }
            }
          }
        }
      },
      "required": ["space", "position"]
    }
  }
]
```

---

## 5. Agent 工作流的前端展示

### 流式展示设计

后端将 agent 的每一步通过 SSE (Server-Sent Events) 推送给前端：

```
event: thinking
data: {"text": "这看起来像卧室的梳妆台..."}

event: tool_call
data: {"tool": "list_spaces", "args": {}}

event: tool_result
data: {"tool": "list_spaces", "result": {"spaces": ["卧室", "书房", "厨房"]}}

event: thinking
data: {"text": "有卧室，看看梳妆台上次记了什么..."}

event: tool_call
data: {"tool": "list_positions", "args": {"space_name": "卧室"}}

event: tool_result
data: {"tool": "list_positions", "result": {"positions": [{"name": "梳妆台", "item_count": 8, "photo_id": "photo_xxx"}]}}

event: tool_call
data: {"tool": "view_photo", "args": {"media_asset_id": "photo_xxx"}}

event: tool_result
data: {"tool": "view_photo", "result": {"viewed": true}}

event: thinking
data: {"text": "对比新旧照片，发现多了一瓶香水..."}

event: tool_call
data: {"tool": "suggest_save", "args": {...}}

event: answer
data: {"text": "这是卧室梳妆台。和上次比，透明收纳盒里多了一瓶香水。", "suggestion": {...}}

event: done
data: {}
```

### 前端渲染规则

| 事件 | 渲染方式 |
|------|---------|
| `thinking` | 灰色斜体文字，流式逐字出现 |
| `tool_call` | 图标 + 工具名的人话翻译（"🔍 查看已有空间..."） |
| `tool_result` | 简要结果（"→ 卧室、书房、厨房"） |
| `view_photo` 结果 | 显示旧照片缩略图 |
| `answer` | 正式回答，正常字体 |
| `suggest_save` | 渲染为可编辑的确认卡片 |

### 工具名翻译表

| tool_call | 显示文案 |
|-----------|---------|
| `list_spaces` | 🔍 查看已有空间... |
| `list_positions` | 🔍 查看{space}的位置... |
| `get_position_items` | 📋 查看{position}的物品... |
| `view_photo` | 🖼 查看历史照片... |
| `search_items` | 🔍 搜索"{query}"... |
| `suggest_save` | 💾 整理识别结果... |

---

## 6. 后端 API

### Responses API 交互

后端封装一个 `runAgent(input, tools)` 函数，处理多轮工具调用循环：

```text
1. 发送 input + tools 给 Responses API
2. 如果返回 tool_calls:
   a. 执行工具函数（查库/查图）
   b. 把结果追加到 input
   c. 通过 SSE 推送 tool_call 和 tool_result 给前端
   d. 继续调用 Responses API
3. 如果返回文本回答:
   a. 通过 SSE 推送 answer 给前端
   b. 结束
```

### 对外 API

```text
POST /auth/login

# Agent 交互（SSE）
POST /agent/analyze    — 传照片，返回 SSE 流
POST /agent/query      — 传文字，返回 SSE 流

# 用户确认
POST /agent/confirm    — 确认 suggest_save 的结果，写入数据库

# 数据读取（空间页用）
GET  /spaces                    — 所有空间 + 统计
GET  /spaces/:id/positions      — 某空间的位置列表
GET  /positions/:id/detail      — 位置详情（物品按容器分组 + 照片）
GET  /uploads/:filename         — 照片文件

# 照片上传
POST /media/upload              — 上传照片，返回 media_asset_id
```

### 核心流程

#### 拍照识别

```text
App: POST /media/upload (照片) → media_asset_id
App: POST /agent/analyze { media_asset_id, space_hint? }
     ← SSE 流：thinking → tool_call → tool_result → ... → suggest_save → done
App: 渲染工作流 + 确认卡片
用户: 点击确认
App: POST /agent/confirm { suggestion, media_asset_id }
     → 写入 spaces / positions / item_records
```

#### 查找物品

```text
App: POST /agent/query { query: "口红在哪" }
     ← SSE 流：tool_call(search_items) → tool_result → tool_call(view_photo)? → answer → done
App: 渲染工作流 + 回答 + 证据照片
```

---

## 7. 项目结构

```
Find/
├── docs/
├── apps/
│   ├── mobile/                  # Expo App
│   │   ├── App.js               # 入口，顶部 tab 切换
│   │   └── src/
│   │       ├── screens/
│   │       │   ├── AssistantScreen.js   # 助手页（对话流）
│   │       │   ├── SpacesScreen.js      # 我的家（空间列表）
│   │       │   └── SpaceDetailScreen.js # 空间详情（位置+物品）
│   │       ├── components/
│   │       │   ├── AgentWorkflow.js     # 渲染 agent 工作流步骤
│   │       │   ├── SuggestionCard.js    # 识别结果确认卡片
│   │       │   ├── ChatBubble.js        # 对话气泡
│   │       │   └── PhotoPicker.js       # 拍照/选照片
│   │       ├── services/
│   │       │   ├── api.js               # REST 请求
│   │       │   └── sse.js               # SSE 流处理
│   │       └── theme.js                 # 颜色/字体
│   └── api/                     # Node.js 后端
│       └── src/
│           ├── server.js                # HTTP 路由
│           ├── store.js                 # 数据读写
│           ├── agent.js                 # Agent 封装（Responses API + 工具循环）
│           ├── tools.js                 # 工具函数实现
│           └── sse.js                   # SSE 推送
```

---

## 8. 开发计划

### Phase 1 — 数据层 + 空间页

- [ ] 新数据模型（spaces / positions / item_records）
- [ ] 空间页 CRUD API
- [ ] 空间页 UI（空间列表 → 位置详情）
- [ ] 照片上传

### Phase 2 — Agent 核心

- [ ] Responses API 封装 + 工具循环
- [ ] 工具函数实现（list_spaces, list_positions, get_position_items, view_photo, search_items, suggest_save）
- [ ] SSE 推送
- [ ] `/agent/analyze` + `/agent/confirm`
- [ ] `/agent/query`

### Phase 3 — 助手页 + 工作流展示

- [ ] 助手页对话流 UI
- [ ] Agent 工作流实时渲染
- [ ] 确认卡片（编辑物品/位置/容器）
- [ ] 证据照片展示

### Phase 4 — 体验打磨

- [ ] 空间页拍照 → 自动进入识别流
- [ ] 深色主题
- [ ] 流式文字输出
- [ ] 错误兜底和重试
- [ ] 离线/弱网提示

---

## 9. 成本估算

| 场景 | Responses API 调用 | 预估 Token |
|------|-------------------|-----------|
| 识别一张照片 | 1次初始 + 2-4次工具循环 | ~2000 input + 500 output |
| 查找一个物品 | 1次初始 + 1-2次工具循环 | ~800 input + 200 output |

GPT-4o 价格：$2.5/1M input, $10/1M output

每天识别 5 张 + 查找 10 次 ≈ $0.03/天 ≈ **$1/月**（单用户）

---

## 10. 和 v1 的关键差异

| 维度 | v1 | v2 |
|------|----|----|
| AI 角色 | 图片标签器 | 有记忆的家庭助手 |
| 识别方式 | 单次调用，无上下文 | Agent 自己查历史、看旧照片、对比 |
| 用户感知 | 提交 → 等 → 看结果 | 看到 AI 思考/查询/对比的全过程 |
| 数据结构 | 扁平 location → item | 空间 → 位置 → 容器 → 物品 |
| 查找方式 | 关键词匹配或全量上下文 | Agent 工具调用，能看照片验证 |
| 页面 | 3 tab | 2 tab（助手 + 我的家） |
