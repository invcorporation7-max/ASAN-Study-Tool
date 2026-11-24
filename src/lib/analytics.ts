import { apiUrl, isExpressBackendAvailable } from './api';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __asanGa4Id?: string;
  }
}

let initializedMeasurementId: string | null =
  typeof window !== 'undefined' &&
  typeof window.__asanGa4Id === 'string' &&
  /^G-[A-Z0-9]+$/i.test(window.__asanGa4Id)
    ? window.__asanGa4Id
    : null;
let initPromise: Promise<string | null> | null = null;

function ensureGtagStub(): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    // Google's gtag.js requires Arguments objects pushed to dataLayer (never plain arrays)
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer?.push(arguments);
    };
  }
}

function injectGtagScript(measurementId: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!/^G-[A-Z0-9]+$/i.test(measurementId)) return;

  ensureGtagStub();

  const alreadyConfiguredBySsr = window.__asanGa4Id === measurementId;
  const existingScript =
    document.querySelector(`script[data-ga4="${measurementId}"]`) ||
    document.querySelector('script[src*="googletagmanager.com/gtag/js"]');

  if (!existingScript) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.setAttribute('data-ga4', measurementId);
    document.head.appendChild(script);
  }

  if (!alreadyConfiguredBySsr && initializedMeasurementId !== measurementId && window.gtag) {
    window.gtag('js', new Date());
    window.gtag('config', measurementId, { send_page_view: false });
    window.__asanGa4Id = measurementId;
  }
  initializedMeasurementId = measurementId;
}

export async function initGoogleAnalytics(): Promise<string | null> {
  if (initializedMeasurementId) return initializedMeasurementId;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (
      typeof window !== 'undefined' &&
      typeof window.__asanGa4Id === 'string' &&
      /^G-[A-Z0-9]+$/i.test(window.__asanGa4Id)
    ) {
      injectGtagScript(window.__asanGa4Id);
      return window.__asanGa4Id;
    }

    try {
      const hasBackend = await isExpressBackendAvailable();
      if (hasBackend) {
        const res = await fetch(apiUrl('/api/analytics/config'));
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as { measurementId?: string } | null;
          const serverId = data?.measurementId?.trim();
          if (serverId && /^G-[A-Z0-9]+$/i.test(serverId)) {
            injectGtagScript(serverId);
            return serverId;
          }
        }
      }
    } catch {
      // ignore GA4 config probe failure
    }

    const buildId = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined)?.trim();
    if (buildId && /^G-[A-Z0-9]+$/i.test(buildId)) {
      injectGtagScript(buildId);
      return buildId;
    }
    return null;
  })();

  return initPromise;
}

export function trackGa4PageView(section: string, title?: string): void {
  if (typeof window === 'undefined' || !initializedMeasurementId) return;
  ensureGtagStub();
  try {
    window.gtag?.('event', 'page_view', {
      page_title: title || `ASAN-Study_tool — ${section}`,
      page_path: `/${section}`,
      page_location: `${window.location.origin}/${section}`,
    });
  } catch {
    // ignore
  }
}

export function trackGa4Event(
  eventName: string,
  params?: Record<string, string | number | boolean>
): void {
  if (typeof window === 'undefined' || !initializedMeasurementId) return;
  ensureGtagStub();
  try {
    window.gtag?.('event', eventName, params || {});
  } catch {
    // ignore
  }
}
