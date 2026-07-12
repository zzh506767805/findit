import React from 'react';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { colors, radius, shadows } from '../theme';
import { t } from '../strings';

const guideImage = require('../../assets/onboarding-guide.jpg');
const STORAGE_KEY = 'findit_guide_done';
const isWeb = Platform.OS === 'web';

export async function isGuideDone() {
  try {
    const raw = isWeb ? localStorage.getItem(STORAGE_KEY) : await SecureStore.getItemAsync(STORAGE_KEY);
    return raw === '1';
  } catch { return false; }
}

export async function markGuideDone() {
  try {
    if (isWeb) localStorage.setItem(STORAGE_KEY, '1');
    else await SecureStore.setItemAsync(STORAGE_KEY, '1');
  } catch {}
}

export default function OnboardingGuide({ onCapture, onDismiss }) {
  const { width: screenW } = useWindowDimensions();
  const cardW = Math.min(screenW - 48, 360);

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDismiss}>
      <View style={s.scrim}>
        <View style={[s.card, { width: cardW }]}>
          <Image source={guideImage} style={[s.hero, { height: cardW * 0.66 }]} resizeMode="cover" />
          <View style={s.content}>
            <Text style={s.title}>{t('og_title')}</Text>
            <Text style={s.text}>{t('og_text')}</Text>
            <Pressable style={({ pressed }) => [s.captureBtn, pressed && s.pressed]} onPress={onCapture}>
              <Text style={s.captureBtnText}>{t('og_try')}</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [s.laterBtn, pressed && s.pressed]} onPress={onDismiss}>
              <Text style={s.laterText}>{t('og_later')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center'
  },
  card: {
    borderRadius: radius.xl,
    backgroundColor: colors.bgCard,
    overflow: 'hidden',
    ...shadows.card
  },
  hero: { width: '100%' },
  content: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },
  title: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center'
  },
  text: {
    marginTop: 10,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center'
  },
  captureBtn: {
    marginTop: 20,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  captureBtnText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
  laterBtn: {
    marginTop: 6,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center'
  },
  laterText: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.72 }
});
