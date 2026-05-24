import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors, radius, shadows } from '../theme';

export default function WelcomeBenefitScreen({ benefits, onBack, onClaim, onRedeem }) {
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');

  const welcomeDays = Number(benefits?.rewards?.welcome_days || 15);
  const ownCode = benefits?.invite_code || '------';
  const claimed = Boolean(benefits?.welcome?.claimed);
  const redeemed = Boolean(benefits?.invite?.redeemed);
  const inputValue = useMemo(() => inviteCode.trim().replace(/\s+/g, '').toUpperCase(), [inviteCode]);

  async function handleClaim() {
    if (claimed || busy) return;
    setBusy('claim');
    setNotice('');
    try {
      const result = await onClaim?.();
      if (result?.granted === false) setNotice('你已经领取过新人会员');
      else setNotice(`已领取 ${welcomeDays} 天新人会员`);
    } catch (err) {
      Alert.alert('领取失败', err.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleRedeem() {
    if (redeemed || busy || !inputValue) return;
    setBusy('redeem');
    setNotice('');
    try {
      await onRedeem?.(inputValue);
      setInviteCode('');
      setNotice('兑换成功，邀请奖励已到账');
    } catch (err) {
      Alert.alert('兑换失败', err.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleShareCode() {
    if (!benefits?.invite_code) return;
    const shareText = `我的放哪了邀请码：${ownCode}，填写后我们各得额外奖励`;
    try {
      if (Platform.OS === 'web' && navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(ownCode);
        setNotice('邀请码已复制');
        return;
      }
      await Share.share({ message: shareText });
    } catch {}
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={s.screen}
    >
      <View style={s.topBar}>
        <Pressable style={({ pressed }) => [s.iconBtn, pressed && s.pressed]} onPress={onBack} hitSlop={8}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={s.navTitle}>新人福利</Text>
        <View style={s.navSpacer} />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.hero}>
          <View style={s.heroIcon}>
            <Feather name="gift" size={22} color={colors.white} />
          </View>
          <Text style={s.title}>领取新人会员</Text>
          <Text style={s.subtitle}>先拿会员体验，再填写邀请码拿额外奖励。</Text>
        </View>

        <View style={s.benefitCard}>
          <View style={s.benefitRow}>
            <View style={[s.benefitIcon, claimed && s.benefitIconDone]}>
              <Feather name={claimed ? 'check' : 'zap'} size={17} color={claimed ? colors.white : '#2F7D5B'} />
            </View>
            <View style={s.benefitRowCopy}>
              <Text style={s.benefitRowTitle}>{claimed ? '新人会员已领取' : '领取新人会员'}</Text>
              <Text style={s.sectionMeta}>{claimed ? '会员权益已到账。' : `送你 ${welcomeDays} 天新人会员`}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                s.rowAction,
                claimed && s.rowActionDone,
                pressed && !claimed && s.pressed
              ]}
              onPress={handleClaim}
              disabled={claimed || busy === 'claim'}
            >
              <Text style={[s.rowActionText, claimed && s.rowActionTextDone]}>
                {claimed ? '已领取' : busy === 'claim' ? '领取中' : '领取'}
              </Text>
            </Pressable>
          </View>

          <View style={s.benefitDivider} />

          <View style={s.benefitRow}>
            <View style={s.benefitIcon}>
              <Feather name="copy" size={17} color="#2F7D5B" />
            </View>
            <View style={s.benefitRowCopy}>
              <Text style={s.benefitRowTitle}>我的邀请码</Text>
              <Text style={s.inviteCodeText}>{ownCode}</Text>
            </View>
            <Pressable style={({ pressed }) => [s.iconAction, pressed && s.pressed]} onPress={handleShareCode}>
              <Feather name={Platform.OS === 'web' ? 'copy' : 'share-2'} size={16} color={colors.text} />
            </Pressable>
          </View>

          <View style={s.benefitDivider} />

          <View style={s.benefitRowTop}>
            <View style={s.benefitIcon}>
              <Feather name="edit-3" size={17} color="#2F7D5B" />
            </View>
            <View style={s.benefitRowCopy}>
              <Text style={s.benefitRowTitle}>{redeemed ? '邀请码已兑换' : '填写邀请码'}</Text>
              <Text style={s.sectionMeta}>{redeemed ? '每个账号只能兑换一次。' : '兑换后双方各得额外奖励'}</Text>
              <View style={s.inputRow}>
                <TextInput
                  value={inviteCode}
                  onChangeText={setInviteCode}
                  editable={!redeemed && !busy}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                  placeholder={redeemed ? '已完成兑换' : '输入邀请码'}
                  placeholderTextColor={colors.textDim}
                  returnKeyType="done"
                  style={s.input}
                  onSubmitEditing={handleRedeem}
                />
                <Pressable
                  style={({ pressed }) => [
                    s.redeemBtn,
                    (redeemed || !inputValue) && s.redeemBtnDisabled,
                    pressed && !redeemed && inputValue && s.pressed
                  ]}
                  onPress={handleRedeem}
                  disabled={redeemed || !inputValue || busy === 'redeem'}
                >
                  <Text style={[s.redeemText, (redeemed || !inputValue) && s.redeemTextDisabled]}>
                    {redeemed ? '已兑' : busy === 'redeem' ? '兑换中' : '兑换'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>

        {notice ? <Text style={s.notice}>{notice}</Text> : null}

        <Pressable style={({ pressed }) => [s.doneBtn, pressed && s.pressed]} onPress={onBack}>
          <Text style={s.doneText}>进入放哪了</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg
  },
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bgInput,
    alignItems: 'center',
    justifyContent: 'center'
  },
  navTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800'
  },
  navSpacer: {
    width: 36
  },
  scroll: {
    flex: 1
  },
  body: {
    padding: 18,
    paddingBottom: 30,
    gap: 14
  },
  hero: {
    minHeight: 170,
    justifyContent: 'flex-end',
    paddingBottom: 8
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2F7D5B',
    marginBottom: 16
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800'
  },
  subtitle: {
    color: colors.textTertiary,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 280
  },
  benefitCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.bgRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    padding: 16,
    ...shadows.card
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 62,
    paddingVertical: 10
  },
  benefitRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingTop: 12
  },
  benefitIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  benefitIconDone: {
    backgroundColor: '#2F7D5B'
  },
  benefitRowCopy: {
    flex: 1,
    minWidth: 0
  },
  benefitRowTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800'
  },
  benefitDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginLeft: 50
  },
  rowAction: {
    minWidth: 66,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 13
  },
  rowActionDone: {
    backgroundColor: colors.bgInput
  },
  rowActionText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800'
  },
  rowActionTextDone: {
    color: colors.textSecondary
  },
  iconAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgInput
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800'
  },
  sectionMeta: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4
  },
  inviteCodeText: { color: '#2F7D5B', fontSize: 16, fontWeight: '800', marginTop: 4, letterSpacing: 0 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.bgInput,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 15,
    fontWeight: '700'
  },
  redeemBtn: {
    width: 64,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  redeemBtnDisabled: {
    backgroundColor: colors.bgInput
  },
  redeemText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '800'
  },
  redeemTextDisabled: {
    color: colors.textTertiary
  },
  notice: {
    color: '#2F7D5B',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center'
  },
  doneBtn: {
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.bgInput,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2
  },
  doneText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800'
  },
  pressed: {
    opacity: 0.72
  }
});
