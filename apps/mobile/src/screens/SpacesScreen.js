import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
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
import { colors, radius } from '../theme';
import SpaceDetailScreen from './SpaceDetailScreen';

export default function SpacesScreen({ session, onDataChanged, dataVersion, onPickMedia }) {
  const [data, setData] = useState({ spaces: [], total_spaces: 0, total_items: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [addingSpace, setAddingSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const posCache = useRef({});
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
      load();
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
      total_items: prev.total_items - (space.item_count || 0)
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

  return (
    <View style={s.screen}>
    {showDetail && selectedSpace ? (
      <Animated.View style={[s.detailLayer, { transform: [{ translateX: slideAnim }] }]} {...panResponder.panHandlers}>
        <SpaceDetailScreen session={session} space={selectedSpace}
          cachedPositions={posCache.current[selectedSpace.id]}
          onCachePositions={(pos) => { posCache.current[selectedSpace.id] = pos; }}
          onBack={closeSpace}
          onPickMedia={(assets) => onPickMedia({ assets, spaceHint: selectedSpace.name })} />
      </Animated.View>
    ) : null}
    <ScrollView style={s.list} contentContainerStyle={s.body}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textDim} />}>

      <View style={s.header}>
        <Text style={s.title}>我的家</Text>
        <Text style={s.subtitle}>{data.total_spaces} 个空间 · {data.total_items} 件物品</Text>
      </View>

      {data.spaces.length > 0 ? data.spaces.map((space) => (
        <Pressable key={space.id} style={({ pressed }) => [s.spaceCard, pressed && s.pressed]}
          onPress={() => openSpace(space)}
          onLongPress={() => handleSpaceLongPress(space)}>
          <View style={s.spaceTop}>
            <Text style={s.spaceName}>{space.name}</Text>
            <Pressable hitSlop={10} onPress={(e) => { e.stopPropagation?.(); handleSpaceLongPress(space); }}>
              <AppIcon name="more-horizontal" size={18} color={colors.textDim} />
            </Pressable>
          </View>
          <Text style={s.spacePositions} numberOfLines={1}>
            {space.positions?.join('  ·  ') || '暂无位置'}
          </Text>
        </Pressable>
      )) : !addingSpace ? (
        <EmptyState title="还没有空间" text="点击下方添加空间，或拍照让 AI 自动识别" icon="home" />
      ) : null}

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
      ) : (
        <Pressable style={({ pressed }) => [s.addSpaceBtn, pressed && s.pressed]}
          onPress={() => setAddingSpace(true)}>
          <AppIcon name="plus" size={16} color={colors.textSecondary} />
          <Text style={s.addSpaceBtnText}>添加空间</Text>
        </Pressable>
      )}

      <Pressable style={({ pressed }) => [s.captureBtn, pressed && s.pressed]}
        onPress={() => pickAndSend()}>
        <AppIcon name="camera" size={18} color={colors.bg} />
        <Text style={s.captureBtnText}>拍照记录</Text>
      </Pressable>
    </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  detailLayer: { ...StyleSheet.absoluteFillObject, zIndex: 2, backgroundColor: colors.bg, ...(Platform.OS === 'web' ? { willChange: 'transform' } : {}) },
  body: { padding: 20, paddingBottom: 40, gap: 12 },
  header: { paddingVertical: 8 },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.textTertiary, fontSize: 14, marginTop: 4 },
  spaceCard: {
    borderRadius: radius.lg, backgroundColor: colors.bgCard,
    padding: 16, gap: 8
  },
  spaceTop: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between'
  },
  spaceName: { color: colors.text, fontSize: 20, fontWeight: '800' },
  spaceCount: { color: colors.textTertiary, fontSize: 14, fontWeight: '700' },
  spacePositions: { color: colors.textDim, fontSize: 14 },
  addSpaceBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, minHeight: 46, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed'
  },
  addSpaceBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8
  },
  addInput: {
    flex: 1, height: 44, borderRadius: radius.md,
    backgroundColor: colors.bgCard, paddingHorizontal: 14,
    color: colors.text, fontSize: 15
  },
  addConfirm: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center'
  },
  addCancel: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center'
  },
  captureBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, minHeight: 50, borderRadius: radius.full,
    backgroundColor: colors.primary, marginTop: 4
  },
  captureBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.7 }
});
