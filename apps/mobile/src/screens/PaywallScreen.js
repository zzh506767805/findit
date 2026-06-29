import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
let InAppPurchases = null;
try { InAppPurchases = require('expo-in-app-purchases'); } catch {}
import { requestJson } from '../api';
import { colors, radius } from '../theme';

const PRODUCTS = [
  {
    id: 'fangnale_yearly',
    label: '标准版',
    price: '¥68/年',
    credits: 1000,
    desc: '一年会员，适合多数家庭；可持续拍照或录像识别、保存物品位置，并用文字查找。',
    cta: '开通',
    primary: true
  },
  {
    id: 'fangnale_yearly_large',
    label: '大户型版',
    price: '¥128/年',
    credits: 3000,
    desc: '一年会员，适合多房间或物品更多的家庭；包含更多媒体识别额度和完整查找功能。',
    cta: '开通'
  }
];
const PRODUCT_IDS = PRODUCTS.map(p => p.id);
const FINISH_TRANSACTION_TIMEOUT_MS = 4000;
const PURCHASE_HISTORY_FALLBACK_DELAYS_MS = [700, 1600, 3200];
const STORE_TIMEOUT_MS = 10000;

const PRODUCT_LABELS = {
  welcome_trial: '新人会员',
  fangnale_yearly: '标准版',
  fangnale_yearly_large: '大户型版'
};

function readSubscription(credits) {
  const subscription = credits?.subscription || {};
  return {
    active: Boolean(subscription.active),
    expired: Boolean(subscription.expired),
    expiresAt: subscription.expires_at || null,
    productId: subscription.product_id || null
  };
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function readReceiptData(purchase) {
  const receipt = purchase?.transactionReceipt
    || purchase?.receiptData
    || purchase?.receipt
    || purchase?.transaction?.transactionReceipt
    || null;
  return typeof receipt === 'string' && receipt.trim() ? receipt.trim() : null;
}

function purchaseDebugSummary(purchase) {
  if (!purchase) return { present: false };
  return {
    keys: Object.keys(purchase),
    productId: purchase.productId || null,
    orderId: purchase.orderId || null,
    originalOrderId: purchase.originalOrderId || null,
    purchaseState: purchase.purchaseState,
    acknowledged: purchase.acknowledged,
    receiptLength: readReceiptData(purchase)?.length || 0,
    hasTransactionReceipt: Boolean(purchase.transactionReceipt),
    hasReceiptData: Boolean(purchase.receiptData),
    hasReceipt: Boolean(purchase.receipt)
  };
}

function isProcessablePurchase(purchase) {
  const state = purchase?.purchaseState;
  const states = InAppPurchases?.InAppPurchaseState || {};
  const purchased = states.PURCHASED ?? 1;
  const restored = states.RESTORED ?? 3;
  return state == null || state === purchased || state === restored;
}

function withTimeout(promise, ms, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function purchaseReceiptKey(purchase, receiptData) {
  const productId = purchase?.productId || 'unknown';
  const orderId = purchase?.orderId || purchase?.transactionId || null;
  const originalOrderId = purchase?.originalOrderId || purchase?.originalTransactionId || null;
  if (orderId || originalOrderId) return `${productId}:${orderId || originalOrderId}`;
  return `${productId}:${String(receiptData || '').slice(-96)}`;
}

export default function PaywallScreen({
  credits,
  apiUrl,
  token,
  appVersion = '1.0.0',
  benefits,
  onPurchase,
  onClaim,
  onRedeem,
  onDeleteAccount,
  onClose
}) {
  const [loading, setLoading] = useState(false);
  const [storeProducts, setStoreProducts] = useState([]);
  const [storeReady, setStoreReady] = useState(false);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [benefitBusy, setBenefitBusy] = useState(null);
  const [notice, setNotice] = useState('');
  const [showPlanOptions, setShowPlanOptions] = useState(false);
  const connectedRef = useRef(false);
  const purchaseFlowRef = useRef({ productId: null, handled: false, canceled: false });
  const processedPurchaseKeysRef = useRef(new Set());
  const insets = useSafeAreaInsets();
  const initialInsets = initialWindowMetrics?.insets || {};
  const rawTopInset = Math.max(insets.top || 0, initialInsets.top || 0, Constants.statusBarHeight || 0);
  const topInset = Platform.OS === 'web'
    ? 0
    : rawTopInset;
  const bottomInset = Platform.OS === 'web'
    ? 0
    : Math.max(insets.bottom || 0, initialInsets.bottom || 0);
  const subscription = readSubscription(credits);
  const hasPaidPlan = subscription.active;
  const activePlanName = PRODUCT_LABELS[subscription.productId] || '年卡';
  const planLabel = hasPaidPlan ? `Pro ${activePlanName}` : (subscription.expired ? '会员已过期' : '免费版');
  const expiresDateText = formatDate(subscription.expiresAt);
  const planMeta = hasPaidPlan
    ? `${expiresDateText || '一年后'}到期`
    : subscription.expired
      ? (expiresDateText ? `已于 ${expiresDateText} 到期` : '会员有效期已结束')
      : `v${appVersion} · 可开通年卡`;
  const welcomeDays = Number(benefits?.rewards?.welcome_days || 15);
  const ownCode = benefits?.invite_code || '------';
  const claimed = Boolean(benefits?.welcome?.claimed);
  const redeemed = Boolean(benefits?.invite?.redeemed);
  const inputValue = useMemo(() => inviteCode.trim().replace(/\s+/g, '').toUpperCase(), [inviteCode]);

  useEffect(() => {
    if (Platform.OS === 'web' || __DEV__) {
      setStoreReady(true);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        if (!InAppPurchases) throw new Error('当前版本未包含内购模块');
        await connectToStore();
        if (!mounted) return;

        InAppPurchases.setPurchaseListener(({ responseCode, results }) => {
          if (responseCode === InAppPurchases.IAPResponseCode.OK && results) {
            const purchases = Array.isArray(results) ? results.filter(isProcessablePurchase) : [];
            if (!purchases.length) {
              setLoading(false);
              return;
            }
            for (const purchase of purchases) {
              handleReceiptValidation(purchase, { showMissingReceiptAlert: false });
            }
          } else if (responseCode === InAppPurchases.IAPResponseCode.USER_CANCELED) {
            purchaseFlowRef.current.canceled = true;
            setLoading(false);
          } else if (responseCode === InAppPurchases.IAPResponseCode.DEFERRED) {
            purchaseFlowRef.current.canceled = true;
            setLoading(false);
            Alert.alert('购买待批准', 'App Store 已收到请求，等待批准后会自动生效。');
          } else {
            purchaseFlowRef.current.canceled = true;
            setLoading(false);
            Alert.alert('购买失败', 'App Store 暂时无法完成购买，请稍后再试。');
          }
        });

        await queryStoreProducts();
      } catch (err) {
        if (mounted) {
          setStoreReady(true);
          setStoreError('商店商品暂时不可用');
        }
        console.warn('[iap] connect error:', err.message);
      }
    })();

    return () => {
      mounted = false;
      connectedRef.current = false;
      InAppPurchases?.disconnectAsync().catch(() => {});
    };
  }, []);

  async function connectToStore() {
    if (connectedRef.current) return;
    try {
      await withTimeout(InAppPurchases.connectAsync(), STORE_TIMEOUT_MS, '连接 App Store 超时');
    } catch (err) {
      if (!String(err?.message || '').includes('Already connected')) throw err;
    }
    connectedRef.current = true;
  }

  async function queryStoreProducts() {
    if (Platform.OS === 'web' || __DEV__) return [];
    if (!InAppPurchases) throw new Error('当前版本未包含内购模块');

    setStoreLoading(true);
    setStoreError('');
    try {
      await connectToStore();
      const { responseCode, results } = await withTimeout(
        InAppPurchases.getProductsAsync(PRODUCT_IDS),
        STORE_TIMEOUT_MS,
        '读取 App Store 商品超时'
      );
      const products = Array.isArray(results) ? results : [];
      if (responseCode !== InAppPurchases.IAPResponseCode.OK) {
        throw new Error('商店商品查询失败');
      }
      setStoreProducts(products);
      setStoreReady(true);
      if (!products.length) setStoreError('商店商品还未准备好');
      return products;
    } finally {
      setStoreLoading(false);
    }
  }

  async function ensureStoreProduct(productId) {
    let products = storeProducts;
    let item = products.find(s => s.productId === productId);
    if (!item) {
      products = await queryStoreProducts();
      item = products.find(s => s.productId === productId);
    }
    return item;
  }

  async function findReceiptInHistory(productId) {
    const { responseCode, results } = await InAppPurchases.getPurchaseHistoryAsync();
    if (responseCode !== InAppPurchases.IAPResponseCode.OK) return null;

    const purchases = Array.isArray(results) ? results.filter(isProcessablePurchase) : [];
    const sameProduct = productId ? purchases.filter(p => p.productId === productId) : [];
    const candidates = sameProduct.length ? sameProduct : purchases.filter(p => PRODUCT_IDS.includes(p.productId));
    const match = candidates.find(p => readReceiptData(p));
    return match ? { purchase: match, receiptData: readReceiptData(match) } : null;
  }

  async function handleReceiptValidation(purchase, { showMissingReceiptAlert = true } = {}) {
    let purchaseKey = null;
    try {
      let receiptData = Platform.OS === 'ios' ? readReceiptData(purchase) : null;
      let receiptPurchase = purchase;

      if (!receiptData && Platform.OS === 'ios') {
        console.warn('[iap] purchase missing receipt; checking history', purchaseDebugSummary(purchase));
        try {
          const history = await findReceiptInHistory(purchase?.productId);
          if (history) {
            receiptData = history.receiptData;
            receiptPurchase = history.purchase;
          }
        } catch (err) {
          console.warn('[iap] purchase history lookup failed:', err.message);
        }
      }

      if (!receiptData) {
        console.warn('[iap] receipt unavailable', purchaseDebugSummary(purchase));
        if (showMissingReceiptAlert) {
          Alert.alert('缺少购买凭证', 'App Store 没有返回 receipt，请点“恢复购买”重试；如果仍失败，需要安装最新 TestFlight 构建再测。');
        }
        setLoading(false);
        return;
      }

      purchaseKey = purchaseReceiptKey(receiptPurchase, receiptData);
      if (processedPurchaseKeysRef.current.has(purchaseKey)) return;
      processedPurchaseKeysRef.current.add(purchaseKey);

      const result = await requestJson('/user/add-credits', {
        apiUrl, token,
        method: 'POST',
        body: {
          receiptData,
          productId: receiptPurchase?.productId || purchase?.productId,
          transactionId: receiptPurchase?.orderId || purchase?.orderId,
          originalTransactionId: receiptPurchase?.originalOrderId || purchase?.originalOrderId
        }
      });

      const purchaseToFinish = purchase?.orderId ? purchase : receiptPurchase;
      purchaseFlowRef.current.handled = true;
      setLoading(false);
      await onPurchase?.(result);
      Alert.alert(result.alreadyProcessed ? '购买已恢复' : '开通成功', result.subscription?.expires_at ? `会员有效期至 ${formatDate(result.subscription.expires_at)}` : '一年会员权益已开通');
      finishTransactionAfterUnlock(purchaseToFinish);
    } catch (err) {
      if (purchaseKey) processedPurchaseKeysRef.current.delete(purchaseKey);
      Alert.alert('验证失败', err.message);
      setLoading(false);
    }
  }

  async function validatePurchaseFromHistoryAfterStoreReturn(productId) {
    for (const waitMs of PURCHASE_HISTORY_FALLBACK_DELAYS_MS) {
      await delay(waitMs);
      if (purchaseFlowRef.current.handled || purchaseFlowRef.current.canceled) return;

      try {
        const history = await findReceiptInHistory(productId);
        if (history?.purchase) {
          await handleReceiptValidation(history.purchase);
          return;
        }
      } catch (err) {
        console.warn('[iap] purchase fallback history lookup failed:', err.message);
      }
    }

    if (!purchaseFlowRef.current.handled && !purchaseFlowRef.current.canceled) {
      setLoading(false);
      Alert.alert('购买待确认', 'App Store 已完成支付，但购买凭证还没同步。请点“恢复购买”刷新会员状态。');
    }
  }

  function finishTransactionAfterUnlock(purchase) {
    if (!purchase || !InAppPurchases) return;
    withTimeout(
      InAppPurchases.finishTransactionAsync(purchase, false),
      FINISH_TRANSACTION_TIMEOUT_MS,
      'finishTransactionAsync timeout'
    ).catch((err) => {
      console.warn('[iap] finish transaction failed:', err.message, purchaseDebugSummary(purchase));
    });
  }

  async function handlePurchase(product) {
    setLoading(true);
    try {
      if (__DEV__) {
        const result = await requestJson('/user/add-credits', {
          apiUrl, token,
          method: 'POST',
          body: { amount: product.credits, productId: product.id }
        });
        setLoading(false);
        await onPurchase?.(result);
        Alert.alert('开通成功', result.subscription?.expires_at ? `会员有效期至 ${formatDate(result.subscription.expires_at)}` : '一年会员权益已开通');
        return;
      }

      if (!connectedRef.current) await connectToStore();

      const storeProduct = await ensureStoreProduct(product.id);
      if (!storeProduct) {
        Alert.alert('商品未就绪', `App Store 暂时没有返回 ${product.id}，请稍后再试。`);
        setLoading(false);
        return;
      }

      purchaseFlowRef.current = { productId: product.id, handled: false, canceled: false };
      await InAppPurchases.purchaseItemAsync(product.id);
      validatePurchaseFromHistoryAfterStoreReturn(product.id).catch((err) => {
        console.warn('[iap] purchase fallback failed:', err.message);
      });
    } catch (err) {
      setLoading(false);
      const message = String(err?.message || '');
      if (message.includes('Must query item from store') || message.includes('E_ITEM_NOT_QUERIED')) {
        Alert.alert('商品还在加载', '请稍后再试。');
      } else {
        Alert.alert('购买失败', message || '请稍后再试');
      }
    }
  }

  async function handleRestore() {
    setLoading(true);
    try {
      if (__DEV__) {
        setNotice('开发模式无需恢复购买');
        return;
      }
      if (!connectedRef.current) await connectToStore();
      const { results } = await InAppPurchases.getPurchaseHistoryAsync();
      const purchases = Array.isArray(results) ? results.filter(isProcessablePurchase) : [];
      const purchaseWithReceipt = purchases.find(p => PRODUCT_IDS.includes(p.productId) && readReceiptData(p))
        || purchases.find(p => readReceiptData(p));
      const purchase = purchaseWithReceipt || purchases.find(p => PRODUCT_IDS.includes(p.productId));
      if (purchase) {
        await handleReceiptValidation(purchase);
      } else {
        Alert.alert('无可恢复的购买');
      }
    } catch (err) {
      Alert.alert('恢复失败', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleClaimWelcome() {
    if (claimed || benefitBusy) return;
    setBenefitBusy('claim');
    setNotice('');
    try {
      const result = await onClaim?.();
      if (result?.granted === false) setNotice('你已经领取过新人会员');
      else setNotice(`已领取 ${welcomeDays} 天新人会员`);
    } catch (err) {
      Alert.alert('领取失败', err.message);
    } finally {
      setBenefitBusy(null);
    }
  }

  async function handleRedeemInvite() {
    if (redeemed || benefitBusy || !inputValue) return;
    setBenefitBusy('redeem');
    setNotice('');
    try {
      await onRedeem?.(inputValue);
      setInviteCode('');
      setNotice('兑换成功，邀请奖励已到账');
    } catch (err) {
      Alert.alert('兑换失败', err.message);
    } finally {
      setBenefitBusy(null);
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

  function getDisplayPrice(product) {
    const sp = storeProducts.find(s => s.productId === product.id);
    if (sp) return sp.price;
    return product.price;
  }

  function isStoreProductAvailable(product) {
    if (Platform.OS === 'web' || __DEV__) return true;
    return storeProducts.some(s => s.productId === product.id);
  }

  function getActionText(product) {
    if (loading) return '处理中';
    if (Platform.OS !== 'web' && !__DEV__) {
      if (storeLoading || !storeReady) return '请稍候';
      if (!isStoreProductAvailable(product)) return '稍后重试';
    }
    return product.cta;
  }

  function legalUrl(path) {
    return `${String(apiUrl || '').replace(/\/$/, '')}${path}`;
  }

  async function openLegal(path) {
    const url = legalUrl(path);
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('无法打开链接', url);
    }
  }

  function confirmDeleteAccount() {
    const run = async () => {
      setLoading(true);
      try {
        await onDeleteAccount?.();
      } catch (err) {
        Alert.alert('删除失败', err.message);
      } finally {
        setLoading(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('确定删除账号和已保存的数据吗？此操作无法撤销。')) run();
      return;
    }

    Alert.alert(
      '删除账号和数据',
      '删除后，你的账号、照片/视频记录、空间、位置、物品和对话内容将从服务中移除。此操作无法撤销。',
      [
        { text: '取消', style: 'cancel' },
        { text: '确认删除', style: 'destructive', onPress: run }
      ]
    );
  }

  function renderPlanOptions() {
    return (
      <View style={s.planOptions}>
        {PRODUCTS.map((p, index) => (
          <Pressable key={p.id}
            style={({ pressed }) => [
              s.planOption,
              index === PRODUCTS.length - 1 && s.planOptionLast,
              storeReady && !isStoreProductAvailable(p) && s.planOptionDisabled,
              pressed && s.pressed
            ]}
            onPress={() => handlePurchase(p)}
            disabled={loading || storeLoading || (Platform.OS !== 'web' && !__DEV__ && !storeReady)}>
            <View style={s.planOptionCopy}>
              <View style={s.planOptionTitleRow}>
                <Text style={s.planOptionLabel}>{p.label}</Text>
                {p.primary ? <Text style={s.planBadge}>推荐</Text> : null}
              </View>
              <Text style={s.planOptionDesc}>{p.desc}</Text>
              <Text style={s.planOptionRenew}>自动续订，可在 Apple ID 订阅管理中取消。</Text>
            </View>
            <View style={s.planOptionSide}>
              <Text style={s.planOptionPrice}>{getDisplayPrice(p)}</Text>
              <View style={s.planOptionAction}>
                <Text style={s.planOptionActionText}>{getActionText(p)}</Text>
                {storeLoading || !isStoreProductAvailable(p) ? null : (
                  <Feather name="chevron-right" size={15} color="#2F7D5B" />
                )}
              </View>
            </View>
          </Pressable>
        ))}
        <View style={s.legalLinks}>
          <Pressable onPress={() => openLegal('/privacy')} hitSlop={8}>
            <Text style={s.legalLinkText}>隐私政策</Text>
          </Pressable>
          <Text style={s.legalDot}>·</Text>
          <Pressable onPress={() => openLegal('/terms')} hitSlop={8}>
            <Text style={s.legalLinkText}>用户协议</Text>
          </Pressable>
        </View>
        {storeError ? <Text style={s.storeNotice}>{storeError}</Text> : null}
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: topInset, paddingBottom: bottomInset }]}>
      <View style={s.header}>
        <Text style={s.pageTitle}>我的</Text>
        <Pressable style={({ pressed }) => [s.closeBtn, pressed && s.pressed]} onPress={onClose} hitSlop={12}>
          <Feather name="x" size={20} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={s.memberSection}>
          <View style={s.planRow}>
            <View style={[s.planIcon, hasPaidPlan && s.planIconActive]}>
              <Feather name={hasPaidPlan ? 'shield' : 'user'} size={18} color={colors.white} />
            </View>
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>当前版本</Text>
              <Text style={s.summaryValue}>{planLabel}</Text>
              <Text style={s.summaryMeta}>{planMeta}</Text>
            </View>
          </View>
          <View style={s.memberActions}>
            <Pressable
              style={({ pressed }) => [s.memberPrimaryAction, pressed && s.pressed]}
              onPress={() => setShowPlanOptions((v) => !v)}
              disabled={loading}
            >
              <Feather name={showPlanOptions ? 'chevron-up' : 'arrow-up-circle'} size={16} color={colors.white} />
              <Text style={s.memberPrimaryActionText} numberOfLines={1}>
                {showPlanOptions ? '收起方案' : hasPaidPlan ? '升级方案' : '开通会员'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.memberSecondaryAction, pressed && s.pressed]}
              onPress={handleRestore}
              disabled={loading}
            >
              <Text style={s.memberSecondaryActionText}>恢复购买</Text>
            </Pressable>
          </View>
          {showPlanOptions ? renderPlanOptions() : null}
        </View>

        <View style={s.benefitSection}>
          <View style={s.benefitHeader}>
            <Feather name="gift" size={18} color="#2F7D5B" />
            <View>
              <Text style={s.sectionTitle}>新人福利</Text>
              <Text style={s.sectionMeta}>领取会员、邀请码奖励都在这里</Text>
            </View>
          </View>

          <View style={s.benefitRow}>
            <View style={[s.benefitIcon, claimed && s.benefitIconDone]}>
              <Feather name={claimed ? 'check' : 'zap'} size={17} color={claimed ? colors.white : '#2F7D5B'} />
            </View>
            <View style={s.benefitRowCopy}>
              <Text style={s.benefitRowTitle}>{claimed ? '新人会员已领取' : '领取新人会员'}</Text>
              <Text style={s.sectionMeta}>{claimed ? '会员权益已到账' : `可领取 ${welcomeDays} 天新人会员`}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                s.rowAction,
                claimed && s.rowActionDone,
                pressed && !claimed && s.pressed
              ]}
              onPress={handleClaimWelcome}
              disabled={claimed || benefitBusy === 'claim'}
            >
              <Text style={[s.rowActionText, claimed && s.rowActionTextDone]}>
                {claimed ? '已领取' : benefitBusy === 'claim' ? '领取中' : '领取'}
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
            <Pressable
              style={({ pressed }) => [s.iconAction, pressed && s.pressed]}
              onPress={handleShareCode}
            >
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
              <Text style={s.sectionMeta}>{redeemed ? '每个账号只能兑换一次' : '兑换后双方各得额外奖励'}</Text>
              <View style={s.inputRow}>
                <TextInput
                  value={inviteCode}
                  onChangeText={setInviteCode}
                  editable={!redeemed && !benefitBusy}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                  placeholder={redeemed ? '已完成兑换' : '输入邀请码'}
                  placeholderTextColor={colors.textDim}
                  returnKeyType="done"
                  style={s.input}
                  onSubmitEditing={handleRedeemInvite}
                />
                <Pressable
                  style={({ pressed }) => [
                    s.redeemBtn,
                    (redeemed || !inputValue) && s.redeemBtnDisabled,
                    pressed && !redeemed && inputValue && s.pressed
                  ]}
                  onPress={handleRedeemInvite}
                  disabled={redeemed || !inputValue || benefitBusy === 'redeem'}
                >
                  <Text style={[s.redeemText, (redeemed || !inputValue) && s.redeemTextDisabled]}>
                    {redeemed ? '已兑' : benefitBusy === 'redeem' ? '兑换中' : '兑换'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
          {notice ? <Text style={s.notice}>{notice}</Text> : null}
        </View>

        <View style={s.accountSection}>
          <Text style={s.sectionTitle}>账号与数据</Text>
          <Text style={s.sectionMeta}>可以删除账号和已保存的个人数据。</Text>
          <Pressable
            style={({ pressed }) => [s.deleteAccountBtn, pressed && s.pressed]}
            onPress={confirmDeleteAccount}
            disabled={loading}
          >
            <Feather name="trash-2" size={16} color="#B13A2F" />
            <Text style={s.deleteAccountText}>删除账号</Text>
          </Pressable>
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  pageTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.bgInput, alignItems: 'center', justifyContent: 'center'
  },
  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 30, gap: 24 },
  memberSection: {
    paddingBottom: 22,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text
  },
  planIconActive: { backgroundColor: '#2F7D5B' },
  summaryItem: { flex: 1, minWidth: 0 },
  summaryLabel: { color: colors.textTertiary, fontSize: 12, fontWeight: '700' },
  summaryValue: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 4 },
  summaryMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 3 },
  memberActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18
  },
  memberPrimaryAction: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 18
  },
  memberPrimaryActionText: { color: colors.white, fontSize: 14, fontWeight: '800', flexShrink: 1 },
  memberSecondaryAction: {
    minHeight: 44,
    borderRadius: radius.full,
    backgroundColor: colors.bgInput,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  memberSecondaryActionText: { color: colors.textSecondary, fontSize: 13, fontWeight: '800' },
  planOptions: {
    marginTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineStrong
  },
  planOption: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  planOptionDisabled: { opacity: 0.58 },
  planOptionLast: { borderBottomWidth: 0 },
  planOptionCopy: { flex: 1, minWidth: 0 },
  planOptionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planOptionLabel: { color: colors.text, fontSize: 16, fontWeight: '800' },
  planBadge: { color: '#2F7D5B', fontSize: 12, fontWeight: '800' },
  planOptionDesc: { color: colors.textTertiary, fontSize: 12, fontWeight: '600', marginTop: 5, lineHeight: 17 },
  planOptionRenew: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 4, lineHeight: 15 },
  planOptionSide: { alignItems: 'flex-end', gap: 5, maxWidth: 96 },
  planOptionPrice: { color: colors.text, fontSize: 18, fontWeight: '800' },
  planOptionAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  planOptionActionText: { color: '#2F7D5B', fontSize: 13, fontWeight: '800' },
  legalLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12
  },
  legalLinkText: { color: '#2F7D5B', fontSize: 12, fontWeight: '800' },
  legalDot: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  storeNotice: { color: colors.textTertiary, fontSize: 12, fontWeight: '600', marginTop: 8, lineHeight: 17 },
  benefitSection: {
    paddingBottom: 2
  },
  benefitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4
  },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  sectionMeta: { color: colors.textTertiary, fontSize: 12, fontWeight: '600', marginTop: 4, lineHeight: 17 },
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greenSoft
  },
  benefitIconDone: {
    backgroundColor: '#2F7D5B'
  },
  benefitRowCopy: {
    flex: 1,
    minWidth: 0
  },
  benefitRowTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
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
  rowActionDone: { backgroundColor: colors.bgInput },
  rowActionText: { color: colors.white, fontSize: 13, fontWeight: '800' },
  rowActionTextDone: { color: colors.textSecondary },
  iconAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgInput
  },
  inviteCodeText: { color: '#2F7D5B', fontSize: 16, fontWeight: '800', marginTop: 4, letterSpacing: 0 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
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
  redeemBtnDisabled: { backgroundColor: colors.bgInput },
  redeemText: { color: colors.white, fontSize: 14, fontWeight: '800' },
  redeemTextDisabled: { color: colors.textTertiary },
  notice: { color: '#2F7D5B', fontSize: 13, fontWeight: '700', marginTop: 12 },
  accountSection: {
    paddingTop: 4,
    paddingBottom: 6
  },
  deleteAccountBtn: {
    minHeight: 44,
    marginTop: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E7B5AD',
    backgroundColor: '#FFF7F5',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8
  },
  deleteAccountText: {
    color: '#B13A2F',
    fontSize: 14,
    fontWeight: '800'
  },
  pressed: { opacity: 0.7 }
});
