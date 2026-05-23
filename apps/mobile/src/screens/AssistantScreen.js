import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Markdown from 'react-native-markdown-display';

import { fullImageUrl, mediaPreviewUrl, requestJson } from '../api';
import { streamAgent, streamAgentUploadBatch } from '../sse';
import StableImage from '../components/StableImage';
import { AppIcon } from '../ui';
import { colors, radius, shadows } from '../theme';
import AgentWorkflow from '../components/AgentWorkflow';
import SuggestionCard from '../components/SuggestionCard';

function TypingDots() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    function loop(dot, delay) {
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
        ])
      ).start();
    }
    loop(dot1, 0);
    loop(dot2, 150);
    loop(dot3, 300);
  }, [dot1, dot2, dot3]);

  return (
    <View style={s.typingRow}>
      <Text style={s.typingLabel}>思考中</Text>
      {[dot1, dot2, dot3].map((d, i) => (
        <Animated.View key={i} style={[s.typingDot, { opacity: d }]} />
      ))}
    </View>
  );
}

function serverMsgToLocal(m, apiUrl) {
  if (m.role === 'user') {
    if (m.type === 'text') return { role: 'user', type: 'text', text: m.content };
    const uri = fullImageUrl(apiUrl, m.blob_url);
    const directThumbnailUri = fullImageUrl(apiUrl, m.thumbnail_url);
    const routePreviewUri = m.media_asset_id
      ? mediaPreviewUrl(apiUrl, m.media_asset_id, Boolean(m.thumbnail_url))
      : null;
    const thumbnailUri = directThumbnailUri || routePreviewUri;
    const previewUri = fullImageUrl(apiUrl, m.preview_url) || thumbnailUri;
    return {
      role: 'user',
      type: m.type,
      uri,
      previewUri,
      thumbnailUri,
      contentType: m.media_content_type
    };
  }
  const steps = Array.isArray(m.steps) ? m.steps.filter((step) => step.type !== 'answer') : [];
  return {
    role: 'agent', steps, answer: m.content,
    suggestion: m.suggestion, mediaAssetId: m.media_asset_id,
    messageId: m.id, confirmed: m.confirmed
  };
}

function UserMediaPreview({ msg }) {
  const isVideo = msg.type === 'video';
  const previewUri = isVideo ? (msg.thumbnailUri || msg.previewUri) : msg.previewUri;

  return (
    <View style={s.userMediaWrap}>
      {previewUri ? (
        <StableImage uri={previewUri} style={s.userPhoto} />
      ) : (
        <View style={[s.userPhoto, isVideo ? s.videoPlaceholder : s.photoPlaceholder]}>
          <AppIcon name={isVideo ? 'play-circle' : 'image'} size={isVideo ? 32 : 24} color={isVideo ? colors.white : colors.textDim} />
        </View>
      )}
      {isVideo ? (
        <View style={s.videoOverlay}>
          <View style={s.videoPlay}>
            <AppIcon name="play" size={16} color={colors.white} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function AssistantSkeleton() {
  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 650, useNativeDriver: true })
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <View style={s.skeletonRoot} pointerEvents="none">
      <View style={s.skeletonAgentRow}>
        <Animated.View style={[s.skeletonBubble, s.skeletonAgentBubble, { opacity }]}>
          <View style={[s.skeletonLine, s.skeletonLineLong]} />
          <View style={[s.skeletonLine, s.skeletonLineMid]} />
        </Animated.View>
      </View>
      <View style={s.skeletonUserRow}>
        <Animated.View style={[s.skeletonBubble, s.skeletonUserBubble, { opacity }]}>
          <View style={[s.skeletonLine, s.skeletonLineMid]} />
        </Animated.View>
      </View>
      <View style={s.skeletonAgentRow}>
        <Animated.View style={[s.skeletonBubble, s.skeletonAgentBubbleWide, { opacity }]}>
          <View style={[s.skeletonLine, s.skeletonLineLong]} />
          <View style={[s.skeletonLine, s.skeletonLineMid]} />
        </Animated.View>
      </View>
      <View style={s.skeletonUserRow}>
        <Animated.View style={[s.skeletonBubble, s.skeletonUserBubbleShort, { opacity }]}>
          <View style={[s.skeletonLine, s.skeletonLineShort]} />
        </Animated.View>
      </View>
    </View>
  );
}

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function AssistantScreen({ session, onDataChanged, credits, isActive = true, onNeedCredits, onCreditsChanged, pendingMedia, onPendingMediaConsumed }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const scrollRef = useRef(null);
  const pendingBottomScrollRef = useRef(false);
  const loadedHistoryKeyRef = useRef(null);
  const creditTotal = Number(credits?.total ?? ((credits?.free || 0) + (credits?.paid || 0)));
  const todayKey = localDateKey();

  useEffect(() => {
    if (!session.token) {
      loadedHistoryKeyRef.current = null;
      setMessages([]);
      setLoadingHistory(false);
      return;
    }
    const historyKey = `${session.apiUrl}:${session.token}:${todayKey}`;
    if (!isActive || loadedHistoryKeyRef.current === historyKey) return;
    loadedHistoryKeyRef.current = historyKey;
    let cancelled = false;
    let completed = false;
    setLoadingHistory(true);
    (async () => {
      try {
        const data = await requestJson(`/conversation?client_day=${encodeURIComponent(todayKey)}&limit=30`, session);
        if (cancelled) return;
        if (data.messages?.length) {
          setMessages(data.messages.map((m) => serverMsgToLocal(m, session.apiUrl)));
        } else {
          setMessages([]);
        }
        completed = true;
      } catch {
        if (!cancelled && loadedHistoryKeyRef.current === historyKey) loadedHistoryKeyRef.current = null;
      }
      if (!cancelled) setLoadingHistory(false);
    })();
    return () => {
      cancelled = true;
      if (!completed && loadedHistoryKeyRef.current === historyKey) loadedHistoryKeyRef.current = null;
    };
  }, [isActive, session.apiUrl, session.token, todayKey]);

  useEffect(() => {
    if (!isActive || loadingHistory || messages.length === 0) return;
    scrollEnd(false);
  }, [isActive, loadingHistory, messages.length]);

  // Handle pending media from Spaces page
  useEffect(() => {
    if (!isActive || !pendingMedia || busy || loadingHistory) return;
    const { assets, spaceHint } = pendingMedia;
    onPendingMediaConsumed?.();
    if (assets?.length) sendMediaAssets(assets, spaceHint, 'spaces');
  }, [isActive, pendingMedia, busy, loadingHistory]);

  async function sendMediaAssets(assets, spaceHint, origin = 'assistant') {
    if (!assets?.length) return;
    if (credits && creditTotal <= 0) {
      onNeedCredits?.();
      return;
    }
    setBusy(true);
    const batchId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const prepared = assets.map((asset, index) => {
      const isVideo = asset.type === 'video' || asset.uri?.match(/\.(mp4|mov|m4v)$/i);
      const mimeType = isVideo ? (asset.mimeType || 'video/mp4') : (asset.mimeType || 'image/jpeg');
      return {
        asset,
        index,
        isVideo,
        mimeType,
        msgType: isVideo ? 'video' : 'photo'
      };
    });

    for (const item of prepared) {
      addMsg({
        role: 'user',
        type: item.msgType,
        uri: item.asset.uri,
        previewUri: item.isVideo ? null : item.asset.uri,
        contentType: item.mimeType,
        uploadBatchId: batchId,
        uploadIndex: item.index
      });
    }
    addMsg({ role: 'agent', steps: [], answer: null, suggestion: null, mediaAssetId: null });

    let uploadPath = `/agent/analyze?source=${encodeURIComponent(origin)}&client_day=${encodeURIComponent(localDateKey())}`;
    if (spaceHint) uploadPath += `&space_hint=${encodeURIComponent(spaceHint)}`;

    const handleEvent = (e) => {
      if (e.type === 'media') {
        const uploadIndex = Number.isInteger(e.index) ? e.index : 0;
        const preparedItem = prepared[uploadIndex] || prepared[0];
        const mediaUri = fullImageUrl(session.apiUrl, e.blob_url);
        const directThumbnailUri = fullImageUrl(session.apiUrl, e.thumbnail_url);
        const routePreviewUri = e.media_asset_id
          ? mediaPreviewUrl(session.apiUrl, e.media_asset_id, Boolean(e.thumbnail_url))
          : null;
        const thumbnailUri = directThumbnailUri || routePreviewUri;
        const previewUri = preparedItem?.isVideo
          ? thumbnailUri
          : (fullImageUrl(session.apiUrl, e.preview_url) || thumbnailUri || mediaUri);
        patchUserMedia(batchId, uploadIndex, (m) => ({
          ...m,
          uri: mediaUri || m.uri,
          previewUri: previewUri || m.previewUri,
          thumbnailUri: thumbnailUri || m.thumbnailUri,
          contentType: e.content_type || m.contentType,
          mediaAssetId: e.media_asset_id
        }));
        patchLastAgent((m) => ({ ...m, mediaAssetId: m.mediaAssetId || e.media_asset_id }));
      }
      else if (e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'thinking')
        patchLastAgent((m) => ({ ...m, steps: [...m.steps, e] }));
      else if (e.type === 'answer_delta') patchLastAgent((m) => ({ ...m, answer: e.text || `${m.answer || ''}${e.delta || ''}` }));
      else if (e.type === 'answer') patchLastAgent((m) => ({ ...m, answer: e.text }));
      else if (e.type === 'done' && e.suggestion) patchLastAgent((m) => ({ ...m, suggestion: e.suggestion }));
      else if (e.type === 'message_saved') patchLastAgent((m) => ({ ...m, messageId: e.message_id }));
      else if (e.type === 'error') throw new Error(e.error || 'Agent failed');
    };

    try {
      const uploadFiles = [];
      for (const item of prepared) {
        let fileData = item.asset.uri;
        if (Platform.OS === 'web') {
          const resp = await fetch(item.asset.uri);
          fileData = await resp.blob();
        }
        uploadFiles.push({ fileUriOrBlob: fileData, mimeType: item.mimeType });
      }
      await streamAgentUploadBatch(session.apiUrl, session.token, uploadPath, uploadFiles, handleEvent);
      onCreditsChanged?.();
    } catch (err) {
      if (err.message?.includes('已用完')) {
        onNeedCredits?.();
      } else {
        patchLastAgent((m) => ({ ...m, answer: `出错了: ${err.message}` }));
      }
    } finally {
      setBusy(false);
    }
  }

  async function startNewConversation() {
    try {
      await requestJson(`/conversation/new?client_day=${encodeURIComponent(localDateKey())}`, { ...session, method: 'POST' });
      setMessages([]);
    } catch {}
  }

  function scrollEnd(animated = true) {
    pendingBottomScrollRef.current = true;
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated }), 0);
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated });
      pendingBottomScrollRef.current = false;
    }, 120);
  }

  function addMsg(msg) {
    setMessages((p) => [...p, msg]);
    scrollEnd();
  }

  function patchLastAgent(fn) {
    setMessages((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === 'agent') { copy[i] = fn(copy[i]); break; }
      }
      return copy;
    });
    scrollEnd();
  }

  function patchUserMedia(batchId, uploadIndex, fn) {
    setMessages((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === 'user' && copy[i].uploadBatchId === batchId && copy[i].uploadIndex === uploadIndex) {
          copy[i] = fn(copy[i]);
          break;
        }
      }
      return copy;
    });
  }

  async function pickMedia(source, mediaType) {
    if (credits && creditTotal <= 0) {
      onNeedCredits?.();
      return;
    }

    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('需要权限'); return; }

    const options = mediaType === 'video'
      ? { mediaTypes: ['videos'], videoMaxDuration: 10, quality: 0.7 }
      : mediaType === 'image'
        ? { mediaTypes: ['images'], quality: 0.72 }
        : { mediaTypes: ['images', 'videos'], videoMaxDuration: 10, quality: 0.72 };
    if (source !== 'camera') options.allowsMultipleSelection = true;

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.length) return;

    await sendMediaAssets(result.assets);
  }

  async function sendQuery() {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    addMsg({ role: 'user', type: 'text', text: q });
    addMsg({ role: 'agent', steps: [], answer: null, suggestion: null });
    setBusy(true);

    try {
      const queryPath = `/agent/query?client_day=${encodeURIComponent(localDateKey())}`;
      await streamAgent(session.apiUrl, session.token, queryPath, { query: q }, (e) => {
        if (e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'thinking')
          patchLastAgent((m) => ({ ...m, steps: [...m.steps, e] }));
        else if (e.type === 'answer_delta') patchLastAgent((m) => ({ ...m, answer: e.text || `${m.answer || ''}${e.delta || ''}` }));
        else if (e.type === 'answer') patchLastAgent((m) => ({ ...m, answer: e.text }));
        else if (e.type === 'done' && e.suggestion) patchLastAgent((m) => ({ ...m, suggestion: e.suggestion }));
        else if (e.type === 'message_saved') patchLastAgent((m) => ({ ...m, messageId: e.message_id }));
        else if (e.type === 'error') throw new Error(e.error || 'Agent failed');
      });
    } catch (err) {
      patchLastAgent((m) => ({ ...m, answer: `出错了: ${err.message}` }));
    } finally { setBusy(false); }
  }

  async function confirmSuggestion(idx, editedSuggestion) {
    const msg = messages[idx];
    const finalSuggestion = editedSuggestion || msg?.suggestion;
    if (!finalSuggestion) return;
    setBusy(true);
    try {
      await requestJson('/agent/confirm', {
        ...session, method: 'POST',
        body: { suggestion: finalSuggestion, media_asset_id: msg.mediaAssetId, message_id: msg.messageId }
      });
      setMessages((prev) => {
        const c = [...prev]; c[idx] = { ...c[idx], confirmed: true }; return c;
      });
      onDataChanged?.();
    } catch (err) { Alert.alert('保存失败', err.message); }
    finally { setBusy(false); }
  }

  if (!isActive) {
    return <View style={s.container} />;
  }

  return (
    <View style={s.container}>
      <ScrollView ref={scrollRef} style={s.scroll} contentContainerStyle={s.scrollBody}
        onContentSizeChange={() => {
          if (pendingBottomScrollRef.current) scrollRef.current?.scrollToEnd({ animated: false });
        }}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {loadingHistory && messages.length === 0 ? <AssistantSkeleton /> : null}

        {messages.length === 0 && !loadingHistory ? (
          <View style={s.hero}>
            <Text style={s.heroTitle}>找东西，问我就行</Text>
            <Text style={s.heroSub}>拍张照片记录，或直接问位置</Text>
            <View style={s.hints}>
              {['护照在哪', '充电线放哪了', '剪刀呢'].map((h) => (
                <Pressable key={h} style={s.hint} onPress={() => setInput(h)}>
                  <Text style={s.hintText}>{h}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {messages.length > 0 ? (
          <Pressable style={s.newConvBtn} onPress={startNewConversation} disabled={busy}>
            <AppIcon name="plus" size={14} color={colors.textDim} />
            <Text style={s.newConvText}>新对话</Text>
          </Pressable>
        ) : null}

        {messages.map((msg, i) => {
          if (msg.role === 'user' && (msg.type === 'photo' || msg.type === 'video')) {
            return (
              <View key={i} style={s.userRow}>
                <UserMediaPreview msg={msg} />
              </View>
            );
          }
          if (msg.role === 'user' && msg.type === 'text') {
            return (
              <View key={i} style={s.userRow}>
                <View style={s.userBubble}>
                  <Text style={s.userText}>{msg.text}</Text>
                </View>
              </View>
            );
          }
          if (msg.role === 'agent') {
            return (
              <View key={i} style={s.agentRow}>
                {msg.steps?.length > 0 ? <AgentWorkflow steps={msg.steps} apiUrl={session.apiUrl} /> : null}
                {!msg.answer && !msg.suggestion && !msg.confirmed ? (
                  <View style={s.agentLoading}><TypingDots /></View>
                ) : null}
                {msg.answer ? (
                  <View style={s.agentAnswer}>
                    <Markdown style={mdStyles}>{msg.answer}</Markdown>
                  </View>
                ) : null}
                {msg.suggestion && !msg.confirmed ? (
                  <SuggestionCard suggestion={msg.suggestion}
                    onConfirm={(edited) => confirmSuggestion(i, edited)}
                    loading={busy} />
                ) : null}
                {msg.confirmed ? (
                  <View style={s.confirmed}>
                    <AppIcon name="check" size={14} color={colors.green} />
                    <Text style={s.confirmedText}>已保存</Text>
                  </View>
                ) : null}
              </View>
            );
          }
          return null;
        })}
      </ScrollView>

        <View style={s.dock}>
          <Pressable style={({ pressed }) => [s.camBtn, pressed && s.pressed]}
            onPress={() => {
              if (Platform.OS === 'web') {
                pickMedia('library');
              } else {
                Alert.alert('记录方式', '', [
                  { text: '拍照', onPress: () => pickMedia('camera', 'image') },
                  { text: '录像', onPress: () => pickMedia('camera', 'video') },
                  { text: '从相册选', onPress: () => pickMedia('library') },
                  { text: '取消', style: 'cancel' }
                ]);
              }
            }} disabled={busy}>
            <AppIcon name="camera" size={20} color={colors.white} />
          </Pressable>
          <View style={s.inputWrap}>
            <TextInput style={s.input} value={input} onChangeText={setInput}
              placeholder="帮我找..." placeholderTextColor={colors.textDim}
              returnKeyType="send" onSubmitEditing={sendQuery} editable={!busy} />
          </View>
          <Pressable style={({ pressed }) => [s.sendBtn, pressed && s.pressed, (!input.trim() || busy) && s.disabled]}
            onPress={sendQuery} disabled={!input.trim() || busy}>
            <AppIcon name="arrow-up" size={18} color={colors.white} />
          </Pressable>
        </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollBody: { padding: 20, paddingBottom: 10, gap: 16 },
  skeletonRoot: { gap: 16, paddingTop: 18 },
  skeletonAgentRow: { alignItems: 'flex-start' },
  skeletonUserRow: { alignItems: 'flex-end' },
  skeletonBubble: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 9
  },
  skeletonAgentBubble: { width: '62%', borderBottomLeftRadius: radius.xs },
  skeletonAgentBubbleWide: { width: '72%', borderBottomLeftRadius: radius.xs },
  skeletonUserBubble: { width: '48%', backgroundColor: colors.bgRaised, borderBottomRightRadius: radius.xs },
  skeletonUserBubbleShort: { width: '38%', backgroundColor: colors.bgRaised, borderBottomRightRadius: radius.xs },
  skeletonLine: { height: 9, borderRadius: radius.full, backgroundColor: colors.lineStrong },
  skeletonLineLong: { width: '86%' },
  skeletonLineMid: { width: '62%' },
  skeletonLineShort: { width: '38%' },
  hero: { alignItems: 'center', paddingTop: 80, paddingBottom: 40 },
  heroTitle: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  heroSub: { color: colors.textTertiary, fontSize: 15, marginTop: 8 },
  hints: { flexDirection: 'row', gap: 8, marginTop: 28, flexWrap: 'wrap', justifyContent: 'center' },
  hint: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.line },
  hintText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  userRow: { alignItems: 'flex-end' },
  userMediaWrap: { width: 200, height: 150, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.bgCard },
  userPhoto: { width: 200, height: 150, borderRadius: radius.lg, backgroundColor: colors.bgCard },
  videoPlaceholder: {
    backgroundColor: colors.textDim, alignItems: 'center', justifyContent: 'center'
  },
  photoPlaceholder: {
    backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center'
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)'
  },
  videoPlay: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center'
  },
  userBubble: { maxWidth: '78%', backgroundColor: colors.bgInput, borderRadius: radius.lg, borderBottomRightRadius: radius.xs, paddingHorizontal: 16, paddingVertical: 10 },
  userText: { color: colors.text, fontSize: 15, fontWeight: '400', lineHeight: 21 },
  agentRow: { gap: 8 },
  agentLoading: {
    backgroundColor: colors.bgInput, borderRadius: radius.lg, borderBottomLeftRadius: radius.xs,
    paddingHorizontal: 16, paddingVertical: 12, alignSelf: 'flex-start'
  },
  agentAnswer: {
    paddingVertical: 4
  },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2 },
  typingLabel: { color: colors.textTertiary, fontSize: 14 },
  typingDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.textTertiary },
  newConvBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 6, alignSelf: 'center', opacity: 0.6
  },
  newConvText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  confirmed: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  confirmedText: { color: colors.green, fontSize: 14, fontWeight: '700' },
  dock: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: colors.bgRaised,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line,
    ...shadows.dock
  },
  camBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  inputWrap: {
    flex: 1, minHeight: 44, borderRadius: radius.full,
    backgroundColor: colors.bgInput, justifyContent: 'center', paddingHorizontal: 16
  },
  input: { color: colors.text, fontSize: 15, paddingVertical: 0 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.3 }
});

const mdStyles = {
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  strong: { fontWeight: '700', color: colors.text },
  paragraph: { marginTop: 0, marginBottom: 4 },
  bullet_list: { marginTop: 2, marginBottom: 2 },
  ordered_list: { marginTop: 2, marginBottom: 2 },
  list_item: { marginTop: 1 },
  code_inline: { backgroundColor: colors.bgRaised, borderRadius: 3, paddingHorizontal: 4, fontSize: 13, color: colors.textSecondary }
};
