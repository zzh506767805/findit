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
- 8 张表：users, spaces, positions, media_assets, items, item_records, conversations, messages
- users 额外字段：apple_user_id, free_credits(默认10), paid_credits, subscription_expires_at
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
│   │           ├── PaywallScreen.js     # 付费墙（年卡 + 补充包）
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

### 对话上下文架构
- 助手页和我的家页共享同一个 conversation（同一个 previousResponseId 链）
- messages 表有 `source` 字段：`assistant`（助手页）或 `spaces`（我的家页）
- 助手页加载历史时只取 source=assistant 的消息，不显示我的家的记录
- AI 上下文是连续的：从我的家拍照后 AI 记得空间结构，助手页查询时可利用
- /agent/analyze?source=spaces 或默认 assistant 区分来源
- /conversation?source=assistant 按来源过滤返回消息

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
- 年卡：¥68/年，500 次识别
- 补充包：¥18，120 次识别
- 查询不限次，只有识别（拍照/录像）扣次数
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
- [x] 付费墙 UI（年卡 + 补充包，IAP 待接入真实 API）
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
- [ ] App Store Connect 创建 IAP 产品（fangnale_yearly + fangnale_topup）
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
- 付费方案：年卡 ¥68 (500次) + 补充包 ¥18 (120次)，免费 10 次
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
- Apple Sign In 验签：Apple 公钥 JWT 验证（issuer/audience/expiry/sub），缓存公钥 1 小时
- IAP 验证：先请求生产 verifyReceipt，status 21007 自动 fallback 沙盒，按 productId 决定加次数
- IAP 产品 ID：fangnale_yearly(500次)、fangnale_topup(120次)
- Token 持久化：原生端 expo-secure-store，Web 端 localStorage，启动时恢复+验证
- JWT_SECRET 生产环境必须设置（否则 process.exit），开发环境用 fallback
- save_items 工具：所有参数可选，通用于拍照识别和手动创建空间/位置/物品
- Azure OpenAI 请求自动重试 2 次（间隔 1s/2s），防 ECONNRESET
