import { getSpacesList, getSpaceByName, getPositionsBySpaceName, getPositionItems, getMediaAsset, searchItems, updateItem, deleteItem } from './store.js';
import { normalizeSuggestionLocation } from './locationRules.js';

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
    description: '列出某个空间下所有位置（家具/区域），返回每个位置的名称、物品数量和最近照片ID。',
    parameters: {
      type: 'object',
      properties: { space_name: { type: 'string', description: '空间名称，如"卧室"' } },
      required: ['space_name']
    }
  },
  {
    type: 'function',
    name: 'get_position_items',
    description: '获取某个位置已记录的所有物品，包含最近照片ID。',
    parameters: {
      type: 'object',
      properties: { position_id: { type: 'string' } },
      required: ['position_id']
    }
  },
  {
    type: 'function',
    name: 'view_photo',
    description: '查看一张历史照片。用于对比新旧照片或为查找结果提供视觉证据。',
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
    description: '修改物品信息或移动物品到新位置。可改名、改描述、移动到其他空间/位置。直接执行，无需用户确认。',
    parameters: {
      type: 'object',
      properties: {
        item_name: { type: 'string', description: '要修改的物品当前名称' },
        new_name: { type: 'string', description: '新名称（不改则不传）' },
        description: { type: 'string', description: '新描述（不改则不传）' },
        space_name: { type: 'string', description: '目标空间名（移动时必传）' },
        position_name: { type: 'string', description: '目标位置名（移动时必传）' }
      },
      required: ['item_name']
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
  switch (toolName) {
    case 'list_spaces':
      return await getSpacesList(userId);

    case 'list_positions': {
      const spaceName = String(args.space_name || '').trim();
      const positions = await getPositionsBySpaceName(userId, spaceName);
      if (!positions.length && !(await getSpaceByName(userId, spaceName))) {
        return { error: `没有找到空间"${spaceName}"` };
      }
      return positions;
    }

    case 'get_position_items':
      return await getPositionItems(userId, args.position_id);

    case 'view_photo': {
      const asset = await getMediaAsset(userId, args.media_asset_id);
      if (!asset) return { error: '照片不存在' };
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
        question: args.question
      };
    }

    case 'search_items': {
      const results = await searchItems(userId, args.query || '');
      return { results, count: results.length };
    }

    case 'save_items':
      return { type: 'suggestion', suggestion: normalizeSuggestionLocation(args) };

    case 'update_item':
      return await updateItem(userId, args.item_name, {
        new_name: args.new_name,
        description: args.description,
        space_name: args.space_name,
        position_name: args.position_name
      });

    case 'delete_item':
      return await deleteItem(userId, args.item_name);

    default:
      return { error: `未知工具: ${toolName}` };
  }
}
