import React, { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Feather } from '@expo/vector-icons';

import { requestJson } from '../api';
import { colors, radius } from '../theme';
import { apiErrorMessage, t } from '../strings';

export default function LoginScreen({ apiUrl, onLogin }) {
  const [loading, setLoading] = useState(false);

  async function signInWithApple() {
    setLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL
        ]
      });

      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean).join(' ') || null;

      const data = await requestJson('/auth/apple', {
        apiUrl,
        method: 'POST',
        body: {
          appleUserId: credential.user,
          email: credential.email,
          fullName,
          identityToken: credential.identityToken
        }
      });

      onLogin(data);
    } catch (err) {
      if (err.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert(t('login_failed'), apiErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  async function signInDemo() {
    setLoading(true);
    try {
      const data = await requestJson('/auth/login', {
        apiUrl,
        method: 'POST',
        body: { email: 'demo@findit.local' }
      });
      onLogin(data);
    } catch (err) {
      Alert.alert(t('login_failed'), apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={s.container}>
      <View style={s.hero}>
        <Text style={s.logo}>{t('app_name')}</Text>
        <Text style={s.subtitle}>{t('login_subtitle')}</Text>
      </View>

      <View style={s.actions}>
        {Platform.OS === 'ios' ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={radius.md}
            style={s.appleBtn}
            onPress={signInWithApple}
          />
        ) : null}

        {__DEV__ ? (
          <Pressable style={s.demoBtn} onPress={signInDemo} disabled={loading}>
            <Feather name="user" size={16} color={colors.textSecondary} />
            <Text style={s.demoBtnText}>{t('login_dev')}</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={s.terms}>{t('login_terms')}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.bg,
    justifyContent: 'center', alignItems: 'center', padding: 40
  },
  hero: { alignItems: 'center', marginBottom: 60 },
  logo: { color: colors.text, fontSize: 36, fontWeight: '800', letterSpacing: -1 },
  subtitle: { color: colors.textTertiary, fontSize: 16, marginTop: 8 },
  actions: { width: '100%', gap: 12 },
  appleBtn: { width: '100%', height: 50 },
  demoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 50, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.line
  },
  demoBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  terms: {
    color: colors.textDim, fontSize: 12, textAlign: 'center',
    marginTop: 30, lineHeight: 18
  }
});
