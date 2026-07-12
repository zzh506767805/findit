import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
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
import { fullImageUrl, mediaPreviewUrl, requestJson } from '../api';
import StableImage from '../components/StableImage';
import { AppIcon, EmptyState } from '../ui';
import { colors, radius } from '../theme';
import { apiErrorMessage, t } from '../strings';

function formatPositionItems(pos) {
  const count = Number(pos.item_count || 0);
  const firstItem = pos.item_names?.find(Boolean);

  if (!count) return t('sd_no_items');
  if (!firstItem) return t('sd_items_count', { count });
  if (count === 1) return firstItem;
  return t('sd_items_with_first', { first: firstItem, count, more: count - 1 });
}

function isVideoContent(contentType) {
  return String(contentType || '').startsWith('video/');
}

function MediaPreview({ apiUrl, uri, thumbnailUri, contentType, style, emptyIcon = 'image', allowOriginalFallback = true }) {
  const isVideo = isVideoContent(contentType);
  const previewPath = isVideo ? thumbnailUri : (thumbnailUri || (allowOriginalFallback ? uri : null));
  const previewUri = fullImageUrl(apiUrl, previewPath);

  return (
    <View style={[style, s.mediaFrame]}>
      {previewUri ? (
        <StableImage uri={previewUri} style={s.mediaImage} />
      ) : (
        <View style={s.mediaEmpty}>
          <AppIcon name={isVideo ? 'play-circle' : emptyIcon} size={20} color={isVideo ? colors.white : colors.textDim} />
        </View>
      )}
      {isVideo ? (
        <View style={s.mediaVideoOverlay}>
          <View style={s.mediaVideoPlay}>
            <AppIcon name="play" size={11} color={colors.white} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function hasDetailContent(detail) {
  return Boolean(detail && (detail.photos?.length || detail.photo_url || detail.items?.length));
}

function hasLikelyDetailContent(pos) {
  return Boolean(
    Number(pos?.item_count || 0) > 0 ||
    pos?.latest_media_asset_id ||
    pos?.latest_photo_url ||
    pos?.latest_thumbnail_url
  );
}

function DetailLoading({ pos }) {
  const hasMedia = Boolean(pos?.latest_media_asset_id || pos?.latest_photo_url || pos?.latest_thumbnail_url);
  const itemRows = Math.min(Number(pos?.item_count || 0), 3);

  return (
    <View style={s.detailLoading}>
      {hasMedia ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.photoStrip} contentContainerStyle={s.photoStripBody}>
          <View style={s.detailPhotoLoading} />
        </ScrollView>
      ) : null}
      {Array.from({ length: itemRows }).map((_, i) => (
        <View key={i} style={s.detailItemLoadingRow}>
          <View style={s.detailItemLoadingDot} />
          <View style={s.detailItemLoadingBody}>
            <View style={s.detailItemLoadingName} />
            <View style={[s.detailItemLoadingDesc, i % 2 === 1 && s.detailItemLoadingDescShort]} />
          </View>
          <View style={s.detailItemLoadingDate} />
        </View>
      ))}
    </View>
  );
}

export default function SpaceDetailScreen({ session, space, dataVersion, onBack, onPickMedia }) {
  const [positions, setPositions] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [detailsByPosition, setDetailsByPosition] = useState({});
  const [loadingDetailId, setLoadingDetailId] = useState(null);
  const [loadingPositions, setLoadingPositions] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingPos, setAddingPos] = useState(false);
  const [newPosName, setNewPosName] = useState('');
  const detailRequestId = useRef(0);

  const load = useCallback(async () => {
    try {
      setLoadingPositions(true);
      const d = await requestJson(`/spaces/${space.id}/positions`, session);
      const pos = d.positions || [];
      setPositions(pos);
    } catch {}
    finally { setLoadingPositions(false); }
  }, [session, space.id, dataVersion]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    detailRequestId.current += 1;
    setExpanded(null);
    setLoadingDetailId(null);
    setDetailsByPosition({});
  }, [dataVersion]);

  async function toggle(pos) {
    const posId = pos.id;
    if (expanded === posId) {
      detailRequestId.current += 1;
      setExpanded(null);
      setLoadingDetailId(null);
      return;
    }

    if (!hasLikelyDetailContent(pos)) {
      detailRequestId.current += 1;
      setExpanded(null);
      setLoadingDetailId(null);
      return;
    }

    setExpanded(posId);
    if (detailsByPosition[posId]) {
      setLoadingDetailId(null);
      return;
    }

    const requestId = detailRequestId.current + 1;
    detailRequestId.current = requestId;
    setLoadingDetailId(posId);
    try {
      const nextDetail = await requestJson(`/positions/${posId}/detail`, session);
      if (detailRequestId.current !== requestId) return;
      setDetailsByPosition(prev => ({ ...prev, [posId]: nextDetail }));
    } catch {
      if (detailRequestId.current === requestId) {
        setDetailsByPosition(prev => ({ ...prev, [posId]: null }));
      }
    } finally {
      if (detailRequestId.current === requestId) setLoadingDetailId(null);
    }
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
      Alert.alert(t('create_failed'), apiErrorMessage(err));
    }
  }

  function handlePosLongPress(pos) {
    if (Platform.OS === 'web') {
      const action = window.prompt(t('web_prompt_action', { name: pos.name }));
      if (action === null || action === '') return;
      if (action.toLowerCase() === 'delete') { executeDeletePos(pos); return; }
      doRenamePos(pos, action);
    } else if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: pos.name, options: [t('rename'), t('delete'), t('cancel')], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
        (idx) => {
          if (idx === 0) Alert.prompt?.(t('sd_rename_pos'), '', (name) => { if (name?.trim()) doRenamePos(pos, name.trim()); }, 'plain-text', pos.name);
          if (idx === 1) executeDeletePos(pos);
        }
      );
    } else {
      Alert.alert(pos.name, '', [
        { text: t('rename'), onPress: () => doRenamePos(pos, '') },
        { text: t('delete'), style: 'destructive', onPress: () => executeDeletePos(pos) },
        { text: t('cancel'), style: 'cancel' }
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
      Alert.alert(t('rename_failed'), apiErrorMessage(err));
    }
  }

  function handleItemAction(item) {
    if (Platform.OS === 'web') {
      const action = window.prompt(t('web_prompt_action', { name: item.item_name }));
      if (!action) return;
      if (action.toLowerCase() === 'delete') { doDeleteItem(item); return; }
      doRenameItem(item, action);
    } else if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: item.item_name, options: [t('rename'), t('delete'), t('cancel')], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
        (idx) => {
          if (idx === 0) Alert.prompt?.(t('sd_rename_item'), '', (name) => { if (name?.trim()) doRenameItem(item, name.trim()); }, 'plain-text', item.item_name);
          if (idx === 1) doDeleteItem(item);
        }
      );
    }
  }

  async function doRenameItem(item, newName) {
    patchExpandedDetail(prev => ({ ...prev, items: prev.items.map(i => i.item_id === item.item_id ? { ...i, item_name: newName } : i) }));
    try {
      await requestJson(`/items/${item.item_id}`, { ...session, method: 'PUT', body: { new_name: newName } });
      load();
    } catch (err) {
      patchExpandedDetail(prev => ({ ...prev, items: prev.items.map(i => i.item_id === item.item_id ? { ...i, item_name: item.item_name } : i) }));
      Alert.alert(t('rename_failed'), apiErrorMessage(err));
    }
  }

  async function doDeleteItem(item) {
    patchExpandedDetail(prev => ({ ...prev, items: prev.items.filter(i => i.item_id !== item.item_id) }));
    try {
      await requestJson(`/items/${item.item_id}`, { ...session, method: 'DELETE' });
      load();
    } catch (err) {
      Alert.alert(t('delete_failed'), apiErrorMessage(err));
      load();
    }
  }

  async function executeDeletePos(pos) {
    if (Platform.OS === 'web' && !window.confirm(t('web_confirm_delete', { name: pos.name }))) return;
    const prevPositions = positions;
    setPositions(prev => prev.filter(p => p.id !== pos.id));
    if (expanded === pos.id) { setExpanded(null); setLoadingDetailId(null); }
    setDetailsByPosition(prev => {
      const copy = { ...prev };
      delete copy[pos.id];
      return copy;
    });
    try {
      await requestJson(`/positions/${pos.id}`, { ...session, method: 'DELETE' });
    } catch (err) {
      setPositions(prevPositions);
      Alert.alert(t('delete_failed'), apiErrorMessage(err));
    }
  }

  function patchExpandedDetail(fn) {
    if (!expanded) return;
    setDetailsByPosition(prev => {
      const current = prev[expanded];
      if (!current) return prev;
      return { ...prev, [expanded]: fn(current) };
    });
  }

  async function pickPhoto() {
    if (Platform.OS === 'web') {
      doPick('library');
    } else {
      Alert.alert(t('record_method'), '', [
        { text: t('take_photo'), onPress: () => doPick('camera') },
        { text: t('from_library'), onPress: () => doPick('library') },
        { text: t('cancel'), style: 'cancel' }
      ]);
    }
  }

  async function doPick(source) {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert(t('need_permission')); return; }

    const options = {
      mediaTypes: ['images', 'videos'],
      videoMaxDuration: 10,
      quality: 1,
      allowsMultipleSelection: source !== 'camera'
    };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.length) return;

    onPickMedia({ assets: result.assets, source });
  }

  const total = positions.reduce((n, p) => n + Number(p.item_count || 0), 0);

  return (
    <View style={s.screen}>
      <View style={s.topBar}>
        <Pressable style={s.backBtn} onPress={onBack} hitSlop={12}>
          <AppIcon name="arrow-left" size={18} color={colors.text} />
        </Pressable>
        <View style={s.topBody}>
          <Text style={s.topTitle}>{space.name}</Text>
          <Text style={s.topMeta}>{t('sd_meta', { positions: positions.length, items: total })}</Text>
        </View>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollBody}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textDim} />}>

        {loadingPositions && !positions.length ? (
          [0, 1, 2].map((i) => (
            <View key={i} style={s.posLoadingCard}>
              <View style={s.posLoadingThumb} />
              <View style={s.posLoadingBody}>
                <View style={s.posLoadingLine} />
                <View style={[s.posLoadingLine, s.posLoadingLineShort]} />
              </View>
            </View>
          ))
        ) : positions.length > 0 ? positions.map((pos) => (
          <View key={pos.id}>
            <Pressable style={({ pressed }) => [s.posCard, pressed && s.posCardPressed]}
              onPress={() => toggle(pos)}
              onLongPress={() => handlePosLongPress(pos)}>
              <MediaPreview
                apiUrl={session.apiUrl}
                uri={pos.latest_photo_url}
                thumbnailUri={pos.latest_media_asset_id
                  ? mediaPreviewUrl(session.apiUrl, pos.latest_media_asset_id, Boolean(pos.latest_thumbnail_url))
                  : pos.latest_thumbnail_url}
                contentType={pos.latest_media_content_type}
                style={s.posThumb}
                emptyIcon="map-pin"
                allowOriginalFallback={false}
              />
              <View style={s.posBody}>
                <Text style={s.posName}>{pos.name}</Text>
                <Text style={s.posItems} numberOfLines={1}>
                  {formatPositionItems(pos)}
                </Text>
              </View>
              <Pressable hitSlop={10} onPress={() => handlePosLongPress(pos)} style={s.posMore}>
                <AppIcon name="more-horizontal" size={16} color={colors.textDim} />
              </Pressable>
            </Pressable>

            {expanded === pos.id && loadingDetailId === pos.id ? (
              <DetailLoading pos={pos} />
            ) : null}

            {expanded === pos.id && hasDetailContent(detailsByPosition[pos.id]) ? (
              <View style={s.detail}>
                {(detailsByPosition[pos.id].photos?.length || detailsByPosition[pos.id].photo_url) ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.photoStrip} contentContainerStyle={s.photoStripBody}>
                    {(detailsByPosition[pos.id].photos || [{ url: detailsByPosition[pos.id].photo_url }]).map((p, pi) => (
                      <MediaPreview
                        key={pi}
                        apiUrl={session.apiUrl}
                        uri={p.preview_url || p.url}
                        thumbnailUri={p.media_asset_id
                          ? mediaPreviewUrl(session.apiUrl, p.media_asset_id, Boolean(p.thumbnail_url))
                          : p.thumbnail_url}
                        contentType={p.content_type}
                        style={s.detailPhoto}
                        allowOriginalFallback={false}
                      />
                    ))}
                  </ScrollView>
                ) : null}
                {(detailsByPosition[pos.id].items || []).map((item, ii) => (
                  <Pressable key={ii} style={s.itemRow} onLongPress={() => handleItemAction(item)}>
                    <View style={s.itemDot} />
                    <View style={s.itemInfo}>
                      <Text style={s.itemName}>{item.item_name}</Text>
                      {item.description ? <Text style={s.itemDesc} numberOfLines={1}>{item.description}</Text> : null}
                    </View>
                    {item.recorded_at ? <Text style={s.itemDate}>{item.recorded_at.slice(5, 10)}</Text> : null}
                    <Pressable hitSlop={8} onPress={() => handleItemAction(item)} style={s.itemMore}>
                      <AppIcon name="more-horizontal" size={14} color={colors.textDim} />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        )) : !addingPos ? (
          <EmptyState title={t('sd_empty_title')} text={t('sd_empty_text')} icon="map-pin" />
        ) : null}

        {addingPos ? (
          <View style={s.addRow}>
            <TextInput style={s.addInput} value={newPosName} onChangeText={setNewPosName}
              placeholder={t('sd_add_pos_ph')} placeholderTextColor={colors.textDim}
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
            <Text style={s.addPosBtnText}>{t('sd_add_pos')}</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={s.bottomBar}>
        <Pressable style={({ pressed }) => [s.photoBtn, pressed && s.pressed]}
          onPress={pickPhoto}>
          <AppIcon name="camera" size={17} color={colors.bg} />
          <Text style={s.photoBtnText}>{t('sd_shoot_room')}</Text>
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
  posCardPressed: { backgroundColor: colors.bgRaised },
  posLoadingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: radius.lg, backgroundColor: colors.bgCard, padding: 12
  },
  posLoadingThumb: {
    width: 56, height: 56, borderRadius: radius.md,
    backgroundColor: colors.bgInput
  },
  posLoadingBody: { flex: 1, gap: 9 },
  posLoadingLine: {
    height: 11, borderRadius: 6,
    backgroundColor: colors.bgInput
  },
  posLoadingLineShort: { width: '58%' },
  posThumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.bgInput },
  posThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  mediaFrame: { overflow: 'hidden' },
  mediaImage: { width: '100%', height: '100%' },
  mediaEmpty: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgInput
  },
  mediaVideoOverlay: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.16)'
  },
  mediaVideoPlay: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center'
  },
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
  detailLoading: {
    borderRadius: radius.md, backgroundColor: colors.bgRaised,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
    padding: 12, marginTop: 4, gap: 12
  },
  detailPhotoLoading: {
    width: 220, height: 165, borderRadius: radius.md,
    backgroundColor: colors.bgCard
  },
  detailItemLoadingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 5, paddingHorizontal: 4
  },
  detailItemLoadingDot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: colors.bgCard
  },
  detailItemLoadingBody: { flex: 1, gap: 5 },
  detailItemLoadingName: {
    width: '42%', height: 12, borderRadius: 6,
    backgroundColor: colors.bgCard
  },
  detailItemLoadingDesc: {
    width: '72%', height: 10, borderRadius: 5,
    backgroundColor: colors.bgCard
  },
  detailItemLoadingDescShort: { width: '54%' },
  detailItemLoadingDate: {
    width: 32, height: 10, borderRadius: 5,
    backgroundColor: colors.bgCard
  },
  photoStrip: { marginHorizontal: -12 },
  photoStripBody: { paddingHorizontal: 12, gap: 8 },
  detailPhoto: { width: 220, height: 165, borderRadius: radius.md, backgroundColor: colors.bgCard },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingHorizontal: 4 },
  itemDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.textDim, marginTop: 1 },
  itemInfo: { flex: 1, minWidth: 0 },
  itemName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  itemDesc: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  itemMore: { padding: 4 },
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
