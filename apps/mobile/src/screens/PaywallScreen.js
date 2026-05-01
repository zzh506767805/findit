import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as InAppPurchases from 'expo-in-app-purchases';
import { requestJson } from '../api';
import { colors, radius } from '../theme';

const PRODUCTS = [
  { id: 'fangnale_yearly', label: '年卡', price: '¥68/年', credits: 500, desc: '含 500 次识别', primary: true },
  { id: 'fangnale_topup', label: '补充包', price: '¥18', credits: 120, desc: '120 次识别' }
];

export default function PaywallScreen({ credits, apiUrl, token, onPurchase, onRestore, onClose }) {
  const [loading, setLoading] = useState(false);
  const [storeProducts, setStoreProducts] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web' || __DEV__) return;

    let mounted = true;
    (async () => {
      try {
        await InAppPurchases.connectAsync();
        if (!mounted) return;
        setConnected(true);

        InAppPurchases.setPurchaseListener(({ responseCode, results }) => {
          if (responseCode === InAppPurchases.IAPResponseCode.OK && results) {
            for (const purchase of results) {
              handleReceiptValidation(purchase);
            }
          }
        });

        const { results } = await InAppPurchases.getProductsAsync(PRODUCTS.map(p => p.id));
        if (mounted && results?.length) {
          setStoreProducts(results);
        }
      } catch (err) {
        console.warn('[iap] connect error:', err.message);
      }
    })();

    return () => {
      mounted = false;
      InAppPurchases.disconnectAsync().catch(() => {});
    };
  }, []);

  async function handleReceiptValidation(purchase) {
    try {
      const receiptData = Platform.OS === 'ios' ? purchase.transactionReceipt : null;
      if (!receiptData) return;

      const result = await requestJson('/user/add-credits', {
        apiUrl, token,
        method: 'POST',
        body: { receiptData }
      });

      await InAppPurchases.finishTransactionAsync(purchase, false);
      onPurchase?.(result.total);
      Alert.alert('购买成功', `已添加识别次数`);
    } catch (err) {
      Alert.alert('验证失败', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePurchase(product) {
    setLoading(true);
    try {
      if (__DEV__) {
        // 开发模式模拟购买
        await requestJson('/user/add-credits', {
          apiUrl, token,
          method: 'POST',
          body: { amount: product.credits }
        });
        onPurchase?.(product.credits);
        Alert.alert('购买成功', `已添加 ${product.credits} 次识别`);
        setLoading(false);
        return;
      }

      if (!connected) {
        Alert.alert('商店未连接', '请稍后再试');
        setLoading(false);
        return;
      }

      await InAppPurchases.purchaseItemAsync(product.id);
      // Result will come through the purchase listener
    } catch (err) {
      setLoading(false);
      Alert.alert('购买失败', err.message);
    }
  }

  async function handleRestore() {
    setLoading(true);
    try {
      if (__DEV__) {
        onRestore?.();
        setLoading(false);
        return;
      }
      const { results } = await InAppPurchases.getPurchaseHistoryAsync();
      if (results?.length) {
        for (const purchase of results) {
          await handleReceiptValidation(purchase);
        }
      } else {
        Alert.alert('无可恢复的购买');
      }
    } catch (err) {
      Alert.alert('恢复失败', err.message);
    } finally {
      setLoading(false);
    }
  }

  function getDisplayPrice(product) {
    if (storeProducts) {
      const sp = storeProducts.find(s => s.productId === product.id);
      if (sp) return sp.price;
    }
    return product.price;
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
            <Text style={[s.productPrice, p.primary && s.productPricePrimary]}>{getDisplayPrice(p)}</Text>
            <Text style={s.productDesc}>{p.desc}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={s.restoreBtn} onPress={handleRestore} disabled={loading}>
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
