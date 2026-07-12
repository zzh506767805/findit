import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fullImageUrl, mediaPreviewUrl, requestJson } from '../api';
import { streamAgent, streamAgentUploadBatch } from '../sse';
import StableImage from '../components/StableImage';
import { AppIcon } from '../ui';
import { colors, radius, shadows } from '../theme';
import AgentWorkflow from '../components/AgentWorkflow';
import { apiErrorMessage, t } from '../strings';
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
      <Text style={s.typingLabel}>{t('typing')}</Text>
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
  // 中间轮次的回复保留为工作流步骤，只滤掉与最终回复重复的那条
  const steps = Array.isArray(m.steps)
    ? m.steps.filter((step) => step.type !== 'answer' || (step.text && step.text !== m.content))
    : [];
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

const DRAFT_MEDIA_LIMIT = 12;
const DATA_MUTATION_TOOLS = new Set(['update_item', 'update_position', 'delete_item']);

function isVideoAsset(asset) {
  return asset?.type === 'video' || asset?.uri?.match(/\.(mp4|mov|m4v)$/i);
}

function assetMimeType(asset) {
  return isVideoAsset(asset) ? (asset?.mimeType || 'video/mp4') : (asset?.mimeType || 'image/jpeg');
}

function DraftMediaThumb({ item, onRemove }) {
  const isVideo = isVideoAsset(item);
  return (
    <View style={s.draftThumbWrap}>
      {isVideo ? (
        <View style={[s.draftThumb, s.draftVideoThumb]}>
          <AppIcon name="play-circle" size={22} color={colors.white} />
        </View>
      ) : (
        <StableImage uri={item.uri} style={s.draftThumb} />
      )}
      <Pressable style={s.draftRemove} onPress={onRemove} hitSlop={6}>
        <AppIcon name="x" size={12} color={colors.white} />
      </Pressable>
    </View>
  );
}

// 从工具结果里挑出答案提到的物品对应的位置照片（steps 已持久化，历史消息同样适用）
function foundItemPhotos(msg) {
  if (!msg.answer || !msg.steps?.length) return [];
  const answer = msg.answer.toLowerCase();
  const candidates = [];
  for (const step of msg.steps) {
    if (step.type !== 'tool_result' || !step.result) continue;
    if (step.tool === 'search_items' && Array.isArray(step.result.results)) {
      for (const r of step.result.results) {
        if (r.media_asset_id) candidates.push({ id: r.media_asset_id, name: r.item_name, location: r.location_path });
      }
    } else if (step.tool === 'get_position_items' && Array.isArray(step.result.items)) {
      for (const r of step.result.items) {
        if (r.media_asset_id) candidates.push({ id: r.media_asset_id, name: r.name, location: null });
      }
    }
  }
  let picked = candidates.filter((c) => c.name && answer.includes(String(c.name).toLowerCase()));
  // 答案没复述物品名时，若所有结果指向同一张照片也可以放心展示
  if (!picked.length && new Set(candidates.map((c) => c.id)).size === 1) picked = candidates.slice(0, 1);
  const seen = new Set();
  const photos = [];
  for (const c of picked) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    photos.push(c);
    if (photos.length >= 3) break;
  }
  return photos;
}

export default function AssistantScreen({ session, onDataChanged, credits, isActive = true, onNeedCredits, onCreditsChanged, pendingMedia, onPendingMediaConsumed }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [draftMedia, setDraftMedia] = useState([]);
  const [draftSpaceHint, setDraftSpaceHint] = useState('');
  const [draftOrigin, setDraftOrigin] = useState('assistant');
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const scrollRef = useRef(null);
  const pendingBottomScrollRef = useRef(false);
  const loadedHistoryKeyRef = useRef(null);
  const copyTimerRef = useRef(null);
  const [copiedAgentKey, setCopiedAgentKey] = useState(null);
  const [photoView, setPhotoView] = useState(null);
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const creditTotal = Number(credits?.total ?? ((credits?.free || 0) + (credits?.paid || 0)));
  const todayKey = localDateKey();

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

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

  function appendDraftMedia(assets, { spaceHint = '', origin = 'assistant' } = {}) {
    if (!assets?.length) return;
    const hadDraft = draftMedia.length > 0;
    const available = Math.max(0, DRAFT_MEDIA_LIMIT - draftMedia.length);
    if (available <= 0) {
      Alert.alert(t('max_media', { count: DRAFT_MEDIA_LIMIT }));
      return;
    }
    const selected = assets.slice(0, available).map((asset, index) => ({
      ...asset,
      draftId: `${Date.now()}_${index}_${Math.random().toString(36).slice(2)}`
    }));
    if (assets.length > available) Alert.alert(t('max_media_added', { count: DRAFT_MEDIA_LIMIT }));
    if (!hadDraft) {
      setDraftOrigin(origin);
      setDraftSpaceHint(spaceHint || '');
    } else if (spaceHint && !draftSpaceHint) {
      setDraftSpaceHint(spaceHint);
    }
    setDraftMedia((prev) => [...prev, ...selected]);
  }

  function removeDraftMedia(draftId) {
    setDraftMedia((prev) => {
      const next = prev.filter((item) => item.draftId !== draftId);
      if (!next.length) {
        setDraftSpaceHint('');
        setDraftOrigin('assistant');
      }
      return next;
    });
  }

  function clearDraftMedia() {
    setDraftMedia([]);
    setDraftSpaceHint('');
    setDraftOrigin('assistant');
  }

  async function handlePickedMedia(assets, { source = 'library', spaceHint = '', origin = 'assistant' } = {}) {
    if (!assets?.length) return;

    if (source === 'library' && draftMedia.length === 0) {
      if (credits && creditTotal <= 0) {
        onNeedCredits?.();
        return;
      }
      const q = input.trim();
      setInput('');
      await sendMediaAssets(assets, spaceHint, origin, q);
      return;
    }

    appendDraftMedia(assets, { spaceHint, origin });
  }

  // Handle pending media from Spaces page
  useEffect(() => {
    if (!isActive || !pendingMedia || busy || loadingHistory) return;
    const { assets, spaceHint, source = 'library' } = pendingMedia;
    onPendingMediaConsumed?.();
    if (assets?.length) handlePickedMedia(assets, { source, spaceHint, origin: 'spaces' });
  }, [isActive, pendingMedia, busy, loadingHistory]);

  async function sendMediaAssets(assets, spaceHint, origin = 'assistant', queryText = '') {
    if (!assets?.length) return;
    if (credits && creditTotal <= 0) {
      onNeedCredits?.();
      return;
    }
    setBusy(true);
    const batchId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const prepared = assets.map((asset, index) => {
      const isVideo = isVideoAsset(asset);
      const mimeType = assetMimeType(asset);
      return {
        asset,
        index,
        isVideo,
        mimeType,
        msgType: isVideo ? 'video' : 'photo'
      };
    });

    const text = String(queryText || '').trim();
    if (text) addMsg({ role: 'user', type: 'text', text });
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
    addMsg({ role: 'agent', steps: [], answer: null, suggestion: null, mediaAssetId: null, streaming: true });

    let uploadPath = `/agent/analyze?source=${encodeURIComponent(origin)}&client_day=${encodeURIComponent(localDateKey())}`;
    if (spaceHint) uploadPath += `&space_hint=${encodeURIComponent(spaceHint)}`;

    let didMutateData = false;
    const handleEvent = (e) => {
      if (e.type === 'tool_result' && DATA_MUTATION_TOOLS.has(e.tool) && !e.result?.error) {
        didMutateData = true;
      }
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
          previewUri: preparedItem?.isVideo ? (previewUri || m.previewUri) : m.previewUri,
          thumbnailUri: thumbnailUri || m.thumbnailUri,
          contentType: e.content_type || m.contentType,
          mediaAssetId: e.media_asset_id
        }));
        patchLastAgent((m) => ({ ...m, mediaAssetId: m.mediaAssetId || e.media_asset_id }));
      }
      else if (e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'thinking')
        patchLastAgent((m) => (e.type === 'tool_call' && m.answer
          ? { ...m, steps: [...m.steps, { type: 'answer', text: m.answer }, e], answer: null }
          : { ...m, steps: [...m.steps, e] }));
      else if (e.type === 'answer_delta') patchLastAgent((m) => ({ ...m, answer: e.text || `${m.answer || ''}${e.delta || ''}` }));
      else if (e.type === 'answer') patchLastAgent((m) => (
        // 该轮文本已随 tool_call 沉淀为步骤时，忽略轮末补发的同文 answer，避免重复
        m.steps.some((st) => st.type === 'answer' && st.text === e.text) ? m : { ...m, answer: e.text }
      ));
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
      await streamAgentUploadBatch(
        session.apiUrl,
        session.token,
        uploadPath,
        uploadFiles,
        handleEvent,
        text ? { query: text } : {}
      );
      onCreditsChanged?.();
    } catch (err) {
      if (err.code === 'INSUFFICIENT_CREDITS' || err.message?.includes('已用完')) {
        onNeedCredits?.();
      } else {
        patchLastAgent((m) => ({ ...m, answer: t('error_prefix', { message: apiErrorMessage(err) }) }));
      }
    } finally {
      patchLastAgent((m) => ({ ...m, streaming: false }));
      if (didMutateData) onDataChanged?.();
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
    if (!perm.granted) { Alert.alert(t('need_permission')); return; }

    const options = mediaType === 'video'
      ? { mediaTypes: ['videos'], videoMaxDuration: 10, quality: 1 }
      : mediaType === 'image'
        ? { mediaTypes: ['images'], quality: 1 }
        : { mediaTypes: ['images', 'videos'], videoMaxDuration: 10, quality: 1 };
    if (source !== 'camera') options.allowsMultipleSelection = true;

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.length) return;

    await handlePickedMedia(result.assets, { source });
  }

  async function sendQuery() {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    addMsg({ role: 'user', type: 'text', text: q });
    addMsg({ role: 'agent', steps: [], answer: null, suggestion: null, streaming: true });
    setBusy(true);
    let didMutateData = false;

    try {
      const queryPath = `/agent/query?client_day=${encodeURIComponent(localDateKey())}`;
      await streamAgent(session.apiUrl, session.token, queryPath, { query: q }, (e) => {
        if (e.type === 'tool_result' && DATA_MUTATION_TOOLS.has(e.tool) && !e.result?.error) {
          didMutateData = true;
        }
        if (e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'thinking')
          patchLastAgent((m) => (e.type === 'tool_call' && m.answer
            ? { ...m, steps: [...m.steps, { type: 'answer', text: m.answer }, e], answer: null }
            : { ...m, steps: [...m.steps, e] }));
        else if (e.type === 'answer_delta') patchLastAgent((m) => ({ ...m, answer: e.text || `${m.answer || ''}${e.delta || ''}` }));
        else if (e.type === 'answer') patchLastAgent((m) => (
        // 该轮文本已随 tool_call 沉淀为步骤时，忽略轮末补发的同文 answer，避免重复
        m.steps.some((st) => st.type === 'answer' && st.text === e.text) ? m : { ...m, answer: e.text }
      ));
        else if (e.type === 'done' && e.suggestion) patchLastAgent((m) => ({ ...m, suggestion: e.suggestion }));
        else if (e.type === 'message_saved') patchLastAgent((m) => ({ ...m, messageId: e.message_id }));
        else if (e.type === 'error') throw new Error(e.error || 'Agent failed');
      });
    } catch (err) {
      patchLastAgent((m) => ({ ...m, answer: t('error_prefix', { message: apiErrorMessage(err) }) }));
    } finally {
      patchLastAgent((m) => ({ ...m, streaming: false }));
      if (didMutateData) onDataChanged?.();
      setBusy(false);
    }
  }

  async function sendComposer() {
    const q = input.trim();
    if (busy || (!q && draftMedia.length === 0)) return;

    if (draftMedia.length > 0) {
      if (credits && creditTotal <= 0) {
        onNeedCredits?.();
        return;
      }
      const assets = draftMedia;
      const spaceHint = draftSpaceHint;
      const origin = draftOrigin;
      setInput('');
      clearDraftMedia();
      await sendMediaAssets(assets, spaceHint, origin, q);
      return;
    }

    await sendQuery();
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
    } catch (err) { Alert.alert(t('save_failed'), apiErrorMessage(err)); }
    finally { setBusy(false); }
  }

  if (!isActive) {
    return <View style={s.container} />;
  }

  async function copyAgentAnswer(text, key) {
    const value = String(text || '').trim();
    if (!value) return;
    try {
      await Clipboard.setStringAsync(value);
      setCopiedAgentKey(key);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        setCopiedAgentKey((current) => current === key ? null : current);
        copyTimerRef.current = null;
      }, 1300);
    } catch {
      Alert.alert(t('copy_failed'), t('try_later'));
    }
  }

  const canSend = Boolean(input.trim() || draftMedia.length) && !busy;
  const bottomInset = Platform.OS === 'web' ? 0 : insets.bottom;
  const dockInsetStyle = bottomInset
    ? { marginBottom: -bottomInset, paddingBottom: bottomInset + 6 }
    : null;

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
            <Text style={s.heroTitle}>{t('hero_title')}</Text>
            <Text style={s.heroSub}>{t('hero_sub')}</Text>
            <View style={s.hints}>
              {[t('hint_1'), t('hint_2'), t('hint_3')].map((h) => (
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
            <Text style={s.newConvText}>{t('new_conv')}</Text>
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
            const copyKey = msg.messageId || i;
            const answerPhotos = msg.streaming ? [] : foundItemPhotos(msg);
            return (
              <View key={i} style={s.agentRow}>
                {msg.steps?.length > 0 ? <AgentWorkflow steps={msg.steps} apiUrl={session.apiUrl} /> : null}
                {!msg.answer && !msg.suggestion && !msg.confirmed ? (
                  <View style={s.agentLoading}><TypingDots /></View>
                ) : null}
                {msg.answer ? (
                  <Pressable
                    style={({ pressed }) => [s.agentAnswer, pressed && s.agentAnswerPressed]}
                    onLongPress={() => copyAgentAnswer(msg.answer, copyKey)}
                    delayLongPress={350}>
                    <Markdown style={mdStyles}>{msg.answer}</Markdown>
                    {copiedAgentKey === copyKey ? (
                      <View style={s.copyHint}>
                        <AppIcon name="check" size={12} color={colors.green} />
                        <Text style={s.copyHintText}>{t('copied')}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                ) : null}
                {answerPhotos.length > 0 ? (
                  <View style={s.answerPhotoRow}>
                    {answerPhotos.map((p) => (
                      <Pressable key={p.id} style={({ pressed }) => [s.answerPhotoCard, pressed && s.pressed]}
                        onPress={() => setPhotoView(p)}>
                        <StableImage uri={mediaPreviewUrl(session.apiUrl, p.id, true)} style={s.answerPhoto} />
                        {p.location ? (
                          <Text style={s.answerPhotoCaption} numberOfLines={1}>{p.location}</Text>
                        ) : null}
                      </Pressable>
                    ))}
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
                    <Text style={s.confirmedText}>{t('saved')}</Text>
                  </View>
                ) : null}
              </View>
            );
          }
          return null;
        })}
      </ScrollView>

        <View style={[s.dock, dockInsetStyle]}>
          {draftMedia.length > 0 ? (
            <View style={s.draftTray}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.draftList} keyboardShouldPersistTaps="handled">
                {draftMedia.map((item) => (
                  <DraftMediaThumb key={item.draftId} item={item} onRemove={() => removeDraftMedia(item.draftId)} />
                ))}
                {Platform.OS !== 'web' ? (
                  <Pressable style={({ pressed }) => [s.draftAddTile, pressed && s.pressed]}
                    onPress={() => pickMedia('camera', 'image')} disabled={busy}>
                    <AppIcon name="camera" size={16} color={colors.textSecondary} />
                    <Text style={s.draftAddText}>{t('draft_more_shoot')}</Text>
                  </Pressable>
                ) : null}
                <Pressable style={({ pressed }) => [s.draftAddTile, pressed && s.pressed]}
                  onPress={() => pickMedia('library')} disabled={busy}>
                  <AppIcon name="image" size={16} color={colors.textSecondary} />
                  <Text style={s.draftAddText}>{t('draft_album')}</Text>
                </Pressable>
              </ScrollView>
            </View>
          ) : null}
          <View style={s.dockRow}>
            <Pressable style={({ pressed }) => [s.camBtn, pressed && s.pressed]}
              onPress={() => {
                if (Platform.OS === 'web') {
                  pickMedia('library');
                } else {
                  Alert.alert(t('record_method'), '', [
                    { text: t('take_photo'), onPress: () => pickMedia('camera', 'image') },
                    { text: t('record_video'), onPress: () => pickMedia('camera', 'video') },
                    { text: t('from_library'), onPress: () => pickMedia('library') },
                    { text: t('cancel'), style: 'cancel' }
                  ]);
                }
              }} disabled={busy}>
              <AppIcon name="camera" size={20} color={colors.white} />
            </Pressable>
            <View style={s.inputWrap}>
              <TextInput style={s.input} value={input} onChangeText={setInput}
                placeholder={draftMedia.length ? t('input_placeholder_media') : t('input_placeholder')} placeholderTextColor={colors.textDim}
                returnKeyType="send" onSubmitEditing={sendComposer} editable={!busy} />
            </View>
            {draftMedia.length > 0 ? (
              <Pressable style={({ pressed }) => [s.clearBtn, pressed && s.pressed]}
                onPress={clearDraftMedia} disabled={busy}>
                <AppIcon name="trash-2" size={17} color={colors.textSecondary} />
              </Pressable>
            ) : null}
            <Pressable style={({ pressed }) => [s.sendBtn, pressed && s.pressed, !canSend && s.disabled]}
              onPress={sendComposer} disabled={!canSend}>
              <AppIcon name="arrow-up" size={18} color={colors.white} />
            </Pressable>
          </View>
        </View>

        {photoView ? (
          <Modal transparent visible animationType="fade" onRequestClose={() => setPhotoView(null)}>
            <View style={s.photoViewerBackdrop}>
              <ScrollView
                contentContainerStyle={s.photoViewerScroll}
                maximumZoomScale={4} minimumZoomScale={1} bouncesZoom
                showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
                <Pressable onPress={() => setPhotoView(null)}>
                  {/* 复用卡片同款缩略图 URL：已在缓存里秒开，避免跨境拉几 MB 原图黑屏 */}
                  <Image source={{ uri: mediaPreviewUrl(session.apiUrl, photoView.id, true) }}
                    style={{ width: winWidth, height: winHeight * 0.86 }} resizeMode="contain" />
                </Pressable>
              </ScrollView>
              <Pressable style={[s.photoViewerClose, { top: insets.top + 12 }]}
                onPress={() => setPhotoView(null)} hitSlop={10}>
                <AppIcon name="x" size={22} color={colors.white} />
              </Pressable>
              {photoView.location ? (
                <Text style={s.photoViewerCaption} pointerEvents="none">{photoView.location}</Text>
              ) : null}
            </View>
          </Modal>
        ) : null}
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
  agentAnswerPressed: { opacity: 0.76 },
  answerPhotoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  answerPhotoCard: {
    width: 148, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: colors.bgInput, ...shadows.card
  },
  answerPhoto: { width: '100%', height: 110 },
  answerPhotoCaption: {
    color: colors.textSecondary, fontSize: 11,
    paddingHorizontal: 8, paddingVertical: 5
  },
  photoViewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  photoViewerScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  photoViewerClose: {
    position: 'absolute', right: 16,
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)'
  },
  photoViewerCaption: {
    position: 'absolute', bottom: 40, alignSelf: 'center',
    color: colors.white, fontSize: 13
  },
  copyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.bgInput
  },
  copyHintText: { color: colors.green, fontSize: 12, fontWeight: '700' },
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
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6,
    backgroundColor: colors.bgRaised,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line,
    ...shadows.dock
  },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  draftTray: { marginBottom: 9 },
  draftList: { gap: 8, alignItems: 'center', paddingRight: 2 },
  draftThumbWrap: {
    width: 58, height: 58, borderRadius: radius.sm,
    backgroundColor: colors.bgInput, overflow: 'hidden'
  },
  draftThumb: { width: 58, height: 58, borderRadius: radius.sm, backgroundColor: colors.bgInput },
  draftVideoThumb: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.textDim },
  draftRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(26,26,26,0.62)',
    alignItems: 'center', justifyContent: 'center'
  },
  draftAddTile: {
    width: 62, height: 58, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.lineStrong,
    backgroundColor: colors.bgCard,
    alignItems: 'center', justifyContent: 'center', gap: 4
  },
  draftAddText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  camBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  inputWrap: {
    flex: 1, minHeight: 44, borderRadius: radius.full,
    backgroundColor: colors.bgInput, justifyContent: 'center', paddingHorizontal: 16
  },
  input: { color: colors.text, fontSize: 15, paddingVertical: 0 },
  clearBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgInput, alignItems: 'center', justifyContent: 'center' },
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

