import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { fullImageUrl, requestJson } from '../api';
import {
  ActionButton,
  AppIcon,
  EmptyState,
  Field,
  ItemLocationCard,
  MiniStat,
  Panel,
  SectionHeader,
  StepIndicator
} from '../ui';
import { colors, radius, shadows } from '../theme';

export default function WorkspaceScreen({ session, locations, recentItems, onChanged }) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [records, setRecords] = useState([]);
  const [searching, setSearching] = useState(false);
  const [activeTool, setActiveTool] = useState('record');

  const [photo, setPhoto] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [mediaAsset, setMediaAsset] = useState(null);
  const [roomName, setRoomName] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [items, setItems] = useState([]);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [placeLoading, setPlaceLoading] = useState(false);

  const suggestions = useMemo(() => {
    const names = recentItems.map((record) => record.item?.name).filter(Boolean);
    return [...new Set(names)].slice(0, 5);
  }, [recentItems]);

  const rooms = useMemo(() => {
    const groups = locations.reduce((acc, location) => {
      const room = location.room_name || '未设置房间';
      if (!acc[room]) acc[room] = [];
      acc[room].push(location);
      return acc;
    }, {});
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [locations]);

  const featuredItems = recentItems.slice(0, 8);
  const activeStep = analysis ? 3 : photo ? 2 : 1;
  const enabledCount = items.filter((item) => item.enabled && item.name.trim()).length;

  async function search(nextQuery = query) {
    const term = nextQuery.trim();
    if (!term) return;

    setQuery(term);
    setSearching(true);
    try {
      const data = await requestJson('/chat/query', {
        ...session,
        method: 'POST',
        body: { query: term }
      });
      setAnswer(data.answer);
      setRecords(data.records || []);
      await onChanged();
    } catch (err) {
      Alert.alert('查询失败', err.message);
    } finally {
      setSearching(false);
    }
  }

  async function pickImage(source) {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('需要权限', source === 'camera' ? '请允许相机权限。' : '请允许相册权限。');
      return;
    }

    const options = {
      allowsEditing: false,
      base64: true,
      quality: 0.72,
      mediaTypes: ImagePicker.MediaTypeOptions.Images
    };

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setPhoto(asset);
    setAnalysis(null);
    setMediaAsset(null);
    setItems([]);
    setActiveTool('record');
  }

  async function analyze() {
    if (!photo?.base64) {
      Alert.alert('没有照片', '请先拍照或选择一张照片。');
      return;
    }

    setCaptureLoading(true);
    try {
      const locationHint = roomName || placeName ? { room_name: roomName, place_name: placeName } : null;
      const data = await requestJson('/media/analyze', {
        ...session,
        method: 'POST',
        body: {
          imageBase64: photo.base64,
          mimeType: photo.mimeType || 'image/jpeg',
          locationHint
        }
      });
      const firstLocation = data.analysis?.location_candidates?.[0] || {};
      setAnalysis(data.analysis);
      setMediaAsset(data.mediaAsset);
      setRoomName(firstLocation.room_name || roomName);
      setPlaceName(firstLocation.place_name || placeName);
      setItems((data.analysis?.items || []).map((item, index) => ({ ...item, enabled: true, localId: `${index}` })));
    } catch (err) {
      Alert.alert('识别失败', err.message);
    } finally {
      setCaptureLoading(false);
    }
  }

  function updateItem(localId, patch) {
    setItems((current) => current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)));
  }

  function addItem() {
    setItems((current) => [
      ...current,
      {
        localId: `${Date.now()}`,
        enabled: true,
        name: '',
        description: '',
        category: '其他'
      }
    ]);
  }

  async function confirm() {
    const selected = items
      .filter((item) => item.enabled && item.name.trim())
      .map((item) => ({
        name: item.name.trim(),
        description: item.description || ''
      }));

    if (!mediaAsset?.id || !placeName.trim() || !selected.length) {
      Alert.alert('缺少信息', '请确认位置和至少一个物品。');
      return;
    }

    setCaptureLoading(true);
    try {
      await requestJson('/recognitions/confirm', {
        ...session,
        method: 'POST',
        body: {
          media_asset_id: mediaAsset.id,
          location: {
            room_name: roomName.trim(),
            place_name: placeName.trim(),
            description: analysis?.scene || ''
          },
          items: selected
        }
      });
      Alert.alert('已保存', '物品位置已经记录。');
      setPhoto(null);
      setAnalysis(null);
      setMediaAsset(null);
      setItems([]);
      setRoomName('');
      setPlaceName('');
      await onChanged();
    } catch (err) {
      Alert.alert('保存失败', err.message);
    } finally {
      setCaptureLoading(false);
    }
  }

  async function saveLocation() {
    if (!placeName.trim()) {
      Alert.alert('缺少位置', '请输入放置点。');
      return;
    }

    setPlaceLoading(true);
    try {
      await requestJson('/locations', {
        ...session,
        method: 'POST',
        body: {
          room_name: roomName.trim(),
          name: placeName.trim()
        }
      });
      setRoomName('');
      setPlaceName('');
      await onChanged();
    } catch (err) {
      Alert.alert('保存失败', err.message);
    } finally {
      setPlaceLoading(false);
    }
  }

  function applyLocation(location) {
    setRoomName(location.room_name || '');
    setPlaceName(location.name || '');
    setActiveTool('record');
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenBody}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.commandArea}>
        <View style={styles.commandHeader}>
          <View style={styles.commandCopy}>
            <Text style={styles.commandKicker}>家庭记忆库</Text>
            <Text style={styles.commandTitle}>找东西，从这里开始</Text>
          </View>
          <View style={styles.liveBadge}>
            <AppIcon name="database" size={15} color={colors.primary} />
            <Text style={styles.liveBadgeText}>{recentItems.length}</Text>
          </View>
        </View>

        <View style={styles.searchComposer}>
          <Field
            icon="search"
            value={query}
            onChangeText={setQuery}
            placeholder="护照、钥匙、备用线..."
            returnKeyType="search"
            onSubmitEditing={() => search()}
            containerStyle={styles.searchField}
            shellStyle={styles.searchShell}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="查找"
            disabled={searching}
            onPress={() => search()}
            style={({ pressed }) => [styles.searchButton, pressed && styles.pressed, searching && styles.disabled]}
          >
            {searching ? <ActivityIndicator color={colors.white} /> : <AppIcon name="arrow-up-right" color={colors.white} size={21} />}
          </Pressable>
        </View>

        {suggestions.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionStrip}>
            {suggestions.map((name) => (
              <Pressable key={name} onPress={() => search(name)} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
                <AppIcon name="clock" color={colors.primary} size={14} />
                <Text style={styles.suggestionText} numberOfLines={1}>{name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      {answer ? (
        <View style={styles.answerBubble}>
          <View style={styles.answerMark}>
            <AppIcon name="check" color={colors.white} size={17} />
          </View>
          <Text style={styles.answerText}>{answer}</Text>
        </View>
      ) : null}

      {records.length ? (
        <View style={styles.matches}>
          <SectionHeader title="这几条最像" icon="target" meta={`${records.length} 条`} />
          {records.map((record) => (
            <ItemLocationCard key={record.item_location_id} apiUrl={session.apiUrl} record={record} compact />
          ))}
        </View>
      ) : null}

      <View style={styles.actionBand}>
        <Pressable
          onPress={() => setActiveTool(activeTool === 'record' ? 'idle' : 'record')}
          style={({ pressed }) => [styles.actionTile, activeTool === 'record' && styles.actionTileActive, pressed && styles.pressed]}
        >
          <View style={[styles.actionIcon, styles.actionIconPrimary]}>
            <AppIcon name="camera" color={colors.white} size={21} />
          </View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>拍照记录</Text>
            <Text style={styles.actionText}>看到就存，不写长表单</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => setActiveTool(activeTool === 'places' ? 'idle' : 'places')}
          style={({ pressed }) => [styles.actionTile, activeTool === 'places' && styles.actionTileActive, pressed && styles.pressed]}
        >
          <View style={[styles.actionIcon, styles.actionIconWarm]}>
            <AppIcon name="map-pin" color={colors.ink} size={20} />
          </View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>整理位置</Text>
            <Text style={styles.actionText}>常用地点做成捷径</Text>
          </View>
        </Pressable>
      </View>

      {activeTool === 'record' ? (
        <Panel style={styles.workbench}>
          <View style={styles.workbenchTop}>
            <View>
              <Text style={styles.workbenchKicker}>快速记录</Text>
              <Text style={styles.workbenchTitle}>拍一张，确认后入库</Text>
            </View>
            <StepIndicator activeStep={activeStep} />
          </View>

          <View style={styles.captureGrid}>
            {photo?.uri ? (
              <View style={styles.photoPreviewWrap}>
                <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
                <View style={styles.photoStatus}>
                  <AppIcon name={analysis ? 'check-circle' : 'image'} color={colors.white} size={14} />
                  <Text style={styles.photoStatusText}>{analysis ? '已识别' : '待识别'}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.photoBlank}>
                <View style={styles.photoBlankIcon}>
                  <AppIcon name="camera" color={colors.primary} size={26} />
                </View>
                <Text style={styles.photoBlankTitle}>对准抽屉、桌面或柜子</Text>
                <Text style={styles.photoBlankText}>AI 会先识别物品和位置，你只需要做最后确认。</Text>
              </View>
            )}

            <View style={styles.captureActions}>
              <ActionButton label="拍照" icon="camera" onPress={() => pickImage('camera')} style={styles.captureAction} />
              <ActionButton label="相册" icon="image" variant="secondary" onPress={() => pickImage('library')} style={styles.captureAction} />
            </View>
          </View>

          <View style={styles.locationFields}>
            <Field label="房间" icon="home" placeholder="书房" value={roomName} onChangeText={setRoomName} containerStyle={styles.fieldHalf} />
            <Field label="放置点" icon="map" placeholder="书桌右侧抽屉" value={placeName} onChangeText={setPlaceName} containerStyle={styles.fieldHalf} />
          </View>

          {locations.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.locationStrip}>
              {locations.slice(0, 10).map((location) => (
                <Pressable key={location.id} onPress={() => applyLocation(location)} style={({ pressed }) => [styles.locationToken, pressed && styles.pressed]}>
                  <Text style={styles.locationTokenRoom}>{location.room_name || '未分组'}</Text>
                  <Text style={styles.locationTokenName} numberOfLines={1}>{location.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <ActionButton
            label="识别照片"
            icon="sparkles"
            onPress={analyze}
            disabled={captureLoading || !photo}
            loading={captureLoading && !analysis}
            style={styles.fullButton}
          />

          {analysis ? (
            <View style={styles.confirmBlock}>
              {analysis.scene ? (
                <View style={styles.sceneLine}>
                  <AppIcon name="layers" color={colors.blue} size={17} />
                  <Text style={styles.sceneText}>{analysis.scene}</Text>
                </View>
              ) : null}

              <SectionHeader title="确认物品" icon="check-square" meta={`${enabledCount} 个将保存`} style={styles.confirmHeader} />
              <View style={styles.itemStack}>
                {items.map((item, index) => (
                  <View key={item.localId} style={[styles.itemRow, !item.enabled && styles.itemRowMuted]}>
                    <View style={styles.itemRowTop}>
                      <View style={styles.itemNumber}>
                        <Text style={styles.itemNumberText}>{index + 1}</Text>
                      </View>
                      <Field
                        icon="tag"
                        value={item.name}
                        onChangeText={(name) => updateItem(item.localId, { name })}
                        placeholder="物品名称"
                        containerStyle={styles.itemNameField}
                      />
                      <Switch
                        value={item.enabled}
                        onValueChange={(enabled) => updateItem(item.localId, { enabled })}
                        trackColor={{ false: colors.lineStrong, true: colors.primarySoft }}
                        thumbColor={item.enabled ? colors.primary : colors.surface}
                      />
                    </View>
                    <Field
                      icon="edit-3"
                      value={item.description}
                      onChangeText={(description) => updateItem(item.localId, { description })}
                      placeholder="备注"
                      multiline
                    />
                  </View>
                ))}
              </View>

              <View style={styles.confirmActions}>
                <ActionButton label="补充物品" icon="plus" variant="secondary" onPress={addItem} style={styles.actionGrow} />
                <ActionButton label="保存记录" icon="save" onPress={confirm} loading={captureLoading} style={styles.actionGrow} />
              </View>
            </View>
          ) : null}
        </Panel>
      ) : null}

      {activeTool === 'places' ? (
        <Panel style={styles.workbench}>
          <View style={styles.workbenchTop}>
            <View>
              <Text style={styles.workbenchKicker}>位置捷径</Text>
              <Text style={styles.workbenchTitle}>给常用放置点命名</Text>
            </View>
            <View style={styles.placeCount}>
              <Text style={styles.placeCountValue}>{locations.length}</Text>
              <Text style={styles.placeCountLabel}>处</Text>
            </View>
          </View>

          <View style={styles.locationFields}>
            <Field label="房间" icon="home" value={roomName} onChangeText={setRoomName} placeholder="厨房" containerStyle={styles.fieldHalf} />
            <Field label="放置点" icon="map-pin" value={placeName} onChangeText={setPlaceName} placeholder="水槽下柜" containerStyle={styles.fieldHalf} />
          </View>
          <ActionButton label="保存为捷径" icon="save" onPress={saveLocation} loading={placeLoading} style={styles.fullButton} />

          {rooms.length ? (
            <View style={styles.roomIndex}>
              {rooms.map(([room, rows]) => (
                <View key={room} style={styles.roomLine}>
                  <Text style={styles.roomName}>{room}</Text>
                  <View style={styles.roomPlaces}>
                    {rows.slice(0, 3).map((location) => (
                      <Pressable key={location.id} onPress={() => applyLocation(location)} style={styles.placePill}>
                        <Text style={styles.placePillText} numberOfLines={1}>{location.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState title="还没有位置捷径" text="保存后，拍照记录时可以一键填入放置点。" icon="map-pin" />
          )}
        </Panel>
      ) : null}

      <View style={styles.statsRow}>
        <MiniStat value={recentItems.length} label="已记录物品" />
        <MiniStat value={rooms.length} label="房间分组" tone="blue" />
        <MiniStat value={locations.length} label="位置捷径" tone="accent" />
      </View>

      <View>
        <SectionHeader title="最近收纳" icon="archive" meta={`${recentItems.length} 条`} />
        {featuredItems.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {featuredItems.map((record) => (
              <RecentTile key={record.id} apiUrl={session.apiUrl} record={record} />
            ))}
          </ScrollView>
        ) : (
          <EmptyState title="还没有记录" text="先拍一张照片，之后就能直接问它在哪。" icon="camera" />
        )}
      </View>

      <View style={styles.recentList}>
        {recentItems.slice(0, 8).map((record) => (
          <ItemLocationCard
            key={record.id}
            apiUrl={session.apiUrl}
            compact
            record={{
              item_name: record.item?.name,
              location_summary: record.location_summary,
              placed_at: record.placed_at,
              note: record.note,
              photo_url: record.mediaAsset?.blob_url
            }}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function RecentTile({ apiUrl, record }) {
  const imageUrl = fullImageUrl(apiUrl, record.mediaAsset?.blob_url);
  return (
    <View style={styles.recentTile}>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.recentTileImage} /> : null}
      <View style={styles.recentTileOverlay} />
      <View style={styles.recentTileText}>
        <Text style={styles.recentTileName} numberOfLines={1}>{record.item?.name || '物品'}</Text>
        <Text style={styles.recentTileLocation} numberOfLines={2}>{record.location_summary || '位置待确认'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas
  },
  screenBody: {
    padding: 16,
    paddingBottom: 26,
    gap: 14
  },
  commandArea: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    ...shadows.card
  },
  commandHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14
  },
  commandCopy: {
    flex: 1
  },
  commandKicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 4
  },
  commandTitle: {
    color: colors.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900'
  },
  liveBadge: {
    minWidth: 56,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10
  },
  liveBadgeText: {
    color: colors.primaryDark,
    fontWeight: '900'
  },
  searchComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  searchField: {
    flex: 1
  },
  searchShell: {
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSoft
  },
  searchButton: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary
  },
  suggestionStrip: {
    gap: 8,
    paddingTop: 12
  },
  suggestion: {
    maxWidth: 132,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10
  },
  suggestionText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: '800'
  },
  answerBubble: {
    borderRadius: radius.lg,
    backgroundColor: colors.successSoft,
    flexDirection: 'row',
    gap: 10,
    padding: 13,
    alignItems: 'flex-start'
  },
  answerMark: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center'
  },
  answerText: {
    flex: 1,
    color: colors.ink,
    lineHeight: 21,
    fontWeight: '700'
  },
  matches: {
    gap: 0
  },
  actionBand: {
    flexDirection: 'row',
    gap: 10
  },
  actionTile: {
    flex: 1,
    minHeight: 96,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: 12,
    justifyContent: 'space-between',
    ...shadows.hairline
  },
  actionTileActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceSoft
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionIconPrimary: {
    backgroundColor: colors.primary
  },
  actionIconWarm: {
    backgroundColor: colors.goldSoft
  },
  actionCopy: {
    gap: 3
  },
  actionTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900'
  },
  actionText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600'
  },
  workbench: {
    padding: 15,
    borderRadius: radius.xl
  },
  workbenchTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14
  },
  workbenchKicker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 4
  },
  workbenchTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '900'
  },
  captureGrid: {
    gap: 10
  },
  photoPreviewWrap: {
    position: 'relative'
  },
  photoPreview: {
    width: '100%',
    height: 245,
    borderRadius: radius.lg,
    backgroundColor: colors.line
  },
  photoStatus: {
    position: 'absolute',
    left: 10,
    top: 10,
    borderRadius: radius.md,
    backgroundColor: colors.scrim,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  photoStatusText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '900'
  },
  photoBlank: {
    minHeight: 210,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22
  },
  photoBlankIcon: {
    width: 58,
    height: 58,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12
  },
  photoBlankTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center'
  },
  photoBlankText: {
    marginTop: 7,
    color: colors.textMuted,
    lineHeight: 20,
    textAlign: 'center',
    fontWeight: '600'
  },
  captureActions: {
    flexDirection: 'row',
    gap: 10
  },
  captureAction: {
    flex: 1
  },
  locationFields: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12
  },
  fieldHalf: {
    flex: 1
  },
  locationStrip: {
    gap: 8,
    paddingTop: 11
  },
  locationToken: {
    width: 138,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  locationTokenRoom: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800'
  },
  locationTokenName: {
    marginTop: 3,
    color: colors.primaryDark,
    fontWeight: '900'
  },
  fullButton: {
    marginTop: 12
  },
  confirmBlock: {
    marginTop: 14
  },
  sceneLine: {
    borderRadius: radius.md,
    backgroundColor: colors.blueSoft,
    padding: 12,
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start'
  },
  sceneText: {
    flex: 1,
    color: colors.text,
    lineHeight: 20,
    fontWeight: '700'
  },
  confirmHeader: {
    marginTop: 12
  },
  itemStack: {
    gap: 9
  },
  itemRow: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceSoft,
    padding: 10,
    gap: 9
  },
  itemRowMuted: {
    opacity: 0.55
  },
  itemRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  itemNumber: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  itemNumberText: {
    color: colors.accent,
    fontWeight: '900'
  },
  itemNameField: {
    flex: 1
  },
  confirmActions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10
  },
  actionGrow: {
    flex: 1
  },
  placeCount: {
    minWidth: 58,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  placeCountValue: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '900'
  },
  placeCountLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800'
  },
  roomIndex: {
    marginTop: 14,
    gap: 10
  },
  roomLine: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
    gap: 8
  },
  roomName: {
    color: colors.ink,
    fontWeight: '900'
  },
  roomPlaces: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  placePill: {
    maxWidth: 145,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  placePillText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '800'
  },
  statsRow: {
    flexDirection: 'row',
    gap: 9
  },
  shelf: {
    gap: 10,
    paddingBottom: 2
  },
  recentTile: {
    width: 156,
    height: 188,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.line,
    justifyContent: 'flex-end'
  },
  recentTileImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%'
  },
  recentTileOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23,32,29,0.24)'
  },
  recentTileText: {
    padding: 12
  },
  recentTileName: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '900'
  },
  recentTileLocation: {
    marginTop: 5,
    color: colors.white,
    lineHeight: 18,
    fontWeight: '700'
  },
  recentList: {
    gap: 0
  },
  pressed: {
    opacity: 0.74
  },
  disabled: {
    opacity: 0.5
  }
});
