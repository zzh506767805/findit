import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { fullImageUrl, requestJson } from '../api';
import { AppIcon, EmptyState } from '../ui';
import { colors, radius } from '../theme';

function formatPositionItems(pos) {
  const count = Number(pos.item_count || 0);
  const firstItem = pos.item_names?.find(Boolean);

  if (!count) return '暂无物品';
  if (!firstItem) return `${count}件物品`;
  if (count === 1) return firstItem;
  return `${firstItem}等${count}件物品`;
}

export default function SpaceDetailScreen({ session, space, onBack, onPhoto }) {
  const [positions, setPositions] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await requestJson(`/spaces/${space.id}/positions`, session);
      setPositions(d.positions || []);
    } catch {}
  }, [session, space.id]);

  useEffect(() => { load(); }, [load]);

  async function toggle(posId) {
    if (expanded === posId) { setExpanded(null); setDetail(null); return; }
    setExpanded(posId);
    try { setDetail(await requestJson(`/positions/${posId}/detail`, session)); }
    catch { setDetail(null); }
  }

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  const total = positions.reduce((n, p) => n + p.item_count, 0);

  return (
    <View style={s.screen}>
      <View style={s.topBar}>
        <Pressable style={s.backBtn} onPress={onBack} hitSlop={12}>
          <AppIcon name="arrow-left" size={18} color={colors.text} />
        </Pressable>
        <View style={s.topBody}>
          <Text style={s.topTitle}>{space.name}</Text>
          <Text style={s.topMeta}>{positions.length} 个位置 · {total} 件物品</Text>
        </View>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollBody}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textDim} />}>

        {positions.length > 0 ? positions.map((pos) => (
          <View key={pos.id}>
            <Pressable style={({ pressed }) => [s.posCard, pressed && s.pressed]}
              onPress={() => toggle(pos.id)}>
              {pos.latest_photo_url ? (
                <Image source={{ uri: fullImageUrl(session.apiUrl, pos.latest_photo_url) }} style={s.posThumb} />
              ) : (
                <View style={[s.posThumb, s.posThumbEmpty]}>
                  <AppIcon name="image" size={20} color={colors.textDim} />
                </View>
              )}
              <View style={s.posBody}>
                <Text style={s.posName}>{pos.name}</Text>
                <Text style={s.posItems} numberOfLines={1}>
                  {formatPositionItems(pos)}
                </Text>
              </View>
              <Text style={s.posCount}>{pos.item_count}</Text>
            </Pressable>

            {expanded === pos.id && detail ? (
              <View style={s.detail}>
                {detail.photo_url ? (
                  <Image source={{ uri: fullImageUrl(session.apiUrl, detail.photo_url) }} style={s.detailPhoto} />
                ) : null}
                <View style={s.tags}>
                  {(detail.containers || []).flatMap((c) => c.items).concat(detail.loose_items || []).map((item, idx) => (
                    <View key={idx} style={s.tag}>
                      <Text style={s.tagText}>{item.item_name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        )) : (
          <EmptyState title="还没有位置" text="拍张照片开始记录" icon="map-pin" />
        )}
      </ScrollView>

      <View style={s.bottomBar}>
        <Pressable style={({ pressed }) => [s.photoBtn, pressed && s.pressed]} onPress={onPhoto}>
          <AppIcon name="camera" size={17} color={colors.bg} />
          <Text style={s.photoBtnText}>拍这个房间</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line
  },
  backBtn: {
    width: 34, height: 34, borderRadius: radius.sm,
    backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center'
  },
  topBody: { flex: 1 },
  topTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  topMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  scroll: { flex: 1 },
  scrollBody: { padding: 20, paddingBottom: 100, gap: 8 },
  posCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: radius.lg, backgroundColor: colors.bgCard, padding: 12
  },
  posThumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.bgInput },
  posThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  posBody: { flex: 1, minWidth: 0 },
  posName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  posItems: { color: colors.textDim, fontSize: 13, marginTop: 3 },
  posCount: { color: colors.textTertiary, fontSize: 14, fontWeight: '700' },
  detail: {
    borderRadius: radius.md, backgroundColor: colors.bgRaised,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
    padding: 12, marginTop: 4, gap: 10
  },
  detailPhoto: { width: '100%', height: 180, borderRadius: radius.md, backgroundColor: colors.bgCard },
  detailGroup: { gap: 6 },
  detailGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  detailGroupName: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  looseLabel: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full, backgroundColor: colors.bgInput
  },
  tagText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 20, backgroundColor: colors.bg
  },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, minHeight: 50, borderRadius: radius.full, backgroundColor: colors.primary
  },
  photoBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.7 }
});
