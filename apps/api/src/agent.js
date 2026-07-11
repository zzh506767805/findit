import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { toolDefinitions, executeTool } from './tools.js';
import { getBlobSasUrl } from './blob.js';
import { getSpacesList, getPositionsBySpaceName } from './store.js';
import { inferSpaceNameForPosition, isLikelyPositionName } from './locationRules.js';

const execFileAsync = promisify(execFile);

const DEFAULT_API_VERSION = '2025-04-01-preview';
const PLACEHOLDER_POSITION_RE = /待识别|未识别|^(图片|照片|未知|未知位置|临时位置|默认位置|其他)$/;

function isPlaceholderPositionName(name) {
  return PLACEHOLDER_POSITION_RE.test(String(name || '').trim());
}

const SYSTEM_PROMPT = `你是 FindIt 家庭记忆助手，帮用户记录和查找家中物品。

## 能力
你可以用工具查询数据库、查看历史照片、提交识别建议。尽量并行调用多个工具以提高效率。
重要ID规则：position_id 是位置ID，只能用于 get_position_items / view_position_photo；media_asset_id / latest_photo_id 是照片ID，才能用于 view_photo。不要把 position_id 当 media_asset_id 传给 view_photo。

## 数据结构定义
- 空间 space：房间或家里的大区域，例如客厅、卧室、厨房、玄关、走廊。
- 位置 position：空间里的真实家具、收纳点、台面、地面或局部区域，例如电视柜、茶几、书桌、玄关柜、走廊地面、客厅一角。位置必须是用户能在家里找到的物理地点。
- 物品 item：用户日后会问"XX在哪"的具体东西，例如护照、数据线、剪刀、遥控器。
- space.name 只能是房间或大区域，禁止写家具、台面、收纳点、容器名，例如"梳妆台"、"床头柜"、"衣柜"、"书桌"、"书架"、"电视柜"、"茶几"、"鞋柜"、"冰箱"、"洗手台"、"收纳盒"。这些只能写入 position.name。
- 不要把照片状态、任务状态或占位词当成位置。position.name 禁止使用"待识别图片"、"待识别"、"图片"、"照片"、"未知位置"、"临时位置"、"其他"等名字。

## 识别照片
收到照片时：
- "当前家庭数据"已包含空间和位置列表，直接使用，不需要再调 list_spaces / list_positions
- 如果有空间提示且它是房间/大区域，space.name 必须使用该空间；如果空间提示看起来像家具或位置名，把它当作 position 提示，另行推断房间级 space.name
- 如果已有空间名看起来像家具或位置名，这是历史误分类，不能复用为 space.name；应把该名称作为 position.name 的参考，并推断真实房间/大区域，例如"梳妆台"应归为"卧室 / 梳妆台"
- 优先复用已有的真实位置；只有确认照片属于同一个家具/区域时才复用该 position.name
- 如果已有位置名是历史占位名，不能复用，要重新判断真实物理位置
- 如果看不出精确家具，用保守的物理区域名，例如"客厅一角"、"桌面"、"地面"，并在 position.description 说明不确定
- 识别所有物品，标注状态：existing / new / missing
- 如果该位置有历史照片且有必要对比，优先用 view_position_photo 传 position_id 查看；只有手里已有 latest_photo_id / media_asset_id 时才用 view_photo
- 直接调用 save_items 提交记录草稿，不要先询问用户是否保存、不要等待用户确认
- 提交草稿后简洁告知识别结果即可

物品命名：用用户日后会搜的词，能辨认品牌就用品牌名。
description 必须包含视觉特征（颜色、品牌、材质、形状等），这是模糊搜索的关键。

## 查找物品
用户问"XX在哪"时：
- 用 search_items 搜索，可以同时搜多个关键词（并行调用）
- 模糊搜索策略：先搜最关键的词，搜不到就换同义词/拆词再搜
- 如需确认，search_items / get_position_items 返回 media_asset_id 时用 view_photo 看证据照片；如果只有 position_id，用 view_position_photo 看该位置最近照片
- 用自然中文回答，包含位置路径和时间

## 修改/删除物品
用户说"把XX移到YY"、"删掉XX"、"XX改名叫YY"时：
- 用 update_item 修改物品（改名、改描述、移动位置），直接执行
- 用 delete_item 删除物品，直接执行
- 执行后用自然语言告知结果

## 注意
- 不要编造数据库里没有的信息
- 看不清的物品放 uncertain_items，不要猜
- search_items 同时匹配名称和描述
- view_photo 只能传照片ID（media_asset_id/latest_photo_id），不能传 position_id
- 所有操作直接执行，不要反问"要不要我帮你XX"、"是否需要我XX"
- 回复简洁自然，像朋友对话，不要列清单式汇报`;

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

function parseToolArguments(raw) {
  if (!raw) return {};
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeToolCall(item) {
  return {
    id: item.call_id || item.id,
    name: item.name,
    arguments: parseToolArguments(item.arguments)
  };
}

async function readResponsesStream(response, { onTextDelta, onToolCall } = {}) {
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let eventType = '';
  let dataLines = [];
  let completedResponse = null;
  let responseId = null;
  let outputText = '';
  const outputItems = new Map();
  const emittedToolCalls = new Set();

  function maybeEmitToolCall(item) {
    if (!item || item.type !== 'function_call') return;
    const call = normalizeToolCall(item);
    if (!call.id || !call.name || emittedToolCalls.has(call.id)) return;
    emittedToolCalls.add(call.id);
    onToolCall?.(call);
  }

  function handleEvent(data) {
    if (!data || data === '[DONE]') return;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    const type = parsed.type || eventType;
    if (parsed.response?.id) responseId = parsed.response.id;
    if (parsed.item?.id) {
      const existing = outputItems.get(parsed.item.id) || {};
      outputItems.set(parsed.item.id, { ...existing, ...parsed.item });
    }

    if (type === 'response.output_text.delta' && parsed.delta) {
      outputText += parsed.delta;
      onTextDelta?.(parsed.delta, outputText);
    } else if (type === 'response.function_call_arguments.delta') {
      const itemId = parsed.item_id;
      if (!itemId) return;
      const existing = outputItems.get(itemId) || { id: itemId, type: 'function_call', arguments: '' };
      outputItems.set(itemId, { ...existing, arguments: `${existing.arguments || ''}${parsed.delta || ''}` });
    } else if (type === 'response.function_call_arguments.done') {
      const itemId = parsed.item_id;
      if (!itemId) return;
      const existing = outputItems.get(itemId) || { id: itemId, type: 'function_call' };
      const item = { ...existing, arguments: parsed.arguments ?? existing.arguments ?? '' };
      outputItems.set(itemId, item);
      maybeEmitToolCall(item);
    } else if (type === 'response.output_item.done' && parsed.item) {
      outputItems.set(parsed.item.id, parsed.item);
      maybeEmitToolCall(parsed.item);
    } else if (type === 'response.completed') {
      completedResponse = parsed.response || completedResponse;
      if (completedResponse?.id) responseId = completedResponse.id;
    } else if (type === 'response.failed' || type === 'error') {
      const message = parsed.error?.message || parsed.response?.error?.message || 'Azure Responses stream failed';
      throw new Error(message);
    }
  }

  function dispatchEvent() {
    if (!eventType && !dataLines.length) return;
    const data = dataLines.join('\n');
    eventType = '';
    dataLines = [];
    handleEvent(data);
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      } else if (!line.trim()) {
        dispatchEvent();
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const line of buffer.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      else if (!line.trim()) dispatchEvent();
    }
  }
  dispatchEvent();

  return completedResponse || {
    id: responseId,
    output: [...outputItems.values()],
    output_text: outputText
  };
}

async function callResponsesApi(input, tools, previousResponseId, { stream = false, onTextDelta, onToolCall, toolChoice = 'auto' } = {}) {
  const url = buildResponsesUrl();
  const body = {
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    input,
    tools,
    tool_choice: toolChoice
  };
  if (stream) body.stream = true;
  if (previousResponseId) body.previous_response_id = previousResponseId;

  let response;
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': process.env.AZURE_OPENAI_API_KEY
        },
        body: JSON.stringify(body)
      });
      break;
    } catch (fetchErr) {
      const cause = fetchErr.cause ? `: ${fetchErr.cause.message || fetchErr.cause}` : '';
      if (attempt < MAX_RETRIES) {
        console.warn(`[agent] Azure fetch attempt ${attempt + 1} failed${cause}, retrying...`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw new Error(`Azure fetch failed${cause}`);
    }
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Azure Responses API failed: ${response.status} ${detail}`);
  }
  if (stream) return readResponsesStream(response, { onTextDelta, onToolCall });
  return response.json();
}

function extractOutputs(payload) {
  const outputs = payload.output || [];
  const toolCalls = [];
  let text = '';

  for (const item of outputs) {
    if (item.type === 'function_call') {
      toolCalls.push(normalizeToolCall(item));
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

function imageExtensionFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('avif')) return 'avif';
  if (mime.includes('heic') || mime.includes('heif')) return 'heic';
  return 'jpg';
}

async function compressImageBase64(base64Str, mimeType = 'image/jpeg', maxDim = 1024, quality = 80) {
  if (typeof mimeType === 'number') {
    maxDim = mimeType;
    mimeType = 'image/jpeg';
  }
  const dir = path.join(tmpdir(), `findit_compress_${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const inPath = path.join(dir, `in.${imageExtensionFromMime(mimeType)}`);
  const outPath = path.join(dir, 'out.jpg');
  await writeFile(inPath, Buffer.from(base64Str, 'base64'));
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inPath,
      '-vf', `scale='min(${maxDim},iw)':'min(${maxDim},ih)':force_original_aspect_ratio=decrease`,
      '-frames:v', '1',
      '-q:v', String(Math.max(2, Math.min(12, Math.round((100 - quality) / 3.3)))),
      outPath
    ]);
    const compressed = await readFile(outPath);
    return compressed.toString('base64');
  } catch {
    return base64Str; // fallback to original if ffmpeg fails
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function buildHomeSummary(userId) {
  const spaces = await getSpacesList(userId);
  if (!spaces.length) return '用户还没有任何空间/位置记录，这是全新用户。';
  const lines = [];
  for (const s of spaces) {
    const positions = await getPositionsBySpaceName(userId, s.name);
    const posStr = positions.length
      ? positions.map(p => {
          const name = isPlaceholderPositionName(p.name)
            ? `${p.name}[历史占位名，勿复用]`
            : p.name;
          const photoId = p.latest_photo_id || '无';
          return `${name}(${p.item_count}件, position_id:${p.id}, latest_photo_id:${photoId})`;
        }).join('、')
      : '暂无位置';
    const inferredSpace = inferSpaceNameForPosition(s.name);
    const spaceName = isLikelyPositionName(s.name)
      ? `${s.name}[疑似位置名/历史误分类，勿作为space.name复用${inferredSpace ? `，可作为"${inferredSpace}"下的position.name参考` : '，仅可作为position.name参考'}]`
      : s.name;
    lines.push(`- ${spaceName}：${posStr}`);
  }
  return `用户家中已有结构：\n${lines.join('\n')}\n\nID说明：position_id 是位置ID；latest_photo_id 是该位置最近照片ID。查看某个位置最近照片请用 view_position_photo(position_id)，不要把 position_id 传给 view_photo。`;
}

function buildImageInput(imageBase64, mimeType) {
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;
  return { type: 'input_image', image_url: dataUrl, detail: 'high' };
}

function buildImageUrl(url) {
  return { type: 'input_image', image_url: url, detail: 'high' };
}

function buildAnalyzeRequestText(baseText, spaceContext, query) {
  const userText = String(query || '').trim();
  const suffix = userText
    ? `${spaceContext}\n用户补充说明：${userText}\n请结合这段文字和媒体内容识别物品与位置。`
    : spaceContext;
  return `${baseText}${suffix}`;
}

async function buildAnalyzeMediaContent(mediaInputs, spaceContext, query) {
  const label = mediaInputs.length > 1
    ? buildAnalyzeRequestText(`这是用户一次上传的${mediaInputs.length}份媒体，请把它们作为同一次记录综合分析。`, spaceContext, query)
    : buildAnalyzeRequestText('请识别这份媒体中的物品和位置。', spaceContext, query);
  const content = [{ type: 'input_text', text: label }];

  for (let i = 0; i < mediaInputs.length; i++) {
    const media = mediaInputs[i];
    const prefix = mediaInputs.length > 1 ? `第 ${i + 1} 份媒体` : '这份媒体';

    if (media.videoFrames?.length) {
      content.push({ type: 'input_text', text: `${prefix}是视频，下面是${media.videoFrames.length}个截帧。` });
      content.push(...media.videoFrames.map(f => buildImageInput(f, 'image/jpeg')));
      continue;
    }

    if (media.imageBase64) {
      content.push({ type: 'input_text', text: `${prefix}是照片。` });
      content.push(buildImageInput(media.imageBase64, media.mimeType || 'image/jpeg'));
    } else if (media.blobUrl?.startsWith('https://')) {
      content.push({ type: 'input_text', text: `${prefix}是照片。` });
      content.push(buildImageUrl(media.blobUrl));
    }
  }

  return content;
}

export async function runAgent({ mode, query, imageBase64, blobUrl, videoFrames, mediaInputs, mimeType, userId, uploadDir, onEvent, previousResponseId, spaceHint }) {
  if (!hasAzureConfig()) {
    return runMockAgent({ mode, query, imageBase64, userId, onEvent });
  }

  const emit = onEvent || (() => {});
  const isRealUrl = blobUrl?.startsWith('https://');
  const analyzeMediaInputs = Array.isArray(mediaInputs) ? mediaInputs.filter(Boolean) : [];
  const homeSummary = await buildHomeSummary(userId);
  let input = [
    { role: 'system', content: [{ type: 'input_text', text: `${SYSTEM_PROMPT}\n\n## 当前家庭数据\n${homeSummary}` }] }
  ];

  const hintedSpace = inferSpaceNameForPosition(spaceHint);
  const spaceContext = spaceHint
    ? (isLikelyPositionName(spaceHint)
        ? `用户正在查看名为「${spaceHint}」的页面，但这个名称更像家具/位置名。不要把「${spaceHint}」写入 space.name；请把它作为 position.name 的参考，并将 space.name 设为${hintedSpace ? `「${hintedSpace}」` : '房间或大区域'}。`
        : `用户正在查看「${spaceHint}」空间，请将识别结果归入此空间。`)
    : '';

  if (mode === 'analyze' && analyzeMediaInputs.length) {
    input.push({ role: 'user', content: await buildAnalyzeMediaContent(analyzeMediaInputs, spaceContext, query) });
  } else if (mode === 'analyze' && videoFrames?.length) {
    const content = [
      { type: 'input_text', text: buildAnalyzeRequestText(`这是一段视频的${videoFrames.length}个截帧，请综合所有帧识别物品和位置。`, spaceContext, query) },
      ...videoFrames.map(f => buildImageInput(f, 'image/jpeg'))
    ];
    input.push({ role: 'user', content });
  } else if (mode === 'analyze' && (isRealUrl || imageBase64)) {
    const imageContent = imageBase64
      ? buildImageInput(imageBase64, mimeType || 'image/jpeg')
      : buildImageUrl(blobUrl);
    input.push({
      role: 'user',
      content: [
        { type: 'input_text', text: buildAnalyzeRequestText('请识别这张照片中的物品和位置。', spaceContext, query) },
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

  let prevResponseId = previousResponseId || null;
  const useStreaming = process.env.AZURE_OPENAI_STREAM !== 'false';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const roundStart = Date.now();
    let firstTextDeltaLogged = false;
    const emittedToolCallIds = new Set();
    const streamCallbacks = useStreaming ? {
      onTextDelta: (delta, text) => {
        if (!firstTextDeltaLogged) {
          firstTextDeltaLogged = true;
          console.log(`[agent] round ${round}: first text delta ${Date.now() - roundStart}ms`);
        }
        emit({ type: 'answer_delta', delta, text });
      },
      onToolCall: (call) => {
        emittedToolCallIds.add(call.id);
        console.log(`[agent] round ${round}: streamed tool_call ${call.name} ${Date.now() - roundStart}ms`);
        emit({ type: 'tool_call', tool: call.name, args: call.arguments });
      }
    } : {};
    let payload;
    try {
      payload = await callResponsesApi(input, tools, prevResponseId, { stream: useStreaming, ...streamCallbacks });
    } catch (err) {
      // 上一次会话链上残留了未答复的 function_call（历史 bug 或中途崩溃），丢弃旧链重新开始
      if (round === 0 && prevResponseId && /No tool output found/i.test(err.message || '')) {
        console.warn('[agent] broken response chain, retrying without previous_response_id');
        prevResponseId = null;
        payload = await callResponsesApi(input, tools, null, { stream: useStreaming, ...streamCallbacks });
      } else {
        throw err;
      }
    }
    prevResponseId = payload.id || null;
    const { toolCalls, text } = extractOutputs(payload);
    const toolNames = toolCalls.map(c => c.name).join(',') || '-';
    console.log(`[agent] round ${round}: ${Date.now() - roundStart}ms, tools=[${toolNames}], text=${text ? text.slice(0, 80) : 'none'}`);

    // Emit intermediate text even when there are tool calls
    if (text) emit({ type: 'answer', text });

    if (toolCalls.length === 0) {
      break;
    }

    const toolOutputs = [];

    for (const call of toolCalls) {
      if (!emittedToolCallIds.has(call.id)) {
        emit({ type: 'tool_call', tool: call.name, args: call.arguments });
      }

      let result;
      if (call.name === 'view_photo' || call.name === 'view_position_photo') {
        const viewResult = await executeTool(call.name, call.arguments, userId, uploadDir);
        if (viewResult.blob_url) {
          try {
            let imageContent;
            if (viewResult.blob_url.startsWith('https://')) {
              const imageRes = await fetch(getBlobSasUrl(viewResult.blob_url));
              if (!imageRes.ok) throw new Error(`Failed to fetch blob: ${imageRes.status}`);
              const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
              const base64 = await compressImageBase64(
                imageBuffer.toString('base64'),
                viewResult.content_type || 'image/jpeg'
              );
              imageContent = buildImageInput(base64, 'image/jpeg');
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
            const blobUrl = viewResult.blob_url.startsWith('https://') ? getBlobSasUrl(viewResult.blob_url) : viewResult.blob_url;
            const thumbnailUrl = viewResult.thumbnail_url
              ? (viewResult.thumbnail_url.startsWith('https://') ? getBlobSasUrl(viewResult.thumbnail_url) : viewResult.thumbnail_url)
              : null;
            emit({ type: 'tool_result', tool: call.name, result: { viewed: true, media_asset_id: viewResult.media_asset_id, blob_url: blobUrl, thumbnail_url: thumbnailUrl, preview_url: thumbnailUrl || blobUrl } });
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

      if (call.name === 'save_items' && result?.suggestion) {
        suggestion = result.suggestion;
      }
    }

    input = toolOutputs;

    // 最后一轮仍有工具调用：必须把结果回传并强制收尾，否则会话链会残留未答复的
    // function_call，后续所有带 previous_response_id 的请求都会 400
    if (round === MAX_ROUNDS - 1) {
      const finalPayload = await callResponsesApi(input, tools, prevResponseId, { toolChoice: 'none' });
      prevResponseId = finalPayload.id || null;
      const { text: finalText } = extractOutputs(finalPayload);
      if (finalText) emit({ type: 'answer', text: finalText });
    }
  }

  emit({ type: 'done', suggestion });
  return { suggestion, responseId: prevResponseId };
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
      items: [
        { name: '护照', description: '深色证件本', status: 'new' },
        { name: 'Type-C 数据线', description: '白色数据线', status: 'new' }
      ],
      uncertain_items: []
    };

    emit({ type: 'tool_call', tool: 'save_items', args: suggestion });
    emit({ type: 'tool_result', tool: 'save_items', result: { type: 'suggestion', suggestion } });
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
    emit({ type: 'answer', text: `${best.item_name}在${best.location_path}。记录时间是 ${best.recorded_at?.slice(0, 10)}。` });
  } else {
    emit({ type: 'answer', text: `没有找到相关记录。你可以拍张照片记录一下。` });
  }
  emit({ type: 'done' });
  return {};
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
