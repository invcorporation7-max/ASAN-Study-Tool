import { apiUrl, isExpressBackendAvailable } from './api';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let initializedMeasurementId: string | null = null;
let initPromise: Promise<string | null> | null = null;

function injectGtagScript(measurementId: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!/^G-[A-Z0-9]+$/i.test(measurementId)) return;
  if (initializedMeasurementId === measurementId) return;

  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer?.push(args);
    };
  }

  const existingScript = document.querySelector(`script[data-ga4="${measurementId}"]`);
  if (!existingScript) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.setAttribute('data-ga4', measurementId);
    document.head.appendChild(script);
  }

  window.gtag('js', new Date());
  window.gtag('config', measurementId, { send_page_view: false });
  initializedMeasurementId = measurementId;
}

export async function initGoogleAnalytics(): Promise<string | null> {
  if (initializedMeasurementId) return initializedMeasurementId;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const buildId = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined)?.trim();
    if (buildId && /^G-[A-Z0-9]+$/i.test(buildId)) {
      injectGtagScript(buildId);
      return buildId;
    }

    try {
      const hasBackend = await isExpressBackendAvailable();
      if (!hasBackend) return null;
      const res = await fetch(apiUrl('/api/analytics/config'));
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as { measurementId?: string } | null;
      const serverId = data?.measurementId?.trim();
      if (serverId && /^G-[A-Z0-9]+$/i.test(serverId)) {
        injectGtagScript(serverId);
        return serverId;
      }
    } catch {
      // ignore GA4 config probe failure
    }
    return null;
  })();

  return initPromise;
}

export function trackGa4PageView(section: string, title?: string): void {
  if (typeof window === 'undefined' || !window.gtag || !initializedMeasurementId) return;
  try {
    window.gtag('event', 'page_view', {
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
  if (typeof window === 'undefined' || !window.gtag || !initializedMeasurementId) return;
  try {
    window.gtag('event', eventName, params || {});
  } catch {
    // ignore
  }
}
