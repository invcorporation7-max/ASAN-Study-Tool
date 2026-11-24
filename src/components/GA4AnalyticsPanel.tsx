import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Clock,
  Eye,
  Globe,
  MonitorSmartphone,
  RefreshCw,
  Users,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { GA4ReportResponse } from '../types';

function formatDuration(sec: number): string {
  const clean = Math.max(0, Math.round(sec));
  const m = Math.floor(clean / 60);
  const s = clean % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export const GA4AnalyticsPanel: React.FC<{
  title?: string;
  subtitle?: string;
}> = ({
  title = 'Google Analytics (GA4) Live Reporting',
  subtitle = 'Real-time visitors, traffic trend, top study sections, devices, and countries from Google Analytics 4.',
}) => {
  const [range, setRange] = useState<'7d' | '28d' | '90d'>('28d');
  const [report, setReport] = useState<GA4ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGa4 = useCallback(
    async (selectedRange: '7d' | '28d' | '90d', forceRefresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<GA4ReportResponse>(
          `/api/admin/google-analytics?range=${selectedRange}${forceRefresh ? '&refresh=1' : ''}`
        );
        setReport(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load Google Analytics report');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadGa4(range, false);
  }, [loadGa4, range]);

  const maxDailyViews =
    report && report.daily.length > 0
      ? Math.max(1, ...report.daily.map((d) => d.pageViews || d.activeUsers || 1))
      : 1;

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5 asan-card-hover">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {title}
              </h2>
              {report?.configured ? (
                <span className="inline-flex items-center gap-1 rounded border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <Activity className="h-3 w-3" />
                  Live · Property {report.propertyId}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                  Setup Required
                </span>
              )}
              {report?.trackingConfigured && report.measurementId && (
                <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-700 dark:text-slate-300">
                  {report.measurementId}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-1 text-xs">
            {(['7d', '28d', '90d'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  range === r
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadGa4(range, true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !report ? (
        <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
          Fetching Google Analytics 4 metrics...
        </div>
      ) : report && !report.configured ? (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/35 p-4 space-y-2.5 text-xs text-amber-950 dark:text-amber-200">
          <div className="font-semibold">
            GA4 Data API Status: {report.reason || 'Not configured yet'}
          </div>
          <p className="text-amber-900 dark:text-amber-300">
            Tracking tag status:{' '}
            <strong>
              {report.trackingConfigured
                ? `Active (${report.measurementId})`
                : 'Not set — add GA4_MEASUREMENT_ID (e.g. G-XXXXXXXXXX)'}
            </strong>
            . To display live GA4 reports here on Admin &amp; Super pages, set these Environment Variables in Render:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[11px] font-mono text-amber-900 dark:text-amber-300">
            <li>GA4_MEASUREMENT_ID=G-XXXXXXXXXX (from GA4 Admin → Data Streams)</li>
            <li>GA4_PROPERTY_ID=123456789 (numeric Property ID from GA4 Admin → Property Settings)</li>
            <li>
              GA4_SERVICE_ACCOUNT_JSON=&#123;&quot;client_email&quot;:...&#125; (grant Viewer role in GA4 Property Access Management)
            </li>
          </ul>
        </div>
      ) : report ? (
        <div className="space-y-5">
          {report.overview.pageViews === 0 && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800/70 bg-blue-50/70 dark:bg-blue-950/35 px-4 py-2.5 text-xs text-blue-900 dark:text-blue-200">
              GA4 Data API is connected to Property <strong className="font-mono">{report.propertyId}</strong>
              {report.measurementId ? (
                <>
                  {' '}and tracking tag <strong className="font-mono">{report.measurementId}</strong> is active in page headers
                </>
              ) : null}
              . Standard GA4 reports update after initial visits process (check Realtime users above within ~30 seconds).
            </div>
          )}
          {/* KPI Strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 tabular-nums">
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/50 dark:bg-emerald-950/30 p-3.5">
              <div className="flex items-center justify-between text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                <span>Live Right Now</span>
                <Activity className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="mt-1 font-display text-xl font-bold text-emerald-950 dark:text-emerald-200">
                {report.realtimeActiveUsers}
              </div>
              <div className="text-[10px] text-emerald-700 dark:text-emerald-400">Last 30 min</div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50 p-3.5">
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <span>Active Users</span>
                <Users className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                {report.overview.activeUsers.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                {report.overview.newUsers.toLocaleString()} new
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50 p-3.5">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Sessions</div>
              <div className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                {report.overview.sessions.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                {report.overview.engagedSessions.toLocaleString()} engaged
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50 p-3.5">
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <span>Page Views</span>
                <Eye className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                {report.overview.pageViews.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Range: {report.range}</div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50 p-3.5">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Engagement Rate</div>
              <div className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                {report.overview.engagementRate}%
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Engaged sessions</div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50 p-3.5">
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <span>Avg. Duration</span>
                <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                {formatDuration(report.overview.avgSessionDurationSec)}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Per session</div>
            </div>
          </div>

          {/* Daily Traffic Bar Chart */}
          {report.daily.length > 0 && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Daily Page Views &amp; Active Users ({report.range})
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Updated {new Date(report.fetchedAt).toLocaleTimeString()}
                  {report.cached ? ' (cached)' : ''}
                </span>
              </div>
              <div className="flex items-end gap-1 h-28 pt-2 overflow-x-auto">
                {report.daily.map((d) => {
                  const pct = Math.max(6, Math.round((d.pageViews / maxDailyViews) * 100));
                  return (
                    <div
                      key={d.date}
                      title={`${d.date}: ${d.pageViews} views · ${d.activeUsers} active users · ${d.sessions} sessions`}
                      className="flex-1 min-w-[10px] flex flex-col items-center justify-end h-full group"
                    >
                      <div
                        className="w-full rounded-t bg-blue-600/85 dark:bg-blue-500/85 group-hover:bg-blue-700 dark:group-hover:bg-blue-400 transition-colors"
                        style={{ height: `${pct}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                <span>{report.daily[0]?.date}</span>
                <span>{report.daily[report.daily.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {/* Breakdowns: Top Pages, Devices, Countries */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">Top Study Pages</div>
              {report.topPages.length === 0 ? (
                <div className="text-xs text-slate-400 dark:text-slate-500">No page views recorded yet.</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs tabular-nums">
                  {report.topPages.slice(0, 6).map((p, idx) => (
                    <div key={`${p.path}-${idx}`} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="truncate font-mono text-[11px] text-slate-700 dark:text-slate-300" title={p.title}>
                        {p.path}
                      </span>
                      <span className="shrink-0 font-semibold text-slate-900 dark:text-slate-100">
                        {p.pageViews} views
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <MonitorSmartphone className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                Devices (Web / Mobile / PWA)
              </div>
              {report.devices.length === 0 ? (
                <div className="text-xs text-slate-400 dark:text-slate-500">No device data yet.</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs tabular-nums">
                  {report.devices.map((dev) => (
                    <div key={dev.device} className="flex items-center justify-between py-1.5">
                      <span className="capitalize text-slate-700 dark:text-slate-300">{dev.device}</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {dev.activeUsers} users · {dev.sessions} sess
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <Globe className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                Top Countries
              </div>
              {report.countries.length === 0 ? (
                <div className="text-xs text-slate-400 dark:text-slate-500">No country data yet.</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs tabular-nums">
                  {report.countries.slice(0, 6).map((c) => (
                    <div key={c.country} className="flex items-center justify-between py-1.5">
                      <span className="truncate text-slate-700 dark:text-slate-300">{c.country}</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{c.activeUsers} users</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
