# FindIt MVP

FindIt 是一个轻量家庭物品定位助手：

1. 手机拍一张收纳照片。
2. 模型识别位置和物品。
3. 用户确认后保存。
4. 之后直接问“XX 在哪”。

## 项目结构

```text
apps/api      API 服务，PostgreSQL 数据库存储，支持 Azure OpenAI Responses API
apps/mobile   Expo 手机端
docs          产品和技术方案
```

## 本地运行

安装依赖：

```bash
npm install --registry=https://registry.npmjs.org/
```

启动 API：

```bash
npm run dev:api
```

另开终端启动手机端：

```bash
npm run dev:mobile:lan
```

手机安装 Expo Go 后，扫描终端里的二维码即可测试。

## Azure OpenAI

API 会读取 `apps/api/.env`。如果没有 Azure 配置，图片识别会走本地模拟结果，方便先测流程。

需要的变量：

```bash
PORT=4000
DATABASE_URL=postgres://user:password@host:5432/findit
JWT_SECRET=生成一个足够长的随机字符串
AZURE_OPENAI_RESPONSES_URL=https://your-resource.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_DEPLOYMENT=gpt-5.4-mini
AZURE_OPENAI_API_VERSION=2025-04-01-preview
AZURE_STORAGE_ACCOUNT=your-storage-account
AZURE_STORAGE_KEY=your-storage-key
AZURE_STORAGE_CONTAINER=data
APPLE_IAP_SHARED_SECRET=your-app-store-shared-secret
```

`apps/api/.env` 已在 `.gitignore` 中。

## 手机连接

App 默认会根据 Expo 的 LAN 地址推导 API 地址：

```text
http://你的电脑局域网 IP:4000
```

如果手机连不上，可以点 App 顶部设置按钮，手动改 API 地址。

电脑和手机需要在同一个 Wi-Fi。

## Cloudflare 正式 API（2026-11-09）

正式 API 为 https://findit-api.dressmeai.com，业务使用 Workers + D1 + 私有 R2。旧 Azure Container Apps 地址仅供已安装旧 App 兼容，空闲缩容到 0；旧 PostgreSQL 已只读暂停。新 iOS 1.0.3/build 15 已于 2026-11-09 通过 Apple 审核并自动发布，全球销售范围为全部 175 地区，中美商店均已确认新版。

- 检查：npm run check；Worker 集成：npm run test:cloudflare。
- 预发布：npx wrangler deploy；正式：npx wrangler deploy --config wrangler.production.jsonc。
- 媒体通过任务槽位流式上传，原始照片/HEIC/视频完整保存；设备提供 JPEG 识别副本、缩略图及视频帧。
- 扣次数、Apple 购买、邀请/欢迎权益和确认保存以 D1 原子批处理为准。中断任务幂等退回，账号删除会清理 R2。
- 备份/密钥仅保存在忽略的 .migration/；迁移过程与回滚见 docs/cloudflare迁移执行记录-2026-11-08.md。
- 免费容量足够当前规模，CPU 冷启动仍须监控；AI 调用、旧 Azure 按需兼容与保留备份不等于免费。
