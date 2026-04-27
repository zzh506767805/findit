# AI Agent Service 设计

## 1. 结论

MVP 需要一层 AI Agent Service，但它不是重型自主 Agent。

它的定位是：

> 统一封装 Responses API 调用、提示词、结构化输出校验、工具调用和错误兜底。

业务状态仍然放在 PostgreSQL。Agent Service 不自己保存“记忆”，也不直接替用户确认物品。

## 2. 为什么需要这一层

如果 App 或普通 API 直接调用模型，会很快出现几个问题：

1. 提示词散落在多个接口里，后续难维护。
2. 模型返回 JSON 失败时缺少统一修复逻辑。
3. 识别、查询解析、回答生成的边界不清楚。
4. 后续更换模型或从 Azure OpenAI 切到其他模型时改动面太大。
5. 无法统一记录模型输入、输出、耗时、错误和成本。

所以需要一个很薄的 Agent Service，把“模型相关逻辑”收口。

## 3. MVP 里它做什么

只做 3 个能力：

```text
analyze_photo
  输入：photo_url, optional location_hint
  输出：scene, location_candidates, items, uncertain_items

answer_find_query
  输入：用户问题
  工具：查历史数据库，查看原图
  输出：简短中文回答 + 命中记录

repair_json
  输入：模型原始输出
  输出：合法 JSON
```

不要让模型直接写数据库。模型可以调用只读查询工具和只读图片查看工具，但写入、确认、合并、删除都必须由 API 服务在用户确认后执行。

## 4. 服务边界

```text
Expo App
  -> API Backend
    -> AI Agent Service
      -> Azure OpenAI Responses API
    -> PostgreSQL
    -> Blob Storage
```

AI Agent Service 可以是：

1. API Backend 里的一个模块，最省事。
2. 一个独立内部 HTTP 服务，后续更容易扩展。
3. Azure Functions 里的几个函数，适合早期低流量。

MVP 推荐先做第 1 种：API Backend 内部模块。等调用复杂后，再拆成独立服务。

## 5. 模型 API 选择

MVP 推荐优先用 Azure OpenAI Responses API，不直接上 Azure AI Agents Service。

原因：

1. 当前需求只是图片识别、位置建议、历史查询和回答生成，不需要托管 Agent 的线程和长程任务。
2. Responses API 足够承载多模态输入、结构化输出和工具调用。
3. 服务边界更简单：你的 API 控制鉴权、数据库和业务状态，模型只负责推理。
4. 后续如果要接 Agent SDK 或 Azure AI Agents Service，可以把这一层替换掉，不影响 App 和数据库。

推荐封装方式：

```text
AI Agent Service
  -> AzureOpenAIResponsesClient
    -> responses.create(...)
```

如果当前 Azure 区域、模型部署或 API 版本不支持 Responses API，可以临时封装一个兼容实现：

```text
AI Agent Service
  -> ModelClient interface
    -> AzureOpenAIResponsesClient
    -> AzureOpenAIChatCompletionsClient fallback
```

业务代码只调用 `ModelClient`，不要在业务接口里散落具体模型 API。

## 6. 要不要用 Agent SDK

可以用，但要控制使用范围。

### MVP 推荐

使用 Agent SDK 或 Agent Framework 管这几件事：

1. 定义 agent instructions。
2. 定义结构化输出 schema。
3. 定义只读工具函数，例如 `search_item_history`。
4. 统一追踪每次模型运行。
5. 加 guardrails，避免模型编造位置。

不要用它做：

1. 多 Agent 协作。
2. 自主规划复杂任务。
3. 长期记忆。
4. 自动修改用户数据库。
5. 自动删除或合并物品。

但如果使用 Responses API 已经能稳定满足 MVP，第一版可以先不引入 Agent SDK。

## 7. Agent 划分

MVP 不需要多个 Agent。一个 `HomeMemoryAgent` 就够。

```text
HomeMemoryAgent
  - analyze_photo
  - answer_find_query
  - repair_json
```

后续真的复杂了，再拆：

```text
VisionAgent
  负责照片识别

QueryAgent
  负责查询解析和回答

MemoryAgent
  负责纠错、合并、更新建议
```

但第一版不要拆。

## 8. 工具函数

Agent Service 里面暴露只读工具：

```text
search_item_history(user_id, queries, limit)
get_item_location_detail(user_id, item_location_id)
get_location(user_id, location_id)
get_media_asset(user_id, media_asset_id)
inspect_original_image(user_id, media_asset_id, question)
```

注意：`analyze_photo` 阶段不需要工具，因为它只看用户刚上传的照片。

`answer_find_query` 阶段允许模型自己调用只读工具：

```text
用户问题
  -> 模型判断搜索词
  -> search_item_history
  -> get_item_location_detail
  -> 必要时 inspect_original_image
  -> 输出回答
```

工具必须由后端做权限过滤：只能访问当前用户自己的 confirmed 历史记录和对应照片。任何写库动作都不能作为模型工具暴露。

## 9. 最小接口

Agent Service 内部接口：

```text
POST /ai/analyze-photo
POST /ai/answer-find-query
POST /ai/repair-json
```

对 App 暴露的业务接口仍然是：

```text
POST /media/analyze
POST /chat/query
```

App 不直接知道 Agent Service 的存在。

## 10. Responses API 调用约定

### 图片识别

```text
model: 支持视觉输入的 Azure OpenAI 模型部署
input:
  - system instructions
  - user text: optional location_hint + JSON schema 要求
  - input_image: 用户照片 URL 或 base64
output:
  - JSON object: scene, location_candidates, items, uncertain_items
```

后端必须做：

1. 校验输出是否是合法 JSON。
2. 校验字段是否符合 schema。
3. 过滤空名称、超长名称和非法 confidence。
4. 失败时重试一次 JSON 修复。
5. 仍失败则不写库。

### 工具化查询

```text
model: 便宜、低延迟的文本模型部署
input:
  - 用户问题
tools:
  - search_item_history
  - get_item_location_detail
  - get_media_asset
  - inspect_original_image
output:
  - answer
  - matched_item
  - location_name
  - placed_at
  - media_asset_id
```

查询时不要默认看原图。只有这些场景才调用 `inspect_original_image`：

```text
1. 多个候选名称接近，需要确认哪一个更像用户问的东西。
2. 历史记录太旧或描述不足。
3. 用户明确要求“看照片/确认一下”。
4. 物品名称依赖外观，例如“那个黑色小盒子”。
```

如果回答中的位置、物品或照片不来自工具返回结果，后端直接丢弃模型回答，改用模板回答。

## 11. analyze-photo 返回格式

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

## 12. 工具定义

### search_item_history

用途：按物品名称、别名、描述查询已确认历史记录。

```json
{
  "queries": ["护照", "passport", "证件"],
  "limit": 5
}
```

返回：

```json
{
  "records": [
    {
      "item_location_id": "locrec_123",
      "item_name": "护照",
      "aliases": ["passport", "证件"],
      "location_summary": "书房 / 书桌左侧抽屉",
      "placed_at": "2026-04-25T10:00:00Z",
      "note": "深蓝色证件本",
      "media_asset_id": "photo_123"
    }
  ]
}
```

### get_item_location_detail

用途：获取某条物品位置记录的完整位置和照片元信息。

```json
{
  "item_location_id": "locrec_123"
}
```

### inspect_original_image

用途：让模型查看原图，验证候选记录和用户问题是否匹配。

```json
{
  "media_asset_id": "photo_123",
  "question": "这张照片里是否能看到护照或证件本？"
}
```

工具内部从 Blob 生成短时效签名 URL 或读取图片内容，再作为 image input 传给 Responses API。工具只返回简短视觉结论，不返回长期公开图片链接。

## 13. answer-find-query 输出格式

```json
{
  "answer": "护照上次记录在「书房 / 书桌左侧抽屉」。照片里是一本深蓝色证件本，记录时间是 2026-04-25。",
  "matched_item": "护照",
  "location_name": "书房 / 书桌左侧抽屉",
  "placed_at": "2026-04-25T10:00:00Z",
  "media_asset_id": "photo_123",
  "used_image_verification": true
}
```

## 14. 错误和兜底

| 场景 | 处理 |
| --- | --- |
| 视觉模型识别失败 | 返回“识别失败，可重试或手动添加” |
| JSON 解析失败 | 自动修复一次，仍失败则不入库 |
| 查询没有命中 | 返回“没有找到记录”，引导用户拍照记录 |
| 多个候选命中 | 优先最近一次 confirmed 记录，必要时查看原图 |
| 模型说出数据库没有的位置 | 丢弃模型回答，使用模板回答 |
| 工具请求越权 | 拒绝工具调用并记录安全日志 |

## 15. MVP 技术选择

Azure 优先时：

```text
API Backend: Node.js 或 Python
Model API: Azure OpenAI Responses API
Agent Layer: 自写薄封装，使用 Responses API tools
Model: Azure OpenAI vision/chat model
Storage: Azure Blob + PostgreSQL
```

第一版关键不是 SDK 名字，而是把模型调用集中封装，并强制结构化输入输出。

## 16. 实现顺序

1. 先写 `AzureOpenAIResponsesClient`。
2. 再写 `analyzePhoto(photoUrl, locationHint?)`。
3. 加位置候选和物品候选的 JSON schema 校验。
4. 写只读工具：`searchItemHistory`、`getItemLocationDetail`、`inspectOriginalImage`。
5. 写 `answerFindQuery(query)`，允许模型调用工具。
6. 加日志：用户、接口、模型、工具调用、耗时、错误、token 成本。

做到这里就够支撑 MVP。
