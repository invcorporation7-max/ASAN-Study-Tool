import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Coins,
  Copy,
  ExternalLink,
  Eye,
  FlaskConical,
  KeyRound,
  Lock,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  apiFetch,
  buildGmailConfirmationUrl,
  buildGmailLicenseComposeUrl,
} from '../lib/api';
import {
  APP_PLATFORM_FEE,
  ELITE_ANNUAL_TOTAL,
  ELITE_MONTHLY_BASE,
  ELITE_MONTHLY_TOTAL,
  PLAN_PLATFORM_FEE,
  PRO_ANNUAL_TOTAL,
  PRO_MONTHLY_BASE,
  PRO_MONTHLY_TOTAL,
  REPO_PLATFORM_FEE,
  calculateCancellationRefund,
  calculatePlanQuote,
  calculateRepoOrAppQuote,
} from '../lib/pricing';
import type {
  AppSubscriptionItem,
  CouponItem,
  LicenseKeyItem,
  MaterialPurchaseItem,
  PlanSubscriptionItem,
  PointTransactionItem,
  ProRefundRequestItem,
} from '../types';
import { ConfirmDialog } from './ConfirmDialog';

type DetailTarget =
  | { kind: 'plan'; sub: PlanSubscriptionItem; linkedKey?: LicenseKeyItem }
  | { kind: 'key'; keyRow: LicenseKeyItem }
  | { kind: 'app'; appSub: AppSubscriptionItem }
  | { kind: 'repo'; purchase: MaterialPurchaseItem };

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10) || '—';
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function formatKeyStatus(status?: string): string {
  if (!status || status === 'unused') return 'new';
  return status;
}

export const SubscriptionsView: React.FC = () => {
  const {
    dbUser,
    isGuest,
    authMode,
    effectivePlan,
    signIn,
    exitGuestToSignIn,
    setAccountPassword,
    refreshProfile,
  } = useAuth();

  const [keys, setKeys] = useState<LicenseKeyItem[]>([]);
  const [planSubscriptions, setPlanSubscriptions] = useState<PlanSubscriptionItem[]>([]);
  const [appSubscriptions, setAppSubscriptions] = useState<AppSubscriptionItem[]>([]);
  const [materialPurchases, setMaterialPurchases] = useState<MaterialPurchaseItem[]>([]);
  const [transactions, setTransactions] = useState<PointTransactionItem[]>([]);
  const [refundRequests, setRefundRequests] = useState<ProRefundRequestItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Upgrade Plan modal state
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeTerm, setUpgradeTerm] = useState<'monthly' | 'annual'>('monthly');
  const [upgradeCouponInput, setUpgradeCouponInput] = useState('');
  const [upgradeValidatedCoupon, setUpgradeValidatedCoupon] = useState<{
    tier: 'pro' | 'elite';
    coupon: CouponItem;
  } | null>(null);
  const [upgradeCouponMsg, setUpgradeCouponMsg] = useState<string | null>(null);
  const [overlapPendingPurchase, setOverlapPendingPurchase] = useState<{
    kind: 'points' | 'key';
    tier: 'pro' | 'elite';
    term?: 'monthly' | 'annual';
    couponCode?: string;
    keyCode?: string;
  } | null>(null);

  // Key activation & gifting state
  const [keyInput, setKeyInput] = useState('');
  const [giftTier, setGiftTier] = useState<'pro' | 'elite'>('pro');
  const [giftTerm, setGiftTerm] = useState<'monthly' | 'annual'>('monthly');
  const [giftRecipient, setGiftRecipient] = useState('');
  const [giftCoupon, setGiftCoupon] = useState('');
  const [lastPurchasedKey, setLastPurchasedKey] = useState<{
    keyCode: string;
    keyType: 'pro' | 'elite';
    recipientEmail: string;
    activationExpiresAt: string;
  } | null>(null);

  // View Details modal state
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [detailExtendTerm, setDetailExtendTerm] = useState<'monthly' | 'annual'>('monthly');
  const [detailExtendUnits, setDetailExtendUnits] = useState(1);
  const [detailCouponInput, setDetailCouponInput] = useState('');
  const [detailValidatedCoupon, setDetailValidatedCoupon] = useState<CouponItem | null>(null);
  const [detailCancelType, setDetailCancelType] = useState<'timed' | 'non_timed'>('timed');
  const [detailCancelReason, setDetailCancelReason] = useState('');
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // Password state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadSubscriptions = useCallback(async () => {
    if (isGuest || !dbUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{
        keys: LicenseKeyItem[];
        transactions: PointTransactionItem[];
        refundRequests?: ProRefundRequestItem[];
        planSubscriptions?: PlanSubscriptionItem[];
        appSubscriptions?: AppSubscriptionItem[];
        materialPurchases?: MaterialPurchaseItem[];
      }>('/api/subscriptions');
      setKeys(data.keys || []);
      setTransactions(data.transactions || []);
      setRefundRequests(data.refundRequests || []);
      setPlanSubscriptions(data.planSubscriptions || []);
      setAppSubscriptions(data.appSubscriptions || []);
      setMaterialPurchases(data.materialPurchases || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load subscription records');
    } finally {
      setLoading(false);
    }
  }, [dbUser, isGuest]);

  useEffect(() => {
    void loadSubscriptions();
  }, [loadSubscriptions]);

  const visualEffectsOn = dbUser?.eliteVisualEffects !== false;
  const isElite = effectivePlan === 'elite';
  const isPro = effectivePlan === 'pro';
  const isInfinite = Boolean(dbUser?.infinitePoints);
  const points = dbUser?.points ?? 0;

  const hasActiveProTenure = useMemo(
    () =>
      !isGuest &&
      Boolean(
        dbUser?.proExpiresAt && new Date(dbUser.proExpiresAt).getTime() > Date.now()
      ),
    [dbUser?.proExpiresAt, isGuest]
  );

  // Merge planSubscriptions and unattached/gifted/new license keys into Table 1
  const planRows = useMemo(() => {
    const usedKeyCodes = new Set(
      planSubscriptions.map((s) => s.keyCode).filter(Boolean)
    );
    const keyEntries: {
      rowId: string;
      tier: 'pro' | 'elite' | string;
      title: string;
      sourceLabel: string;
      keyCode: string;
      status: string;
      useBefore: string;
      startsAt: string;
      expiresAt: string;
      cost: number;
      noRefund: boolean;
      target: DetailTarget;
    }[] = [];

    for (const sub of planSubscriptions) {
      const linkedKey = sub.keyCode
        ? keys.find((k) => k.keyCode === sub.keyCode)
        : undefined;
      keyEntries.push({
        rowId: `plan-${sub.id}`,
        tier: sub.tier,
        title: `${sub.tier === 'elite' ? 'Elite' : 'Pro'} (${sub.term === 'annual' ? 'Annual 11+1' : 'Monthly'})`,
        sourceLabel:
          sub.sourceType === 'admin_gift'
            ? 'Admin Gift (No Refund)'
            : sub.sourceType === 'key'
              ? 'License Key'
              : 'Points Purchase',
        keyCode: sub.keyCode || '—',
        status: sub.status,
        useBefore: linkedKey?.activationExpiresAt ? linkedKey.activationExpiresAt.slice(0, 10) : '—',
        startsAt: sub.startedAt,
        expiresAt: sub.expiresAt,
        cost: sub.totalCost ?? 0,
        noRefund: Boolean(sub.noRefund || sub.sourceType === 'admin_gift'),
        target: { kind: 'plan', sub, linkedKey },
      });
    }

    for (const k of keys) {
      if (usedKeyCodes.has(k.keyCode)) continue;
      keyEntries.push({
        rowId: `key-${k.id}`,
        tier: k.keyType || 'pro',
        title: `${k.keyType === 'elite' ? 'Elite' : 'Pro'} Key (${k.durationMonths === 12 ? '12 mo' : '1 mo'})`,
        sourceLabel:
          k.sourceType === 'admin_gift'
            ? 'Admin Gift Key (No Refund)'
            : k.activatedByUserId === dbUser?.id
              ? 'License Key'
              : `Key for ${k.issuedToEmail || 'User'}`,
        keyCode: k.keyCode,
        status: formatKeyStatus(k.status),
        useBefore: k.activationExpiresAt ? k.activationExpiresAt.slice(0, 10) : '—',
        startsAt: k.subStartsAt,
        expiresAt: k.subEndsAt,
        cost: k.purchaseCost ?? 0,
        noRefund: Boolean(k.noRefund || k.sourceType === 'admin_gift'),
        target: { kind: 'key', keyRow: k },
      });
    }

    return keyEntries;
  }, [dbUser?.id, keys, planSubscriptions]);

  const repoAndAppRows = useMemo(() => {
    const appItems = appSubscriptions.map((a) => ({
      rowId: `app-${a.id}`,
      category: 'App',
      title: a.appName || a.appKey,
      mode: a.billingMode === 'metered_hourly' ? `${a.hourlyRate} pts/hr (15m)` : a.billingMode,
      status: a.status,
      startsAt: a.startedAt,
      expiresAt: a.expiresAt,
      cost: a.totalCost,
      target: { kind: 'app', appSub: a } as DetailTarget,
    }));
    const repoItems = materialPurchases.map((m) => ({
      rowId: `repo-${m.id}`,
      category: 'Repository',
      title: m.materialTitle,
      mode: m.accessType === 'buy' ? 'Lifetime Buy' : `Rent (${m.hours}h)`,
      status: m.status || 'active',
      startsAt: m.createdAt,
      expiresAt: m.accessType === 'buy' ? '' : m.expiresAt,
      cost: m.totalCost,
      target: { kind: 'repo', purchase: m } as DetailTarget,
    }));
    return [...appItems, ...repoItems].sort(
      (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()
    );
  }, [appSubscriptions, materialPurchases]);

  const handleValidateUpgradeCoupon = async (tier: 'pro' | 'elite') => {
    const code = upgradeCouponInput.trim().toUpperCase();
    if (!code) {
      setUpgradeValidatedCoupon(null);
      setUpgradeCouponMsg(null);
      return;
    }
    setBusy(true);
    setUpgradeCouponMsg(null);
    try {
      const res = await apiFetch<{ valid: boolean; coupon: CouponItem }>('/api/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({
          code,
          targetScope: tier === 'elite' ? 'elite_plan' : 'pro_plan',
          tier,
          term: upgradeTerm,
        }),
      });
      setUpgradeValidatedCoupon({ tier, coupon: res.coupon });
      setUpgradeCouponMsg(`Coupon ${res.coupon.code} applied for ${tier.toUpperCase()}!`);
    } catch (err) {
      setUpgradeValidatedCoupon(null);
      setUpgradeCouponMsg(err instanceof Error ? err.message : 'Invalid coupon code.');
    } finally {
      setBusy(false);
    }
  };

  const handlePurchasePlan = async (
    tier: 'pro' | 'elite',
    proHandling?: 'keep' | 'cancel'
  ) => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    const couponCode =
      upgradeValidatedCoupon && upgradeValidatedCoupon.tier === tier
        ? upgradeValidatedCoupon.coupon.code
        : upgradeCouponInput.trim().toUpperCase() || undefined;
    try {
      const res = await apiFetch<{ message: string }>('/api/subscriptions/redeem-points', {
        method: 'POST',
        body: JSON.stringify({
          tier,
          term: upgradeTerm,
          couponCode,
          ...(proHandling ? { proHandling } : {}),
        }),
      });
      setOverlapPendingPurchase(null);
      setUpgradeModalOpen(false);
      await Promise.all([refreshProfile(), loadSubscriptions()]);
      setStatusMsg(`${res.message} Confirmation delivered to Tool Mail.`);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const msg = err instanceof Error ? err.message : 'Could not activate subscription';
      if (
        code === 'PRO_OVERLAP_CHOICE_REQUIRED' ||
        /keep or cancel Pro|keep.*cancel/i.test(msg)
      ) {
        setOverlapPendingPurchase({
          kind: 'points',
          tier,
          term: upgradeTerm,
          couponCode,
        });
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePurchaseLicenseKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{
        key: LicenseKeyItem;
        recipientEmail: string;
      }>('/api/subscriptions/purchase-key', {
        method: 'POST',
        body: JSON.stringify({
          recipientEmail: giftRecipient.trim() || dbUser?.email,
          tier: giftTier,
          keyType: giftTier,
          term: giftTerm,
          couponCode: giftCoupon.trim().toUpperCase() || undefined,
        }),
      });
      setLastPurchasedKey({
        keyCode: res.key.keyCode,
        keyType: giftTier,
        recipientEmail: res.recipientEmail,
        activationExpiresAt: res.key.activationExpiresAt,
      });
      setGiftRecipient('');
      setGiftCoupon('');
      await Promise.all([refreshProfile(), loadSubscriptions()]);
      setStatusMsg(
        `Generated ${giftTier === 'elite' ? '12-char Elite' : '8-char Pro'} Key ${res.key.keyCode} and delivered to ${res.recipientEmail} in Tool Mail.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to purchase license key');
    } finally {
      setBusy(false);
    }
  };

  const submitRedeemKey = async (cleaned: string, proHandling?: 'keep' | 'cancel') => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/subscriptions/redeem-key', {
        method: 'POST',
        body: JSON.stringify({
          keyCode: cleaned,
          ...(proHandling ? { proHandling } : {}),
        }),
      });
      setKeyInput('');
      setOverlapPendingPurchase(null);
      await Promise.all([refreshProfile(), loadSubscriptions()]);
      setStatusMsg(res.message);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const msg = err instanceof Error ? err.message : 'Invalid or expired license key';
      if (
        code === 'PRO_OVERLAP_CHOICE_REQUIRED' ||
        /keep or cancel Pro|keep.*cancel/i.test(msg)
      ) {
        setOverlapPendingPurchase({
          kind: 'key',
          tier: 'elite',
          keyCode: cleaned,
        });
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRedeemKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = keyInput.trim().toUpperCase();
    if (!cleaned) return;
    await submitRedeemKey(cleaned);
  };

  const handleOpenDetails = (target: DetailTarget) => {
    setDetailTarget(target);
    setDetailExtendTerm('monthly');
    setDetailExtendUnits(1);
    setDetailCouponInput('');
    setDetailValidatedCoupon(null);
    setDetailCancelType('timed');
    setDetailCancelReason('');
    setConfirmCancelOpen(false);
  };

  const detailMeta = useMemo(() => {
    if (!detailTarget) return null;
    const role = dbUser?.role || 'user';
    const currentPlan = effectivePlan;

    if (detailTarget.kind === 'plan' || detailTarget.kind === 'key') {
      const isKeyOnly = detailTarget.kind === 'key';
      const tier: 'pro' | 'elite' = isKeyOnly
        ? detailTarget.keyRow.keyType === 'elite'
          ? 'elite'
          : 'pro'
        : detailTarget.sub.tier === 'elite'
          ? 'elite'
          : 'pro';
      const term = isKeyOnly
        ? detailTarget.keyRow.durationMonths === 12
          ? 'annual'
          : 'monthly'
        : detailTarget.sub.term === 'annual'
          ? 'annual'
          : 'monthly';
      const keyObj = isKeyOnly ? detailTarget.keyRow : detailTarget.linkedKey;
      const isNoRefund = isKeyOnly
        ? Boolean(detailTarget.keyRow.noRefund || detailTarget.keyRow.sourceType === 'admin_gift')
        : Boolean(detailTarget.sub.noRefund || detailTarget.sub.sourceType === 'admin_gift');
      const originalCost = isKeyOnly
        ? detailTarget.keyRow.purchaseCost ?? 0
        : detailTarget.sub.totalCost ?? 0;
      const status = isKeyOnly ? formatKeyStatus(detailTarget.keyRow.status) : detailTarget.sub.status;
      const startsAt = isKeyOnly ? detailTarget.keyRow.subStartsAt : detailTarget.sub.startedAt;
      const expiresAt = isKeyOnly ? detailTarget.keyRow.subEndsAt : detailTarget.sub.expiresAt;

      const currentQuote = calculatePlanQuote({
        tier,
        term: detailExtendTerm,
        coupon: detailValidatedCoupon,
      });
      const refundPreview = calculateCancellationRefund({
        pointsPaid: originalCost,
        platformFee: isNoRefund ? 0 : PLAN_PLATFORM_FEE,
        noRefund: isNoRefund,
        startedAt: startsAt,
        expiresAt,
        purchaseType: detailCancelType,
      });

      return {
        kind: detailTarget.kind,
        title: `${tier === 'elite' ? 'Elite' : 'Pro'} Membership (${term === 'annual' ? 'Annual' : 'Monthly'})`,
        tier,
        status,
        isNoRefund,
        originalCost,
        platformFee: isKeyOnly ? detailTarget.keyRow.platformFee ?? PLAN_PLATFORM_FEE : detailTarget.sub.platformFee ?? PLAN_PLATFORM_FEE,
        keyCode: keyObj?.keyCode || (isKeyOnly ? detailTarget.keyRow.keyCode : ''),
        useBefore: keyObj?.activationExpiresAt || '',
        activatedAt: keyObj?.activatedAt || '',
        startsAt,
        expiresAt,
        currentQuote,
        refundPreview,
        canCancel:
          status === 'active' &&
          (!isKeyOnly || detailTarget.keyRow.activatedByUserId === dbUser?.id),
        canExtend: status === 'active' || status === 'expired',
      };
    }

    if (detailTarget.kind === 'app') {
      const a = detailTarget.appSub;
      const baseExtend = 8 * Math.max(1, detailExtendUnits); // 15-min quarter @ 30 pts/hr = 8 pts base
      const currentQuote = calculateRepoOrAppQuote({
        targetScope: 'apps_metered',
        baseSubtotal: baseExtend,
        effectivePlan: currentPlan,
        role,
        coupon: detailValidatedCoupon,
      });
      const refundPreview = calculateCancellationRefund({
        pointsPaid: a.totalCost,
        platformFee: a.platformFee ?? APP_PLATFORM_FEE,
        startedAt: a.startedAt,
        expiresAt: a.expiresAt,
        purchaseType: 'timed',
      });
      return {
        kind: 'app' as const,
        title: a.appName || a.appKey,
        tier: 'app',
        status: a.status,
        isNoRefund: false,
        originalCost: a.totalCost,
        platformFee: a.platformFee ?? APP_PLATFORM_FEE,
        discountApplied: a.discountPercent ?? 0,
        keyCode: '',
        useBefore: '',
        activatedAt: '',
        startsAt: a.startedAt,
        expiresAt: a.expiresAt,
        currentQuote,
        refundPreview,
        canCancel: a.status === 'active',
        canExtend: true,
      };
    }

    // Repository item
    const p = detailTarget.purchase;
    const isBuy = p.accessType === 'buy';
    const baseExtend = isBuy ? p.baseCost || p.totalCost : p.hourlyRate * Math.max(1, detailExtendUnits);
    const currentQuote = calculateRepoOrAppQuote({
      targetScope: isBuy ? 'repository_buy' : 'repository_rent',
      baseSubtotal: baseExtend,
      effectivePlan: currentPlan,
      role,
      coupon: detailValidatedCoupon,
    });
    const refundPreview = calculateCancellationRefund({
      pointsPaid: p.totalCost,
      platformFee: p.platformFee ?? REPO_PLATFORM_FEE,
      startedAt: p.createdAt,
      expiresAt: isBuy ? '' : p.expiresAt,
      purchaseType: isBuy ? 'non_timed' : 'timed',
    });
    return {
      kind: 'repo' as const,
      title: `${p.materialTitle} (${isBuy ? 'Lifetime Buy' : 'Hourly Rent'})`,
      tier: 'repo',
      status: p.status || 'active',
      isNoRefund: false,
      originalCost: p.totalCost,
      platformFee: p.platformFee ?? REPO_PLATFORM_FEE,
      discountApplied: p.discountPercent ?? 0,
      keyCode: '',
      useBefore: '',
      activatedAt: '',
      startsAt: p.createdAt,
      expiresAt: isBuy ? '' : p.expiresAt,
      currentQuote,
      refundPreview,
      canCancel: (p.status || 'active') === 'active',
      canExtend: !isBuy,
    };
  }, [
    dbUser?.id,
    dbUser?.role,
    detailCancelType,
    detailExtendTerm,
    detailExtendUnits,
    detailTarget,
    detailValidatedCoupon,
    effectivePlan,
  ]);

  const handleValidateDetailCoupon = async () => {
    if (!detailTarget || !detailMeta) return;
    const code = detailCouponInput.trim().toUpperCase();
    if (!code) {
      setDetailValidatedCoupon(null);
      return;
    }
    const scope =
      detailMeta.kind === 'plan' || detailMeta.kind === 'key'
        ? detailMeta.tier === 'elite'
          ? 'elite_plan'
          : 'pro_plan'
        : detailMeta.kind === 'app'
          ? 'apps_metered'
          : detailTarget.kind === 'repo' && detailTarget.purchase.accessType === 'buy'
            ? 'repository_buy'
            : 'repository_rent';
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ valid: boolean; coupon: CouponItem }>('/api/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({ code, targetScope: scope, term: detailExtendTerm }),
      });
      setDetailValidatedCoupon(res.coupon);
      setStatusMsg(`Coupon ${res.coupon.code} validated for extension.`);
    } catch (err) {
      setDetailValidatedCoupon(null);
      setErrorMsg(err instanceof Error ? err.message : 'Coupon invalid for this item.');
    } finally {
      setBusy(false);
    }
  };

  const handleExtendDetail = async () => {
    if (!detailTarget || !detailMeta) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    const couponCode = detailValidatedCoupon?.code || detailCouponInput.trim().toUpperCase() || undefined;
    try {
      let msg = 'Extended successfully.';
      if (detailTarget.kind === 'plan' || detailTarget.kind === 'key') {
        const res = await apiFetch<{ message: string }>('/api/subscriptions/extend', {
          method: 'POST',
          body: JSON.stringify({
            tier: detailMeta.tier,
            term: detailExtendTerm,
            couponCode,
          }),
        });
        msg = res.message;
      } else if (detailTarget.kind === 'app') {
        const res = await apiFetch<{ message: string }>(
          `/api/app-subscriptions/${detailTarget.appSub.id}/extend`,
          {
            method: 'POST',
            body: JSON.stringify({ quarters: detailExtendUnits, couponCode }),
          }
        );
        msg = res.message;
      } else {
        const res = await apiFetch<{ message: string }>(
          `/api/study-materials/purchases/${detailTarget.purchase.id}/extend`,
          {
            method: 'POST',
            body: JSON.stringify({ hours: detailExtendUnits, couponCode }),
          }
        );
        msg = res.message;
      }
      setDetailTarget(null);
      await Promise.all([refreshProfile(), loadSubscriptions()]);
      setStatusMsg(msg);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to extend subscription');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmCancelDetail = async () => {
    if (!detailTarget || !detailMeta) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      let msg = 'Cancelled successfully.';
      if (detailTarget.kind === 'plan' || detailTarget.kind === 'key') {
        const res = await apiFetch<{ message: string }>('/api/subscriptions/cancel-pro', {
          method: 'POST',
          body: JSON.stringify({
            reason: detailCancelReason.trim(),
            purchaseType: detailCancelType,
            tier: detailMeta.tier,
          }),
        });
        msg = res.message;
      } else if (detailTarget.kind === 'app') {
        const res = await apiFetch<{ message: string }>(
          `/api/app-subscriptions/${detailTarget.appSub.id}/cancel`,
          {
            method: 'POST',
            body: JSON.stringify({ reason: detailCancelReason.trim() }),
          }
        );
        msg = res.message;
      } else {
        const res = await apiFetch<{ message: string }>(
          `/api/study-materials/purchases/${detailTarget.purchase.id}/cancel`,
          {
            method: 'POST',
            body: JSON.stringify({ reason: detailCancelReason.trim() }),
          }
        );
        msg = res.message;
      }
      setConfirmCancelOpen(false);
      setDetailTarget(null);
      await Promise.all([refreshProfile(), loadSubscriptions()]);
      setStatusMsg(msg);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to cancel subscription');
    } finally {
      setBusy(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (newPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setSavingPwd(true);
    try {
      const msg = await setAccountPassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setStatusMsg(msg);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save password');
    } finally {
      setSavingPwd(false);
    }
  };

  if (isGuest) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-4 asan-card-hover">
          <div className="flex items-start gap-3">
            <Lock className="mt-1 h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Subscriptions and Plans Require Sign-In
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Sign in with Google or Email &amp; Password to receive <strong>500 initial points</strong>, upgrade to Pro (500/mo · 5,250/yr) or Elite (750/mo · 8,000/yr), or redeem 8-char Pro &amp; 12-char Elite License Keys.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={signIn}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Sign in with Google
            </button>
            <button
              type="button"
              onClick={exitGuestToSignIn}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              Email &amp; Password Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  const proDaysLeft =
    dbUser?.proExpiresAt && new Date(dbUser.proExpiresAt).getTime() > Date.now()
      ? Math.max(0, Math.ceil((new Date(dbUser.proExpiresAt).getTime() - Date.now()) / 86400000))
      : null;
  const eliteDaysLeft =
    dbUser?.eliteExpiresAt && new Date(dbUser.eliteExpiresAt).getTime() > Date.now()
      ? Math.max(0, Math.ceil((new Date(dbUser.eliteExpiresAt).getTime() - Date.now()) / 86400000))
      : null;

  const proQuote = calculatePlanQuote({
    tier: 'pro',
    term: upgradeTerm,
    coupon: upgradeValidatedCoupon?.tier === 'pro' ? upgradeValidatedCoupon.coupon : null,
  });
  const eliteQuote = calculatePlanQuote({
    tier: 'elite',
    term: upgradeTerm,
    coupon: upgradeValidatedCoupon?.tier === 'elite' ? upgradeValidatedCoupon.coupon : null,
  });

  const giftQuote = calculatePlanQuote({
    tier: giftTier,
    term: giftTerm,
  });

  return (
    <div className="space-y-6">
      {/* Header + Balance + Upgrade CTA */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Subscriptions and Plans
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Pro ({PRO_MONTHLY_TOTAL} pts/mo · {PRO_ANNUAL_TOTAL.toLocaleString()} pts/yr) · Elite ({ELITE_MONTHLY_TOTAL} pts/mo · {ELITE_ANNUAL_TOTAL.toLocaleString()} pts/yr · 50% off Repository &amp; Apps) · Platform fee: {PLAN_PLATFORM_FEE} pts (Plans), {APP_PLATFORM_FEE} pts (Apps), {REPO_PLATFORM_FEE} pts (Repository).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="asan-card-hover flex items-center gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2">
            <Coins className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <div className="text-xs">
              <span className="text-slate-500 dark:text-slate-400">Balance: </span>
              <strong className="font-display text-base text-slate-900 dark:text-white tabular-nums">
                {isInfinite ? '∞ pts' : `${points.toLocaleString()} pts`}
              </strong>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setOverlapPendingPurchase(null);
              setUpgradeModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-900 dark:bg-cyan-500 px-4 py-2.5 text-xs font-bold text-white dark:text-slate-950 hover:bg-blue-800 dark:hover:bg-cyan-400 whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-4 w-4" />
            Upgrade Plan
          </button>
        </div>
      </div>

      {/* 3-Day Renewal Reminder */}
      {((isElite && eliteDaysLeft !== null && eliteDaysLeft <= 3) ||
        (isPro && proDaysLeft !== null && proDaysLeft <= 3)) && (
        <div className="asan-card-hover rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <div>
              <strong>Renewal Reminder:</strong> Your {isElite ? 'Elite' : 'Pro'} plan expires in{' '}
              <strong>{isElite ? eliteDaysLeft : proDaysLeft} day(s)</strong>. Renew in Upgrade Plan or Extend inside View Details.
            </div>
          </div>
          <a
            href={buildGmailConfirmationUrl({
              recipientEmail: dbUser?.email || '',
              subject: `ASAN-Study_tool ${isElite ? 'Elite' : 'Pro'} Renewal Reminder`,
              body: `Reminder: Your ASAN-Study_tool ${isElite ? 'Elite' : 'Pro'} plan expires soon. Open Subscriptions and Plans to extend.`,
            })}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100"
          >
            Open Gmail Reminder
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {statusMsg && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {overlapPendingPurchase && !upgradeModalOpen && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-3">
          <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            Active Pro Plan Detected — Elite Already Includes All Pro Features
          </div>
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Choose whether to keep your existing Pro tenure alongside Elite or cancel Pro immediately before activating Elite:
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                overlapPendingPurchase.kind === 'key' && overlapPendingPurchase.keyCode
                  ? void submitRedeemKey(overlapPendingPurchase.keyCode, 'keep')
                  : void handlePurchasePlan('elite', 'keep')
              }
              className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              Keep Pro Alongside Elite
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                overlapPendingPurchase.kind === 'key' && overlapPendingPurchase.keyCode
                  ? void submitRedeemKey(overlapPendingPurchase.keyCode, 'cancel')
                  : void handlePurchasePlan('elite', 'cancel')
              }
              className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/60 px-3.5 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 disabled:opacity-60"
            >
              Cancel Pro &amp; Activate Elite
            </button>
          </div>
        </div>
      )}

      {lastPurchasedKey && (
        <div className="asan-card-hover rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-blue-900 dark:text-blue-200 space-y-1">
            <div className="font-semibold">
              {lastPurchasedKey.keyType === 'elite' ? '12-Char Elite' : '8-Char Pro'} Key Ready:{' '}
              <span className="font-mono text-sm tracking-wider">{lastPurchasedKey.keyCode}</span>
            </div>
            <div>
              Sent to Tool Mail for {lastPurchasedKey.recipientEmail} · Use before{' '}
              {lastPurchasedKey.activationExpiresAt.slice(0, 10)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(lastPurchasedKey.keyCode)}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy Key
            </button>
            <a
              href={buildGmailLicenseComposeUrl({
                keyCode: lastPurchasedKey.keyCode,
                keyType: lastPurchasedKey.keyType,
                recipientEmail: lastPurchasedKey.recipientEmail,
                activationExpiresAt: lastPurchasedKey.activationExpiresAt,
              })}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Send via Gmail
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* Active Tier Summary Strip */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div
          className={`rounded-xl border p-5 asan-card-hover ${
            isElite
              ? `${visualEffectsOn ? 'asan-elite-card' : ''} border-blue-900/50 dark:border-cyan-400/50 bg-white dark:bg-slate-900`
              : isPro
                ? 'asan-pro-card border-indigo-200 dark:border-indigo-800/70'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Plan</span>
            {isElite && (
              <span className="asan-elite-badge rounded px-1.5 py-0.5 text-[9px] font-bold">ELITE</span>
            )}
            {isPro && <span className="asan-pro-badge rounded px-1.5 py-0.5 text-[9px]">PRO</span>}
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 dark:text-white uppercase">
            {effectivePlan}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {isElite || isPro
              ? 'Active paid plans cannot pause; cancel anytime via View Details'
              : 'Free on login · Upgrade to Pro or Elite'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 asan-card-hover">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Elite Window</div>
          <div className="mt-2 font-display text-lg font-bold text-slate-900 dark:text-white tabular-nums">
            {dbUser?.eliteExpiresAt ? dbUser.eliteExpiresAt.slice(0, 10) : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {eliteDaysLeft !== null
              ? `${eliteDaysLeft} day(s) remaining · 50% off Repo & Apps`
              : '750 pts/mo · 8,000 pts/yr (12-char key)'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 asan-card-hover">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Pro Window</div>
          <div className="mt-2 font-display text-lg font-bold text-slate-900 dark:text-white tabular-nums">
            {dbUser?.proExpiresAt ? dbUser.proExpiresAt.slice(0, 10) : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {proDaysLeft !== null
              ? `${proDaysLeft} day(s) left${dbUser?.activeProGifted ? ' · Admin Gift (No Refund)' : ''}`
              : '500 pts/mo · 5,250 pts/yr (8-char key)'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 asan-card-hover">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Account Discounts</div>
          <div className="mt-2 font-display text-lg font-bold text-slate-900 dark:text-white tabular-nums">
            {isElite ? '50% OFF' : dbUser?.role === 'admin' || dbUser?.role === 'super' ? '5% OFF' : '0%'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Applies to Repo &amp; Apps (not Plan upgrades)
          </div>
        </div>
      </div>

      {/* License Key Redemption & Key Purchase */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <form
          onSubmit={handleRedeemKey}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 asan-card-hover"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <KeyRound className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            Redeem 8-Char Pro or 12-Char Elite License Key
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Single-use activation keys mailed via Tool Mail or gifted by Admin/Super activate immediately and cannot be reused by another user.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              maxLength={12}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
              placeholder="Enter 8 or 12-char key"
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 font-mono text-xs uppercase tracking-wider text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !keyInput.trim()}
              className="rounded-lg bg-slate-900 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              Activate Key
            </button>
          </div>
        </form>

        <form
          onSubmit={handlePurchaseLicenseKey}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 asan-card-hover"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <FlaskConical className="h-4 w-4 text-blue-600 dark:text-cyan-400" />
              Buy Pro (8-Char) or Elite (12-Char) License Key
            </div>
            <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums">
              {giftQuote.finalCost.toLocaleString()} pts
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={giftTier}
              onChange={(e) => setGiftTier(e.target.value === 'elite' ? 'elite' : 'pro')}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            >
              <option value="pro">Pro Key (8-char)</option>
              <option value="elite">Elite Key (12-char)</option>
            </select>
            <select
              value={giftTerm}
              onChange={(e) => setGiftTerm(e.target.value === 'annual' ? 'annual' : 'monthly')}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            >
              <option value="monthly">Monthly ({giftTier === 'elite' ? ELITE_MONTHLY_TOTAL : PRO_MONTHLY_TOTAL} pts)</option>
              <option value="annual">Annual 11+1 ({giftTier === 'elite' ? ELITE_ANNUAL_TOTAL : PRO_ANNUAL_TOTAL} pts)</option>
            </select>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={giftRecipient}
              onChange={(e) => setGiftRecipient(e.target.value)}
              placeholder={`Recipient email/UID (default: ${dbUser?.email || 'you'})`}
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
            />
            <input
              type="text"
              value={giftCoupon}
              onChange={(e) => setGiftCoupon(e.target.value.toUpperCase())}
              placeholder="Coupon (optional)"
              className="sm:w-36 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 font-mono text-xs uppercase"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              Buy Key
            </button>
          </div>
        </form>
      </div>

      {/* Table 1: Pro & Elite Plans */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-3.5 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Pro &amp; Elite Plans
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              All point purchases, Admin-gifted 8-char Pro keys (No Refund), and 8/12-char license keys with start, expiry, and use-before windows.
            </p>
          </div>
          <span className="text-xs font-medium text-slate-400 tabular-nums">{planRows.length} items</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5">Plan / Item</th>
                <th className="px-4 py-2.5">Key</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Use Before</th>
                <th className="px-4 py-2.5">Start</th>
                <th className="px-4 py-2.5">End</th>
                <th className="px-4 py-2.5 text-right">Paid</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                    Loading plans...
                  </td>
                </tr>
              ) : planRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                    No Pro or Elite plan records or license keys yet. Click Upgrade Plan above to begin.
                  </td>
                </tr>
              ) : (
                planRows.map((row) => (
                  <tr key={row.rowId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      <span
                        className={`mr-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                          row.tier === 'elite' ? 'asan-elite-badge' : 'asan-pro-badge'
                        }`}
                      >
                        {row.tier}
                      </span>
                      {row.title}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                      {row.keyCode}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.sourceLabel}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          row.status === 'active'
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            : row.status === 'new'
                              ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                              : row.status === 'cancelled'
                                ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] tabular-nums">{row.useBefore}</td>
                    <td className="px-4 py-3 font-mono text-[11px] tabular-nums">
                      {row.startsAt ? row.startsAt.slice(0, 10) : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] tabular-nums">
                      {row.expiresAt ? row.expiresAt.slice(0, 10) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                      {row.noRefund && row.cost === 0 ? 'Gift (0)' : `${row.cost} pts`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenDetails(row.target)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
                      >
                        <Eye className="h-3 w-3" />
                        View Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Table 2: Repository & Apps' Subscriptions */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-3.5 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Repository &amp; Apps&apos; Subscriptions
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Metered Apps (+{APP_PLATFORM_FEE} pt fee) and Study Material Repository rentals/purchases (+{REPO_PLATFORM_FEE} pt fee). Elite gets 50% off; Admins/Super get 5% off.
            </p>
          </div>
          <span className="text-xs font-medium text-slate-400 tabular-nums">{repoAndAppRows.length} items</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Item</th>
                <th className="px-4 py-2.5">Billing / Mode</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Start</th>
                <th className="px-4 py-2.5">End</th>
                <th className="px-4 py-2.5 text-right">Paid</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    Loading subscriptions...
                  </td>
                </tr>
              ) : repoAndAppRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    No Repository rentals/purchases or Metered App subscriptions yet.
                  </td>
                </tr>
              ) : (
                repoAndAppRows.map((row) => (
                  <tr key={row.rowId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-blue-700 dark:text-cyan-400">{row.category}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">{row.title}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.mode}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          row.status === 'active'
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            : row.status === 'cancelled'
                              ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] tabular-nums">
                      {row.startsAt ? row.startsAt.slice(0, 10) : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] tabular-nums">
                      {row.expiresAt ? row.expiresAt.slice(0, 10) : 'Lifetime'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                      {row.cost} pts
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenDetails(row.target)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
                      >
                        <Eye className="h-3 w-3" />
                        View Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Refund Requests & Ledger */}
      {refundRequests.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Plan Cancellation &amp; Refund Requests
          </h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {refundRequests.slice(0, 8).map((r) => (
              <div key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 uppercase">
                    {r.planTerm}
                  </span>{' '}
                  · Paid {r.pointsPaid} pts · Requested {r.requestedRefundPoints} pts
                  {r.adminNote && <span className="text-slate-500"> · Note: {r.adminNote}</span>}
                </div>
                <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase">
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Email & Password Login Setup */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Account Password Login ({authMode === 'password' ? 'Signed in via Password' : 'Google Session'})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Set or update an account password to sign in directly without Google OAuth.
            </p>
          </div>
          {dbUser?.hasPassword && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Password Configured
            </span>
          )}
        </div>
        <form onSubmit={handleSavePassword} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 6 chars)"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
          />
          <button
            type="submit"
            disabled={savingPwd}
            className="rounded-lg bg-slate-900 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-60"
          >
            {savingPwd ? 'Saving...' : 'Save Account Password'}
          </button>
        </form>
      </div>

      {/* Recent Point Transactions */}
      {transactions.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2.5">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Recent Point Ledger
          </h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {transactions.slice(0, 10).map((t) => (
              <div key={t.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800 dark:text-slate-200">{t.reason}</div>
                  <div className="text-[11px] text-slate-400">{formatDateTime(t.createdAt)}</div>
                </div>
                <span
                  className={`font-mono font-bold tabular-nums shrink-0 ${
                    t.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {t.amount >= 0 ? `+${t.amount}` : t.amount} pts
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upgrade Plan Modal (ONLY Basic, Pro, Elite — NO Free Tier) */}
      {upgradeModalOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto">
          <div className="w-full max-w-5xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-5 my-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                  Upgrade Plan · Basic vs Pro vs Elite
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Annual plans bill 11 months + 1 month free + flat {PLAN_PLATFORM_FEE} pt non-refundable platform fee. Elite is attained strictly via points or 12-char Elite keys.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUpgradeModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Billing Cycle + Super Coupon Row */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3.5">
              <div className="flex items-center gap-1.5">
                {(['monthly', 'annual'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setUpgradeTerm(t);
                      setUpgradeValidatedCoupon(null);
                    }}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold capitalize ${
                      upgradeTerm === t
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {t === 'annual' ? 'Annual (11 + 1 Free)' : 'Monthly (1 Month)'}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Tag className="h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={upgradeCouponInput}
                  onChange={(e) => {
                    setUpgradeCouponInput(e.target.value.toUpperCase());
                    setUpgradeValidatedCoupon(null);
                  }}
                  placeholder="Super Coupon Code"
                  className="w-40 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-mono text-xs uppercase"
                />
                <button
                  type="button"
                  disabled={busy || !upgradeCouponInput.trim()}
                  onClick={() => void handleValidateUpgradeCoupon('pro')}
                  className="rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 disabled:opacity-50"
                >
                  Apply to Pro
                </button>
                <button
                  type="button"
                  disabled={busy || !upgradeCouponInput.trim()}
                  onClick={() => void handleValidateUpgradeCoupon('elite')}
                  className="rounded-lg border border-cyan-300 dark:border-cyan-700 bg-cyan-50 dark:bg-cyan-950/60 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-800 dark:text-cyan-300 disabled:opacity-50"
                >
                  Apply to Elite
                </button>
              </div>
            </div>

            {upgradeCouponMsg && (
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-3.5 py-2 text-xs text-blue-800 dark:text-blue-200">
                {upgradeCouponMsg}
              </div>
            )}

            {overlapPendingPurchase && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 p-4 space-y-2.5">
                <div className="text-xs font-bold text-amber-900 dark:text-amber-200">
                  Active Pro Membership Detected — Choose Overlap Preference
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Elite already includes all Pro benefits. Keep Pro (resumes after Elite) or cancel Pro now?
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handlePurchasePlan('elite', 'keep')}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Keep Pro &amp; Activate Elite
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handlePurchasePlan('elite', 'cancel')}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Cancel Pro &amp; Activate Elite
                  </button>
                </div>
              </div>
            )}

            {/* Basic / Pro / Elite 3-Card Comparison */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {/* Basic */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">Basic</h3>
                    {effectivePlan === 'basic' && (
                      <span className="text-[11px] font-semibold text-blue-600">Current</span>
                    )}
                  </div>
                  <div className="font-display text-xl font-bold tabular-nums">Free on Login</div>
                  <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" /> Unlimited notes, tasks &amp; Study Forum</li>
                    <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" /> Metered Formula Calc (30 pts/hr + 8 fee)</li>
                    <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" /> Study Repository (+3 pt platform fee)</li>
                  </ul>
                </div>
                <button
                  type="button"
                  disabled
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 py-2 text-xs font-semibold text-slate-500"
                >
                  {effectivePlan === 'basic' ? 'Current Plan' : 'Included Base'}
                </button>
              </div>

              {/* Pro */}
              <div className="asan-pro-card rounded-xl border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">Pro</h3>
                      <span className="asan-pro-badge rounded px-1.5 py-0.5 text-[9px]">PRO</span>
                    </div>
                    {isPro && <span className="text-[11px] font-semibold text-indigo-600">Active</span>}
                  </div>
                  <div>
                    <div className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                      {proQuote.finalCost.toLocaleString()} pts
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      {upgradeTerm === 'annual' ? `${PRO_MONTHLY_BASE}×11` : PRO_MONTHLY_BASE} + {PLAN_PLATFORM_FEE} fee
                      {proQuote.couponDiscount > 0 ? ` − ${proQuote.couponDiscount} coupon` : ''}
                    </div>
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-indigo-600 shrink-0 mt-0.5" /> Unlimited Formula Calc &amp; Lite STEM Solvers</li>
                    <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-indigo-600 shrink-0 mt-0.5" /> PDF Booklet Studio &amp; Google Workspace</li>
                    <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-indigo-600 shrink-0 mt-0.5" /> Study Time Logger &amp; 8-Char License Keys</li>
                  </ul>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePurchasePlan('pro')}
                  className="w-full rounded-lg bg-indigo-600 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {isPro ? 'Extend Pro' : 'Activate Pro'} ({proQuote.finalCost.toLocaleString()} pts)
                </button>
              </div>

              {/* Elite */}
              <div
                className={`${visualEffectsOn ? 'asan-elite-card' : ''} rounded-xl border border-blue-900/60 dark:border-cyan-400/60 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">Elite</h3>
                      <span className="asan-elite-badge rounded px-1.5 py-0.5 text-[9px] font-bold">ELITE</span>
                    </div>
                    {isElite && <span className="text-[11px] font-semibold text-cyan-500">Active</span>}
                  </div>
                  <div>
                    <div className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                      {eliteQuote.finalCost.toLocaleString()} pts
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      {upgradeTerm === 'annual' ? `${ELITE_MONTHLY_BASE}×11` : ELITE_MONTHLY_BASE} + {PLAN_PLATFORM_FEE} fee
                      {eliteQuote.couponDiscount > 0 ? ` − ${eliteQuote.couponDiscount} coupon` : ''}
                    </div>
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-cyan-500 shrink-0 mt-0.5" /> Everything in Pro + 12-Char Elite Access</li>
                    <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-cyan-500 shrink-0 mt-0.5" /> <strong>Virtual Laboratories &amp; 3D Motion Visualizer</strong></li>
                    <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-cyan-500 shrink-0 mt-0.5" /> <strong>50% Off</strong> All Repository &amp; Metered Apps</li>
                    <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-cyan-500 shrink-0 mt-0.5" /> Animated Navy/Aqua Borders &amp; Avatar Shine</li>
                  </ul>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void handlePurchasePlan(
                      'elite',
                      hasActiveProTenure && !isElite ? undefined : 'keep'
                    )
                  }
                  className="w-full rounded-lg bg-blue-900 dark:bg-cyan-500 py-2.5 text-xs font-bold text-white dark:text-slate-950 hover:bg-blue-800 dark:hover:bg-cyan-400 disabled:opacity-60"
                >
                  {isElite ? 'Extend Elite' : 'Activate Elite'} ({eliteQuote.finalCost.toLocaleString()} pts)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Details Modal (Purchase Cost, Current Amount w/ Discount+Fee, Tenure, Cancel & Extend) */}
      {detailTarget && detailMeta && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-5 my-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 dark:text-cyan-400">
                  Subscription &amp; Purchase Details
                </div>
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  {detailMeta.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDetailTarget(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4 text-xs">
              <div>
                <div className="text-slate-400">Status</div>
                <div className="font-bold uppercase text-slate-900 dark:text-white">{detailMeta.status}</div>
              </div>
              <div>
                <div className="text-slate-400">Original Purchase Cost</div>
                <div className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                  {detailMeta.isNoRefund && detailMeta.originalCost === 0
                    ? 'Admin Gift (0 pts · No Refund)'
                    : `${detailMeta.originalCost} pts (incl. ${detailMeta.platformFee} fee)`}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Tenure Start</div>
                <div className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                  {formatDateTime(detailMeta.startsAt)}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Tenure End</div>
                <div className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                  {detailMeta.expiresAt ? formatDateTime(detailMeta.expiresAt) : 'Lifetime / Until Used'}
                </div>
              </div>
              {detailMeta.keyCode && (
                <>
                  <div>
                    <div className="text-slate-400">Activation Key</div>
                    <div className="font-mono font-bold tracking-wider text-blue-700 dark:text-cyan-300">
                      {detailMeta.keyCode}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Use Before / Activated At</div>
                    <div className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                      {detailMeta.useBefore ? detailMeta.useBefore.slice(0, 10) : '—'} ·{' '}
                      {detailMeta.activatedAt ? detailMeta.activatedAt.slice(0, 10) : 'Not activated'}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Current Purchase Amount Breakdown */}
            <div className="rounded-xl border border-blue-200 dark:border-cyan-900/60 bg-blue-50/60 dark:bg-cyan-950/20 p-4 space-y-2 text-xs">
              <div className="font-semibold text-slate-900 dark:text-white">
                Current Renewal / Re-Purchase Quote
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 tabular-nums">
                <span className="text-slate-600 dark:text-slate-300">
                  Base: {detailMeta.currentQuote.baseSubtotal} pts · Platform Fee: +{detailMeta.currentQuote.platformFee} pts
                  {detailMeta.currentQuote.tierDiscountPercent > 0 &&
                    ` · ${detailMeta.currentQuote.tierDiscountPercent}% ${isElite ? 'Elite' : 'Admin'} Off (−${detailMeta.currentQuote.tierDiscountAmount})`}
                  {detailMeta.currentQuote.couponDiscount > 0 &&
                    ` · Coupon −${detailMeta.currentQuote.couponDiscount}`}
                </span>
                <strong className="font-mono text-sm text-blue-800 dark:text-cyan-300">
                  {detailMeta.currentQuote.finalCost.toLocaleString()} pts
                </strong>
              </div>
            </div>

            {/* Extend Section */}
            {detailMeta.canExtend && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 text-xs">
                <div className="font-semibold text-slate-900 dark:text-white">
                  Extend / Add Tenure
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {detailMeta.kind === 'plan' || detailMeta.kind === 'key' ? (
                    <select
                      value={detailExtendTerm}
                      onChange={(e) =>
                        setDetailExtendTerm(e.target.value === 'annual' ? 'annual' : 'monthly')
                      }
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
                    >
                      <option value="monthly">Add 1 Month</option>
                      <option value="annual">Add 1 Year (11+1)</option>
                    </select>
                  ) : (
                    <select
                      value={detailExtendUnits}
                      onChange={(e) => setDetailExtendUnits(Number(e.target.value))}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
                    >
                      <option value={1}>
                        {detailMeta.kind === 'app' ? '+1 Quarter (15 min)' : '+1 Hour'}
                      </option>
                      <option value={2}>
                        {detailMeta.kind === 'app' ? '+2 Quarters (30 min)' : '+2 Hours'}
                      </option>
                      <option value={4}>
                        {detailMeta.kind === 'app' ? '+4 Quarters (1 hr)' : '+4 Hours'}
                      </option>
                    </select>
                  )}
                  <input
                    type="text"
                    value={detailCouponInput}
                    onChange={(e) => {
                      setDetailCouponInput(e.target.value.toUpperCase());
                      setDetailValidatedCoupon(null);
                    }}
                    placeholder="Coupon Code"
                    className="w-36 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 font-mono text-xs uppercase"
                  />
                  <button
                    type="button"
                    disabled={busy || !detailCouponInput.trim()}
                    onClick={() => void handleValidateDetailCoupon()}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Apply Coupon
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleExtendDetail()}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    Extend ({detailMeta.currentQuote.finalCost.toLocaleString()} pts)
                  </button>
                </div>
              </div>
            )}

            {/* Cancel Section */}
            {detailMeta.canCancel && (
              <div className="rounded-xl border border-red-200 dark:border-red-900/70 bg-red-50/50 dark:bg-red-950/20 p-4 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-red-800 dark:text-red-300">
                    Willing Cancellation (Paid plans cannot pause)
                  </span>
                  <span className="font-mono font-bold text-red-700 dark:text-red-300 tabular-nums">
                    {detailMeta.isNoRefund
                      ? '0 pts · No Refund (Admin Gift)'
                      : `Est. Refund: ${detailMeta.refundPreview.requestedRefundPoints} pts`}
                  </span>
                </div>
                {(detailMeta.kind === 'plan' || detailMeta.kind === 'key') && !detailMeta.isNoRefund && (
                  <div className="flex flex-wrap gap-2">
                    {(['timed', 'non_timed'] as const).map((pt) => (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => setDetailCancelType(pt)}
                        className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                          detailCancelType === pt
                            ? 'border-red-500 bg-white dark:bg-slate-900 text-red-700 dark:text-red-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {pt === 'timed' ? 'Time-Dependent (Remaining% − 5%)' : 'Non-Timed (Flat 60%)'}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={detailCancelReason}
                    onChange={(e) => setDetailCancelReason(e.target.value)}
                    placeholder="Reason for cancellation (optional)"
                    className="flex-1 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmCancelOpen(true)}
                    className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    Cancel Subscription
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmCancelOpen}
        title="Confirm Subscription Cancellation?"
        description={
          detailMeta?.isNoRefund
            ? 'This Admin-gifted Pro key carries a No Refund policy (0 points refunded) and ends immediately upon cancellation.'
            : `This will cancel "${detailMeta?.title || 'subscription'}" immediately. Estimated refund: ${detailMeta?.refundPreview.requestedRefundPoints ?? 0} pts (platform fees are non-refundable).`
        }
        confirmLabel="Confirm Cancel"
        busy={busy}
        onConfirm={() => void handleConfirmCancelDetail()}
        onCancel={() => setConfirmCancelOpen(false)}
      />
    </div>
  );
};
