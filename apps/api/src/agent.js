import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { toolDefinitions, executeTool } from './tools.js';

const execFileAsync = promisify(execFile);

const DEFAULT_API_VERSION = '2025-04-01-preview';

const SYSTEM_PROMPT = `你是 FindIt 家庭记忆助手。你管理用户家中物品的位置记录。

你有两种工作模式：

【识别模式】当用户发来照片时：
1. 先用 list_spaces 和 list_positions 了解用户家的已有结构。
2. 判断照片属于哪个空间和位置。如果是已有位置，用已有名称。
3. 如果该位置有历史照片，用 view_photo 查看旧照片，对比变化。
4. 识别照片中的物品，按容器分组。
5. 标注每个物品的状态：existing（已有）、new（新增）、missing（上次有但现在没看到）。
6. 调用 suggest_save 提交建议，等待用户确认。

【查找模式】当用户问"XX在哪"时：
1. 用 search_items 搜索物品记录。
2. 如果需要确认，用 view_photo 查看证据照片。
3. 用自然中文回答，包含完整位置路径和记录时间。
4. 如果能在照片中指出物品具体位置，描述出来。

识别规则：
- 物品名称用用户日后会搜的词，不用视觉描述词。
- 如果能辨认品牌/型号，优先用品牌名。
- 容器本身不作为物品记录，但作为物品的归属信息。
- 看不清的物品不要猜，放到 uncertain_items 里。
- 不要编造数据库里没有的信息。
- description 必须包含视觉特征：颜色、品牌、材质、形状、大小、文字/logo。这些特征是用户日后模糊搜索的关键。例如"绿色, Nike, 棉质, 圆领, 胸前有白色logo"。

查找规则：
- 用户可能用模糊描述搜索，如"绿色的衣服""那个耐克的"。
- 先用最关键的词搜索。如果结果不够，拆分关键词多次搜索。例如"绿色耐克鞋"→ 先搜"鞋"，再从结果的description里找"绿色"和"耐克"。
- search_items 会同时搜索物品名称和描述，善用颜色、品牌等特征词。`;

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
  if (/\/openai\/responses/i.test(configured)) return configured;
  const endpoint = configured.replace(/\/+$/, '');
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION;
  return `${endpoint}/openai/responses?api-version=${encodeURIComponent(apiVersion)}`;
}

export function getAzureConfigStatus() {
  return {
    hasEndpoint: Boolean(process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_RESPONSES_URL),
    hasKey: Boolean(process.env.AZURE_OPENAI_API_KEY),
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || null
  };
}

async function callResponsesApi(input, tools, previousResponseId) {
  const url = buildResponsesUrl();
  const body = {
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    input,
    tools,
    tool_choice: 'auto'
  };
  if (previousResponseId) body.previous_response_id = previousResponseId;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.AZURE_OPENAI_API_KEY
      },
      body: JSON.stringify(body)
    });
  } catch (fetchErr) {
    const cause = fetchErr.cause ? `: ${fetchErr.cause.message || fetchErr.cause}` : '';
    throw new Error(`Azure fetch failed${cause}`);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Azure Responses API failed: ${response.status} ${detail}`);
  }
  return response.json();
}

function extractOutputs(payload) {
  const outputs = payload.output || [];
  const toolCalls = [];
  let text = '';

  for (const item of outputs) {
    if (item.type === 'function_call') {
      toolCalls.push({
        id: item.call_id || item.id,
        name: item.name,
        arguments: typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments
      });
    }
    if (item.type === 'message') {
      for (const content of item.content || []) {
        if (content.type === 'output_text' || content.type === 'text') {
          text += content.text || '';
        }
      }
    }
  }
  if (!text && typeof payload.output_text === 'string') {
    text = payload.output_text;
  }
  return { toolCalls, text };
}

async function compressImageBase64(base64Str, maxDim = 1024, quality = 80) {
  const dir = path.join(tmpdir(), `findit_compress_${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const inPath = path.join(dir, 'in.jpg');
  const outPath = path.join(dir, 'out.jpg');
  await writeFile(inPath, Buffer.from(base64Str, 'base64'));
  try {
    await execFileAsync('ffmpeg', [
      '-i', inPath, '-vf', `scale='min(${maxDim},iw)':min'(${maxDim},ih)':force_original_aspect_ratio=decrease`,
      '-q:v', String(Math.round((100 - quality) / 3.3)), '-y', outPath
    ]);
    const compressed = await readFile(outPath);
    return compressed.toString('base64');
  } catch {
    return base64Str; // fallback to original if ffmpeg fails
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function buildImageInput(imageBase64, mimeType) {
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;
  return { type: 'input_image', image_url: dataUrl };
}

function buildImageUrl(url) {
  return { type: 'input_image', image_url: url };
}

export async function runAgent({ mode, query, imageBase64, blobUrl, videoFrames, mimeType, userId, uploadDir, onEvent }) {
  if (!hasAzureConfig()) {
    return runMockAgent({ mode, query, imageBase64, userId, onEvent });
  }

  const emit = onEvent || (() => {});
  const isRealUrl = blobUrl?.startsWith('https://');
  let input = [
    { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] }
  ];

  if (mode === 'analyze' && videoFrames?.length) {
    const content = [
      { type: 'input_text', text: `这是一段视频的${videoFrames.length}个截帧，请综合所有帧识别物品和位置。` },
      ...videoFrames.map(f => buildImageInput(f, 'image/jpeg'))
    ];
    input.push({ role: 'user', content });
  } else if (mode === 'analyze' && (isRealUrl || imageBase64)) {
    // Prefer Blob URL (faster, no base64 overhead), fallback to compressed base64
    const imageContent = isRealUrl
      ? buildImageUrl(blobUrl)
      : buildImageInput(await compressImageBase64(imageBase64), 'image/jpeg');
    input.push({
      role: 'user',
      content: [
        { type: 'input_text', text: '请识别这张照片中的物品和位置。' },
        imageContent
      ]
    });
  } else {
    input.push({
      role: 'user',
      content: [{ type: 'input_text', text: query }]
    });
  }

  const tools = toolDefinitions.map((t) => ({ type: t.type, name: t.name, description: t.description, parameters: t.parameters }));
  let suggestion = null;
  const MAX_ROUNDS = 8;

  let prevResponseId = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const payload = await callResponsesApi(input, tools, prevResponseId);
    prevResponseId = payload.id || null;
    const { toolCalls, text } = extractOutputs(payload);

    if (toolCalls.length === 0) {
      if (text) emit({ type: 'answer', text });
      break;
    }

    const toolOutputs = [];

    for (const call of toolCalls) {
      emit({ type: 'tool_call', tool: call.name, args: call.arguments });

      let result;
      if (call.name === 'view_photo') {
        const viewResult = await executeTool(call.name, call.arguments, userId, uploadDir);
        if (viewResult.blob_url) {
          try {
            let imageContent;
            if (viewResult.blob_url.startsWith('https://')) {
              imageContent = buildImageUrl(viewResult.blob_url);
            } else {
              const filePath = path.join(uploadDir, path.basename(viewResult.blob_url));
              const fileData = await readFile(filePath);
              const base64 = await compressImageBase64(fileData.toString('base64'));
              imageContent = buildImageInput(base64, 'image/jpeg');
            }
            // Return tool output as string, then append image as user message
            toolOutputs.push({
              type: 'function_call_output',
              call_id: call.id,
              output: JSON.stringify({ viewed: true, media_asset_id: viewResult.media_asset_id, question: viewResult.question })
            });
            toolOutputs.push({
              role: 'user',
              content: [imageContent]
            });
            emit({ type: 'tool_result', tool: call.name, result: { viewed: true, blob_url: viewResult.blob_url } });
          } catch {
            result = { error: '无法读取照片文件' };
            emit({ type: 'tool_result', tool: call.name, result });
            toolOutputs.push({ type: 'function_call_output', call_id: call.id, output: JSON.stringify(result) });
          }
        } else {
          result = viewResult;
          emit({ type: 'tool_result', tool: call.name, result });
          toolOutputs.push({ type: 'function_call_output', call_id: call.id, output: JSON.stringify(result) });
        }
      } else {
        result = await executeTool(call.name, call.arguments, userId, uploadDir);
        emit({ type: 'tool_result', tool: call.name, result });
        toolOutputs.push({ type: 'function_call_output', call_id: call.id, output: JSON.stringify(result) });
      }

      if (call.name === 'suggest_save' && result?.suggestion) {
        suggestion = result.suggestion;
      }
    }

    input = toolOutputs;
  }

  emit({ type: 'done', suggestion });
  return { suggestion };
}

async function runMockAgent({ mode, query, imageBase64, userId, onEvent }) {
  const emit = onEvent || (() => {});

  if (mode === 'analyze') {
    emit({ type: 'tool_call', tool: 'list_spaces', args: {} });
    const spacesResult = await executeTool('list_spaces', {}, userId);
    emit({ type: 'tool_result', tool: 'list_spaces', result: spacesResult });

    await delay(300);

    const suggestion = {
      space: { name: '书房', is_new: spacesResult.length === 0 },
      position: { name: '书桌', is_new: true, description: '模拟识别结果' },
      containers: [
        {
          name: '第一层抽屉',
          items: [
            { name: '护照', description: '深色证件本', status: 'new' },
            { name: 'Type-C 数据线', description: '白色数据线', status: 'new' }
          ]
        }
      ],
      loose_items: [],
      uncertain_items: []
    };

    emit({ type: 'tool_call', tool: 'suggest_save', args: suggestion });
    emit({ type: 'tool_result', tool: 'suggest_save', result: { type: 'suggestion', suggestion } });
    emit({ type: 'answer', text: '这是书房的书桌。在第一层抽屉里发现了护照和Type-C数据线。请确认是否保存。' });
    emit({ type: 'done', suggestion });
    return { suggestion };
  }

  emit({ type: 'tool_call', tool: 'search_items', args: { query } });
  const searchResult = await executeTool('search_items', { query: query.replace(/在哪|哪里|放哪|放在|我的|帮我找|找一下|？|\?/g, '').trim() }, userId);
  emit({ type: 'tool_result', tool: 'search_items', result: searchResult });

  await delay(200);

  if (searchResult.results?.length) {
    const best = searchResult.results[0];
    emit({ type: 'answer', text: `${best.item_name}在${best.location_path}${best.container ? '的' + best.container + '里' : ''}。记录时间是 ${best.recorded_at?.slice(0, 10)}。` });
  } else {
    emit({ type: 'answer', text: `没有找到相关记录。你可以拍张照片记录一下。` });
  }
  emit({ type: 'done' });
  return {};
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
