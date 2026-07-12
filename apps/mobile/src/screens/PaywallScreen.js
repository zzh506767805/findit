import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
let InAppPurchases = null;
try { InAppPurchases = require('expo-in-app-purchases'); } catch {}
import { requestJson } from '../api';
import { colors, radius } from '../theme';
import { apiErrorMessage, formatDate, t } from '../strings';

const PRODUCTS = [
  {
    id: 'fangnale_yearly',
    label: t('pw_plan_standard'),
    price: t('pw_price_standard'),
    credits: 1000,
    desc: t('pw_desc_standard'),
    cta: t('pw_cta'),
    primary: true
  },
  {
    id: 'fangnale_yearly_large',
    label: t('pw_plan_large'),
    price: t('pw_price_large'),
    credits: 3000,
    desc: t('pw_desc_large'),
    cta: t('pw_cta')
  }
];
const PRODUCT_IDS = PRODUCTS.map(p => p.id);
const FINISH_TRANSACTION_TIMEOUT_MS = 4000;
const PURCHASE_HISTORY_FALLBACK_DELAYS_MS = [700, 1600, 3200];
const STORE_TIMEOUT_MS = 10000;

const PRODUCT_LABELS = {
  welcome_trial: t('pw_plan_welcome'),
  fangnale_yearly: t('pw_plan_standard'),
  fangnale_yearly_large: t('pw_plan_large')
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
  onLogout,
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
  const activePlanName = PRODUCT_LABELS[subscription.productId] || t('pw_plan_annual');
  const planLabel = hasPaidPlan ? `Pro ${activePlanName}` : (subscription.expired ? t('pw_plan_expired') : t('pw_plan_free'));
  const expiresDateText = formatDate(subscription.expiresAt);
  const planMeta = hasPaidPlan
    ? t('pw_expires', { date: expiresDateText || t('pw_one_year_later') })
    : subscription.expired
      ? (expiresDateText ? t('pw_expired_on', { date: expiresDateText }) : t('pw_expired_generic'))
      : t('pw_meta_free', { version: appVersion });
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
        if (!InAppPurchases) throw new Error(t('pw_iap_missing'));
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
            Alert.alert(t('pw_purchase_pending_title'), t('pw_purchase_pending_msg'));
          } else {
            purchaseFlowRef.current.canceled = true;
            setLoading(false);
            Alert.alert(t('pw_purchase_failed'), t('pw_purchase_failed_msg'));
          }
        });

        await queryStoreProducts();
      } catch (err) {
        if (mounted) {
          setStoreReady(true);
          setStoreError(t('pw_store_unavailable'));
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
      await withTimeout(InAppPurchases.connectAsync(), STORE_TIMEOUT_MS, t('pw_store_connect_timeout'));
    } catch (err) {
      if (!String(err?.message || '').includes('Already connected')) throw err;
    }
    connectedRef.current = true;
  }

  async function queryStoreProducts() {
    if (Platform.OS === 'web' || __DEV__) return [];
    if (!InAppPurchases) throw new Error(t('pw_iap_missing'));

    setStoreLoading(true);
    setStoreError('');
    try {
      await connectToStore();
      const { responseCode, results } = await withTimeout(
        InAppPurchases.getProductsAsync(PRODUCT_IDS),
        STORE_TIMEOUT_MS,
        t('pw_store_read_timeout')
      );
      const products = Array.isArray(results) ? results : [];
      if (responseCode !== InAppPurchases.IAPResponseCode.OK) {
        throw new Error(t('pw_store_query_failed'));
      }
      setStoreProducts(products);
      setStoreReady(true);
      if (!products.length) setStoreError(t('pw_store_not_ready'));
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
          Alert.alert(t('pw_receipt_missing_title'), t('pw_receipt_missing_msg'));
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
      Alert.alert(result.alreadyProcessed ? t('pw_restored') : t('pw_activated'), result.subscription?.expires_at ? t('pw_valid_until', { date: formatDate(result.subscription.expires_at) }) : t('pw_activated_msg'));
      finishTransactionAfterUnlock(purchaseToFinish);
    } catch (err) {
      if (purchaseKey) processedPurchaseKeysRef.current.delete(purchaseKey);
      Alert.alert(t('pw_verify_failed'), apiErrorMessage(err));
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
      Alert.alert(t('pw_purchase_unconfirmed_title'), t('pw_purchase_unconfirmed_msg'));
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
        Alert.alert(t('pw_activated'), result.subscription?.expires_at ? t('pw_valid_until', { date: formatDate(result.subscription.expires_at) }) : t('pw_activated_msg'));
        return;
      }

      if (!connectedRef.current) await connectToStore();

      const storeProduct = await ensureStoreProduct(product.id);
      if (!storeProduct) {
        Alert.alert(t('pw_product_not_ready_title'), t('pw_product_not_ready_msg', { id: product.id }));
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
        Alert.alert(t('pw_product_loading_title'), t('try_later'));
      } else {
        Alert.alert(t('pw_purchase_failed'), apiErrorMessage(err));
      }
    }
  }

  async function handleRestore() {
    setLoading(true);
    try {
      if (__DEV__) {
        setNotice(t('pw_dev_no_restore'));
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
        Alert.alert(t('pw_nothing_restore'));
      }
    } catch (err) {
      Alert.alert(t('pw_restore_failed'), apiErrorMessage(err));
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
      if (result?.granted === false) setNotice(t('bf_already_claimed'));
      else setNotice(t('bf_claim_ok', { days: welcomeDays }));
    } catch (err) {
      Alert.alert(t('bf_claim_failed'), apiErrorMessage(err));
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
      setNotice(t('bf_redeem_ok'));
    } catch (err) {
      Alert.alert(t('bf_redeem_failed'), apiErrorMessage(err));
    } finally {
      setBenefitBusy(null);
    }
  }

  async function handleShareCode() {
    if (!benefits?.invite_code) return;
    const shareText = t('bf_share_text', { code: ownCode });
    try {
      if (Platform.OS === 'web' && navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(ownCode);
        setNotice(t('bf_code_copied'));
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
    if (loading) return t('pw_processing');
    if (Platform.OS !== 'web' && !__DEV__) {
      if (storeLoading || !storeReady) return t('pw_wait');
      if (!isStoreProductAvailable(product)) return t('pw_retry_later');
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
      Alert.alert(t('open_link_failed'), url);
    }
  }

  function confirmLogout() {
    const run = async () => {
      setLoading(true);
      try {
        await onLogout?.();
      } catch (err) {
        Alert.alert(t('ac_logout_failed'), apiErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(t('web_logout_confirm'))) run();
      return;
    }

    Alert.alert(
      t('ac_logout'),
      t('ac_logout_msg'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('ac_logout'), onPress: run }
      ]
    );
  }

  function confirmDeleteAccount() {
    const run = async () => {
      setLoading(true);
      try {
        await onDeleteAccount?.();
      } catch (err) {
        Alert.alert(t('delete_failed'), apiErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(t('web_delete_account_confirm'))) run();
      return;
    }

    Alert.alert(
      t('ac_delete_title'),
      t('ac_delete_msg'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('ac_confirm_delete'), style: 'destructive', onPress: run }
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
                {p.primary ? <Text style={s.planBadge}>{t('pw_badge_recommend')}</Text> : null}
              </View>
              <Text style={s.planOptionDesc}>{p.desc}</Text>
              <Text style={s.planOptionRenew}>{t('pw_auto_renew')}</Text>
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
            <Text style={s.legalLinkText}>{t('pw_privacy')}</Text>
          </Pressable>
          <Text style={s.legalDot}>·</Text>
          <Pressable onPress={() => openLegal('/terms')} hitSlop={8}>
            <Text style={s.legalLinkText}>{t('pw_terms')}</Text>
          </Pressable>
        </View>
        {storeError ? <Text style={s.storeNotice}>{storeError}</Text> : null}
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: topInset, paddingBottom: bottomInset }]}>
      <View style={s.header}>
        <Text style={s.pageTitle}>{t('pw_page_title')}</Text>
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
              <Text style={s.summaryLabel}>{t('pw_current_plan')}</Text>
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
                {showPlanOptions ? t('pw_collapse') : hasPaidPlan ? t('pw_upgrade') : t('pw_subscribe')}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.memberSecondaryAction, pressed && s.pressed]}
              onPress={handleRestore}
              disabled={loading}
            >
              <Text style={s.memberSecondaryActionText}>{t('pw_restore')}</Text>
            </Pressable>
          </View>
          {showPlanOptions ? renderPlanOptions() : null}
        </View>

        <View style={s.benefitSection}>
          <View style={s.benefitHeader}>
            <Feather name="gift" size={18} color="#2F7D5B" />
            <View>
              <Text style={s.sectionTitle}>{t('bf_section')}</Text>
              <Text style={s.sectionMeta}>{t('bf_section_meta')}</Text>
            </View>
          </View>

          <View style={s.benefitRow}>
            <View style={[s.benefitIcon, claimed && s.benefitIconDone]}>
              <Feather name={claimed ? 'check' : 'zap'} size={17} color={claimed ? colors.white : '#2F7D5B'} />
            </View>
            <View style={s.benefitRowCopy}>
              <Text style={s.benefitRowTitle}>{claimed ? t('bf_claimed_title') : t('bf_claim_title')}</Text>
              <Text style={s.sectionMeta}>{claimed ? t('bf_claimed_meta') : t('bf_claim_meta', { days: welcomeDays })}</Text>
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
                {claimed ? t('bf_claimed') : benefitBusy === 'claim' ? t('bf_claiming') : t('bf_claim')}
              </Text>
            </Pressable>
          </View>

          <View style={s.benefitDivider} />

          <View style={s.benefitRow}>
            <View style={s.benefitIcon}>
              <Feather name="copy" size={17} color="#2F7D5B" />
            </View>
            <View style={s.benefitRowCopy}>
              <Text style={s.benefitRowTitle}>{t('bf_my_code')}</Text>
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
              <Text style={s.benefitRowTitle}>{redeemed ? t('bf_redeemed_title') : t('bf_enter_code')}</Text>
              <Text style={s.sectionMeta}>{redeemed ? t('bf_redeemed_meta') : t('bf_redeem_meta')}</Text>
              <View style={s.inputRow}>
                <TextInput
                  value={inviteCode}
                  onChangeText={setInviteCode}
                  editable={!redeemed && !benefitBusy}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                  placeholder={redeemed ? t('bf_redeemed_ph') : t('bf_code_ph')}
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
                    {redeemed ? t('bf_redeemed_short') : benefitBusy === 'redeem' ? t('bf_redeeming') : t('bf_redeem')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
          {notice ? <Text style={s.notice}>{notice}</Text> : null}
        </View>

        <View style={s.accountSection}>
          <Text style={s.sectionTitle}>{t('ac_section')}</Text>
          <Text style={s.sectionMeta}>{t('ac_section_meta')}</Text>
          <Pressable
            style={({ pressed }) => [s.logoutBtn, pressed && s.pressed]}
            onPress={confirmLogout}
            disabled={loading}
          >
            <Feather name="log-out" size={16} color={colors.textSecondary} />
            <Text style={s.logoutText}>{t('ac_logout')}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.deleteAccountBtn, pressed && s.pressed]}
            onPress={confirmDeleteAccount}
            disabled={loading}
          >
            <Feather name="trash-2" size={16} color="#B13A2F" />
            <Text style={s.deleteAccountText}>{t('ac_delete')}</Text>
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
  logoutBtn: {
    minHeight: 44,
    marginTop: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.bgInput,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8
  },
  logoutText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '800'
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
