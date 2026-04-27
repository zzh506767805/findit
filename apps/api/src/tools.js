import { getSpacesList, getPositionsBySpaceName, getPositionItems, getMediaAsset, searchItems } from './store.js';

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
    description: '获取某个位置已记录的所有物品，按容器分组，包含最近照片ID。',
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
    description: '按物品名称搜索所有记录，返回物品名、位置路径、容器、记录时间和照片ID。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索关键词' } },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'suggest_save',
    description: '提交识别结果建议。不会直接保存，需要用户确认后才写入数据库。',
    parameters: {
      type: 'object',
      properties: {
        space: {
          type: 'object',
          properties: { name: { type: 'string' }, is_new: { type: 'boolean' } },
          required: ['name', 'is_new']
        },
        position: {
          type: 'object',
          properties: { name: { type: 'string' }, is_new: { type: 'boolean' }, description: { type: 'string' } },
          required: ['name', 'is_new']
        },
        containers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, status: { type: 'string', enum: ['existing', 'new', 'missing'] } }, required: ['name', 'status'] } }
            },
            required: ['name', 'items']
          }
        },
        loose_items: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, status: { type: 'string', enum: ['existing', 'new', 'missing'] } }, required: ['name', 'status'] }
        },
        uncertain_items: {
          type: 'array',
          items: { type: 'object', properties: { description: { type: 'string' } } }
        }
      },
      required: ['space', 'position']
    }
  }
];

export async function executeTool(toolName, args, userId, uploadDir) {
  switch (toolName) {
    case 'list_spaces':
      return await getSpacesList(userId);

    case 'list_positions': {
      const positions = await getPositionsBySpaceName(userId, args.space_name);
      if (!positions.length) return { error: `没有找到空间"${args.space_name}"` };
      return positions;
    }

    case 'get_position_items':
      return await getPositionItems(userId, args.position_id);

    case 'view_photo': {
      const asset = await getMediaAsset(userId, args.media_asset_id);
      if (!asset) return { error: '照片不存在' };
      return { type: 'image', media_asset_id: asset.id, blob_url: asset.blob_url, question: args.question };
    }

    case 'search_items': {
      const results = await searchItems(userId, args.query || '');
      return { results, count: results.length };
    }

    case 'suggest_save':
      return { type: 'suggestion', suggestion: args };

    default:
      return { error: `未知工具: ${toolName}` };
  }
}
