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
  View
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { requestJson } from '../api';
import { streamAgentUpload } from '../sse';
import { AppIcon, EmptyState } from '../ui';
import { colors, radius } from '../theme';
import AgentWorkflow from '../components/AgentWorkflow';
import SuggestionCard from '../components/SuggestionCard';
import SpaceDetailScreen from './SpaceDetailScreen';

export default function SpacesScreen({ session, onDataChanged, dataVersion, onNeedCredits, onCreditsChanged }) {
  const [data, setData] = useState({ spaces: [], total_spaces: 0, total_items: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [agentSteps, setAgentSteps] = useState([]);
  const [agentSuggestion, setAgentSuggestion] = useState(null);
  const [agentMediaId, setAgentMediaId] = useState(null);
  const [agentMessageId, setAgentMessageId] = useState(null);
  const [agentPreview, setAgentPreview] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const load = useCallback(async () => {
    try { setData(await requestJson('/spaces', session)); } catch {}
  }, [session, dataVersion]);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  async function pickAndAnalyze() {
    if (Platform.OS === 'web') {
      startAnalyze('library');
    } else {
      Alert.alert('拍照方式', '', [
        { text: '相机', onPress: () => startAnalyze('camera') },
        { text: '相册', onPress: () => startAnalyze('library') },
        { text: '取消', style: 'cancel' }
      ]);
    }
  }

  async function startAnalyze(source) {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('需要权限'); return; }

    const options = { mediaTypes: ['images', 'videos'], videoMaxDuration: 10, quality: 0.72 };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const isVideo = asset.type === 'video' || asset.uri?.match(/\.(mp4|mov|m4v)$/i);
    const mime = isVideo ? 'video/mp4' : (asset.mimeType || 'image/jpeg');
    setAnalyzing(true);
    setAgentSteps([{ type: 'thinking', text: isVideo ? '正在上传视频' : '正在上传照片' }]);
    setAgentSuggestion(null);
    setAgentMediaId(null);
    setAgentMessageId(null);
    setAgentPreview({ uri: asset.uri, type: isVideo ? 'video' : 'photo' });

    try {
      let fileData = asset.uri;
      if (Platform.OS === 'web') {
        const resp = await fetch(asset.uri);
        fileData = await resp.blob();
      }
      await streamAgentUpload(session.apiUrl, session.token, '/agent/analyze?source=spaces',
        fileData, mime, (e) => {
        if (e.type === 'media') {
          setAgentMediaId(e.media_asset_id);
          setAgentSteps((p) => [...p, { type: 'thinking', text: '已上传，正在识别' }]);
        }
        else if (e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'thinking')
          setAgentSteps((p) => [...p, e]);
        else if (e.type === 'done' && e.suggestion) setAgentSuggestion(e.suggestion);
        else if (e.type === 'message_saved') setAgentMessageId(e.message_id);
        else if (e.type === 'error') throw new Error(e.error || 'Agent failed');
      });
      onCreditsChanged?.();
    } catch (err) {
      if (err.message?.includes('已用完')) {
        setAgentSteps([]);
        setAgentSuggestion(null);
        setAgentMediaId(null);
        setAgentMessageId(null);
        setAgentPreview(null);
        onNeedCredits?.();
      } else {
        setAgentSteps((p) => [...p, { type: 'thinking', text: `识别失败：${err.message}` }]);
        Alert.alert('识别失败', err.message);
      }
    }
    finally { setAnalyzing(false); }
  }

  async function confirmSuggestion(edited) {
    const finalSuggestion = edited || agentSuggestion;
    if (!finalSuggestion) return;
    setConfirmLoading(true);
    try {
      await requestJson('/agent/confirm', {
        ...session, method: 'POST',
        body: { suggestion: finalSuggestion, media_asset_id: agentMediaId, message_id: agentMessageId }
      });
      setAgentSteps([]); setAgentSuggestion(null); setAgentMediaId(null); setAgentMessageId(null); setAgentPreview(null);
      await load(); onDataChanged?.();
    } catch (err) { Alert.alert('保存失败', err.message); }
    finally { setConfirmLoading(false); }
  }

  const showAgentPanel = analyzing || agentPreview || agentSteps.length > 0 || agentSuggestion;
  const analysisPanel = showAgentPanel ? (
    <View style={s.agentPanel}>
      <Text style={s.agentLabel}>{analyzing ? 'AI 正在识别' : agentSuggestion ? '识别结果' : '识别状态'}</Text>
      {agentPreview ? (
        <View style={s.previewRow}>
          {agentPreview.type === 'video' ? (
            <View style={[s.previewThumb, s.previewVideo]}>
              <AppIcon name="play-circle" size={18} color={colors.white} />
            </View>
          ) : (
            <Image source={{ uri: agentPreview.uri }} style={s.previewThumb} />
          )}
          <Text style={s.previewText}>{agentPreview.type === 'video' ? '视频已添加' : '照片已添加'}</Text>
        </View>
      ) : null}
      <AgentWorkflow steps={agentSteps} apiUrl={session.apiUrl} />
      {agentSuggestion ? (
        <SuggestionCard suggestion={agentSuggestion}
          onConfirm={confirmSuggestion} loading={confirmLoading || analyzing} />
      ) : null}
    </View>
  ) : null;

  if (selectedSpace) {
    return <SpaceDetailScreen session={session} space={selectedSpace}
      onBack={() => { setSelectedSpace(null); load(); }} onPhoto={pickAndAnalyze}
      analysisPanel={analysisPanel} photoBusy={analyzing} />;
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.body}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textDim} />}>

      <View style={s.header}>
        <Text style={s.title}>我的家</Text>
        <Text style={s.subtitle}>{data.total_spaces} 个空间 · {data.total_items} 件物品</Text>
      </View>

      {analysisPanel}

      {data.spaces.length > 0 ? data.spaces.map((space) => (
        <Pressable key={space.id} style={({ pressed }) => [s.spaceCard, pressed && s.pressed]}
          onPress={() => setSelectedSpace(space)}>
          <View style={s.spaceTop}>
            <Text style={s.spaceName}>{space.name}</Text>
            <Text style={s.spaceCount}>{space.item_count}</Text>
          </View>
          <Text style={s.spacePositions} numberOfLines={1}>
            {space.positions?.join('  ·  ') || '暂无位置'}
          </Text>
        </Pressable>
      )) : (
        <EmptyState title="还没有空间" text="拍张照片，AI 自动识别房间和位置" icon="home" />
      )}

      <Pressable style={({ pressed }) => [s.captureBtn, pressed && s.pressed, analyzing && s.disabled]}
        onPress={pickAndAnalyze} disabled={analyzing}>
        <AppIcon name="camera" size={18} color={colors.bg} />
        <Text style={s.captureBtnText}>{analyzing ? '正在识别' : '拍照记录'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingBottom: 40, gap: 12 },
  header: { paddingVertical: 8 },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.textTertiary, fontSize: 14, marginTop: 4 },
  agentPanel: {
    borderRadius: radius.lg, backgroundColor: colors.bgRaised,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
    padding: 14, gap: 8
  },
  agentLabel: { color: colors.orange, fontSize: 12, fontWeight: '700' },
  previewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: radius.md, backgroundColor: colors.bgInput, padding: 8
  },
  previewThumb: {
    width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.bgCard
  },
  previewVideo: {
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary
  },
  previewText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
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
  captureBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, minHeight: 50, borderRadius: radius.full,
    backgroundColor: colors.primary, marginTop: 4
  },
  captureBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 }
});
