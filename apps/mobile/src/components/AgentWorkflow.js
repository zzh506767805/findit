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
  delete_item: { icon: 'trash-2', label: '删除物品' }
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
      {steps.map((step, i) => {
        if (step.type === 'tool_call') {
          const { icon, label } = formatToolLabel(step.tool, step.args);
          const argsText = formatToolArgs(step.args);
          return (
            <FadeIn key={i} delay={i * 60}>
              <Pressable disabled={!argsText} onPress={() => toggleStep(i)}>
                <View style={s.stepRow}>
                  <View style={s.dot} />
                  <AppIcon name={icon} size={12} color={colors.textDim} />
                  <Text style={s.stepLabel}>{label}</Text>
                </View>
                {argsText && expandedSteps.has(i) ? (
                  <Text style={s.argsLine} numberOfLines={2}>{argsText}</Text>
                ) : null}
              </Pressable>
            </FadeIn>
          );
        }
        if (step.type === 'tool_result') {
          const summary = formatToolResult(step.tool, step.result);
          const showPhotoPreview = step.tool !== 'view_position_photo';
          const photoPath = showPhotoPreview ? (step.result?.preview_url || step.result?.thumbnail_url || step.result?.blob_url) : null;
          const directPhotoUrl = photoPath ? fullImageUrl(apiUrl, photoPath) : null;
          const routePhotoUrl = showPhotoPreview && step.result?.media_asset_id
            ? mediaPreviewUrl(apiUrl, step.result.media_asset_id, Boolean(step.result?.thumbnail_url))
            : null;
          const photoUrl = directPhotoUrl || routePhotoUrl;
          if (!summary && !photoUrl) return null;
          return (
            <FadeIn key={i} delay={i * 60}>
              {summary ? <Text style={s.resultLine}>  → {summary}</Text> : null}
              {photoUrl ? <StableImage uri={photoUrl} style={s.thumb} /> : null}
            </FadeIn>
          );
        }
        if (step.type === 'thinking') {
          return (
            <FadeIn key={i} delay={i * 60}>
              <Text style={s.thinking}>{step.text}</Text>
            </FadeIn>
          );
        }
        if (step.type === 'answer') {
          return (
            <FadeIn key={i} delay={i * 60}>
              <Markdown style={mdStyles}>{step.text}</Markdown>
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
    paddingVertical: 4
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textDim
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
    paddingLeft: 22,
    paddingTop: 1,
    paddingBottom: 2
  },
  resultLine: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    paddingLeft: 10
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
