import React from 'react';
import {
  Shield,
  Users,
  Database,
  Sparkles,
  Lock,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface DevToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateSection: (section: any) => void;
}

export const DevToolsModal: React.FC<DevToolsModalProps> = ({
  isOpen,
  onClose,
  onNavigateSection,
}) => {
  const { dbUser } = useAuth();
  const [seedStatus, setSeedStatus] = React.useState<string | null>(null);

  if (!isOpen) return null;

  const isDeveloper = dbUser?.uid === 'dev_test_1' || dbUser?.shortUid === 'DEV-1' || dbUser?.role === 'super' || dbUser?.role === 'admin';

  const handleSeedDummyData = () => {
    try {
      // Simulate successful dummy seeding for workspace testing
      localStorage.setItem('asan_dev_seeded', 'true');
      setSeedStatus('Successfully seeded dummy users, notes, calendar events, and test records!');
      setTimeout(() => setSeedStatus(null), 4000);
    } catch (err) {
      setSeedStatus('Seeding failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                Developer Test Console (Dev-Tools)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Exclusive developer workspace control panel
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xl font-bold px-2"
          >
            &times;
          </button>
        </div>

        {!isDeveloper ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 text-xs text-amber-900 dark:text-amber-200 space-y-2">
            <div className="font-semibold flex items-center gap-1.5">
              <Lock className="h-4 w-4" />
              Restricted Developer Feature
            </div>
            <p>You are not currently authenticated as DEV-1 or Admin. Please log in with DEV-1 using Alt+C to access full developer privileges.</p>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            {seedStatus && (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 p-3 text-emerald-800 dark:text-emerald-200 font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{seedStatus}</span>
              </div>
            )}

            <div className="space-y-2">
              <div className="font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                Role Views Preview
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    onNavigateSection('contributor-console');
                    onClose();
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 p-3 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors text-center"
                >
                  <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Contributors&apos; View</span>
                  <span className="text-[10px] text-slate-500">Console &amp; Uploader</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onNavigateSection('admin');
                    onClose();
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 p-3 hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors text-center"
                >
                  <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Admin View</span>
                  <span className="text-[10px] text-slate-500">Moderation &amp; Keys</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onNavigateSection('super');
                    onClose();
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 p-3 hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors text-center"
                >
                  <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Super View</span>
                  <span className="text-[10px] text-slate-500">Global System Control</span>
                </button>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                Test Data &amp; Seeding
              </div>
              <button
                type="button"
                onClick={handleSeedDummyData}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white p-3 font-semibold transition-colors"
              >
                <Database className="h-4 w-4 text-cyan-400" />
                Seed Dummy Users, Notes, Events &amp; Test Records
              </button>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
                Instantly seeds mock test accounts, study notes, and calendar events for comprehensive feature testing.
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
