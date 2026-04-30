# FindIt（放哪了—AI收纳师）

## 项目概述

拍照/录像记录家中物品位置，AI 自动识别并记住。问"XX在哪"，AI 查库+看照片回答。

## 技术栈

- 前端：React Native (Expo SDK 54/55)
- 后端：Node.js（原生 HTTP，无框架，Dockerfile 含 ffmpeg）
- 数据库：PostgreSQL (Azure Flexible Server)
- AI：Azure OpenAI Responses API (gpt-5.5) + 工具调用
- 部署：Azure Container Apps (Japan East)
- 图片上传：FormData multipart → Blob Storage（已改掉 base64）

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
- 6 张表：users, spaces, positions, media_assets, items, item_records
- users 额外字段：apple_user_id, free_credits(默认10), paid_credits, subscription_expires_at
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
│   │       ├── sse.js            # SSE 流式请求 + FormData 上传（XMLHttpRequest）
│   │       ├── theme.js          # 配色（米白浅色方案）
│   │       ├── ui.js             # 通用组件
│   │       ├── components/
│   │       │   ├── AgentWorkflow.js   # AI 工作流步骤展示（含 Markdown 渲染）
│   │       │   └── SuggestionCard.js  # 识别结果确认/编辑卡片
│   │       └── screens/
│   │           ├── LoginScreen.js       # Apple Sign In + 开发模式 demo 登录
│   │           ├── PaywallScreen.js     # 付费墙（年卡 + 补充包）
│   │           ├── AssistantScreen.js   # 助手页（对话，支持拍照/录像/文字）
│   │           ├── SpacesScreen.js      # 我的家（空间列表）
│   │           └── SpaceDetailScreen.js # 空间详情
│   └── api/                      # Node.js 后端
│       ├── Dockerfile            # node:22-slim + ffmpeg（视频截帧用）
│       ├── .env                  # 环境变量（不提交）
│       └── src/
│           ├── server.js         # HTTP 路由 + SSE + FormData 解析
│           ├── store.js          # PostgreSQL 数据访问 + 用量计费
│           ├── agent.js          # Responses API + 工具调用循环 + 图片压缩
│           └── tools.js          # Agent 工具定义和执行
```

## 架构

```
Expo App → API (Container Apps) → PostgreSQL
         (FormData upload)      → Blob Storage (照片/视频帧)
                                → Azure OpenAI (Responses API + tools)
```

### Agent 工具

- list_spaces — 列出空间
- list_positions — 列出位置
- get_position_items — 获取位置物品
- view_photo — 查看历史照片（支持 Blob URL 直传 AI）
- search_items — 搜索物品（匹配 name + description，支持颜色/品牌等特征）
- suggest_save — 提交识别建议（需用户确认）

### 数据三层结构

空间(Space) → 位置(Position) → 容器(container字段) → 物品(Item)

### 用量计费

- 免费：10 次识别（注册时赠送）
- 年卡：¥68/年，500 次识别
- 补充包：¥18，120 次识别
- 查询不限次，只有识别（拍照/录像）扣次数
- 后端 /agent/analyze 接口调用前 consumeCredit，余额不足返回 403

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

### 待做（上架阻断项）
- [ ] ICP 备案提交（阿里云，需轻量服务器做备案落地）
- [ ] Apple IAP 接入真实 API（替换开发模式模拟购买）
- [ ] Apple Sign In identityToken 服务端验证
- [ ] App 图标 + 截图
- [ ] 隐私政策 + 用户协议
- [ ] EAS Build 打包 + TestFlight 测试
- [ ] 提交 App Store 审核

### 后续迭代
- [ ] 微信/手机号登录
- [ ] 上下文对话（previous_response_id + compaction）
- [ ] iCloud 数据备份
- [ ] 新手引导
- [ ] 识别 prompt 持续调优
- [ ] GitHub Actions 自动部署

## 决策记录

- 不做 aliases（过度设计）
- 容器信息存在 item_records.container 字段，不单独建表
- 一个 Agent 两种模式（识别/查找），不拆多 Agent
- 配色用米白浅色方案（theme.js 统一管理），照片是唯一色彩
- 登录方案：强制 Apple Sign In（上架要求）
- 付费方案：年卡 ¥68 (500次) + 补充包 ¥18 (120次)，免费 10 次
- 查询不计次，只有识别扣次数（AI 调用成本控制）
- 日本区部署（Container Apps + PostgreSQL），阿里云做备案落地
- 图片用 FormData multipart 上传到 Blob Storage，不用 base64
- 视频用 ffmpeg 截帧后多帧发给 AI 识别
- 物品 description 必须包含视觉特征（颜色/品牌/材质），提升模糊搜索召回
- 防火墙开发阶段全开，上线前收紧
