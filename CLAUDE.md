# FindIt - 家居物品定位助手

## 项目概述

拍照记录家中物品位置，AI 自动识别并记住。问"XX在哪"，AI 查库+看照片回答。

## 技术栈

- 前端：React Native (Expo SDK 54/55)
- 后端：Node.js（原生 HTTP，无框架）
- 数据库：PostgreSQL (Azure Flexible Server)
- AI：Azure OpenAI Responses API (gpt-5.5) + 工具调用
- 部署：Azure Container Apps (Japan East)

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

## 数据库

- 服务器：findit-db.postgres.database.azure.com
- 数据库名：findit
- 用户：finditadmin
- 6 张表：users, spaces, positions, media_assets, items, item_records

## 项目结构

```
Find/
├── docs/                        # 方案文档
│   ├── PRD.md
│   ├── 方案对比.md
│   ├── v2-agent-plan.md          # 当前方案
│   └── light-vision-mvp/
├── apps/
│   ├── mobile/                   # Expo App
│   │   ├── App.js                # 入口，顶部 tab 切换
│   │   └── src/
│   │       ├── api.js            # HTTP 请求
│   │       ├── sse.js            # SSE 流式请求（XMLHttpRequest）
│   │       ├── theme.js          # 配色（米白浅色方案）
│   │       ├── ui.js             # 通用组件
│   │       ├── components/
│   │       │   ├── AgentWorkflow.js   # AI 工作流步骤展示
│   │       │   └── SuggestionCard.js  # 识别结果确认/编辑卡片
│   │       └── screens/
│   │           ├── AssistantScreen.js   # 助手页（对话）
│   │           ├── SpacesScreen.js      # 我的家（空间列表）
│   │           └── SpaceDetailScreen.js # 空间详情
│   └── api/                      # Node.js 后端
│       ├── Dockerfile
│       ├── .env                  # 环境变量（不提交）
│       └── src/
│           ├── server.js         # HTTP 路由 + SSE
│           ├── store.js          # PostgreSQL 数据访问
│           ├── agent.js          # Responses API + 工具调用循环
│           └── tools.js          # Agent 工具定义和执行
```

## 架构

```
Expo App → API (Container Apps) → PostgreSQL
                                → Azure OpenAI (Responses API + tools)
                                → Blob Storage (照片)
```

### Agent 工具

- list_spaces — 列出空间
- list_positions — 列出位置
- get_position_items — 获取位置物品
- view_photo — 查看历史照片
- search_items — 搜索物品
- suggest_save — 提交识别建议（需用户确认）

### 数据三层结构

空间(Space) → 位置(Position) → 容器(container字段) → 物品(Item)

## 发布流程

每次改完代码后，按以下顺序操作：

```bash
# 1. 推代码到 GitHub
git add -A && git commit -m "描述改了什么" && git push

# 2. 后端有改动时，重新部署
cd apps/api
az acr build --registry nbpacr --resource-group nbp-rg --image findit-api:latest --file Dockerfile .
az containerapp update --name findit-api --resource-group nbp-rg --image nbpacr.azurecr.io/findit-api:latest

# 3. 前端有改动时，重新打包（等 EAS Build 配好后）
cd apps/mobile
npx eas-cli build --profile preview --platform ios
```

注意：目前没有自动部署，每次都需要手动执行。

## 上架计划

### 已完成
- [x] 后端部署到 Azure
- [x] PostgreSQL 数据库
- [x] AI Agent 工具调用
- [x] 两页 UI（助手 + 我的家）
- [x] SSE 流式展示 agent 工作流

### 待做（等开发者账号激活）
- [ ] Apple Sign In 登录（强制）
- [ ] Apple IAP 订阅付费
- [ ] App 图标 + 截图
- [ ] 隐私政策 + 用户协议
- [ ] eas.json 配置 + 打包
- [ ] 提交 App Store 审核

### 待做（等域名 + ICP 备案）
- [ ] 买域名
- [ ] 阿里云轻量服务器（备案落地）
- [ ] ICP 备案提交
- [ ] 备案号填入 App Store Connect

### 后续迭代
- [ ] 微信/手机号登录
- [ ] 图片改 Blob Storage 上传（替代 base64）
- [ ] 上下文对话（previous_response_id + compaction）
- [ ] iCloud 数据备份
- [ ] 新手引导
- [ ] 识别 prompt 调优

## 决策记录

- 不做 aliases（过度设计）
- 容器信息存在 item_records.container 字段，不单独建表
- 一个 Agent 两种模式（识别/查找），不拆多 Agent
- 配色用米白浅色方案，照片是唯一色彩
- 登录方案：强制 Apple Sign In
- 付费方案：Apple IAP 订阅，客户端验证 receipt
- 日本区部署（和 OpenAI 调用延迟折中），阿里云做备案落地
