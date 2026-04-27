# FindIt MVP

FindIt 是一个轻量家庭物品定位助手：

1. 手机拍一张收纳照片。
2. 模型识别位置和物品。
3. 用户确认后保存。
4. 之后直接问“XX 在哪”。

## 项目结构

```text
apps/api      本地 API 服务，JSON 文件存储，支持 Azure OpenAI Responses API
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
AZURE_OPENAI_RESPONSES_URL=https://your-resource.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_DEPLOYMENT=gpt-5.5
AZURE_OPENAI_API_VERSION=2025-04-01-preview
```

`apps/api/.env` 已在 `.gitignore` 中。

## 手机连接

App 默认会根据 Expo 的 LAN 地址推导 API 地址：

```text
http://你的电脑局域网 IP:4000
```

如果手机连不上，可以点 App 顶部设置按钮，手动改 API 地址。

电脑和手机需要在同一个 Wi-Fi。
