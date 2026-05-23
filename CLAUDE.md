# FindIt（放哪了—AI收纳师）

## 项目概述

拍照/录像记录家中物品位置，AI 自动识别并记住。问"XX在哪"，AI 查库+看照片回答。

## 技术栈

- 前端：React Native (Expo SDK 54/55)，支持 Web 开发模式
- 后端：Node.js（原生 HTTP，无框架，Dockerfile 含 ffmpeg）
- 数据库：PostgreSQL (Azure Flexible Server)
- AI：Azure OpenAI Responses API (gpt-5.4-mini) + 工具调用（gpt-5.5/5 太慢且不稳定）
- 部署：Azure Container Apps (Japan East)
- 存储：Azure Blob Storage（@azure/storage-blob SDK，SAS URL 读取）
- 上传：FormData multipart → Blob Storage（已改掉 base64）

## Azure 资源

| 资源 | 名称 | 位置 | 资源组 |
|------|------|------|--------|
| Container Apps | findit-api | Japan East | nbp-rg |
| Container Apps 环境 | nbp-env-jp | Japan East | nbp-rg |
| PostgreSQL | findit-db | Japan East | nbp-rg |
| Blob Storage | finditstore | Japan East | nbp-rg |
| ACR 镜像仓库 | nbpacr | East Asia | nbp-rg |
| OpenAI | zihao250424 | East US 2 | openai |

线上 API: https://findit-api.livelysky-debdec5e.japaneast.azurecontainerapps.io
GitHub: https://github.com/zzh506767805/findit

## 数据库

- 服务器：findit-db.postgres.database.azure.com
- 数据库名：findit
- 用户：finditadmin
- 核心表：users, spaces, positions, media_assets, items, item_records, conversations, messages, reward_events, iap_transactions
- users 额外字段：apple_user_id, free_credits(默认10), paid_credits, subscription_expires_at, subscription_product_id
- messages 额外字段：source（'assistant' 或 'spaces'，标记消息来源页面）
- 防火墙：allow-dev 开放所有IP（开发阶段），allow-azure 开放 Azure 内部

## App Store

- 名称：放哪了—AI收纳师
- Bundle ID：top.fangnale
- SKU：fangnale
- Apple Developer Team：L5SQW898SB (Zihao Zhao)
- EAS Project：@zetacoler/findit (fce39d55-e1da-4488-9dee-204eeb7a48c3)
- 域名：fangnale.top

## 项目结构

```
Find/
├── docs/                        # 方案文档
├── apps/
│   ├── mobile/                   # Expo App
│   │   ├── App.js                # 入口，登录判断 + 顶部 tab 切换 + 付费墙
│   │   ├── eas.json              # EAS Build 配置
│   │   └── src/
│   │       ├── api.js            # HTTP 请求（开发→本地，正式→线上API）
│   │       ├── sse.js            # SSE 流式请求 + FormData 上传（XMLHttpRequest，Web 用 Blob）
│   │       ├── theme.js          # 配色（米白浅色方案）
│   │       ├── ui.js             # 通用组件
│   │       ├── components/
│   │       │   ├── AgentWorkflow.js   # AI 工作流步骤展示（含 Markdown 渲染）
│   │       │   └── SuggestionCard.js  # 识别结果确认/编辑卡片
│   │       └── screens/
│   │           ├── LoginScreen.js       # Apple Sign In + 开发模式 demo 登录
│   │           ├── PaywallScreen.js     # 付费墙（标准年卡 + 大户型年卡）
│   │           ├── AssistantScreen.js   # 助手页（对话，支持拍照/录像/文字）
│   │           ├── SpacesScreen.js      # 我的家（空间列表 + 识别面板）
│   │           └── SpaceDetailScreen.js # 空间详情（多图横滑 + 物品列表）
│   └── api/                      # Node.js 后端
│       ├── Dockerfile            # node:22-slim + ffmpeg（视频截帧用）
│       ├── .env                  # 环境变量（不提交）
│       └── src/
│           ├── server.js         # HTTP 路由 + SSE + FormData 解析
│           ├── store.js          # PostgreSQL 数据访问 + 用量计费 + 对话管理
│           ├── agent.js          # Responses API + 工具调用循环 + 图片压缩
│           ├── blob.js           # Azure Blob Storage 上传 + SAS URL 生成
│           └── tools.js          # Agent 工具定义和执行
```

## 架构

```
Expo App → API (Container Apps) → PostgreSQL
         (FormData upload)      → Blob Storage (照片/视频，SAS URL 访问)
                                → Azure OpenAI (Responses API + tools，图片用 SAS URL 直传)
```

### 拍照识别架构
- "我的家"页和空间详情的拍照统一跳转到助手页处理
- 支持多图选择（allowsMultipleSelection），依次发送 AI 识别
- 从空间详情拍照时带 space_hint 参数，AI prompt 引导归入对应空间
- 识别由 `apps/api/src/agent.js` 的单 Agent 完成：系统 prompt + 当前家庭结构摘要 + Responses API tools
- 当前家庭结构摘要由 `buildHomeSummary()` 注入，不需要模型再调用 `list_spaces` / `list_positions`
- `space` 只表示房间/大区域；`position` 表示家具、台面、收纳点或局部区域
- 如果历史空间名看起来像家具/位置（如"梳妆台"），摘要里标记为"疑似位置名/历史误分类"，提示模型不要作为 `space.name` 复用
- 如果 `space_hint` 本身像家具/位置名，会被当作 position 提示，prompt 要求模型另行推断房间级 `space.name`
- 后端不自动改写模型返回的 `suggestion`；`save_items` 返回用户可编辑草稿，`/agent/confirm` 保存用户最终确认的内容
- App.js 通过 pendingMedia 状态桥接：SpacesScreen 设值+切 tab → AssistantScreen 消费并发送

### 对话上下文架构
- 助手页和我的家页共享同一个 conversation（同一个 previousResponseId 链）
- messages 表有 `source` 字段：`assistant`（助手页）或 `spaces`（我的家页）
- 助手页加载历史时只取 source=assistant 的消息，不显示我的家的记录
- AI 上下文是连续的：从我的家拍照后 AI 记得空间结构，助手页查询时可利用
- /agent/analyze?source=spaces&space_hint=客厅 区分来源并传空间上下文
- /conversation?source=assistant 按来源过滤返回消息

### 空间/位置管理
- 空间：手动新建（内联输入框）、长按重命名/删除
- 位置：手动新建、长按重命名/删除
- 后端路由：POST/PUT/DELETE /spaces/:id，POST /spaces/:id/positions，PUT/DELETE /positions/:id
- 前端乐观更新：操作立即反映在 UI，失败自动回滚
- 空间详情进出有滑动动画（150ms），支持左滑返回手势
- 位置数据缓存（useRef），避免重进空间时闪烁
- 覆盖型页面（空间详情、付费页等）应作为绝对定位 layer 盖在当前页面上，不要在 App 根部提前 return 替换主页面；这样返回时首页和 `StableImage` 不会卸载重建，避免图片闪烁

### Blob Storage
- 账户：finditstore，容器：data，公开访问已关闭
- 上传用 @azure/storage-blob SDK，不手写签名
- 数据库存裸 URL，API 返回时动态加 SAS（1小时有效）
- AI 读图用 SAS URL（比 base64 省内存，但大图偶尔超时）
- 环境变量：AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY, AZURE_STORAGE_CONTAINER

### Agent 工具

- list_spaces — 列出空间
- list_positions — 列出位置
- get_position_items — 获取位置物品
- view_photo — 查看历史照片（支持 Blob URL 直传 AI）
- search_items — 搜索物品（匹配 name + description，支持颜色/品牌等特征）
- save_items — 创建/更新空间、位置、物品（通用，需用户确认；原 suggest_save）
- update_item — 修改物品（名称/描述/位置）
- delete_item — 删除物品

### 数据三层结构

空间(Space) → 位置(Position) → 物品(Item)

### 用量计费

- 免费：10 次识别（注册时赠送）
- 标准年卡：¥68/年，适合 100m² 以内户型，内部额度 1000 次/年
- 大户型年卡：¥128/年，适合 300m² 以下户型，内部额度 3000 次/年
- 查询不限次，只有识别（拍照/录像）扣次数
- 年卡购买后写入 subscription_expires_at；付费额度只在有效期内可用，过期后 total 只计算免费额度
- iap_transactions 按 transaction_id 去重，恢复购买不会重复加额度
- 后端 /agent/analyze 接口调用前 consumeCredit，余额不足返回 403

## 开发调试

```bash
# Web 开发模式（电脑浏览器测试）
cd apps/mobile && npx expo start --web

# 本地 API（开发模式自动连 localhost:4000）
cd apps/api && node src/server.js
```

api.js 中 `__DEV__` 模式自动连本地 API，Web 端连 localhost:4000。
Web 端不支持相机，点击拍照按钮直接打开文件选择器。
sse.js 中 Web 端用 Blob 对象上传（React Native 用 { uri, type, name }）。

## 发布流程

每次改完代码后，按以下顺序操作：

```bash
# 1. 推代码到 GitHub
git add -A && git commit -m "描述改了什么" && git push

# 2. 后端有改动时，重新部署
cd apps/api
az acr build --registry nbpacr --resource-group nbp-rg --image findit-api:latest --file Dockerfile .
az containerapp update --name findit-api --resource-group nbp-rg --image nbpacr.azurecr.io/findit-api:latest

# 3. 前端有改动时，重新打包
cd apps/mobile
npx eas-cli build --profile preview --platform ios
```

注意：目前没有自动部署（CI/CD），每次都需要手动执行。

## 上架计划

### 已完成
- [x] 后端部署到 Azure Container Apps
- [x] PostgreSQL 数据库（含用量计费字段）
- [x] AI Agent 工具调用（Responses API + 多轮工具循环）
- [x] 两页 UI（助手对话 + 我的家空间浏览）
- [x] SSE 流式展示 agent 工作流
- [x] Apple Sign In 登录页（代码就绪，需 development build 测试）
- [x] 付费墙 UI（标准年卡 + 大户型年卡，IAP 待接入真实 API）
- [x] 用量计费后端（free_credits + paid_credits）
- [x] 图片改 FormData 上传 + Blob Storage 存储
- [x] 视频录像支持（ffmpeg 截帧 → 多帧识别）
- [x] 搜索优化（匹配 name + description，prompt 要求存特征标签）
- [x] App Store Connect 创建 App（放哪了—AI收纳师）
- [x] Bundle ID 注册（top.fangnale）
- [x] iOS 发布证书创建（EAS Credentials）
- [x] EAS 项目配置（eas.json）
- [x] 域名购买（fangnale.top）
- [x] 对话上下文（previousResponseId + source 分离显示）
- [x] 空间详情（多图横滑 + 物品列表 + 去重计数）
- [x] Web 开发模式（电脑浏览器测试，文件选择上传）
- [x] 物品编辑/删除（update_item + delete_item 工具）
- [x] Apple Sign In 服务端验签（Apple 公钥 JWT，生产强制/开发宽松）
- [x] Apple IAP 真实接入（expo-in-app-purchases + 后端 receipt 验证）
- [x] JWT_SECRET 生产环境强制设置
- [x] add-credits 接口收紧（仅 development 模式直接加次数）
- [x] apple_user_id 唯一约束 + INSERT ON CONFLICT
- [x] Token 持久化（expo-secure-store，Web 用 localStorage）
- [x] 删除未使用的 WorkspaceScreen.js
- [x] suggest_save 改名 save_items（通用创建工具，参数全可选）
- [x] Azure OpenAI 请求重试（ECONNRESET 等网络错误自动重试 2 次）

### 待做（上架阻断项）
- [ ] ICP 备案提交（阿里云，需轻量服务器做备案落地）
- [x] Apple IAP 接入真实 API（expo-in-app-purchases + 后端 receipt 验证）
- [x] Apple Sign In identityToken 服务端验证（Apple 公钥 JWT 验签）
- [ ] App Store Connect 创建 IAP 产品（fangnale_yearly + fangnale_yearly_large）
- [ ] 设置环境变量 APPLE_IAP_SHARED_SECRET
- [ ] App 图标 + 截图
- [ ] 隐私政策 + 用户协议
- [ ] EAS Build 打包 + TestFlight 测试
- [ ] 提交 App Store 审核

### 后续迭代
- [ ] 微信/手机号登录
- [ ] iCloud 数据备份
- [ ] 新手引导
- [ ] 识别 prompt 持续调优
- [ ] GitHub Actions 自动部署

## 决策记录

- 不做 aliases（过度设计）
- 已去掉容器(container)概念，三级结构：空间→位置→物品
- 一个 Agent 两种模式（识别/查找），不拆多 Agent
- 配色用米白浅色方案（theme.js 统一管理），照片是唯一色彩
- 登录方案：强制 Apple Sign In（上架要求）
- 付费方案：标准年卡 ¥68（100m² 以内，内部 1000 次/年）+ 大户型年卡 ¥128（300m² 以下，内部 3000 次/年），免费 10 次
- 查询不计次，只有识别扣次数（AI 调用成本控制）
- 日本区部署（Container Apps + PostgreSQL），阿里云做备案落地
- 图片用 FormData multipart 上传到 Blob Storage，不用 base64
- AI 读图用 Blob SAS URL 直传（不用 base64 内嵌），手写 SAS 签名不靠谱必须用 SDK
- 视频用 ffmpeg 截帧（1FPS，最多10帧）后多帧 base64 发给 AI 识别
- 视频限制 10 秒，前端 expo-image-picker videoMaxDuration=10
- 物品 description 包含视觉特征（颜色/品牌/材质），提升模糊搜索召回
- 防火墙开发阶段全开，上线前收紧
- 对话上下文：两页共享 conversation + previousResponseId，用 source 字段分开展示
- 物品计数用 count(DISTINCT item_id) 避免同物品多次记录重复计数
- Web 端：expo-image-picker 只用 library 模式（无 camera），FormData 用 Blob 对象
- 首页图片稳定性：付费页/详情页这类覆盖层必须保留底层 SpacesScreen 挂载，禁止用条件 return 整页替换导致首页图片重载闪烁
- Apple Sign In 验签：Apple 公钥 JWT 验证（issuer/audience/expiry/sub），缓存公钥 1 小时
- IAP 验证：先请求生产 verifyReceipt，status 21007 自动 fallback 沙盒，按 productId 决定加次数
- IAP 产品 ID：fangnale_yearly（标准年卡，1000次）、fangnale_yearly_large（大户型年卡，3000次）；fangnale_topup 仅后端兼容旧测试，不对用户展示
- 年卡有效期：优先使用 Apple receipt 的 expires_date_ms；没有时按当前有效期顺延 365 天，过期后重新开通从当前时间算 365 天
- Token 持久化：原生端 expo-secure-store，Web 端 localStorage，启动时恢复+验证
- JWT_SECRET 生产环境必须设置（否则 process.exit），开发环境用 fallback
- save_items 工具：所有参数可选，通用于拍照识别和手动创建空间/位置/物品
- Azure OpenAI 请求自动重试 2 次（间隔 1s/2s），防 ECONNRESET
