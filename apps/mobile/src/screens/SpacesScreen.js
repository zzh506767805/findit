import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { requestJson } from '../api';
import { streamAgent } from '../sse';
import { AppIcon, EmptyState } from '../ui';
import { colors, radius } from '../theme';
import AgentWorkflow from '../components/AgentWorkflow';
import SuggestionCard from '../components/SuggestionCard';
import SpaceDetailScreen from './SpaceDetailScreen';

export default function SpacesScreen({ session, onDataChanged }) {
  const [data, setData] = useState({ spaces: [], total_spaces: 0, total_items: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [agentSteps, setAgentSteps] = useState([]);
  const [agentSuggestion, setAgentSuggestion] = useState(null);
  const [agentMediaId, setAgentMediaId] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const load = useCallback(async () => {
    try { setData(await requestJson('/spaces', session)); } catch {}
  }, [session]);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  async function pickAndAnalyze() {
    Alert.alert('拍照方式', '', [
      { text: '相机', onPress: () => startAnalyze('camera') },
      { text: '相册', onPress: () => startAnalyze('library') },
      { text: '取消', style: 'cancel' }
    ]);
  }

  async function startAnalyze(source) {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('需要权限'); return; }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.72 })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.72 });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setAnalyzing(true);
    setAgentSteps([]);
    setAgentSuggestion(null);
    setAgentMediaId(null);

    try {
      await streamAgent(session.apiUrl, session.token, '/agent/analyze', {
        imageBase64: asset.base64, mimeType: asset.mimeType || 'image/jpeg'
      }, (e) => {
        if (e.type === 'media') setAgentMediaId(e.media_asset_id);
        else if (e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'thinking')
          setAgentSteps((p) => [...p, e]);
        else if (e.type === 'done' && e.suggestion) setAgentSuggestion(e.suggestion);
      });
    } catch (err) { Alert.alert('识别失败', err.message); }
    finally { setAnalyzing(false); }
  }

  async function confirmSuggestion(edited) {
    const finalSuggestion = edited || agentSuggestion;
    if (!finalSuggestion) return;
    setConfirmLoading(true);
    try {
      await requestJson('/agent/confirm', {
        ...session, method: 'POST',
        body: { suggestion: finalSuggestion, media_asset_id: agentMediaId }
      });
      setAgentSteps([]); setAgentSuggestion(null); setAgentMediaId(null);
      await load(); onDataChanged?.();
    } catch (err) { Alert.alert('保存失败', err.message); }
    finally { setConfirmLoading(false); }
  }

  if (selectedSpace) {
    return <SpaceDetailScreen session={session} space={selectedSpace}
      onBack={() => { setSelectedSpace(null); load(); }} onPhoto={pickAndAnalyze} />;
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.body}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textDim} />}>

      <View style={s.header}>
        <Text style={s.title}>我的家</Text>
        <Text style={s.subtitle}>{data.total_spaces} 个空间 · {data.total_items} 件物品</Text>
      </View>

      {(agentSteps.length > 0 || agentSuggestion) ? (
        <View style={s.agentPanel}>
          <Text style={s.agentLabel}>AI 正在识别</Text>
          <AgentWorkflow steps={agentSteps} apiUrl={session.apiUrl} />
          {agentSuggestion ? (
            <SuggestionCard suggestion={agentSuggestion}
              onConfirm={confirmSuggestion} loading={confirmLoading} />
          ) : null}
        </View>
      ) : null}

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
        <Text style={s.captureBtnText}>拍照记录</Text>
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
