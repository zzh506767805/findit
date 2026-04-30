import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius } from '../theme';

const PRODUCTS = [
  { id: 'fangnale_yearly', label: '年卡', price: '¥68/年', credits: 500, desc: '含 500 次识别', primary: true },
  { id: 'fangnale_topup', label: '补充包', price: '¥18', credits: 120, desc: '120 次识别' }
];

export default function PaywallScreen({ credits, onPurchase, onRestore, onClose }) {
  const [loading, setLoading] = useState(false);

  async function handlePurchase(product) {
    setLoading(true);
    try {
      // TODO: 接入真实 IAP
      // 开发阶段模拟购买
      if (__DEV__) {
        await onPurchase?.(product.credits);
        Alert.alert('购买成功', `已添加 ${product.credits} 次识别`);
      } else {
        Alert.alert('暂未开放', '内购功能即将上线');
      }
    } catch (err) {
      Alert.alert('购买失败', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Pressable style={s.closeBtn} onPress={onClose} hitSlop={12}>
          <Feather name="x" size={20} color={colors.text} />
        </Pressable>
      </View>

      <View style={s.hero}>
        <Text style={s.title}>免费次数已用完</Text>
        <Text style={s.subtitle}>
          剩余 {credits?.total || 0} 次识别{'\n'}开通年卡继续使用 AI 收纳师
        </Text>
      </View>

      <View style={s.products}>
        {PRODUCTS.map((p) => (
          <Pressable key={p.id}
            style={({ pressed }) => [s.productCard, p.primary && s.productPrimary, pressed && s.pressed]}
            onPress={() => handlePurchase(p)} disabled={loading}>
            {p.primary ? <Text style={s.productBadge}>推荐</Text> : null}
            <Text style={[s.productLabel, p.primary && s.productLabelPrimary]}>{p.label}</Text>
            <Text style={[s.productPrice, p.primary && s.productPricePrimary]}>{p.price}</Text>
            <Text style={s.productDesc}>{p.desc}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={s.restoreBtn} onPress={onRestore}>
        <Text style={s.restoreText}>恢复购买</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  header: { alignItems: 'flex-end', paddingTop: 10 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.bgInput, alignItems: 'center', justifyContent: 'center'
  },
  hero: { alignItems: 'center', paddingVertical: 40 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: colors.textTertiary, fontSize: 15, textAlign: 'center', marginTop: 10, lineHeight: 22 },
  products: { gap: 12 },
  productCard: {
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bgCard, padding: 20, alignItems: 'center', gap: 4
  },
  productPrimary: {
    borderColor: colors.text, borderWidth: 2
  },
  productBadge: {
    position: 'absolute', top: -10, right: 16,
    backgroundColor: colors.text, color: colors.white,
    fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.xs, overflow: 'hidden'
  },
  productLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  productLabelPrimary: { color: colors.text },
  productPrice: { color: colors.text, fontSize: 28, fontWeight: '800' },
  productPricePrimary: { color: colors.text },
  productDesc: { color: colors.textTertiary, fontSize: 13 },
  restoreBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 12 },
  restoreText: { color: colors.textTertiary, fontSize: 14 },
  pressed: { opacity: 0.7 }
});
