# FindIt - 家居物品定位助手

> 拍照记录，语音查找，再也不忘东西放哪了。

## 1. 产品概述

FindIt 帮助用户通过拍照/录像记录家中物品的位置，AI 自动识别并建立「位置-物品」映射。后续用户只需问"XX在哪"，即可快速定位物品并查看原始照片。

### 目标用户
- 经常忘记物品放置位置的人
- 搬家/整理收纳后需要记录物品位置的人
- 家庭成员间共享物品位置信息

### 核心价值
- 拍一张照片，AI 自动识别多个物品及所在位置
- 自然语言查询，秒级定位
- 附带原始照片，视觉确认

---

## 2. MVP 功能范围

### P0 - 必须有
| 功能 | 描述 |
|------|------|
| 拍照上传 | 拍照或从相册选择照片上传 |
| AI 识别 | 自动识别照片中的房间类型、物品列表及位置描述 |
| 位置管理 | 用户可创建/编辑房间和存放位置（如「客厅-电视柜第二层」） |
| 物品管理 | 查看所有已记录物品，支持手动修正 AI 识别结果 |
| 搜索查找 | 输入物品名称，返回位置信息 + 原始照片 |
| 用户认证 | 手机号/邮箱注册登录 |

### P1 - 应该有
| 功能 | 描述 |
|------|------|
| 视频上传 | 上传视频，自动抽帧分析多个区域 |
| 自然语言问答 | 对话式查询（"我的护照放哪了"） |
| 物品分类标签 | 自动/手动给物品打标签（文件、工具、衣物等） |
| 搜索历史 | 记录查找历史，高频查找物品置顶 |

### P2 - 可以有
| 功能 | 描述 |
|------|------|
| 家庭共享 | 多人共享同一个家的物品数据 |
| 语音输入 | 语音问"XX在哪" |
| 过期提醒 | 食品/药品等有保质期的物品到期提醒 |
| 多房屋支持 | 管理多个住所的物品 |

---

## 3. 技术架构

```
+-------------------+        +----------------------+        +------------------+
|                   |        |                      |        |                  |
|  React Native     | <----> |  Azure Functions     | <----> |  Azure Cosmos DB |
|  (Expo)           |  REST  |  (Node.js/TS)        |        |  (PostgreSQL)    |
|                   |        |                      |        |                  |
+-------------------+        +----------+-----------+        +------------------+
                                        |
                              +---------+---------+
                              |                   |
                     +--------+------+   +--------+--------+
                     |               |   |                  |
                     | Azure OpenAI  |   | Azure Blob      |
                     | GPT-4o        |   | Storage          |
                     | (Vision AI)   |   | (图片/视频存储)   |
                     |               |   |                  |
                     +---------------+   +-----------------+
```

### 3.1 前端 - React Native (Expo)

**选型理由：** 跨平台、Expo 生态完善、开发效率高、MVP 快速迭代

**主要依赖：**
- `expo-camera` - 拍照
- `expo-image-picker` - 相册选择
- `expo-av` - 视频处理
- `react-navigation` - 页面导航
- `zustand` - 状态管理
- `react-query` - 数据请求缓存

**页面结构：**
```
App
├── Auth (登录/注册)
├── Home (首页 - 搜索框 + 最近物品)
├── Camera (拍照/录像)
├── Analysis (AI 分析结果确认/编辑)
├── Rooms (房间和位置管理)
│   └── RoomDetail (房间详情 - 位置列表)
├── Items (所有物品列表)
│   └── ItemDetail (物品详情 - 位置+照片)
└── Profile (个人设置)
```

### 3.2 后端 - Azure Functions (Node.js/TypeScript)

**选型理由：** Serverless 免运维、按量付费、冷启动可接受（MVP 阶段）

**API 设计：**

```
POST   /api/auth/register          # 注册
POST   /api/auth/login             # 登录

POST   /api/photos/upload          # 上传照片，返回 Blob URL
POST   /api/photos/analyze         # 调用 GPT-4o 分析照片
GET    /api/photos/:id             # 获取照片信息

POST   /api/rooms                  # 创建房间
GET    /api/rooms                  # 获取用户所有房间
PUT    /api/rooms/:id              # 更新房间
DELETE /api/rooms/:id              # 删除房间

POST   /api/locations              # 创建位置（属于某个房间）
GET    /api/locations?roomId=xx    # 获取房间下的位置
PUT    /api/locations/:id          # 更新位置
DELETE /api/locations/:id          # 删除位置

POST   /api/items                  # 创建/记录物品
GET    /api/items                  # 获取用户所有物品
GET    /api/items/search?q=护照    # 搜索物品
PUT    /api/items/:id              # 更新物品信息
DELETE /api/items/:id              # 删除物品

POST   /api/chat                   # 自然语言问答（P1）
```

### 3.3 AI 分析 - Azure OpenAI GPT-4o

**分析流程：**
```
照片上传 → Blob Storage 存储 → GPT-4o Vision 分析 → 结构化结果 → 用户确认 → 入库
```

**Prompt 设计思路：**
```
系统提示：你是一个家居物品识别助手。分析用户上传的照片，识别：
1. 房间类型（客厅/卧室/厨房/卫生间/书房/储物间/其他）
2. 可见的存放位置（桌面、抽屉、柜子、架子等）
3. 可识别的物品列表，每个物品包含：
   - 物品名称
   - 所在位置描述
   - 物品类别（电子/文件/工具/衣物/食品/日用品/其他）
   - 置信度（high/medium/low）

以 JSON 格式返回。
```

**示例输出：**
```json
{
  "room_type": "书房",
  "locations": [
    { "name": "书桌", "description": "靠窗的木质书桌" },
    { "name": "书架", "description": "书桌左侧三层书架" }
  ],
  "items": [
    {
      "name": "MacBook Pro",
      "location": "书桌",
      "category": "电子",
      "confidence": "high"
    },
    {
      "name": "护照",
      "location": "书架第二层",
      "category": "文件",
      "confidence": "medium"
    }
  ]
}
```

**视频处理（P1）：**
- 使用 `ffmpeg` 每 2 秒抽取 1 帧
- 过滤重复/模糊帧
- 逐帧送入 GPT-4o 分析
- 合并去重结果

### 3.4 数据库 - Azure Cosmos DB (PostgreSQL)

**数据模型：**

```sql
-- 用户表
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) UNIQUE,
    phone         VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(100),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 房屋表
CREATE TABLE houses (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES users(id),
    name       VARCHAR(100) NOT NULL,  -- "我的家"
    address    TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 房间表
CREATE TABLE rooms (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    house_id   UUID REFERENCES houses(id),
    name       VARCHAR(100) NOT NULL,  -- "主卧"
    type       VARCHAR(50),            -- bedroom/kitchen/living_room...
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 位置表（房间内的具体存放位置）
CREATE TABLE locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     UUID REFERENCES rooms(id),
    name        VARCHAR(100) NOT NULL,  -- "床头柜第二层抽屉"
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 物品表
CREATE TABLE items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id),
    location_id UUID REFERENCES locations(id),
    name        VARCHAR(200) NOT NULL,
    category    VARCHAR(50),
    tags        TEXT[],                  -- 标签数组
    notes       TEXT,
    confidence  VARCHAR(10),             -- AI 识别置信度
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 照片表
CREATE TABLE photos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id),
    room_id     UUID REFERENCES rooms(id),
    blob_url    TEXT NOT NULL,
    thumbnail   TEXT,
    ai_analysis JSONB,                   -- GPT-4o 原始分析结果
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 物品-照片关联表
CREATE TABLE item_photos (
    item_id  UUID REFERENCES items(id),
    photo_id UUID REFERENCES photos(id),
    PRIMARY KEY (item_id, photo_id)
);

-- 搜索优化索引
CREATE INDEX idx_items_name ON items USING gin(to_tsvector('simple', name));
CREATE INDEX idx_items_user ON items(user_id);
CREATE INDEX idx_items_location ON items(location_id);
```

### 3.5 存储 - Azure Blob Storage

```
Container: findit-photos
├── {user_id}/
│   ├── originals/       # 原始照片
│   │   └── {photo_id}.jpg
│   ├── thumbnails/      # 缩略图（前端列表用）
│   │   └── {photo_id}_thumb.jpg
│   └── frames/          # 视频抽帧（P1）
│       └── {video_id}_{frame_n}.jpg
```

- 上传使用 SAS Token，前端直传 Blob Storage
- 缩略图由 Azure Functions 触发生成

---

## 4. 用户流程

### 4.1 首次使用
```
注册/登录 → 创建房屋 → 拍第一张照片 → AI 识别并建议房间/位置/物品
→ 用户确认或修正 → 数据入库 → 完成引导
```

### 4.2 日常记录
```
打开相机 → 拍照 → 选择/新建房间 → AI 分析
→ 展示识别结果（物品列表）→ 用户确认/修正/补充 → 保存
```

### 4.3 查找物品
```
首页搜索框输入"护照" → 显示匹配结果：
┌─────────────────────────────┐
│  护照                        │
│  位置：书房 > 书架第二层       │
│  记录时间：2024-03-15         │
│  [查看照片]                   │
└─────────────────────────────┘
```

---

## 5. Azure 资源清单与成本估算（MVP）

| 资源 | SKU | 预估月费 |
|------|-----|---------|
| Azure Functions | Consumption Plan | ~$0（免费额度 100 万次/月） |
| Azure Cosmos DB (PostgreSQL) | Burstable, 1 vCore | ~$30 |
| Azure Blob Storage | LRS, Hot | ~$2（< 10GB） |
| Azure OpenAI (GPT-4o) | Pay-as-you-go | ~$10-30（取决于使用量） |
| Azure AD B2C（认证） | 免费层 | $0（前 5 万用户免费） |
| **合计** | | **~$40-60/月** |

---

## 6. 项目结构

```
Find/
├── docs/                     # 文档
│   └── PRD.md
├── app/                      # React Native (Expo) 前端
│   ├── app.json
│   ├── package.json
│   ├── src/
│   │   ├── screens/          # 页面
│   │   ├── components/       # 组件
│   │   ├── services/         # API 调用
│   │   ├── stores/           # 状态管理
│   │   ├── types/            # TypeScript 类型
│   │   └── utils/            # 工具函数
│   └── assets/               # 静态资源
├── api/                      # Azure Functions 后端
│   ├── package.json
│   ├── host.json
│   ├── src/
│   │   ├── functions/        # 各 API 函数
│   │   ├── services/         # 业务逻辑
│   │   ├── models/           # 数据模型
│   │   └── utils/            # 工具函数
│   └── infra/                # Azure 基础设施配置
│       └── main.bicep        # IaC 模板
└── README.md
```

---

## 7. 开发计划

### Phase 1 — 基础骨架（1 周）
- [ ] 初始化 Expo 项目 + Azure Functions 项目
- [ ] Azure 资源部署（Cosmos DB, Blob Storage, OpenAI）
- [ ] 用户认证（注册/登录）
- [ ] 照片上传 + Blob 存储

### Phase 2 — AI 核心能力（1 周）
- [ ] GPT-4o 照片分析 Prompt 调优
- [ ] 分析结果展示 + 用户确认/编辑页面
- [ ] 房间/位置/物品 CRUD

### Phase 3 — 搜索与体验（1 周）
- [ ] 物品搜索功能
- [ ] 搜索结果展示（位置+照片）
- [ ] 首页设计（搜索框+最近记录）
- [ ] 整体 UI 打磨

### Phase 4 — 测试与上线
- [ ] 端到端测试
- [ ] TestFlight / 内部测试
- [ ] 性能优化（图片压缩、缓存策略）
