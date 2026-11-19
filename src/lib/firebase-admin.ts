import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

try {
  if (!getApps().length) {
    initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }
} catch (err) {
  console.warn('Firebase Admin init warning (REST fallback active):', err instanceof Error ? err.message : err);
}

export const adminAuth = getAuth();

