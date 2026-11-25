import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

try {
  if (!getApps().length) {
    const projectId =
      process.env.FIREBASE_PROJECT_ID?.trim() ||
      process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
      firebaseConfig.projectId;
    initializeApp({
      projectId,
    });
  }
} catch (err) {
  console.warn('Firebase Admin init warning (REST fallback active):', err instanceof Error ? err.message : err);
}

export const adminAuth = getAuth();

