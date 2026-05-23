import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { requestJson } from '../api';
import { AppIcon, EmptyState } from '../ui';
import { colors, radius, shadows } from '../theme';
import SpaceDetailScreen from './SpaceDetailScreen';
import { getSpaceCoverSource } from '../spaceCovers';

const heroFloorPlanImage = require('../../assets/home-floorplan-wash.jpg');

function HeroFloorPlan() {
  return (
    <View pointerEvents="none" style={s.floorPlanBackdrop}>
      <Image source={heroFloorPlanImage} style={s.floorPlanBackdropImage} resizeMode="cover" />
    </View>
  );
}

function SpaceImage({ space, index = 0 }) {
  return (
    <View style={s.sketch}>
      <Image source={getSpaceCoverSource(space.name, index)} style={s.spaceImage} resizeMode="cover" />
      <View style={s.spaceImageShade} />
    </View>
  );
}

export default function SpacesScreen({ session, onDataChanged, dataVersion, onPickMedia }) {
  const [data, setData] = useState({ spaces: [], total_spaces: 0, total_items: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [addingSpace, setAddingSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const { width: screenW } = useWindowDimensions();
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [showDetail, setShowDetail] = useState(false);

  function openSpace(space) {
    setSelectedSpace(space);
    setShowDetail(true);
    slideAnim.setValue(screenW);
    Animated.timing(slideAnim, { toValue: 0, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }

  function closeSpace() {
    Animated.timing(slideAnim, { toValue: screenW, duration: 150, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      setShowDetail(false);
      setSelectedSpace(null);
    });
  }

  const shouldCapture = (e, g) => {
    const fromEdge = e.nativeEvent.pageX - g.dx;
    return fromEdge < 60 && g.dx > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 2;
  };
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: shouldCapture,
    onMoveShouldSetPanResponderCapture: shouldCapture,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { slideAnim.stopAnimation(); },
    onPanResponderMove: (_, g) => { if (g.dx >= 0) slideAnim.setValue(g.dx); },
    onPanResponderRelease: (_, g) => {
      if (g.dx > screenW * 0.25 || g.vx > 0.4) {
        closeSpace();
      } else {
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, overshootClamping: true }).start();
      }
    }
  })).current;

  const load = useCallback(async () => {
    try { setData(await requestJson('/spaces', session)); } catch {}
  }, [session, dataVersion]);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  async function handleAddSpace() {
    const name = newSpaceName.trim();
    if (!name) return;
    const tempId = `temp_${Date.now()}`;
    setNewSpaceName('');
    setAddingSpace(false);
    setData(prev => ({
      ...prev,
      spaces: [...prev.spaces, { id: tempId, name, item_count: 0, positions: [] }],
      total_spaces: prev.total_spaces + 1
    }));
    try {
      await requestJson('/spaces', { ...session, method: 'POST', body: { name } });
      load();
      onDataChanged?.();
    } catch (err) {
      setData(prev => ({ ...prev, spaces: prev.spaces.filter(s => s.id !== tempId), total_spaces: prev.total_spaces - 1 }));
      Alert.alert('创建失败', err.message);
    }
  }

  function handleSpaceLongPress(space) {
    if (Platform.OS === 'web') {
      const action = window.prompt(`${space.name}\n输入 "delete" 删除，或输入新名称重命名，取消则留空：`);
      if (action === null || action === '') return;
      if (action.toLowerCase() === 'delete') { doDeleteSpace(space); return; }
      doRenameSpace(space, action);
    } else {
      Alert.alert(space.name, '', [
        { text: '重命名', onPress: () => {
          Alert.prompt?.('重命名空间', '', (name) => { if (name?.trim()) doRenameSpace(space, name.trim()); }, 'plain-text', space.name);
        }},
        { text: '删除', style: 'destructive', onPress: () => doDeleteSpace(space) },
        { text: '取消', style: 'cancel' }
      ]);
    }
  }

  async function doRenameSpace(space, newName) {
    const oldName = space.name;
    setData(prev => ({ ...prev, spaces: prev.spaces.map(s => s.id === space.id ? { ...s, name: newName } : s) }));
    try {
      await requestJson(`/spaces/${space.id}`, { ...session, method: 'PUT', body: { name: newName } });
      onDataChanged?.();
    } catch (err) {
      setData(prev => ({ ...prev, spaces: prev.spaces.map(s => s.id === space.id ? { ...s, name: oldName } : s) }));
      Alert.alert('重命名失败', err.message);
    }
  }

  async function doDeleteSpace(space) {
    if (Platform.OS === 'web' ? !window.confirm(`确定删除"${space.name}"？`) : false) return;
    if (Platform.OS !== 'web') {
      // Native uses Alert.alert for confirmation
      return new Promise(resolve => {
        Alert.alert('删除空间', `确定删除"${space.name}"及其所有位置和物品？`, [
          { text: '取消', style: 'cancel', onPress: resolve },
          { text: '删除', style: 'destructive', onPress: () => { executeDeleteSpace(space); resolve(); }}
        ]);
      });
    }
    executeDeleteSpace(space);
  }

  async function executeDeleteSpace(space) {
    const prevData = data;
    setData(prev => ({
      ...prev,
      spaces: prev.spaces.filter(s => s.id !== space.id),
      total_spaces: prev.total_spaces - 1,
      total_items: Number(prev.total_items || 0) - Number(space.item_count || 0)
    }));
    try {
      await requestJson(`/spaces/${space.id}`, { ...session, method: 'DELETE' });
      onDataChanged?.();
    } catch (err) {
      setData(prevData);
      Alert.alert('删除失败', err.message);
    }
  }

  async function pickAndSend(spaceHint) {
    if (Platform.OS === 'web') {
      doPick('library', spaceHint);
    } else {
      Alert.alert('记录方式', '', [
        { text: '拍照', onPress: () => doPick('camera', spaceHint) },
        { text: '从相册选', onPress: () => doPick('library', spaceHint) },
        { text: '取消', style: 'cancel' }
      ]);
    }
  }

  async function doPick(source, spaceHint) {
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

    onPickMedia({ assets: result.assets, spaceHint });
  }

  const spaces = data.spaces || [];
  const hasSpaces = spaces.length > 0;
  const totalPositions = spaces.reduce((sum, space) => sum + Number(space.positions?.length || 0), 0);

  return (
    <View style={s.screen}>
    {showDetail && selectedSpace ? (
      <Animated.View style={[s.detailLayer, { transform: [{ translateX: slideAnim }] }]} {...panResponder.panHandlers}>
        <SpaceDetailScreen session={session} space={selectedSpace}
          onBack={closeSpace}
          onPickMedia={(assets) => onPickMedia({ assets, spaceHint: selectedSpace.name })} />
      </Animated.View>
    ) : null}
    <ScrollView style={s.list} contentContainerStyle={s.body}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textDim} />}>

      <View style={s.topArea}>
        <HeroFloorPlan />
        <View style={s.header}>
          <View style={s.headerText}>
            <Text style={s.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.86}>拍照记录，想找就问</Text>
            <View style={s.topStats}>
              <View style={s.topStat}>
                <Text style={s.topStatValue}>{data.total_spaces}</Text>
                <Text style={s.topStatLabel}>空间</Text>
              </View>
              <View style={s.topStatDivider} />
              <View style={s.topStat}>
                <Text style={s.topStatValue}>{totalPositions}</Text>
                <Text style={s.topStatLabel}>位置</Text>
              </View>
              <View style={s.topStatDivider} />
              <View style={s.topStat}>
                <Text style={s.topStatValue}>{data.total_items}</Text>
                <Text style={s.topStatLabel}>物品</Text>
              </View>
            </View>
          </View>
        </View>

        <Pressable style={({ pressed }) => [s.captureBtn, pressed && s.pressed]}
          onPress={() => pickAndSend()}>
          <View style={s.captureIconSlot}>
            <View style={s.captureIcon}>
              <AppIcon name="camera" size={20} color="#5F754F" />
            </View>
          </View>
          <View style={s.captureLabelWrap}>
            <Text style={s.captureBtnText}>记录物品</Text>
          </View>
        </Pressable>
      </View>

      {addingSpace ? (
        <View style={s.addRow}>
          <TextInput style={s.addInput} value={newSpaceName} onChangeText={setNewSpaceName}
            placeholder="空间名称，如 客厅、卧室" placeholderTextColor={colors.textDim}
            autoFocus returnKeyType="done" onSubmitEditing={handleAddSpace} />
          <Pressable style={s.addConfirm} onPress={handleAddSpace}>
            <AppIcon name="check" size={16} color={colors.white} />
          </Pressable>
          <Pressable style={s.addCancel} onPress={() => { setAddingSpace(false); setNewSpaceName(''); }}>
            <AppIcon name="x" size={16} color={colors.textDim} />
          </Pressable>
        </View>
      ) : null}

      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>我的空间</Text>
        <View style={s.sectionActions}>
          <Text style={s.sectionMeta}>{hasSpaces ? `${spaces.length} 个` : '待创建'}</Text>
          {!addingSpace ? (
            <Pressable style={({ pressed }) => [s.sectionAddBtn, pressed && s.pressed]} onPress={() => setAddingSpace(true)}>
              <AppIcon name="plus" size={16} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {hasSpaces ? (
        <View style={s.spaceGrid}>
          {spaces.map((space, index) => (
            <Pressable key={space.id} style={({ pressed }) => [s.spaceCard, pressed && s.spaceCardPressed]}
              onPress={() => openSpace(space)}
              onLongPress={() => handleSpaceLongPress(space)}>
              <SpaceImage space={space} index={index} />
              <View style={s.spaceInfo}>
                <View style={s.spaceTop}>
                  <View style={s.spaceNameWrap}>
                    <Text style={s.spaceName} numberOfLines={1}>{space.name}</Text>
                    <Text style={s.spaceCount}>{Number(space.item_count || 0)} 件物品</Text>
                  </View>
                  <Pressable style={s.spaceMore} hitSlop={8} onPress={(e) => { e.stopPropagation?.(); handleSpaceLongPress(space); }}>
                    <AppIcon name="more-horizontal" size={17} color={colors.textDim} />
                  </Pressable>
                </View>
                <Text style={s.spacePositions} numberOfLines={1}>
                  {space.positions?.join('  ·  ') || '暂无位置'}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : !addingSpace ? (
        <EmptyState title="还没有空间" text="点击上方添加空间，或拍照让 AI 自动识别" icon="home" />
      ) : null}
    </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F8F4' },
  topArea: {
    position: 'relative',
    minHeight: 182,
    paddingBottom: 0,
    overflow: 'visible'
  },
  floorPlanBackdrop: {
    position: 'absolute',
    left: 96,
    top: -44,
    width: 316,
    height: 308,
    opacity: 0.95,
    zIndex: 0
  },
  floorPlanBackdropImage: { width: '100%', height: '100%', borderRadius: radius.xl },
  list: { flex: 1 },
  detailLayer: { ...StyleSheet.absoluteFillObject, zIndex: 2, backgroundColor: colors.bg, ...(Platform.OS === 'web' ? { willChange: 'transform' } : {}) },
  body: { padding: 18, paddingBottom: 28, gap: 14 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 8, paddingBottom: 2,
    zIndex: 1
  },
  headerText: { flex: 1, minWidth: 0, maxWidth: 296 },
  title: { color: colors.text, fontSize: 24, lineHeight: 31, fontWeight: '800' },
  topStats: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  topStat: { minWidth: 42 },
  topStatValue: { color: '#2F7D5B', fontSize: 25, fontWeight: '800', lineHeight: 29 },
  topStatLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 1 },
  topStatDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: 'rgba(47,125,91,0.24)' },
  captureBtn: {
    flexDirection: 'row', alignItems: 'center',
    minHeight: 50, borderRadius: radius.full,
    backgroundColor: '#5F754F',
    paddingLeft: 6,
    paddingRight: 12,
    marginTop: 14,
    width: 148,
    zIndex: 1,
    shadowColor: '#4F6540',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 5
  },
  captureIconSlot: {
    width: 42,
    alignItems: 'flex-start',
    justifyContent: 'center'
  },
  captureIcon: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.white
  },
  captureLabelWrap: {
    flex: 1,
    alignItems: 'center',
    paddingRight: 1
  },
  captureBtnText: { color: colors.white, fontSize: 16, fontWeight: '800' },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 0
  },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sectionActions: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  sectionMeta: { color: colors.textTertiary, fontSize: 13, fontWeight: '700' },
  sectionAddBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bgCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center'
  },
  spaceGrid: { gap: 10 },
  spaceCard: {
    overflow: 'hidden',
    borderRadius: radius.lg, backgroundColor: colors.bgCard,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
    ...shadows.card
  },
  spaceCardPressed: { backgroundColor: '#F8F6F2' },
  sketch: {
    height: 136,
    backgroundColor: '#EEE8DE',
    overflow: 'hidden'
  },
  spaceImage: { width: '100%', height: '100%' },
  spaceImageShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(14,21,18,0.05)'
  },
  spaceInfo: { padding: 14, gap: 10 },
  spaceTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  spaceNameWrap: { flex: 1, minWidth: 0 },
  spaceName: { color: colors.text, fontSize: 18, fontWeight: '800' },
  spaceMore: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F5F3EE',
    marginRight: -4, marginTop: -4
  },
  spaceCount: { color: '#2F7D5B', fontSize: 13, fontWeight: '800', marginTop: 3 },
  spacePositions: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8
  },
  addInput: {
    flex: 1, height: 46, borderRadius: radius.lg,
    backgroundColor: colors.bgCard, paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.lineStrong,
    color: colors.text, fontSize: 15
  },
  addConfirm: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#2F7D5B', alignItems: 'center', justifyContent: 'center'
  },
  addCancel: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center'
  },
  pressed: { opacity: 0.7 }
});
