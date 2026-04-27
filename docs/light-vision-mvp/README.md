# FindIt 轻量视觉 MVP 方案

## 1. MVP 定位

这个版本只解决一个闭环：

> 用户拍一张家中收纳照片，模型识别可能的位置和物品，用户确认后保存。之后用户问“XX 在哪”，模型用工具查询历史数据库并按需查看原图，返回最近一次确认的位置和证据照片。

第一版保留“位置识别”，但只做照片级位置建议，不做完整房屋结构分析、不做自动户型图、不做视频理解、不做图片向量检索、不做 Azure AI Search。所有视觉理解都走模型本身能力，模型调用统一走 Responses API，后端负责权限、工具、结构化结果校验和入库。

## 2. 用户流程

### 2.1 录入物品

1. 用户拍照或从相册选择照片。
2. App 可让用户选择一个位置作为提示，也可以让模型自动建议位置。
3. App 上传照片。
4. 后端通过 Responses API 调用视觉模型，识别照片中可能的位置和可见物品。
5. App 展示识别结果：
   - 位置建议：房间、放置点
   - 物品名称
   - 简短描述
   - 物品所属位置
6. 用户确认位置、改名、删除或补充物品。
7. 后端保存为“物品放置记录”。

### 2.2 查询物品

1. 用户输入“护照在哪”。
2. Agent 通过 Responses API 工具调用查询历史数据库。
3. Agent 获取候选记录、位置、时间和证据照片。
4. 如候选不确定，Agent 通过工具查看原图进行二次确认。
5. 返回位置、时间和证据照片。

## 3. MVP 功能范围

### 必须做

| 功能 | 说明 |
| --- | --- |
| 账号登录 | 邮箱登录即可，MVP 可以先用验证码或 magic link |
| 位置识别 | AI 从照片建议房间和放置点，用户确认后保存 |
| 位置管理 | 用户可手动创建、修改、合并 AI 建议的位置 |
| 照片上传 | 只支持图片，暂不支持视频 |
| 模型识别 | 使用视觉模型从图片中识别位置和物品 |
| 用户确认 | AI 结果必须经过用户确认再进入可查询记忆库 |
| 工具化查询 | 用户问“XX 在哪”，Agent 用工具查历史数据库并可查看原图 |

### 暂时不做

| 不做 | 原因 |
| --- | --- |
| 完整房屋结构自动分析 | 容易错，且不是闭环必需 |
| 视频上传和抽帧 | 增加成本和异步复杂度 |
| 图片向量检索 | MVP 只需要把图片转文字后查文字 |
| Azure AI Search | 普通 PostgreSQL 查询足够 |
| 多人家庭共享 | 先验证单人使用价值 |
| 物品边框标注 | 模型返回文字已经够验证需求 |
| 自动去重 | 用户确认阶段可以先手动处理 |

## 4. Azure 轻量架构

```text
Expo App
  -> API Backend
  -> AI Agent Service: Responses API + tools
  -> Azure Blob Storage: store photos
  -> Azure OpenAI Responses API: image/query to JSON
  -> Azure PostgreSQL: store text records
```

### 推荐最小资源

| 资源 | 用途 |
| --- | --- |
| Azure Blob Storage | 存用户上传照片 |
| Azure PostgreSQL Flexible Server | 存用户、位置、物品、物品位置记录 |
| Azure OpenAI Responses API | 识别位置和物品、工具化查询、生成回答 |
| Azure Container Apps | 跑 API 服务 |
| Azure Key Vault | 存数据库连接串、模型密钥、Blob 密钥 |

如果想更省事，MVP 后端也可以全部用 Azure Functions。若后续要做聊天、鉴权、任务状态和管理后台，Container Apps 更好维护。

模型调用建议单独封装成一个轻量 AI Agent Service，底层走 Responses API，不做复杂多 Agent 系统。详见 [agent-service.md](./agent-service.md)。

## 5. 简单识别方案

照片上传时，用户可以选择位置作为提示，也可以不选，让模型自动建议位置：

```text
位置提示：可选
照片：一张抽屉内部照片
```

视觉模型需要回答两层信息：

1. 这张照片可能属于哪个位置。
2. 这个位置里有哪些可见物品。

```json
{
  "scene": "书房抽屉内部",
  "location_candidates": [
    {
      "room_name": "书房",
      "place_name": "书桌左侧抽屉",
      "description": "木质书桌下方打开的抽屉",
      "confidence": "high"
    }
  ],
  "items": [
    {
      "name": "护照",
      "aliases": ["passport", "证件"],
      "category": "文件证件",
      "description": "深蓝色证件本",
      "confidence": "high"
    },
    {
      "name": "Type-C 数据线",
      "aliases": ["充电线", "USB-C 线", "数据线"],
      "category": "电子配件",
      "description": "白色卷起的数据线",
      "confidence": "medium"
    }
  ],
  "uncertain_items": [
    {
      "description": "黑色小盒子，无法确认具体用途",
      "confidence": "low"
    }
  ]
}
```

规则：

1. 模型不要猜看不清的物品。
2. 模型可以建议位置，但不能自动创建最终位置。
3. 所有模型识别结果都先给用户确认。
4. 用户确认后才写入 `locations` 和 `item_locations`。
5. 原图始终保留，查询结果必须能回看证据照片。

## 6. 简单召回方案

MVP 不做图片向量召回，但查询阶段允许模型使用只读工具：

```text
search_item_history
get_item_location_detail
get_media_asset
inspect_original_image
```

工具边界：

1. 工具只能读数据库和照片，不能写库。
2. 默认先查 confirmed 历史记录。
3. 只有候选不确定、名称模糊或用户要求看证据时，才查看原图。
4. 原图通过短时效签名 URL 或内部 image input 传给 Responses API，不暴露长期公开链接。

### 查询步骤

```text
用户问题
  -> Responses API Agent 判断要找的物品
  -> 调用 search_item_history 查历史数据库
  -> 调用 get_item_location_detail 获取位置和照片信息
  -> 必要时调用 inspect_original_image 查看原图
  -> 返回 location + photo + placed_at
```

### 例子

用户问：

```text
我的充电线在哪？
```

Agent 先调用工具：

```json
{
  "tool": "search_item_history",
  "arguments": {
    "queries": ["充电线", "数据线", "Type-C 线", "USB-C 线"]
  }
}
```

SQL 查询命中：

```text
Type-C 数据线
位置：书房抽屉
上次确认：2026-04-25
证据照片：photo_123
```

回答：

```text
充电线上次记录在「书房抽屉」。照片里是一根白色卷起的数据线，记录时间是 2026-04-25。
```

## 7. 最小数据模型

数据库只保存用户确认后的结果，不长期保存模型候选、建议位置、置信度等中间字段。

### locations

用户手动创建或确认后的最终位置。

```sql
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  room_name TEXT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### media_assets

上传的照片。

```sql
CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  location_id UUID REFERENCES locations(id),
  blob_url TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### items

物品主记录。一个物品可以被多次观察到。

```sql
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### item_locations

物品当前或最近一次确认的位置记录。

```sql
CREATE TABLE item_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  item_id UUID REFERENCES items(id),
  location_id UUID REFERENCES locations(id),
  media_asset_id UUID REFERENCES media_assets(id),
  note TEXT,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 简单索引

```sql
CREATE INDEX idx_items_user_name ON items (user_id, name);
CREATE INDEX idx_items_user_aliases ON items USING GIN (aliases);
CREATE INDEX idx_locations_user_name ON locations (user_id, room_name, name);
CREATE INDEX idx_item_locations_user ON item_locations (user_id, placed_at DESC);
CREATE INDEX idx_item_locations_item_latest ON item_locations (item_id, placed_at DESC);
```

## 8. 最小 API

```text
POST /auth/login

POST /locations
GET  /locations
PUT  /locations/:id
DELETE /locations/:id

POST /media/upload-url
POST /media/analyze

POST /recognitions/confirm

GET  /items
GET  /items/search?q=护照
POST /chat/query
```

### 上传和识别

```text
1. App 调 POST /media/upload-url 获取 Blob 上传地址
2. App 直传照片到 Blob
3. App 调 POST /media/analyze，传 media_asset_id 和可选 location_hint
4. 后端通过 Responses API 调用视觉模型
5. App 展示位置候选和物品候选给用户确认
6. App 调 POST /recognitions/confirm，后端只保存用户确认后的最终位置和物品记录
```

MVP 可以同步调用 `/media/analyze`，不需要异步队列。等识别时间或用户量上来后，再改成后台任务。

## 9. 端侧页面

只做 5 个页面：

| 页面 | 用途 |
| --- | --- |
| 首页 | 搜索入口 + 最近记录 |
| 位置页 | 创建和管理位置 |
| 拍照上传页 | 拍照上传，可选位置提示 |
| 确认页 | 确认模型识别出的位置和物品 |
| 查询结果页 | 展示物品位置、时间、证据照片 |

聊天页可以先伪聊天，本质调用 `/chat/query`。

## 10. 开发顺序

### 第 1 阶段：不用 AI，跑通数据闭环

1. 创建位置。
2. 上传照片。
3. 手动添加物品。
4. 搜索物品并返回位置。

### 第 2 阶段：接入视觉模型

1. 照片上传后通过 Responses API 调用视觉模型。
2. 模型返回位置候选和物品候选 JSON。
3. 用户确认位置和物品。
4. 后端保存 `locations`、`items`、`item_locations`。

### 第 3 阶段：自然语言查询

1. 用户输入“XX 在哪”。
2. Responses API Agent 调用历史数据库工具。
3. 必要时调用原图查看工具。
4. 模型生成自然语言回答。

## 11. 成功标准

MVP 只看这四件事：

1. 用户能快速记录一个位置里的多个物品。
2. AI 能给出可确认的位置建议，让用户感受到智能。
3. AI 识别结果经过用户确认后可保存。
4. 用户问“XX 在哪”时，Agent 能查历史记录并返回位置和证据照片。

如果这四件事跑通，再考虑视频、向量检索、多端同步和家庭共享。
