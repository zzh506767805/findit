import { getSpacesList, getSpaceByName, getPositionsBySpaceName, getPositionItems, getMediaAsset, getLatestMediaAssetForPosition, searchItems, updateItem, deleteItem, findPositionsByName, updatePosition } from './store.js';

export const toolDefinitions = [
  {
    type: 'function',
    name: 'list_spaces',
    description: '列出用户家中所有空间（房间），返回每个空间的名称、位置数量和物品总数。',
    parameters: { type: 'object', properties: {} }
  },
  {
    type: 'function',
    name: 'list_positions',
    description: '列出某个空间下所有位置（家具/区域）。返回 position_id、物品数量、latest_photo_id。latest_photo_id 是照片ID，可传给 view_photo；position_id 只能传给 get_position_items 或 view_position_photo。',
    parameters: {
      type: 'object',
      properties: { space_name: { type: 'string', description: '空间名称，如"卧室"' } },
      required: ['space_name']
    }
  },
  {
    type: 'function',
    name: 'get_position_items',
    description: '获取某个位置已记录的所有物品。参数必须是 position_id。返回的 latest_photo_id 或物品 media_asset_id 才是照片ID，可传给 view_photo。',
    parameters: {
      type: 'object',
      properties: { position_id: { type: 'string' } },
      required: ['position_id']
    }
  },
  {
    type: 'function',
    name: 'view_photo',
    description: '查看一张历史照片。media_asset_id 必须是照片/媒体资产ID，来自 latest_photo_id 或 search_items/get_position_items 返回的 media_asset_id。不要传 position_id；如果只有 position_id，请改用 view_position_photo。',
    parameters: {
      type: 'object',
      properties: {
        media_asset_id: { type: 'string' },
        question: { type: 'string', description: '查看照片时想确认的问题（可选）' }
      },
      required: ['media_asset_id']
    }
  },
  {
    type: 'function',
    name: 'view_position_photo',
    description: '查看某个位置最近一张历史照片。用于拍照识别时对比同一位置的新旧照片，或查找时查看某个位置的视觉证据。参数必须是 position_id，不需要照片ID。',
    parameters: {
      type: 'object',
      properties: {
        position_id: { type: 'string', description: '位置ID，来自当前家庭数据或 list_positions 返回的 position_id' },
        question: { type: 'string', description: '查看照片时想确认的问题（可选）' }
      },
      required: ['position_id']
    }
  },
  {
    type: 'function',
    name: 'search_items',
    description: '按关键词搜索物品，同时匹配名称和描述（颜色、品牌、材质等特征）。可多次调用，用不同关键词扩大搜索范围。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索关键词' } },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'update_item',
    description: '修改单个物品信息或把它移动到新位置。可改名、改描述、移动。移动时 space_name 和 position_name 必须同时提供，目标空间/位置不存在时会自动创建。直接执行，无需用户确认。注意：如果是位置名称本身识别错了（如整批物品归错了位置），应改用 update_position 修正位置名，不要逐个移动物品。',
    parameters: {
      type: 'object',
      properties: {
        item_name: { type: 'string', description: '要修改的物品当前名称' },
        new_name: { type: 'string', description: '新名称（不改则不传）' },
        description: { type: 'string', description: '新描述（不改则不传）' },
        space_name: { type: 'string', description: '目标空间名（移动时必传，与 position_name 成对出现）' },
        position_name: { type: 'string', description: '目标位置名（移动时必传，与 space_name 成对出现）' }
      },
      required: ['item_name']
    }
  },
  {
    type: 'function',
    name: 'update_position',
    description: '重命名一个位置（家具/收纳点）。用于修正识别错误的位置名称，该位置下的所有物品自动跟随，无需逐个移动。直接执行，无需用户确认。',
    parameters: {
      type: 'object',
      properties: {
        position_name: { type: 'string', description: '当前位置名称' },
        new_name: { type: 'string', description: '新位置名称' },
        space_name: { type: 'string', description: '该位置所属空间名，同名位置存在于多个空间时用来区分（可选）' }
      },
      required: ['position_name', 'new_name']
    }
  },
  {
    type: 'function',
    name: 'delete_item',
    description: '删除一个物品及其所有记录。直接执行，无需用户确认。',
    parameters: {
      type: 'object',
      properties: {
        item_name: { type: 'string', description: '要删除的物品名称' }
      },
      required: ['item_name']
    }
  },
  {
    type: 'function',
    name: 'save_items',
    description: '创建或更新空间、位置、物品。需要用户确认后才写入数据库。可用于拍照识别、手动添加空间/位置/物品等任何场景。',
    parameters: {
      type: 'object',
      properties: {
        space: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '房间或家里的大区域名称，如"客厅"、"卧室"、"厨房"、"玄关"。禁止填写家具/台面/容器名。' },
            is_new: { type: 'boolean' }
          }
        },
        position: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '空间内的真实家具、收纳点、台面、地面或局部区域，如"梳妆台"、"电视柜"、"书桌左侧抽屉"。' },
            is_new: { type: 'boolean' },
            description: { type: 'string' }
          }
        },
        items: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, status: { type: 'string', enum: ['existing', 'new', 'missing'] } } }
        },
        uncertain_items: {
          type: 'array',
          items: { type: 'object', properties: { description: { type: 'string' } } }
        }
      }
    }
  }
];

export async function executeTool(toolName, args, userId, uploadDir) {
  function formatMediaView(asset, question, extra = {}) {
    const isVideo = asset.content_type?.startsWith('video/');
    const viewUrl = isVideo ? asset.thumbnail_url : asset.blob_url;
    if (!viewUrl) return { error: '这段视频还没有可查看的预览图' };
    return {
      type: isVideo ? 'video_preview' : 'image',
      media_asset_id: asset.id,
      blob_url: viewUrl,
      thumbnail_url: asset.thumbnail_url,
      preview_url: asset.thumbnail_url || viewUrl,
      original_blob_url: asset.blob_url,
      content_type: asset.content_type,
      question,
      ...extra
    };
  }

  switch (toolName) {
    case 'list_spaces':
      return await getSpacesList(userId);

    case 'list_positions': {
      const spaceName = String(args.space_name || '').trim();
      const positions = await getPositionsBySpaceName(userId, spaceName);
      if (!positions.length && !(await getSpaceByName(userId, spaceName))) {
        return { error: `没有找到空间"${spaceName}"` };
      }
      return positions.map((p) => ({ ...p, position_id: p.position_id || p.id }));
    }

    case 'get_position_items':
      return await getPositionItems(userId, args.position_id);

    case 'view_photo': {
      const requestedId = args.media_asset_id;
      const asset = await getMediaAsset(userId, requestedId);
      if (asset) return formatMediaView(asset, args.question);

      const latestForPosition = await getLatestMediaAssetForPosition(userId, requestedId);
      if (latestForPosition) {
        return formatMediaView(latestForPosition, args.question, {
          resolved_from: 'position_id',
          position_id: requestedId
        });
      }
      return { error: '照片不存在；如果你只有 position_id，请使用 view_position_photo。' };
    }

    case 'view_position_photo': {
      const positionId = args.position_id;
      const asset = await getLatestMediaAssetForPosition(userId, positionId);
      if (!asset) return { error: '这个位置还没有历史照片', position_id: positionId };
      return formatMediaView(asset, args.question, { position_id: positionId });
    }

    case 'search_items': {
      const results = await searchItems(userId, args.query || '');
      return { results, count: results.length };
    }

    case 'save_items':
      return { type: 'suggestion', suggestion: args };

    case 'update_item': {
      const hasSpace = Boolean(args.space_name?.trim?.() || args.space_name);
      const hasPosition = Boolean(args.position_name?.trim?.() || args.position_name);
      if (hasSpace !== hasPosition) {
        return { error: '移动物品必须同时提供 space_name 和 position_name，请补全后重试' };
      }
      return await updateItem(userId, args.item_name, {
        new_name: args.new_name,
        description: args.description,
        space_name: args.space_name,
        position_name: args.position_name
      });
    }

    case 'update_position': {
      const currentName = String(args.position_name || '').trim();
      const newName = String(args.new_name || '').trim();
      if (!currentName || !newName) return { error: 'position_name 和 new_name 都不能为空' };

      let matches = await findPositionsByName(userId, currentName);
      if (args.space_name) {
        matches = matches.filter((p) => p.space_name === String(args.space_name).trim());
      }
      if (!matches.length) return { error: `没有找到位置"${currentName}"` };
      if (matches.length > 1) {
        return {
          error: `有多个空间存在位置"${currentName}"，请传 space_name 指明是哪一个`,
          candidates: matches.map((p) => ({ space_name: p.space_name, position_name: p.name }))
        };
      }

      const updated = await updatePosition(userId, matches[0].id, newName);
      if (!updated) return { error: '重命名失败' };
      return { success: true, space_name: matches[0].space_name, old_name: currentName, new_name: newName };
    }

    case 'delete_item':
      return await deleteItem(userId, args.item_name);

    default:
      return { error: `未知工具: ${toolName}` };
  }
}
