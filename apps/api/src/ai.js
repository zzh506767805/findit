const DEFAULT_API_VERSION = '2025-04-01-preview';

const analyzeInstructions = `You are a household item recognition assistant.
Analyze a home storage photo. Return only JSON.
Return likely location candidates and visible items. Do not invent hidden or unclear items.
Use common Chinese item names. Keep the schema exactly:
{
  "scene": "string",
  "location_candidates": [
    {
      "room_name": "string",
      "place_name": "string",
      "description": "string",
      "confidence": "high | medium | low"
    }
  ],
  "items": [
    {
      "name": "string",
      "category": "文件证件 | 电子配件 | 工具 | 药品 | 食品 | 衣物 | 日用品 | 玩具 | 其他",
      "description": "string",
      "confidence": "high | medium | low"
    }
  ],
  "uncertain_items": [
    {
      "description": "string",
      "confidence": "low"
    }
  ]
}`;

function hasAzureConfig() {
  return Boolean(
    (process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_RESPONSES_URL) &&
      process.env.AZURE_OPENAI_API_KEY &&
      process.env.AZURE_OPENAI_DEPLOYMENT
  );
}

function buildResponsesUrl() {
  const configured = process.env.AZURE_OPENAI_RESPONSES_URL || process.env.AZURE_OPENAI_ENDPOINT;
  if (!configured) return '';

  if (/\/openai\/responses/i.test(configured)) {
    return configured;
  }

  const endpoint = configured.replace(/\/+$/, '');
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION;
  return `${endpoint}/openai/responses?api-version=${encodeURIComponent(apiVersion)}`;
}

function extractResponseText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;

  const parts = [];
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === 'string') parts.push(content.text);
      if (typeof content.value === 'string') parts.push(content.value);
    }
  }
  return parts.join('\n').trim();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model did not return JSON');
    return JSON.parse(match[0]);
  }
}

function normalizeAnalysis(raw) {
  return {
    scene: String(raw.scene ?? ''),
    location_candidates: Array.isArray(raw.location_candidates)
      ? raw.location_candidates.slice(0, 3).map((location) => ({
          room_name: String(location.room_name ?? ''),
          place_name: String(location.place_name ?? location.name ?? ''),
          description: String(location.description ?? ''),
          confidence: normalizeConfidence(location.confidence)
        }))
      : [],
    items: Array.isArray(raw.items)
      ? raw.items.slice(0, 30).map((item) => ({
          name: String(item.name ?? '').trim(),
          category: String(item.category ?? '其他'),
          description: String(item.description ?? ''),
          confidence: normalizeConfidence(item.confidence)
        })).filter((item) => item.name)
      : [],
    uncertain_items: Array.isArray(raw.uncertain_items)
      ? raw.uncertain_items.slice(0, 10).map((item) => ({
          description: String(item.description ?? ''),
          confidence: 'low'
        })).filter((item) => item.description)
      : []
  };
}

function normalizeConfidence(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'medium';
}

function mockAnalyzePhoto({ locationHint }) {
  const hasHint = locationHint?.room_name || locationHint?.place_name || locationHint?.name;
  const roomName = locationHint?.room_name || '书房';
  const placeName = locationHint?.place_name || locationHint?.name || '书桌左侧抽屉';

  return {
    scene: hasHint ? `${roomName}${placeName}` : '家庭收纳位置',
    location_candidates: [
      {
        room_name: roomName,
        place_name: placeName,
        description: '本地模拟识别结果。配置 Azure OpenAI 后会使用真实视觉识别。',
        confidence: 'medium'
      }
    ],
    items: [
      {
        name: '护照',
        category: '文件证件',
        description: '深色证件本',
        confidence: 'medium'
      },
      {
        name: 'Type-C 数据线',
        category: '电子配件',
        description: '白色数据线',
        confidence: 'medium'
      }
    ],
    uncertain_items: []
  };
}

export async function analyzePhoto({ imageBase64, mimeType, locationHint }) {
  if (!hasAzureConfig()) {
    return mockAnalyzePhoto({ locationHint });
  }

  const url = buildResponsesUrl();
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;
  const userText = `用户提供的位置提示：${JSON.stringify(locationHint || {})}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.AZURE_OPENAI_API_KEY
    },
    body: JSON.stringify({
      model: process.env.AZURE_OPENAI_DEPLOYMENT,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: analyzeInstructions }]
        },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: userText },
            { type: 'input_image', image_url: dataUrl }
          ]
        }
      ],
      text: {
        format: { type: 'json_object' }
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Azure Responses API failed: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  return normalizeAnalysis(parseJson(extractResponseText(payload)));
}

export function buildSearchQueries(query) {
  const normalized = query
    .replace(/[？?。,.，!！]/g, ' ')
    .replace(/在哪|哪里|放哪|放在|我的|帮我找|找一下/g, ' ')
    .trim();
  return normalized ? [normalized] : [query.trim()];
}

export async function chatQuery(query, allItems) {
  if (!hasAzureConfig()) {
    return mockChatQuery(query, allItems);
  }

  const url = buildResponsesUrl();
  const itemsSummary = allItems.map((entry) => ({
    name: entry.item?.name,
    location: entry.location_summary,
    note: entry.note,
    date: entry.placed_at?.slice(0, 10),
    photo_url: entry.mediaAsset?.blob_url
  }));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.AZURE_OPENAI_API_KEY
    },
    body: JSON.stringify({
      model: process.env.AZURE_OPENAI_DEPLOYMENT,
      input: [
        {
          role: 'system',
          content: [{
            type: 'input_text',
            text: `你是 FindIt 家居物品助手。根据用户家中已记录的物品数据回答问题。

规则：
1. 如果找到匹配物品，用简短自然的中文回答位置和记录时间。
2. 支持模糊理解，比如用户说"充电器"可以匹配"Type-C 数据线"。
3. 如果有多个匹配，全部列出。
4. 如果没找到，说没有记录，建议用户拍照记录。
5. 不要编造数据里没有的物品或位置。

用户家中物品数据：
${JSON.stringify(itemsSummary)}

返回 JSON：
{
  "answer": "自然语言回答",
  "matched_items": ["匹配的物品名称"],
  "found": true/false
}`
          }]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: query }]
        }
      ],
      text: { format: { type: 'json_object' } }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Azure API failed: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  return parseJson(extractResponseText(payload));
}

function mockChatQuery(query, allItems) {
  const q = query.replace(/在哪|哪里|放哪|放在|我的|帮我找|找一下|？|\?/g, '').trim();
  const match = allItems.find((entry) =>
    entry.item?.name && entry.item.name.toLowerCase().includes(q.toLowerCase())
  );
  if (!match) {
    return { answer: `还没有找到"${q}"的记录。你可以拍一张照片先记录它的位置。`, matched_items: [], found: false };
  }
  return {
    answer: `${match.item.name}上次记录在「${match.location_summary}」。记录时间是 ${match.placed_at?.slice(0, 10)}。`,
    matched_items: [match.item.name],
    found: true
  };
}

export function getAzureConfigStatus() {
  return {
    hasEndpoint: Boolean(process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_RESPONSES_URL),
    hasKey: Boolean(process.env.AZURE_OPENAI_API_KEY),
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || null,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION
  };
}
