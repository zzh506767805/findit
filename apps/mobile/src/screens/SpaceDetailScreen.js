import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
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

export default function SpaceDetailScreen({ session, space, onBack, onPickMedia, cachedPositions, onCachePositions }) {
  const [positions, setPositions] = useState(cachedPositions || []);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [addingPos, setAddingPos] = useState(false);
  const [newPosName, setNewPosName] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await requestJson(`/spaces/${space.id}/positions`, session);
      const pos = d.positions || [];
      setPositions(prev => {
        if (!prev.length) { onCachePositions?.(pos); return pos; }
        // Merge: keep old photo URLs to avoid image flicker
        const oldMap = Object.fromEntries(prev.map(p => [p.id, p]));
        const merged = pos.map(p => {
          const old = oldMap[p.id];
          if (old && p.latest_photo_url && old.latest_photo_url) {
            return { ...p, latest_photo_url: old.latest_photo_url };
          }
          return p;
        });
        onCachePositions?.(merged);
        return merged;
      });
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

  async function handleAddPos() {
    const name = newPosName.trim();
    if (!name) return;
    const tempId = `temp_${Date.now()}`;
    setNewPosName('');
    setAddingPos(false);
    setPositions(prev => [...prev, { id: tempId, name, item_count: 0, item_names: [] }]);
    try {
      await requestJson(`/spaces/${space.id}/positions`, { ...session, method: 'POST', body: { name } });
      load();
    } catch (err) {
      setPositions(prev => prev.filter(p => p.id !== tempId));
      Alert.alert('创建失败', err.message);
    }
  }

  function handlePosLongPress(pos) {
    if (Platform.OS === 'web') {
      const action = window.prompt(`${pos.name}\n输入 "delete" 删除，或输入新名称重命名，取消则留空：`);
      if (action === null || action === '') return;
      if (action.toLowerCase() === 'delete') { executeDeletePos(pos); return; }
      doRenamePos(pos, action);
    } else {
      Alert.alert(pos.name, '', [
        { text: '重命名', onPress: () => {
          Alert.prompt?.('重命名位置', '', (name) => { if (name?.trim()) doRenamePos(pos, name.trim()); }, 'plain-text', pos.name);
        }},
        { text: '删除', style: 'destructive', onPress: () => executeDeletePos(pos) },
        { text: '取消', style: 'cancel' }
      ]);
    }
  }

  async function doRenamePos(pos, newName) {
    const oldName = pos.name;
    setPositions(prev => prev.map(p => p.id === pos.id ? { ...p, name: newName } : p));
    try {
      await requestJson(`/positions/${pos.id}`, { ...session, method: 'PUT', body: { name: newName } });
    } catch (err) {
      setPositions(prev => prev.map(p => p.id === pos.id ? { ...p, name: oldName } : p));
      Alert.alert('重命名失败', err.message);
    }
  }

  async function executeDeletePos(pos) {
    if (Platform.OS === 'web' && !window.confirm(`确定删除"${pos.name}"？`)) return;
    const prevPositions = positions;
    setPositions(prev => prev.filter(p => p.id !== pos.id));
    if (expanded === pos.id) { setExpanded(null); setDetail(null); }
    try {
      await requestJson(`/positions/${pos.id}`, { ...session, method: 'DELETE' });
    } catch (err) {
      setPositions(prevPositions);
      Alert.alert('删除失败', err.message);
    }
  }

  async function pickPhoto() {
    if (Platform.OS === 'web') {
      doPick('library');
    } else {
      Alert.alert('记录方式', '', [
        { text: '拍照', onPress: () => doPick('camera') },
        { text: '从相册选', onPress: () => doPick('library') },
        { text: '取消', style: 'cancel' }
      ]);
    }
  }

  async function doPick(source) {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('需要权限'); return; }

    const options = {
      mediaTypes: ['images', 'videos'],
      videoMaxDuration: 10,
      quality: 0.72,
      allowsMultipleSelection: source !== 'camera'
    };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.length) return;

    onPickMedia(result.assets);
  }

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
              onPress={() => toggle(pos.id)}
              onLongPress={() => handlePosLongPress(pos)}>
              {pos.latest_photo_url ? (
                <Image source={{ uri: fullImageUrl(session.apiUrl, pos.latest_photo_url) }} style={s.posThumb} />
              ) : (
                <View style={[s.posThumb, s.posThumbEmpty]}>
                  <AppIcon name="map-pin" size={20} color={colors.textDim} />
                </View>
              )}
              <View style={s.posBody}>
                <Text style={s.posName}>{pos.name}</Text>
                <Text style={s.posItems} numberOfLines={1}>
                  {formatPositionItems(pos)}
                </Text>
              </View>
              <Pressable hitSlop={10} onPress={() => handlePosLongPress(pos)} style={s.posMore}>
                <AppIcon name="more-vertical" size={16} color={colors.textDim} />
              </Pressable>
            </Pressable>

            {expanded === pos.id && detail ? (
              <View style={s.detail}>
                {(detail.photos?.length || detail.photo_url) ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.photoStrip} contentContainerStyle={s.photoStripBody}>
                    {(detail.photos || [{ url: detail.photo_url }]).map((p, pi) => (
                      <Image key={pi} source={{ uri: fullImageUrl(session.apiUrl, p.url) }} style={s.detailPhoto} />
                    ))}
                  </ScrollView>
                ) : null}
                {(detail.items || []).map((item, ii) => (
                  <View key={ii} style={s.itemRow}>
                    <View style={s.itemDot} />
                    <View style={s.itemInfo}>
                      <Text style={s.itemName}>{item.item_name}</Text>
                      {item.description ? <Text style={s.itemDesc} numberOfLines={1}>{item.description}</Text> : null}
                    </View>
                    {item.recorded_at ? <Text style={s.itemDate}>{item.recorded_at.slice(5, 10)}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )) : !addingPos ? (
          <EmptyState title="还没有位置" text="添加位置或拍照让 AI 自动识别" icon="map-pin" />
        ) : null}

        {addingPos ? (
          <View style={s.addRow}>
            <TextInput style={s.addInput} value={newPosName} onChangeText={setNewPosName}
              placeholder="位置名称，如 书桌、衣柜第二层" placeholderTextColor={colors.textDim}
              autoFocus returnKeyType="done" onSubmitEditing={handleAddPos} />
            <Pressable style={s.addConfirm} onPress={handleAddPos}>
              <AppIcon name="check" size={16} color={colors.white} />
            </Pressable>
            <Pressable style={s.addCancel} onPress={() => { setAddingPos(false); setNewPosName(''); }}>
              <AppIcon name="x" size={16} color={colors.textDim} />
            </Pressable>
          </View>
        ) : (
          <Pressable style={({ pressed }) => [s.addPosBtn, pressed && s.pressed]}
            onPress={() => setAddingPos(true)}>
            <AppIcon name="plus" size={14} color={colors.textSecondary} />
            <Text style={s.addPosBtnText}>添加位置</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={s.bottomBar}>
        <Pressable style={({ pressed }) => [s.photoBtn, pressed && s.pressed]}
          onPress={pickPhoto}>
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
  posMore: { padding: 4 },
  detail: {
    borderRadius: radius.md, backgroundColor: colors.bgRaised,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
    padding: 12, marginTop: 4, gap: 12
  },
  photoStrip: { marginHorizontal: -12 },
  photoStripBody: { paddingHorizontal: 12, gap: 8 },
  detailPhoto: { width: 220, height: 165, borderRadius: radius.md, backgroundColor: colors.bgCard },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingHorizontal: 4 },
  itemDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.textDim, marginTop: 1 },
  itemInfo: { flex: 1, minWidth: 0 },
  itemName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  itemDesc: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  itemDate: { color: colors.textTertiary, fontSize: 11 },
  addPosBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, minHeight: 42, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed'
  },
  addPosBtnText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8
  },
  addInput: {
    flex: 1, height: 42, borderRadius: radius.md,
    backgroundColor: colors.bgCard, paddingHorizontal: 14,
    color: colors.text, fontSize: 14
  },
  addConfirm: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'
  },
  addCancel: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center'
  },
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
