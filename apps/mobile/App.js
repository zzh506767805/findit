import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import { getDefaultApiUrl, requestJson } from './src/api';
import { colors, radius } from './src/theme';

const isWeb = Platform.OS === 'web';

async function saveSession(token, user) {
  const data = JSON.stringify({ token, user });
  if (isWeb) { try { localStorage.setItem('findit_session', data); } catch {} }
  else { await SecureStore.setItemAsync('findit_session', data); }
}

async function loadSession() {
  try {
    const raw = isWeb ? localStorage.getItem('findit_session') : await SecureStore.getItemAsync('findit_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function clearSession() {
  if (isWeb) { try { localStorage.removeItem('findit_session'); } catch {} }
  else { await SecureStore.deleteItemAsync('findit_session'); }
}
import AssistantScreen from './src/screens/AssistantScreen';
import SpacesScreen from './src/screens/SpacesScreen';
import LoginScreen from './src/screens/LoginScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import WelcomeBenefitScreen from './src/screens/WelcomeBenefitScreen';


const tabs = [
  { id: 'spaces', label: '我的家', icon: 'home', width: 82 },
  { id: 'assistant', label: '助手', icon: 'message-circle', width: 70 }
];

const TAB_GAP = 4;
const TAB_OFFSETS = [];
const APP_VERSION =
  Constants.expoConfig?.version ||
  Constants.manifest2?.extra?.expoClient?.version ||
  Constants.manifest?.version ||
  '1.0.0';
let offset = 0;
for (const t of tabs) {
  TAB_OFFSETS.push(offset);
  offset += t.width + TAB_GAP;
}

function readCredits(credits) {
  const free = Number(credits?.free || 0);
  const paid = Number(credits?.paid || 0);
  const total = Number(credits?.total ?? (free + paid));
  return { free, paid, total };
}

function AccountButton({ credits, benefits, onPress }) {
  const usage = readCredits(credits);
  const needsAttention = (credits && usage.total <= 0) || (benefits && !benefits.welcome?.claimed);

  return (
    <Pressable
      accessibilityLabel="账户和购买"
      hitSlop={8}
      style={({ pressed }) => [s.accountBtn, pressed && s.pressed]}
      onPress={onPress}
    >
      <Feather name="user" size={16} color={colors.textSecondary} />
      {needsAttention ? <View style={s.accountBadge} /> : null}
    </Pressable>
  );
}

export default function App() {
  const [apiUrl, setApiUrl] = useState(getDefaultApiUrl());
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(null);
  const [benefits, setBenefits] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showBenefits, setShowBenefits] = useState(false);
  const [tab, setTab] = useState('spaces');
  const [error, setError] = useState('');
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Warm up network: triggers iOS local network permission dialog early
    // so it won't block the login request later
    fetch(`${apiUrl}/health`).catch(() => {});

    loadSession().then(async (session) => {
      if (session?.token && session?.user) {
        setToken(session.token);
        setUser(session.user);
        try {
          const c = await requestJson('/user/credits', { apiUrl, token: session.token });
          setCredits(c);
        } catch {
          // Token invalid/expired, clear and show login
          await clearSession();
          setToken(null);
          setUser(null);
          setBenefits(null);
          setRestoring(false);
          return;
        }
        try {
          const b = await requestJson('/user/benefits', { apiUrl, token: session.token });
          setBenefits(b);
          if (!b?.welcome?.claimed) setShowBenefits(true);
        } catch {
          setBenefits(null);
        }
      }
      setRestoring(false);
    });
  }, []);

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
    inputRange: [0, 0.3, 1],
    outputRange: [0, 0.12, 1],
    extrapolate: 'clamp'
  });
  const assistantScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1.015, 1],
    extrapolate: 'clamp'
  });
  const assistantLift = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-4, 0],
    extrapolate: 'clamp'
  });
  const spacesOpacity = progress.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [1, 0.12, 0],
    extrapolate: 'clamp'
  });
  const spacesScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.985],
    extrapolate: 'clamp'
  });
  const spacesLift = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 6],
    extrapolate: 'clamp'
  });

  const [dataVersion, setDataVersion] = useState(0);
  const handleDataChanged = useCallback(() => setDataVersion((v) => v + 1), []);
  const session = useMemo(() => ({ apiUrl, token }), [apiUrl, token]);
  const [pendingMedia, setPendingMedia] = useState(null);

  function handleLogin(data) {
    setToken(data.token);
    setUser(data.user);
    setCredits(data.credits);
    setBenefits(data.benefits || null);
    if (!data.benefits?.welcome?.claimed) setShowBenefits(true);
    saveSession(data.token, data.user);
  }

  async function refreshCredits() {
    if (!token) return;
    try {
      const c = await requestJson('/user/credits', { apiUrl, token });
      setCredits(c);
    } catch {}
  }

  async function handleClaimWelcome() {
    const result = await requestJson('/user/benefits/welcome/claim', {
      apiUrl,
      token,
      method: 'POST'
    });
    if (result.credits) setCredits(result.credits);
    if (result.benefits) setBenefits(result.benefits);
    return result;
  }

  async function handleRedeemInvite(inviteCode) {
    const result = await requestJson('/user/benefits/invite/redeem', {
      apiUrl,
      token,
      method: 'POST',
      body: { invite_code: inviteCode }
    });
    if (result.credits) setCredits(result.credits);
    if (result.benefits) setBenefits(result.benefits);
    return result;
  }

  async function handlePaywallPurchase(nextCredits) {
    if (nextCredits && typeof nextCredits === 'object') setCredits(nextCredits);
    else await refreshCredits();
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

  if (restoring) {
    return (
      <SafeAreaView style={[s.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
        <Text style={s.logo}>FindIt</Text>
      </SafeAreaView>
    );
  }

  if (!token) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
        <LoginScreen apiUrl={apiUrl} onLogin={handleLogin} />
      </SafeAreaView>
    );
  }

  if (showBenefits) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
        <WelcomeBenefitScreen
          benefits={benefits}
          onBack={() => setShowBenefits(false)}
          onClaim={handleClaimWelcome}
          onRedeem={handleRedeemInvite}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <View style={s.topBar}>
        <Text style={s.logo}>FindIt</Text>
        <View style={s.topActions}>
          <View style={s.tabRow}>
            <Animated.View style={[s.slider, { transform: [{ translateX: sliderX }], width: sliderW }]} />
            {tabs.map((t, index) => {
              const focus = progress.interpolate({
                inputRange: tabs.map((_, i) => i),
                outputRange: tabs.map((_, i) => (i === index ? 1 : 0)),
                extrapolate: 'clamp'
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
                    <Feather name={t.icon} size={14} color={tab === t.id ? colors.text : colors.textDim} />
                    <Text style={[s.tabLabel, { color: tab === t.id ? colors.text : colors.textDim }]}>{t.label}</Text>
                  </Animated.View>
                </Pressable>
              );
            })}
          </View>
          <AccountButton credits={credits} benefits={benefits} onPress={() => setShowPaywall(true)} />
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
            <AssistantScreen
              session={session}
              credits={credits}
              isActive={tab === 'assistant'}
              onNeedCredits={() => setShowPaywall(true)}
              onCreditsChanged={refreshCredits}
              onDataChanged={handleDataChanged}
              pendingMedia={pendingMedia}
              onPendingMediaConsumed={() => setPendingMedia(null)}
            />
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
            <SpacesScreen session={session} onDataChanged={handleDataChanged} dataVersion={dataVersion} onPickMedia={(media) => { setPendingMedia(media); switchTab('assistant'); }} />
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
      {showPaywall ? (
        <View style={s.paywallLayer}>
          <PaywallScreen
            credits={credits}
            apiUrl={apiUrl}
            token={token}
            appVersion={APP_VERSION}
            benefits={benefits}
            onPurchase={handlePaywallPurchase}
            onClaim={handleClaimWelcome}
            onRedeem={handleRedeemInvite}
            onClose={() => setShowPaywall(false)}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F8F4' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#F7F8F4'
  },
  logo: { color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  tabRow: {
    flexDirection: 'row', gap: TAB_GAP, position: 'relative'
  },
  slider: {
    position: 'absolute', top: 0, bottom: 0,
    borderRadius: 17, backgroundColor: colors.bgCard,
    shadowColor: '#8C8578',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2
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
  accountBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bgInput,
    alignItems: 'center',
    justifyContent: 'center'
  },
  accountBadge: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.orange
  },
  pressed: { opacity: 0.72 },
  body: { flex: 1 },
  sceneStack: { flex: 1 },
  sceneLayer: {
    ...StyleSheet.absoluteFillObject
  },
  sceneActive: {
    zIndex: 1
  },
  paywallLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    backgroundColor: colors.bg
  }
});
