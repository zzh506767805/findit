import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
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

import { requestJson } from '../api';
import { streamAgent } from '../sse';
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

export default function AssistantScreen({ session, onDataChanged }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  function scrollEnd() {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
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

  async function pickImage(source) {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('需要权限'); return; }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.72 })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.72 });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    addMsg({ role: 'user', type: 'photo', uri: asset.uri });
    addMsg({ role: 'agent', steps: [], answer: null, suggestion: null, mediaAssetId: null });
    setBusy(true);

    try {
      await streamAgent(session.apiUrl, session.token, '/agent/analyze', {
        imageBase64: asset.base64, mimeType: asset.mimeType || 'image/jpeg'
      }, (e) => {
        if (e.type === 'media') patchLastAgent((m) => ({ ...m, mediaAssetId: e.media_asset_id }));
        else if (e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'thinking')
          patchLastAgent((m) => ({ ...m, steps: [...m.steps, e] }));
        else if (e.type === 'answer') patchLastAgent((m) => ({ ...m, answer: e.text, steps: [...m.steps, e] }));
        else if (e.type === 'done' && e.suggestion) patchLastAgent((m) => ({ ...m, suggestion: e.suggestion }));
      });
    } catch (err) {
      patchLastAgent((m) => ({ ...m, answer: `出错了: ${err.message}` }));
    } finally { setBusy(false); }
  }

  async function sendQuery() {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    addMsg({ role: 'user', type: 'text', text: q });
    addMsg({ role: 'agent', steps: [], answer: null, suggestion: null });
    setBusy(true);

    try {
      await streamAgent(session.apiUrl, session.token, '/agent/query', { query: q }, (e) => {
        if (e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'thinking')
          patchLastAgent((m) => ({ ...m, steps: [...m.steps, e] }));
        else if (e.type === 'answer') patchLastAgent((m) => ({ ...m, answer: e.text, steps: [...m.steps, e] }));
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
        body: { suggestion: finalSuggestion, media_asset_id: msg.mediaAssetId }
      });
      setMessages((prev) => {
        const c = [...prev]; c[idx] = { ...c[idx], confirmed: true }; return c;
      });
      onDataChanged?.();
    } catch (err) { Alert.alert('保存失败', err.message); }
    finally { setBusy(false); }
  }

  return (
    <View style={s.container}>
      <ScrollView ref={scrollRef} style={s.scroll} contentContainerStyle={s.scrollBody}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {messages.length === 0 ? (
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

        {messages.map((msg, i) => {
          if (msg.role === 'user' && msg.type === 'photo') {
            return (
              <View key={i} style={s.userRow}>
                <Image source={{ uri: msg.uri }} style={s.userPhoto} />
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
            onPress={() => Alert.alert('拍照方式', '', [
              { text: '相机', onPress: () => pickImage('camera') },
              { text: '相册', onPress: () => pickImage('library') },
              { text: '取消', style: 'cancel' }
            ])} disabled={busy}>
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
  hero: { alignItems: 'center', paddingTop: 80, paddingBottom: 40 },
  heroTitle: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  heroSub: { color: colors.textTertiary, fontSize: 15, marginTop: 8 },
  hints: { flexDirection: 'row', gap: 8, marginTop: 28, flexWrap: 'wrap', justifyContent: 'center' },
  hint: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.line },
  hintText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  userRow: { alignItems: 'flex-end' },
  userPhoto: { width: 200, height: 150, borderRadius: radius.lg, backgroundColor: colors.bgCard },
  userBubble: { maxWidth: '78%', backgroundColor: colors.bgInput, borderRadius: radius.lg, borderBottomRightRadius: radius.xs, paddingHorizontal: 16, paddingVertical: 10 },
  userText: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  agentRow: { gap: 8 },
  agentLoading: {
    backgroundColor: colors.bgInput, borderRadius: radius.lg, borderBottomLeftRadius: radius.xs,
    paddingHorizontal: 16, paddingVertical: 12, alignSelf: 'flex-start'
  },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2 },
  typingLabel: { color: colors.textTertiary, fontSize: 14 },
  typingDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.textTertiary },
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
