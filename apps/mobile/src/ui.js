import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { fullImageUrl } from './api';
import { colors, radius } from './theme';

export function AppIcon({ name, size = 18, color = colors.textSecondary }) {
  return <Feather name={name} size={size} color={color} />;
}

export function Header({ apiUrl, onApiUrlChange, user, onRefresh, loading }) {
  const [editing, setEditing] = useState(false);
  return (
    <View style={s.header}>
      <View style={s.headerTop}>
        <View style={s.brand}>
          <Text style={s.brandName}>FindIt</Text>
          <View style={[s.statusDot, user && s.statusDotOnline]} />
        </View>
        <View style={s.headerActions}>
          <IconButton icon="refresh-cw" onPress={onRefresh} loading={loading} />
          <IconButton icon="settings" onPress={() => setEditing((v) => !v)} active={editing} />
        </View>
      </View>
      {editing ? (
        <View style={s.apiField}>
          <TextInput
            style={s.apiInput}
            value={apiUrl}
            onChangeText={onApiUrlChange}
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor={colors.textDim}
            placeholder="API 地址"
          />
        </View>
      ) : null}
    </View>
  );
}

export function IconButton({ icon, onPress, disabled, loading, active }) {
  return (
    <Pressable
      disabled={disabled || loading}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [s.iconBtn, active && s.iconBtnActive, pressed && s.pressed]}
    >
      {loading ? <ActivityIndicator size="small" color={colors.white} /> : <AppIcon name={icon} color={active ? colors.white : colors.textSecondary} size={17} />}
    </Pressable>
  );
}

export function ActionButton({ label, icon, onPress, disabled, loading, variant = 'primary', compact, style }) {
  const isPrimary = variant === 'primary';
  const iconColor = isPrimary ? colors.white : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn, compact && s.btnCompact,
        isPrimary ? s.btnPrimary : s.btnSecondary,
        (disabled || loading) && s.disabled, pressed && s.pressed, style
      ]}
    >
      {loading ? <ActivityIndicator color={iconColor} size="small" /> : icon ? <AppIcon name={icon} color={iconColor} size={compact ? 15 : 17} /> : null}
      <Text style={[s.btnLabel, isPrimary ? s.btnLabelPrimary : s.btnLabelSecondary]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({ title = '暂无内容', text, icon = 'inbox' }) {
  return (
    <View style={s.empty}>
      <AppIcon name={icon} color={colors.textDim} size={28} />
      <Text style={s.emptyTitle}>{title}</Text>
      {text ? <Text style={s.emptyText}>{text}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  brandName: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.textDim
  },
  statusDotOnline: {
    backgroundColor: colors.green
  },
  headerActions: {
    flexDirection: 'row',
    gap: 6
  },
  apiField: {
    marginTop: 10
  },
  apiInput: {
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.bgInput,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 14
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconBtnActive: {
    backgroundColor: colors.lineStrong
  },
  btn: {
    minHeight: 46,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7
  },
  btnCompact: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: radius.sm
  },
  btnPrimary: {
    backgroundColor: colors.primary
  },
  btnSecondary: {
    backgroundColor: colors.bgCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong
  },
  btnLabel: {
    fontSize: 15,
    fontWeight: '700'
  },
  btnLabelPrimary: {
    color: colors.white
  },
  btnLabelSecondary: {
    color: colors.text
  },
  empty: {
    minHeight: 160,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8
  },
  emptyTitle: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '700'
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 }
});
