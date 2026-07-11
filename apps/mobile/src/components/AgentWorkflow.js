import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { fullImageUrl, mediaPreviewUrl } from '../api';
import StableImage from './StableImage';
import { AppIcon } from '../ui';
import { colors, radius } from '../theme';

const TOOL_LABELS = {
  list_spaces: { icon: 'globe', label: '查看空间' },
  list_positions: { icon: 'map-pin', label: '查看位置' },
  get_position_items: { icon: 'list', label: '查看物品' },
  view_photo: { icon: 'image', label: '查看照片' },
  view_position_photo: { icon: 'image', label: '查看位置照片' },
  search_items: { icon: 'search', label: '搜索物品' },
  save_items: { icon: 'save', label: '整理数据' },
  suggest_save: { icon: 'save', label: '整理数据' },
  update_item: { icon: 'edit-2', label: '修改物品' },
  update_position: { icon: 'edit-3', label: '修正位置' },
  delete_item: { icon: 'trash-2', label: '删除物品' },
  submit_feedback: { icon: 'message-square', label: '记录反馈' }
};

function formatToolArgs(args) {
  if (!args || typeof args !== 'object') return null;
  const entries = Object.entries(args).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return null;
  const text = entries
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ');
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function formatToolLabel(tool, args) {
  const entry = TOOL_LABELS[tool] || { icon: 'cpu', label: tool };
  if (tool === 'list_positions' && args?.space_name) return { ...entry, label: `查看${args.space_name}的位置` };
  if (tool === 'search_items' && args?.query) return { ...entry, label: `搜索"${args.query}"` };
  return entry;
}

function formatToolResult(tool, result) {
  if (!result) return null;
  if (result.error) return result.error;
  if (tool === 'list_spaces') {
    return Array.isArray(result) && result.length ? result.map((s) => s.name).join('、') : '还没有记录';
  }
  if (tool === 'list_positions') {
    return Array.isArray(result) && result.length ? result.map((p) => `${p.name}(${p.item_count}件)`).join('、') : '暂无位置';
  }
  if (tool === 'get_position_items') {
    return `${(result.items || []).length} 件物品`;
  }
  if (tool === 'search_items') return `找到 ${result.count || 0} 条记录`;
  if (tool === 'view_photo' || tool === 'view_position_photo') return '已查看';
  if (tool === 'save_items') return '已整理成记录草稿';
  if (tool === 'update_item') return '已修改';
  if (tool === 'update_position') return result.new_name ? `已改为"${result.new_name}"` : '已修正';
  if (tool === 'delete_item') return '已删除';
  if (tool === 'submit_feedback') return '已记录，会转给开发团队';
  return null;
}

function FadeIn({ children, delay = 0 }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }, delay);
    return () => clearTimeout(t);
  }, [delay, opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

function resultPhotoUrl(tool, result, apiUrl) {
  if (tool === 'view_position_photo' || !result) return null;
  const photoPath = result.preview_url || result.thumbnail_url || result.blob_url;
  const directPhotoUrl = photoPath ? fullImageUrl(apiUrl, photoPath) : null;
  const routePhotoUrl = result.media_asset_id
    ? mediaPreviewUrl(apiUrl, result.media_asset_id, Boolean(result.thumbnail_url))
    : null;
  return directPhotoUrl || routePhotoUrl;
}

// 把每个 tool_call 和它之后第一个同名 tool_result 配成一行；
// 并行轮次里所有 call 在前、result 在后，所以按工具名向后认领
function pairSteps(steps) {
  const consumed = new Set();
  const entries = steps.map((step, i) => {
    if (step.type !== 'tool_call') return { step, key: i };
    for (let j = i + 1; j < steps.length; j++) {
      if (!consumed.has(j) && steps[j].type === 'tool_result' && steps[j].tool === step.tool) {
        consumed.add(j);
        return { step, result: steps[j].result, key: i };
      }
    }
    return { step, key: i };
  });
  return entries.filter((entry) => !consumed.has(entry.key));
}

export default function AgentWorkflow({ steps = [], apiUrl }) {
  const [expandedSteps, setExpandedSteps] = useState(() => new Set());
  if (!steps.length) return null;

  function toggleStep(i) {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <View style={s.root}>
      {pairSteps(steps).map(({ step, result, key }, idx) => {
        if (step.type === 'tool_call') {
          const { icon, label } = formatToolLabel(step.tool, step.args);
          const argsText = formatToolArgs(step.args);
          const summary = formatToolResult(step.tool, result);
          const photoUrl = resultPhotoUrl(step.tool, result, apiUrl);
          return (
            <FadeIn key={key} delay={idx * 60}>
              <Pressable disabled={!argsText} onPress={() => toggleStep(key)}>
                <View style={s.stepRow}>
                  <AppIcon name={icon} size={12} color={colors.textDim} />
                  <Text style={s.stepLabel} numberOfLines={1}>{label}</Text>
                  {summary ? <Text style={s.resultInline} numberOfLines={1}>· {summary}</Text> : null}
                </View>
                {argsText && expandedSteps.has(key) ? (
                  <Text style={s.argsLine} numberOfLines={2}>{argsText}</Text>
                ) : null}
              </Pressable>
              {photoUrl ? <StableImage uri={photoUrl} style={s.thumb} /> : null}
            </FadeIn>
          );
        }
        if (step.type === 'tool_result') {
          // 没配上对儿的孤立结果（一般不会出现），保持旧样式兜底
          const summary = formatToolResult(step.tool, step.result);
          const photoUrl = resultPhotoUrl(step.tool, step.result, apiUrl);
          if (!summary && !photoUrl) return null;
          return (
            <FadeIn key={key} delay={idx * 60}>
              {summary ? <Text style={s.resultLine}>  → {summary}</Text> : null}
              {photoUrl ? <StableImage uri={photoUrl} style={s.thumb} /> : null}
            </FadeIn>
          );
        }
        if (step.type === 'thinking') {
          return (
            <FadeIn key={key} delay={idx * 60}>
              <Text style={s.thinking}>{step.text}</Text>
            </FadeIn>
          );
        }
        if (step.type === 'answer') {
          return (
            <FadeIn key={key} delay={idx * 60}>
              <Markdown style={mdStylesInterim}>{step.text}</Markdown>
            </FadeIn>
          );
        }
        return null;
      })}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    gap: 5,
    paddingVertical: 4,
    paddingLeft: 10,
    marginBottom: 6,
    borderLeftWidth: 2,
    borderLeftColor: colors.line
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2
  },
  stepLabel: {
    color: colors.textTertiary,
    fontSize: 13,
    fontWeight: '500'
  },
  argsLine: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 15,
    paddingLeft: 18,
    paddingTop: 1,
    paddingBottom: 2
  },
  resultLine: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    paddingLeft: 10
  },
  resultInline: {
    color: colors.textTertiary,
    fontSize: 12,
    flexShrink: 1
  },
  thumb: {
    width: 72,
    height: 50,
    borderRadius: radius.sm,
    marginLeft: 10,
    marginTop: 4,
    backgroundColor: colors.bgCard
  },
  thinking: {
    color: colors.textDim,
    fontSize: 13,
    fontStyle: 'italic',
    paddingLeft: 10
  },
  answer: {
    marginTop: 4
  }
});

const mdStyles = {
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  strong: { fontWeight: '700', color: colors.text },
  paragraph: { marginTop: 0, marginBottom: 6 },
  heading1: { fontSize: 15, fontWeight: '700', lineHeight: 22, marginTop: 0, marginBottom: 4 },
  heading2: { fontSize: 15, fontWeight: '700', lineHeight: 22, marginTop: 0, marginBottom: 4 },
  heading3: { fontSize: 15, fontWeight: '700', lineHeight: 22, marginTop: 0, marginBottom: 4 },
  heading4: { fontSize: 15, fontWeight: '700', lineHeight: 22, marginTop: 0, marginBottom: 4 },
  bullet_list: { marginTop: 2, marginBottom: 2 },
  ordered_list: { marginTop: 2, marginBottom: 2 },
  list_item: { marginTop: 1 },
  code_inline: { backgroundColor: colors.bgInput, borderRadius: 3, paddingHorizontal: 4, fontSize: 13, color: colors.textSecondary },
};

// 多轮工具间的过程叙述：比最终回复弱一档
const mdStylesInterim = {
  ...mdStyles,
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  strong: { fontWeight: '700', color: colors.textSecondary },
};
