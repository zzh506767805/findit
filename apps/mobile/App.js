import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { getDefaultApiUrl, requestJson } from './src/api';
import { colors, radius } from './src/theme';
import AssistantScreen from './src/screens/AssistantScreen';
import SpacesScreen from './src/screens/SpacesScreen';
import LoginScreen from './src/screens/LoginScreen';
import PaywallScreen from './src/screens/PaywallScreen';

const AnimatedFeather = Animated.createAnimatedComponent(Feather);
const AnimatedText = Animated.createAnimatedComponent(Text);

const tabs = [
  { id: 'assistant', label: '助手', icon: 'message-circle', width: 70 },
  { id: 'spaces', label: '我的家', icon: 'home', width: 82 }
];

const TAB_GAP = 4;
const TAB_OFFSETS = [];
let offset = 0;
for (const t of tabs) {
  TAB_OFFSETS.push(offset);
  offset += t.width + TAB_GAP;
}

export default function App() {
  const [apiUrl, setApiUrl] = useState(getDefaultApiUrl());
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [tab, setTab] = useState('assistant');
  const [error, setError] = useState('');
  const progress = useRef(new Animated.Value(0)).current;

  // Tab slider
  const sliderX = progress.interpolate({
    inputRange: tabs.map((_, i) => i),
    outputRange: TAB_OFFSETS,
    extrapolate: 'clamp'
  });
  const sliderW = progress.interpolate({
    inputRange: tabs.map((_, i) => i),
    outputRange: tabs.map((t) => t.width),
    extrapolate: 'clamp'
  });
  const assistantOpacity = progress.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [1, 0.12, 0],
    extrapolate: 'clamp'
  });
  const assistantScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.985],
    extrapolate: 'clamp'
  });
  const assistantLift = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 6],
    extrapolate: 'clamp'
  });
  const spacesOpacity = progress.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, 0.12, 1],
    extrapolate: 'clamp'
  });
  const spacesScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1.015, 1],
    extrapolate: 'clamp'
  });
  const spacesLift = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-4, 0],
    extrapolate: 'clamp'
  });

  const session = useMemo(() => ({ apiUrl, token }), [apiUrl, token]);

  function handleLogin(data) {
    setToken(data.token);
    setUser(data.user);
    setCredits(data.credits);
  }

  async function refreshCredits() {
    if (!token) return;
    try {
      const c = await requestJson('/user/credits', { apiUrl, token });
      setCredits(c);
    } catch {}
  }

  async function handlePurchase(amount) {
    // 开发阶段：直接给后端加次数
    await requestJson('/user/add-credits', { apiUrl, token, method: 'POST', body: { amount } });
    await refreshCredits();
    setShowPaywall(false);
  }

  function switchTab(next) {
    if (next === tab) return;
    const idx = tabs.findIndex((t) => t.id === next);
    progress.stopAnimation();
    setTab(next);
    Animated.timing(progress, {
      toValue: idx,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    }).start();
  }

  if (!token) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
        <LoginScreen apiUrl={apiUrl} onLogin={handleLogin} />
      </SafeAreaView>
    );
  }

  if (showPaywall) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
        <PaywallScreen
          credits={credits}
          onPurchase={handlePurchase}
          onRestore={() => Alert.alert('恢复购买', '开发中')}
          onClose={() => setShowPaywall(false)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <View style={s.topBar}>
        <Text style={s.logo}>FindIt</Text>
        <View style={s.tabRow}>
          <Animated.View style={[s.slider, { transform: [{ translateX: sliderX }], width: sliderW }]} />
          {tabs.map((t, index) => {
            const focus = progress.interpolate({
              inputRange: tabs.map((_, i) => i),
              outputRange: tabs.map((_, i) => (i === index ? 1 : 0)),
              extrapolate: 'clamp'
            });
            const tabColor = focus.interpolate({
              inputRange: [0, 1],
              outputRange: [colors.textDim, colors.text]
            });
            const tabScale = focus.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.035],
              extrapolate: 'clamp'
            });
            const tabLift = focus.interpolate({
              inputRange: [0, 1],
              outputRange: [0, -1],
              extrapolate: 'clamp'
            });
            return (
              <Pressable key={t.id} onPress={() => switchTab(t.id)}
                style={[s.tabBtn, { width: t.width }]}>
                <Animated.View
                  style={[
                    s.tabContent,
                    { transform: [{ translateY: tabLift }, { scale: tabScale }] }
                  ]}
                >
                  <AnimatedFeather name={t.icon} size={14} color={tabColor} />
                  <AnimatedText style={[s.tabLabel, { color: tabColor }]}>{t.label}</AnimatedText>
                </Animated.View>
              </Pressable>
            );
          })}
        </View>
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.body}>
        <View style={s.sceneStack}>
          <Animated.View
            pointerEvents={tab === 'assistant' ? 'auto' : 'none'}
            style={[
              s.sceneLayer,
              tab === 'assistant' && s.sceneActive,
              {
                opacity: assistantOpacity,
                transform: [{ translateY: assistantLift }, { scale: assistantScale }]
              }
            ]}
          >
            <AssistantScreen session={session} credits={credits} onNeedCredits={() => setShowPaywall(true)} onCreditsChanged={refreshCredits} />
          </Animated.View>
          <Animated.View
            pointerEvents={tab === 'spaces' ? 'auto' : 'none'}
            style={[
              s.sceneLayer,
              tab === 'spaces' && s.sceneActive,
              {
                opacity: spacesOpacity,
                transform: [{ translateY: spacesLift }, { scale: spacesScale }]
              }
            ]}
          >
            <SpacesScreen session={session} credits={credits} onNeedCredits={() => setShowPaywall(true)} onCreditsChanged={refreshCredits} />
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line
  },
  logo: { color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  tabRow: {
    flexDirection: 'row', gap: TAB_GAP, position: 'relative'
  },
  slider: {
    position: 'absolute', top: 0, bottom: 0,
    borderRadius: 17, backgroundColor: colors.bgInput
  },
  tabBtn: {
    height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center'
  },
  tabContent: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5
  },
  tabLabel: {
    fontSize: 13, fontWeight: '700'
  },
  error: {
    marginHorizontal: 20, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.sm, backgroundColor: colors.redSoft, color: colors.red, fontSize: 13, fontWeight: '600'
  },
  body: { flex: 1 },
  sceneStack: { flex: 1 },
  sceneLayer: {
    ...StyleSheet.absoluteFillObject
  },
  sceneActive: {
    zIndex: 1
  }
});
