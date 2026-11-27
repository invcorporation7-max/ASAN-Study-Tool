export const PRO_MONTHLY_BASE = 475;
export const ELITE_MONTHLY_BASE = 725;
export const PLAN_PLATFORM_FEE = 25;
export const APP_PLATFORM_FEE = 8;
export const REPO_PLATFORM_FEE = 3;

export const PRO_MONTHLY_TOTAL = PRO_MONTHLY_BASE + PLAN_PLATFORM_FEE; // 500
export const PRO_ANNUAL_TOTAL = PRO_MONTHLY_BASE * 11 + PLAN_PLATFORM_FEE; // 5250
export const ELITE_MONTHLY_TOTAL = ELITE_MONTHLY_BASE + PLAN_PLATFORM_FEE; // 750
export const ELITE_ANNUAL_TOTAL = ELITE_MONTHLY_BASE * 11 + PLAN_PLATFORM_FEE; // 8000

export const INFINITE_POINTS_SENTINEL = 999999999;

export type CouponScope =
  | 'all'
  | 'all_plans'
  | 'pro_plan'
  | 'elite_plan'
  | 'apps_metered'
  | 'all_repository'
  | 'repository_rent'
  | 'repository_buy';

export type PricingTargetScope =
  | 'pro_plan'
  | 'elite_plan'
  | 'apps_metered'
  | 'repository_rent'
  | 'repository_buy';

export interface CouponLike {
  id?: number;
  code: string;
  description?: string;
  scope: CouponScope | string;
  discountType: 'percent' | 'flat' | string;
  discountValue: number;
  maxUses?: number;
  usedCount?: number;
  expiresAt?: string;
  active?: boolean;
}

export interface PriceQuote {
  baseSubtotal: number;
  platformFee: number;
  tierDiscountPercent: number;
  tierDiscountAmount: number;
  couponDiscount: number;
  totalBeforeDiscount: number;
  finalCost: number;
  appliedCouponCode: string;
}

export function couponMatchesScope(
  couponScope: string,
  targetScope: PricingTargetScope
): boolean {
  const s = (couponScope || '').trim().toLowerCase();
  if (s === 'all') return true;
  if (s === 'all_plans') return targetScope === 'pro_plan' || targetScope === 'elite_plan';
  if (s === 'all_repository')
    return targetScope === 'repository_rent' || targetScope === 'repository_buy';
  return s === targetScope;
}

export function isCouponCurrentlyValid(
  coupon: CouponLike | null | undefined,
  targetScope: PricingTargetScope,
  nowMs = Date.now()
): { valid: boolean; reason?: string } {
  if (!coupon) return { valid: false, reason: 'Coupon not found.' };
  if (coupon.active === false) return { valid: false, reason: 'Coupon is inactive.' };
  if (coupon.expiresAt) {
    const expMs = new Date(coupon.expiresAt).getTime();
    if (Number.isFinite(expMs) && expMs <= nowMs) {
      return { valid: false, reason: 'Coupon has expired.' };
    }
  }
  const maxUses = Math.round(Number(coupon.maxUses || 0));
  const usedCount = Math.round(Number(coupon.usedCount || 0));
  if (maxUses > 0 && usedCount >= maxUses) {
    return { valid: false, reason: 'Coupon usage limit reached.' };
  }
  if (!couponMatchesScope(coupon.scope, targetScope)) {
    return { valid: false, reason: `Coupon does not apply to ${targetScope.replace('_', ' ')}.` };
  }
  return { valid: true };
}

export function getTierDiscountPercent(effectivePlan: string, role: string): number {
  if (effectivePlan === 'elite') return 50;
  if (role === 'admin' || role === 'super') return 5;
  return 0;
}

export function calculatePlanQuote(params: {
  tier: 'pro' | 'elite';
  term: 'monthly' | 'annual';
  coupon?: CouponLike | null;
}): PriceQuote {
  const isAnnual = params.term === 'annual';
  const monthlyBase = params.tier === 'elite' ? ELITE_MONTHLY_BASE : PRO_MONTHLY_BASE;
  const baseSubtotal = isAnnual ? monthlyBase * 11 : monthlyBase;
  const platformFee = PLAN_PLATFORM_FEE;
  const totalBeforeDiscount = baseSubtotal + platformFee;

  // No Elite 50% or Admin 5% discount on Pro or Elite subscriptions.
  // Only valid Super Console coupons can discount plan pricing.
  const targetScope: PricingTargetScope = params.tier === 'elite' ? 'elite_plan' : 'pro_plan';
  let couponDiscount = 0;
  let appliedCouponCode = '';

  if (params.coupon && isCouponCurrentlyValid(params.coupon, targetScope).valid) {
    appliedCouponCode = params.coupon.code.toUpperCase();
    const val = Math.max(0, Math.round(Number(params.coupon.discountValue) || 0));
    if (params.coupon.discountType === 'percent') {
      const pct = Math.max(0, Math.min(100, val));
      couponDiscount = Math.min(baseSubtotal, Math.round((baseSubtotal * pct) / 100));
    } else {
      couponDiscount = Math.min(totalBeforeDiscount, val);
    }
  }

  const finalCost = Math.max(0, Math.round(totalBeforeDiscount - couponDiscount));
  return {
    baseSubtotal,
    platformFee,
    tierDiscountPercent: 0,
    tierDiscountAmount: 0,
    couponDiscount,
    totalBeforeDiscount,
    finalCost,
    appliedCouponCode,
  };
}

export function calculateRepoOrAppQuote(params: {
  targetScope: 'apps_metered' | 'repository_rent' | 'repository_buy';
  baseSubtotal: number;
  effectivePlan: string;
  role: string;
  coupon?: CouponLike | null;
}): PriceQuote {
  const baseSubtotal = Math.max(0, Math.round(params.baseSubtotal || 0));
  const platformFee =
    params.targetScope === 'apps_metered' ? APP_PLATFORM_FEE : REPO_PLATFORM_FEE;
  const totalBeforeDiscount = baseSubtotal + platformFee;

  const tierDiscountPercent = getTierDiscountPercent(params.effectivePlan, params.role);
  const tierDiscountAmount =
    tierDiscountPercent > 0
      ? Math.min(baseSubtotal, Math.round((baseSubtotal * tierDiscountPercent) / 100))
      : 0;

  const afterTierBase = Math.max(0, baseSubtotal - tierDiscountAmount);
  let couponDiscount = 0;
  let appliedCouponCode = '';

  if (params.coupon && isCouponCurrentlyValid(params.coupon, params.targetScope).valid) {
    appliedCouponCode = params.coupon.code.toUpperCase();
    const val = Math.max(0, Math.round(Number(params.coupon.discountValue) || 0));
    if (params.coupon.discountType === 'percent') {
      const pct = Math.max(0, Math.min(100, val));
      couponDiscount = Math.min(afterTierBase, Math.round((afterTierBase * pct) / 100));
    } else {
      couponDiscount = Math.min(afterTierBase + platformFee, val);
    }
  }

  const finalCost = Math.max(
    0,
    Math.round(afterTierBase + platformFee - couponDiscount)
  );

  return {
    baseSubtotal,
    platformFee,
    tierDiscountPercent,
    tierDiscountAmount,
    couponDiscount,
    totalBeforeDiscount,
    finalCost,
    appliedCouponCode,
  };
}

export function calculateCancellationRefund(params: {
  pointsPaid: number;
  platformFee: number;
  noRefund?: boolean;
  startedAt: string;
  expiresAt: string;
  purchaseType?: 'timed' | 'non_timed';
}) {
  const pointsPaid = Math.max(0, Math.round(params.pointsPaid || 0));
  const platformFee = Math.max(0, Math.round(params.platformFee || 0));
  if (params.noRefund || pointsPaid <= 0) {
    return {
      refundBasis: params.noRefund ? ('no_refund_admin_gift' as const) : ('flat_60_percent' as const),
      planTerm: params.expiresAt ? 'monthly' : 'non_timed',
      pointsPaid,
      platformFeeExcluded: platformFee,
      refundableBase: 0,
      remainingPercent: 0,
      remainingDays: 0,
      totalDays: 0,
      requestedRefundPoints: 0,
    };
  }

  const refundableBase = Math.max(0, pointsPaid - platformFee);
  const nowMs = Date.now();
  const hasExpiry = Boolean(params.expiresAt && !Number.isNaN(new Date(params.expiresAt).getTime()));
  const isNonTimed = params.purchaseType === 'non_timed' || !hasExpiry;

  if (isNonTimed) {
    const requestedRefundPoints = Math.max(0, Math.round(refundableBase * 0.6));
    return {
      refundBasis: 'flat_60_percent' as const,
      planTerm: 'non_timed',
      pointsPaid,
      platformFeeExcluded: platformFee,
      refundableBase,
      remainingPercent: 100,
      remainingDays: 0,
      totalDays: 0,
      requestedRefundPoints,
    };
  }

  const endMs = new Date(params.expiresAt).getTime();
  const startMsRaw = params.startedAt ? new Date(params.startedAt).getTime() : NaN;
  const fallbackSpanMs = 30 * 24 * 60 * 60 * 1000;
  const startMs = Number.isFinite(startMsRaw) && startMsRaw < endMs ? startMsRaw : endMs - fallbackSpanMs;
  const totalMs = Math.max(60 * 1000, endMs - startMs);
  const remainingMs = Math.max(0, endMs - nowMs);
  const remainingFraction = Math.min(1, remainingMs / totalMs);
  const remainingPercent = Math.round(remainingFraction * 100);
  const refundableFraction = Math.max(0, remainingFraction - 0.05);
  const requestedRefundPoints = Math.max(0, Math.round(refundableBase * refundableFraction));
  const totalDays = Math.max(1, Math.round(totalMs / (24 * 60 * 60 * 1000)));
  const remainingDays = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  const planTerm = totalDays >= 180 ? 'annual' : 'monthly';

  return {
    refundBasis: 'time_remaining_minus_5' as const,
    planTerm,
    pointsPaid,
    platformFeeExcluded: platformFee,
    refundableBase,
    remainingPercent,
    remainingDays,
    totalDays,
    requestedRefundPoints,
  };
}
