const STUDY_KEYWORDS = [
  'study',
  'exam',
  'test',
  'mock',
  'revision',
  'revise',
  'lecture',
  'class',
  'lab',
  'assignment',
  'homework',
  'notes',
  'physics',
  'chemistry',
  'math',
  'maths',
  'biology',
  'calculus',
  'organic',
  'inorganic',
  'algebra',
  'geometry',
  'trigonometry',
  'syllabus',
  'chapter',
  'paper',
  'pyq',
  'jee',
  'neet',
  'cbse',
  'isc',
  'cuet',
  'practice',
  'quiz',
  'formula',
  'reading',
  'project',
  'thesis',
  'viva',
  'seminar',
  'coding',
  'tutorial',
  'workbook',
  'ncert',
  'mock test',
  'doubt',
];

const NON_STUDY_KEYWORDS = [
  'movie',
  'cinema',
  'party',
  'birthday',
  'dinner',
  'lunch',
  'shopping',
  'vacation',
  'trip',
  'holiday',
  'wedding',
  'gaming',
  'concert',
  'netflix',
  'picnic',
];

function isStudyRelatedEvent(
  title: string,
  category?: string,
  notes?: string
): boolean {
  const cat = (category || '').trim().toLowerCase();
  const combined = `${title} ${notes || ''}`.toLowerCase();
  const hasNonStudy = NON_STUDY_KEYWORDS.some((kw) => combined.includes(kw));
  const hasStudyKeyword = STUDY_KEYWORDS.some((kw) => combined.includes(kw));
  if (hasStudyKeyword) return true;
  if (hasNonStudy) return false;
  if (cat === 'study' || cat === 'exam' || cat === 'deadline') return true;
  return false;
}

const STORE_KEY = 'asan_inbuilt_server_store_v1';
const DB_NAME = 'asan_inbuilt_blobs_v1';
const BLOB_STORE = 'files';
const ADMIN_OWNER_EMAIL = 'invcorporation7@gmail.com';
const CONSTANT_ADMIN_LICENSE_KEY = 'ADM9ASAN';
const DEFAULT_WEEKLY_CONTRIB_PTS = 120;

interface InbuiltUser {
  id: number;
  uid: string;
  shortUid: string;
  email: string;
  displayName: string;
  username: string;
  photoUrl: string;
  plan: string;
  viewPlanMode: string;
  role: string;
  passwordHash: string;
  authMode: string;
  points: number;
  proStartedAt: string;
  proExpiresAt: string;
  lastExpiryReminderFor: string;
  contributorApproved: boolean;
  contributorRequested: boolean;
  adminAuthorized: boolean;
  adminFirstGiftClaimed: boolean;
  lastWeeklyGrantWeek: string;
  spectraUrl: string;
  driveFolderId: string;
  scheduleSheetId: string;
  createdAt: string;
  updatedAt: string;
}

interface InbuiltStore {
  seq: Record<string, number>;
  settings: {
    contributorWeeklyPoints: number;
  };
  users: InbuiltUser[];
  tasks: any[];
  calendarEvents: any[];
  notebooks: any[];
  notePages: any[];
  examSchedules: any[];
  studyLogs: any[];
  contactMessages: any[];
  userMessages: any[];
  licenseKeys: any[];
  pointTransactions: any[];
  notifications: any[];
  studyMaterials: any[];
  materialPurchases: any[];
  examBlueprints: any[];
  contributorFolders: any[];
  contributorFiles: any[];
}

function emptyStore(): InbuiltStore {
  return {
    seq: {},
    settings: { contributorWeeklyPoints: DEFAULT_WEEKLY_CONTRIB_PTS },
    users: [],
    tasks: [],
    calendarEvents: [],
    notebooks: [],
    notePages: [],
    examSchedules: [],
    studyLogs: [],
    contactMessages: [],
    userMessages: [],
    licenseKeys: [],
    pointTransactions: [],
    notifications: [],
    studyMaterials: [],
    materialPurchases: [],
    examBlueprints: [],
    contributorFolders: [],
    contributorFiles: [],
  };
}

function loadStore(): InbuiltStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) {
      const fresh = emptyStore();
      saveStore(fresh);
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<InbuiltStore>;
    const merged: InbuiltStore = {
      ...emptyStore(),
      ...parsed,
      settings: {
        contributorWeeklyPoints:
          typeof parsed.settings?.contributorWeeklyPoints === 'number'
            ? parsed.settings.contributorWeeklyPoints
            : DEFAULT_WEEKLY_CONTRIB_PTS,
      },
    };
    merged.users.forEach((u) => {
      if (u.email.toLowerCase() === ADMIN_OWNER_EMAIL) {
        u.role = 'super';
        u.adminAuthorized = true;
      } else if (u.role === 'super') {
        u.role = 'admin';
      }
      if (!u.viewPlanMode) u.viewPlanMode = 'auto';
      if (!u.authMode) u.authMode = 'google';
    });
    return merged;
  } catch {
    return emptyStore();
  }
}

function saveStore(store: InbuiltStore) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // ignore quota issues
  }
}

function nextId(store: InbuiltStore, table: string): number {
  const n = (store.seq[table] || 0) + 1;
  store.seq[table] = n;
  return n;
}

// IndexedDB binary blob persistence
function openBlobDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putInbuiltBlob(key: string, blob: Blob): Promise<void> {
  const db = await openBlobDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    tx.objectStore(BLOB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getInbuiltBlob(key: string): Promise<Blob | null> {
  const db = await openBlobDb();
  return await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, 'readonly');
    const req = tx.objectStore(BLOB_STORE).get(key);
    req.onsuccess = () => resolve((req.result as Blob) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteInbuiltBlob(key: string): Promise<void> {
  if (!key) return;
  try {
    const db = await openBlobDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(BLOB_STORE, 'readwrite');
      tx.objectStore(BLOB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

function randomCode(len: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[arr[i] % alphabet.length];
  }
  return out;
}

function generate5CharUid(taken: Set<string>): string {
  for (let i = 0; i < 40; i++) {
    const c = randomCode(5);
    if (!taken.has(c)) return c;
  }
  return randomCode(5);
}

function generate8CharKey(store: InbuiltStore): string {
  let code = randomCode(8);
  while (
    code === CONSTANT_ADMIN_LICENSE_KEY ||
    store.licenseKeys.some((k) => k.keyCode === code)
  ) {
    code = randomCode(8);
  }
  return code;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPasswordClient(password: string): Promise<string> {
  const salt = randomCode(12);
  const digest = await sha256Hex(`${salt}:${password}`);
  return `${salt}:${digest}`;
}

async function verifyPasswordClient(password: string, stored: string): Promise<boolean> {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = await sha256Hex(`${salt}:${password}`);
  return check === hash;
}

function sanitizeUser(u: InbuiltUser, authModeOverride?: string) {
  const { passwordHash, ...rest } = u;
  return {
    ...rest,
    authMode: authModeOverride || u.authMode || 'google',
    hasPassword: Boolean(passwordHash),
  };
}

function addMonthsIso(fromDate: Date, months: number): string {
  const d = new Date(fromDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function addYearsIso(fromDate: Date, years: number): string {
  const d = new Date(fromDate);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

function getSundayWeekKey(date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

function sanitizeUsernameBase(email: string, displayName?: string): string {
  const raw = (email.split('@')[0] || displayName || 'student')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '');
  return raw.slice(0, 24) || 'student';
}

function pushNotification(
  store: InbuiltStore,
  params: {
    userId: number | null;
    senderId?: number | null;
    senderLabel?: string;
    title: string;
    message: string;
    type?: string;
  }
) {
  store.notifications.unshift({
    id: nextId(store, 'notifications'),
    userId: params.userId,
    senderId: params.senderId ?? null,
    senderLabel: params.senderLabel || 'ASAN System',
    title: params.title,
    message: params.message,
    type: params.type || 'info',
    isRead: false,
    createdAt: new Date().toISOString(),
  });
}

function sendSystemMail(
  store: InbuiltStore,
  params: {
    recipient: InbuiltUser;
    senderId?: number | null;
    senderEmail?: string;
    senderUsername?: string;
    senderLabel?: string;
    isAdminMail?: boolean;
    subject: string;
    body: string;
    notifTitle?: string;
    notifMessage?: string;
    notifType?: string;
  }
) {
  store.userMessages.unshift({
    id: nextId(store, 'userMessages'),
    senderId: params.senderId || params.recipient.id,
    recipientId: params.recipient.id,
    senderEmail: params.senderEmail || ADMIN_OWNER_EMAIL,
    senderUsername: params.senderUsername || 'asan_system',
    recipientEmail: params.recipient.email,
    recipientUsername: params.recipient.username,
    visibility: 'direct',
    isAdminMail: Boolean(params.isAdminMail ?? true),
    recipientSummary: params.recipient.username ? `@${params.recipient.username}` : params.recipient.email,
    subject: params.subject,
    body: params.body,
    attachmentTitle: '',
    attachmentNoteId: null,
    isRead: false,
    createdAt: new Date().toISOString(),
  });
  pushNotification(store, {
    userId: params.recipient.id,
    senderId: params.senderId ?? null,
    senderLabel: params.senderLabel || 'ASAN System',
    title: params.notifTitle || params.subject,
    message: params.notifMessage || params.body.slice(0, 140),
    type: params.notifType || 'info',
  });
}

function awardPointsLocal(
  store: InbuiltStore,
  user: InbuiltUser,
  amount: number,
  reason: string,
  category: string
) {
  user.points = Math.max(0, (user.points || 0) + amount);
  user.updatedAt = new Date().toISOString();
  store.pointTransactions.unshift({
    id: nextId(store, 'pointTransactions'),
    userId: user.id,
    amount,
    reason,
    category,
    createdAt: new Date().toISOString(),
  });
}

function maintainLifecycle(store: InbuiltStore, user: InbuiltUser): InbuiltUser {
  const now = new Date();
  let changed = false;

  if (!user.shortUid || user.shortUid.length !== 5) {
    const taken = new Set(store.users.map((u) => u.shortUid).filter(Boolean));
    user.shortUid = generate5CharUid(taken);
    changed = true;
  }
  if (!user.viewPlanMode) {
    user.viewPlanMode = 'auto';
    changed = true;
  }
  if (user.email.toLowerCase() === ADMIN_OWNER_EMAIL) {
    if (user.role !== 'super' || !user.adminAuthorized) {
      user.role = 'super';
      user.adminAuthorized = true;
      changed = true;
    }
  } else if (user.role === 'super') {
    user.role = 'admin';
    changed = true;
  }

  if (user.plan === 'pro' && user.proExpiresAt) {
    const exp = new Date(user.proExpiresAt);
    if (!Number.isNaN(exp.getTime())) {
      const msLeft = exp.getTime() - now.getTime();
      if (msLeft < 0) {
        user.plan = 'basic';
        user.proStartedAt = '';
        user.proExpiresAt = '';
        user.lastExpiryReminderFor = '';
        changed = true;
        sendSystemMail(store, {
          recipient: user,
          senderLabel: 'ASAN Subscriptions',
          subject: 'Your ASAN-Study_tool Pro Plan Has Expired',
          body: `Hello ${user.displayName},\n\nYour Pro Plan ended on ${exp.toISOString().slice(0, 10)}. Renew anytime in Subscriptions.`,
          notifTitle: 'Pro Subscription Expired',
          notifMessage: 'Your Pro Plan expired and returned to Basic.',
          notifType: 'warning',
        });
      }
    }
  }

  if ((user.role === 'admin' || user.role === 'super') && !user.adminFirstGiftClaimed) {
    user.adminFirstGiftClaimed = true;
    changed = true;
    const keyCode = generate8CharKey(store);
    const activationExpiresAt = addYearsIso(now, 1);
    store.licenseKeys.unshift({
      id: nextId(store, 'licenseKeys'),
      keyCode,
      keyType: 'pro',
      durationMonths: 1,
      issuedToUserId: user.id,
      issuedToEmail: user.email,
      issuedByUserId: user.id,
      activationExpiresAt,
      activatedByUserId: null,
      activatedAt: '',
      subStartsAt: '',
      subEndsAt: '',
      status: 'unused',
      createdAt: now.toISOString(),
    });
    sendSystemMail(store, {
      recipient: user,
      senderId: user.id,
      senderLabel: 'ASAN Licensing',
      subject: `Welcome ${user.role === 'super' ? 'Super Admin' : 'Admin'} — Free Pro License Key Gift`,
      body: `Pro License Key (8 chars): ${keyCode}\nValid Until: ${activationExpiresAt.slice(0, 10)}`,
      notifTitle: 'Complimentary Pro License Key',
      notifMessage: `Key ${keyCode} delivered to Tool Mail.`,
      notifType: 'license',
    });
  }

  const weekKey = getSundayWeekKey(now);
  if (user.lastWeeklyGrantWeek !== weekKey) {
    if (user.role === 'admin' || user.role === 'super') {
      user.lastWeeklyGrantWeek = weekKey;
      changed = true;
      awardPointsLocal(store, user, 150, `Weekly Admin Stipend (Week of ${weekKey})`, 'weekly_admin');
      pushNotification(store, {
        userId: user.id,
        title: '+150 Points Weekly Admin Stipend',
        message: `Sunday weekly admin reward (+150 pts) credited for week ${weekKey}.`,
        type: 'points',
      });
    } else if (user.role === 'contributor' && user.contributorApproved) {
      const weeklyPts = store.settings.contributorWeeklyPoints ?? DEFAULT_WEEKLY_CONTRIB_PTS;
      if (weeklyPts > 0) {
        user.lastWeeklyGrantWeek = weekKey;
        changed = true;
        awardPointsLocal(
          store,
          user,
          weeklyPts,
          `Weekly Contributor Stipend (Week of ${weekKey})`,
          'weekly_contributor'
        );
        pushNotification(store, {
          userId: user.id,
          title: `+${weeklyPts} Points Weekly Contributor Stipend`,
          message: `Weekly contributor stipend (+${weeklyPts} pts) credited for week ${weekKey}.`,
          type: 'points',
        });
      }
    }
  }

  if (changed) {
    user.updatedAt = now.toISOString();
    saveStore(store);
  }
  return user;
}

function getOrCreateUserFromClaims(
  store: InbuiltStore,
  claims: { uid: string; email: string; name?: string; picture?: string },
  authMode: 'google' | 'password'
): InbuiltUser {
  const email = (claims.email || '').trim();
  const isOwner = email.toLowerCase() === ADMIN_OWNER_EMAIL;
  let user = store.users.find(
    (u) => u.uid === claims.uid || (email && u.email.toLowerCase() === email.toLowerCase())
  );
  const now = new Date().toISOString();

  if (!user) {
    const base = sanitizeUsernameBase(email, claims.name);
    const taken = new Set(store.users.map((u) => u.username.toLowerCase()));
    const takenUids = new Set(store.users.map((u) => u.shortUid).filter(Boolean));
    let candidate = base;
    let suffix = 1;
    while (taken.has(candidate)) {
      candidate = `${base}${suffix++}`;
    }
    const shortUid = generate5CharUid(takenUids);
    const id = nextId(store, 'users');
    user = {
      id,
      uid: claims.uid,
      shortUid,
      email,
      displayName: claims.name || email.split('@')[0] || 'Student',
      username: candidate,
      photoUrl: claims.picture || '',
      plan: 'basic',
      viewPlanMode: 'auto',
      role: isOwner ? 'super' : 'user',
      passwordHash: '',
      authMode,
      points: 500,
      proStartedAt: '',
      proExpiresAt: '',
      lastExpiryReminderFor: '',
      contributorApproved: false,
      contributorRequested: false,
      adminAuthorized: isOwner,
      adminFirstGiftClaimed: false,
      lastWeeklyGrantWeek: '',
      spectraUrl: 'https://www.khanacademy.org',
      driveFolderId: '',
      scheduleSheetId: '',
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(user);
    store.pointTransactions.unshift({
      id: nextId(store, 'pointTransactions'),
      userId: id,
      amount: 500,
      reason: 'Welcome Bonus (Initial Login Balance)',
      category: 'initial',
      createdAt: now,
    });
    const nbId = nextId(store, 'notebooks');
    store.notebooks.push({
      id: nbId,
      userId: id,
      title: 'Academic Study Notebook',
      subject: 'Physics & Calculus',
      color: '#2563EB',
      createdAt: now,
      updatedAt: now,
    });
    store.notePages.push({
      id: nextId(store, 'notePages'),
      notebookId: nbId,
      userId: id,
      sectionName: 'Quick Start',
      title: 'A4 Study Document Guide',
      pagesData: [
        {
          id: 'page-1',
          pageNumber: 1,
          title: 'Page 1 — A4 Structured Notes',
          blocks: [
            {
              id: 'b-1',
              type: 'heading',
              content: 'Welcome to ASAN-Study_tool A4 Notebooks',
              fontSize: 16,
            },
            {
              id: 'b-2',
              type: 'text',
              content:
                'Write, paste images, add formulas, and export clean A4 PDFs. Works seamlessly offline and as an installable PWA.',
              fontSize: 10,
            },
          ],
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    saveStore(store);
  } else {
    if (claims.name) user.displayName = claims.name;
    if (claims.picture) user.photoUrl = claims.picture;
    user.updatedAt = now;
    saveStore(store);
  }

  return maintainLifecycle(store, user);
}

function decodeJwtPayload(token: string): {
  uid: string;
  email: string;
  name?: string;
  picture?: string;
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64));
    const uid = String(json.user_id || json.sub || '');
    const email = String(json.email || '');
    if (!uid) return null;
    return {
      uid,
      email,
      name: json.name,
      picture: json.picture,
    };
  } catch {
    return null;
  }
}

function makeInbuiltToken(user: InbuiltUser): string {
  const payload = btoa(
    JSON.stringify({ userId: user.id, uid: user.uid, email: user.email, exp: Date.now() + 30 * 86400000 })
  );
  return `inbuilt.${payload}`;
}

function resolveUserFromToken(
  store: InbuiltStore,
  token: string | null
): { user: InbuiltUser; authMode: 'google' | 'password' } {
  if (!token) throw new Error('Unauthorized: Please sign in.');
  if (token.startsWith('inbuilt.')) {
    try {
      const parsed = JSON.parse(atob(token.slice('inbuilt.'.length))) as {
        userId: number;
        uid: string;
        email: string;
      };
      const found = store.users.find((u) => u.id === parsed.userId || u.uid === parsed.uid);
      if (!found) throw new Error('Session expired.');
      return { user: maintainLifecycle(store, found), authMode: 'password' };
    } catch {
      throw new Error('Unauthorized: Invalid password session.');
    }
  }
  const claims = decodeJwtPayload(token);
  if (!claims) throw new Error('Unauthorized: Invalid Firebase session.');
  const user = getOrCreateUserFromClaims(store, claims, 'google');
  return { user, authMode: 'google' };
}

function matchRecipientToken(token: string, user: InbuiltUser): boolean {
  const clean = token.trim().toLowerCase();
  if (!clean) return false;
  const noAt = clean.replace(/^@/, '');
  const numeric = /^\d+$/.test(clean) ? Number(clean) : NaN;
  if (Number.isFinite(numeric) && user.id === numeric) return true;
  if (user.shortUid && user.shortUid.toLowerCase() === clean) return true;
  if (user.username && user.username.toLowerCase() === noAt) return true;
  if (user.email.toLowerCase() === clean) return true;
  if (user.uid.toLowerCase() === clean) return true;
  return false;
}

export async function handleInbuiltApiRequest<T>(
  path: string,
  options: RequestInit = {},
  token: string | null = null
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  let body: Record<string, any> = {};
  if (typeof options.body === 'string' && options.body) {
    try {
      body = JSON.parse(options.body) as Record<string, any>;
    } catch {
      throw new Error('Malformed JSON request body.');
    }
  }
  const store = loadStore();

  // --- PUBLIC ROUTES ---
  if (path === '/api/health') {
    return { status: 'ok', mode: 'inbuilt' } as T;
  }

  if (path === '/api/credits' && method === 'GET') {
    const contributors = store.users
      .filter((u) => u.role === 'contributor' && u.contributorApproved)
      .map((u) => ({
        id: u.id,
        displayName: u.displayName,
        username: u.username,
        shortUid: u.shortUid,
        plan: u.plan,
        role: u.role,
        contributorApproved: u.contributorApproved,
        photoUrl: u.photoUrl,
      }));
    return { contributors } as T;
  }

  if (path === '/api/auth/register' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim() || email.split('@')[0] || 'Student';
    if (!email || !email.includes('@')) throw new Error('Please enter a valid email address.');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (store.users.some((u) => u.email.toLowerCase() === email)) {
      throw new Error('An account with this email already exists. Sign in with your password.');
    }
    const base = sanitizeUsernameBase(email, displayName);
    const taken = new Set(store.users.map((u) => u.username.toLowerCase()));
    const takenUids = new Set(store.users.map((u) => u.shortUid).filter(Boolean));
    let candidate = base;
    let sfx = 1;
    while (taken.has(candidate)) candidate = `${base}${sfx++}`;
    const shortUid = generate5CharUid(takenUids);
    const id = nextId(store, 'users');
    const now = new Date().toISOString();
    const isOwner = email === ADMIN_OWNER_EMAIL;
    const pwdHash = await hashPasswordClient(password);
    const created: InbuiltUser = {
      id,
      uid: `pwd_${shortUid.toLowerCase()}_${id}`,
      shortUid,
      email,
      displayName,
      username: candidate,
      photoUrl: '',
      plan: 'basic',
      viewPlanMode: 'auto',
      role: isOwner ? 'super' : 'user',
      passwordHash: pwdHash,
      authMode: 'password',
      points: 500,
      proStartedAt: '',
      proExpiresAt: '',
      lastExpiryReminderFor: '',
      contributorApproved: false,
      contributorRequested: false,
      adminAuthorized: isOwner,
      adminFirstGiftClaimed: false,
      lastWeeklyGrantWeek: '',
      spectraUrl: 'https://www.khanacademy.org',
      driveFolderId: '',
      scheduleSheetId: '',
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(created);
    store.pointTransactions.unshift({
      id: nextId(store, 'pointTransactions'),
      userId: id,
      amount: 500,
      reason: 'Welcome Bonus (Initial Password Account Balance)',
      category: 'initial',
      createdAt: now,
    });
    const nbId = nextId(store, 'notebooks');
    store.notebooks.push({
      id: nbId,
      userId: id,
      title: 'Academic Study Notebook',
      subject: 'General Studies',
      color: '#2563EB',
      createdAt: now,
      updatedAt: now,
    });
    store.notePages.push({
      id: nextId(store, 'notePages'),
      notebookId: nbId,
      userId: id,
      sectionName: 'Quick Start',
      title: 'A4 Study Document Guide',
      pagesData: [
        {
          id: 'page-1',
          pageNumber: 1,
          title: 'Page 1 — A4 Structured Notes',
          blocks: [
            {
              id: 'b-1',
              type: 'heading',
              content: 'Welcome to ASAN-Study_tool (Standard Password Account)',
              fontSize: 16,
            },
            {
              id: 'b-2',
              type: 'text',
              content:
                'Signed in without Google OAuth. Google Workspace stays hidden, while Notes, PDFs, Tasks, Calendar, Timers, and Tool Mail remain active.',
              fontSize: 10,
            },
          ],
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    saveStore(store);
    const refreshed = maintainLifecycle(store, created);
    return {
      token: makeInbuiltToken(refreshed),
      user: sanitizeUser(refreshed, 'password'),
    } as T;
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const clean = String(body.identifier || body.email || '')
      .trim()
      .toLowerCase()
      .replace(/^@/, '');
    const password = String(body.password || '');
    const found = store.users.find(
      (u) =>
        u.email.toLowerCase() === clean ||
        u.username.toLowerCase() === clean ||
        (u.shortUid && u.shortUid.toLowerCase() === clean)
    );
    if (!found) throw new Error('Account not found.');
    if (!found.passwordHash) {
      throw new Error(
        'This account uses Google Sign-In and has no password yet. Sign in with Google once and set a password in Subscriptions.'
      );
    }
    const ok = await verifyPasswordClient(password, found.passwordHash);
    if (!ok) throw new Error('Incorrect password.');
    const refreshed = maintainLifecycle(store, found);
    return {
      token: makeInbuiltToken(refreshed),
      user: sanitizeUser(refreshed, 'password'),
    } as T;
  }

  // --- AUTHENTICATED ROUTES ---
  const { user, authMode } = resolveUserFromToken(store, token);
  const isElevated = user.role === 'admin' || user.role === 'super';
  const isSuper = user.role === 'super' && user.email.toLowerCase() === ADMIN_OWNER_EMAIL;

  if (path === '/api/auth/set-password' && method === 'POST') {
    const password = String(body.password || '');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    user.passwordHash = await hashPasswordClient(password);
    user.updatedAt = new Date().toISOString();
    saveStore(store);
    return {
      ok: true,
      user: sanitizeUser(user, authMode),
      message: 'Password saved! You can now sign in with Email & Password without Google OAuth.',
    } as T;
  }

  if (path === '/api/me') {
    if (method === 'GET') return sanitizeUser(user, authMode) as T;
    if (method === 'PATCH') {
      if (typeof body.username === 'string') {
        const cleanU = body.username
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_.-]/g, '')
          .slice(0, 32);
        if (cleanU.length < 3) {
          throw new Error('Username must be at least 3 characters.');
        }
        if (store.users.some((u) => u.id !== user.id && u.username.toLowerCase() === cleanU)) {
          throw new Error(`Username "@${cleanU}" is already taken.`);
        }
        user.username = cleanU;
      }
      if (typeof body.displayName === 'string') user.displayName = body.displayName.slice(0, 120);
      if (typeof body.spectraUrl === 'string') user.spectraUrl = body.spectraUrl.slice(0, 300);
      if (typeof body.driveFolderId === 'string') user.driveFolderId = body.driveFolderId.slice(0, 160);
      if (typeof body.scheduleSheetId === 'string') user.scheduleSheetId = body.scheduleSheetId.slice(0, 160);
      if (body.viewPlanMode === 'basic' || body.viewPlanMode === 'auto') {
        user.viewPlanMode = body.viewPlanMode;
      }
      user.updatedAt = new Date().toISOString();
      saveStore(store);
      return sanitizeUser(user, authMode) as T;
    }
  }

  if (path === '/api/me/plan' && method === 'POST') {
    if (!isElevated) throw new Error('Forbidden: Admin responsibility required.');
    const plan = body.plan === 'pro' ? 'pro' : 'basic';
    const now = new Date();
    user.plan = plan;
    user.proStartedAt = plan === 'pro' ? now.toISOString() : '';
    user.proExpiresAt = plan === 'pro' ? addMonthsIso(now, 1) : '';
    user.updatedAt = now.toISOString();
    saveStore(store);
    return sanitizeUser(user, authMode) as T;
  }

  if (path === '/api/points' && method === 'GET') {
    return {
      points: user.points,
      transactions: store.pointTransactions.filter((t) => t.userId === user.id),
    } as T;
  }

  if (path === '/api/subscriptions' && method === 'GET') {
    return {
      plan: user.plan,
      role: user.role,
      points: user.points,
      proStartedAt: user.proStartedAt,
      proExpiresAt: user.proExpiresAt,
      keys: store.licenseKeys.filter(
        (k) =>
          k.issuedToUserId === user.id ||
          k.activatedByUserId === user.id ||
          k.issuedByUserId === user.id ||
          k.issuedToEmail.toLowerCase() === user.email.toLowerCase()
      ),
      transactions: store.pointTransactions.filter((t) => t.userId === user.id),
    } as T;
  }

  if (path === '/api/subscriptions/redeem-points' && method === 'POST') {
    const isAnnual = body.term === 'annual';
    const cost = isAnnual ? 5100 : 500;
    const months = isAnnual ? 12 : 1;
    if (user.points < cost) {
      throw new Error(`Insufficient points. Need ${cost.toLocaleString()} points.`);
    }
    const now = new Date();
    const baseStart =
      user.plan === 'pro' && user.proExpiresAt && new Date(user.proExpiresAt) > now
        ? new Date(user.proExpiresAt)
        : now;
    user.points -= cost;
    user.plan = 'pro';
    user.proStartedAt = user.proStartedAt || now.toISOString();
    user.proExpiresAt = addMonthsIso(baseStart, months);
    user.lastExpiryReminderFor = '';
    user.updatedAt = now.toISOString();
    store.pointTransactions.unshift({
      id: nextId(store, 'pointTransactions'),
      userId: user.id,
      amount: -cost,
      reason: `${isAnnual ? 'Annual Pro (12m)' : 'Monthly Pro (1m)'} Activation`,
      category: 'pro_purchase',
      createdAt: now.toISOString(),
    });
    sendSystemMail(store, {
      recipient: user,
      senderLabel: 'Subscriptions',
      subject: `Pro Plan Purchase Confirmation`,
      body: `Active until ${user.proExpiresAt.slice(0, 10)} (${cost} pts deducted).`,
      notifTitle: 'Pro Plan Activated',
      notifMessage: `Pro active until ${user.proExpiresAt.slice(0, 10)}.`,
      notifType: 'subscription',
    });
    saveStore(store);
    return {
      user: sanitizeUser(user, authMode),
      message: `${isAnnual ? 'Annual' : 'Monthly'} Pro activated until ${user.proExpiresAt.slice(0, 10)}.`,
    } as T;
  }

  if (path === '/api/subscriptions/purchase-key' && method === 'POST') {
    const isAnnual = body.term === 'annual';
    const cost = isAnnual ? 5100 : 500;
    if (user.points < cost) {
      throw new Error(`Insufficient points. Need ${cost.toLocaleString()} points.`);
    }
    let target = user;
    if (body.recipientEmail && String(body.recipientEmail).trim()) {
      const found = store.users.find((u) => matchRecipientToken(String(body.recipientEmail), u));
      if (!found) throw new Error(`Registered user "${body.recipientEmail}" not found.`);
      target = found;
    }
    awardPointsLocal(store, user, -cost, `Purchased 8-char Pro Key for ${target.email}`, 'pro_key_purchase');
    const now = new Date();
    const keyRec = {
      id: nextId(store, 'licenseKeys'),
      keyCode: generate8CharKey(store),
      keyType: 'pro',
      durationMonths: isAnnual ? 12 : 1,
      issuedToUserId: target.id,
      issuedToEmail: target.email,
      issuedByUserId: user.id,
      activationExpiresAt: addYearsIso(now, 1),
      activatedByUserId: null,
      activatedAt: '',
      subStartsAt: '',
      subEndsAt: '',
      status: 'unused',
      createdAt: now.toISOString(),
    };
    store.licenseKeys.unshift(keyRec);
    sendSystemMail(store, {
      recipient: target,
      senderId: user.id,
      senderLabel: 'Subscriptions',
      subject: `Your ASAN-Study_tool 8-Character Pro Key (${keyRec.keyCode})`,
      body: `Pro Key: ${keyRec.keyCode}\nValid Until: ${keyRec.activationExpiresAt.slice(0, 10)}`,
      notifTitle: `Pro Key ${keyRec.keyCode}`,
      notifMessage: 'Check Tool Mail for your 8-character Pro key.',
      notifType: 'license',
    });
    saveStore(store);
    return { key: keyRec, recipientEmail: target.email } as T;
  }

  if (path === '/api/subscriptions/redeem-key' && method === 'POST') {
    const keyCode = String(body.keyCode || '').trim().toUpperCase();
    if (keyCode.length !== 8) throw new Error('License keys must be exactly 8 characters.');
    if (keyCode === CONSTANT_ADMIN_LICENSE_KEY) {
      if (!user.adminAuthorized && user.email.toLowerCase() !== ADMIN_OWNER_EMAIL) {
        throw new Error('Admin access is strictly hand-selected by the workspace owner.');
      }
      user.role = user.email.toLowerCase() === ADMIN_OWNER_EMAIL ? 'super' : 'admin';
      user.adminAuthorized = true;
      saveStore(store);
      return { user: sanitizeUser(user, authMode), kind: 'admin', message: 'Admin responsibility activated.' } as T;
    }
    const keyRow = store.licenseKeys.find((k) => k.keyCode === keyCode);
    if (!keyRow) throw new Error('Invalid 8-character license key.');
    if (keyRow.status !== 'unused') throw new Error(`This license key is already ${keyRow.status}.`);
    const now = new Date();
    if (new Date(keyRow.activationExpiresAt) < now) {
      keyRow.status = 'expired';
      saveStore(store);
      throw new Error('This license key has expired.');
    }
    const months = keyRow.durationMonths === 12 ? 12 : 1;
    const baseStart =
      user.plan === 'pro' && user.proExpiresAt && new Date(user.proExpiresAt) > now
        ? new Date(user.proExpiresAt)
        : now;
    const subStartsAt = user.proStartedAt || now.toISOString();
    const subEndsAt = addMonthsIso(baseStart, months);
    keyRow.status = 'active';
    keyRow.activatedByUserId = user.id;
    keyRow.activatedAt = now.toISOString();
    keyRow.subStartsAt = subStartsAt;
    keyRow.subEndsAt = subEndsAt;
    user.plan = 'pro';
    user.viewPlanMode = 'auto';
    user.proStartedAt = subStartsAt;
    user.proExpiresAt = subEndsAt;
    user.updatedAt = now.toISOString();
    saveStore(store);
    return {
      user: sanitizeUser(user, authMode),
      kind: 'pro',
      message: `Pro plan activated until ${subEndsAt.slice(0, 10)}.`,
    } as T;
  }

  // --- TASKS ---
  if (path === '/api/tasks') {
    if (method === 'GET') return store.tasks.filter((t) => t.userId === user.id) as T;
    if (method === 'POST') {
      const now = new Date().toISOString();
      const created = {
        id: nextId(store, 'tasks'),
        userId: user.id,
        title: String(body.title || 'Task'),
        description: String(body.description || ''),
        subject: String(body.subject || 'General'),
        priority: String(body.priority || 'medium'),
        status: 'todo',
        dueDate: String(body.dueDate || ''),
        dueTime: String(body.dueTime || ''),
        createdAt: now,
        updatedAt: now,
      };
      store.tasks.unshift(created);
      saveStore(store);
      return created as T;
    }
  }
  if (path.startsWith('/api/tasks/')) {
    const id = Number(path.split('/').pop());
    if (method === 'PATCH') {
      const item = store.tasks.find((t) => t.id === id && t.userId === user.id);
      if (item) {
        Object.assign(item, body, { updatedAt: new Date().toISOString() });
        saveStore(store);
      }
      return item as T;
    }
    if (method === 'DELETE') {
      store.tasks = store.tasks.filter((t) => !(t.id === id && t.userId === user.id));
      saveStore(store);
      return { ok: true } as T;
    }
  }

  // --- CALENDAR EVENTS ---
  if (path === '/api/events') {
    if (method === 'GET') {
      return store.calendarEvents
        .filter((e) => e.userId === user.id)
        .sort((a, b) => `${a.eventDate} ${a.eventTime}`.localeCompare(`${b.eventDate} ${b.eventTime}`)) as T;
    }
    if (method === 'POST') {
      const studyVerified = isStudyRelatedEvent(String(body.title || ''), body.category, body.notes);
      const pointsAwarded = studyVerified ? 5 : 0;
      const created = {
        id: nextId(store, 'calendarEvents'),
        userId: user.id,
        title: String(body.title || ''),
        eventDate: String(body.eventDate || ''),
        eventTime: String(body.eventTime || '09:00'),
        category: String(body.category || 'study'),
        notes: String(body.notes || ''),
        meetLink: String(body.meetLink || ''),
        createdAt: new Date().toISOString(),
      };
      store.calendarEvents.push(created);
      if (pointsAwarded > 0) {
        awardPointsLocal(store, user, pointsAwarded, `Study Calendar Event: ${created.title}`, 'calendar_study');
      }
      saveStore(store);
      return { event: created, pointsAwarded, studyVerified } as T;
    }
  }
  if (path.startsWith('/api/events/') && method === 'DELETE') {
    const id = Number(path.split('/').pop());
    store.calendarEvents = store.calendarEvents.filter((e) => !(e.id === id && e.userId === user.id));
    saveStore(store);
    return { ok: true } as T;
  }

  // --- NOTEBOOKS & A4 PAGES ---
  if (path === '/api/notebooks') {
    if (method === 'GET') {
      return {
        notebooks: store.notebooks.filter((n) => n.userId === user.id),
        pages: store.notePages.filter((p) => p.userId === user.id),
      } as T;
    }
    if (method === 'POST') {
      const now = new Date().toISOString();
      const created = {
        id: nextId(store, 'notebooks'),
        userId: user.id,
        title: String(body.title || 'Notebook'),
        subject: String(body.subject || 'General'),
        color: String(body.color || '#2563EB'),
        createdAt: now,
        updatedAt: now,
      };
      store.notebooks.unshift(created);
      saveStore(store);
      return created as T;
    }
  }
  if (path.startsWith('/api/notebooks/') && method === 'DELETE') {
    const id = Number(path.split('/').pop());
    store.notebooks = store.notebooks.filter((n) => !(n.id === id && n.userId === user.id));
    store.notePages = store.notePages.filter((p) => !(p.notebookId === id && p.userId === user.id));
    saveStore(store);
    return { ok: true } as T;
  }
  if (path === '/api/note-pages' && method === 'POST') {
    const now = new Date().toISOString();
    const created = {
      id: nextId(store, 'notePages'),
      userId: user.id,
      notebookId: Number(body.notebookId),
      sectionName: String(body.sectionName || 'General'),
      title: String(body.title || 'Untitled Note'),
      pagesData: Array.isArray(body.pagesData) ? body.pagesData : [],
      createdAt: now,
      updatedAt: now,
    };
    store.notePages.unshift(created);
    saveStore(store);
    return created as T;
  }
  if (path.startsWith('/api/note-pages/')) {
    const id = Number(path.split('/').pop());
    if (method === 'PATCH') {
      const item = store.notePages.find((p) => p.id === id && p.userId === user.id);
      if (item) {
        Object.assign(item, body, { updatedAt: new Date().toISOString() });
        saveStore(store);
      }
      return item as T;
    }
    if (method === 'DELETE') {
      store.notePages = store.notePages.filter((p) => !(p.id === id && p.userId === user.id));
      saveStore(store);
      return { ok: true } as T;
    }
  }

  // --- EXAMS & STUDY LOGS ---
  if (path === '/api/exams') {
    if (method === 'GET') return store.examSchedules.filter((ex) => ex.userId === user.id) as T;
    if (method === 'POST') {
      const created = {
        id: nextId(store, 'examSchedules'),
        userId: user.id,
        subject: String(body.subject || ''),
        paperName: String(body.paperName || ''),
        examType: String(body.examType || 'JEE Main'),
        customExamType: String(body.customExamType || ''),
        readingMinutes: Number(body.readingMinutes) || 0,
        writingMinutes: Number(body.writingMinutes) || 60,
        seatingTime: String(body.seatingTime || ''),
        alarmEnabled: Boolean(body.alarmEnabled ?? true),
        hourlyAlarm: Boolean(body.hourlyAlarm ?? true),
        status: String(body.status || 'scheduled'),
        createdAt: new Date().toISOString(),
      };
      store.examSchedules.unshift(created);
      saveStore(store);
      return created as T;
    }
  }
  if (path.startsWith('/api/exams/')) {
    const id = Number(path.split('/').pop());
    if (method === 'PATCH') {
      const item = store.examSchedules.find((ex) => ex.id === id && ex.userId === user.id);
      if (item) {
        item.status = String(body.status || 'completed');
        saveStore(store);
      }
      return item as T;
    }
    if (method === 'DELETE') {
      store.examSchedules = store.examSchedules.filter((ex) => !(ex.id === id && ex.userId === user.id));
      saveStore(store);
      return { ok: true } as T;
    }
  }

  if (path === '/api/study-logs') {
    if (method === 'GET') return store.studyLogs.filter((l) => l.userId === user.id) as T;
    if (method === 'POST') {
      const dur = Math.max(0, Math.round(Number(body.durationSeconds) || 0));
      const isExamMode = body.mode === 'test_timer' || body.mode === 'exam_timer';
      const blocks = Math.floor(dur / 1800);
      const pointsAwarded = isExamMode ? blocks * 10 : 0;
      const created = {
        id: nextId(store, 'studyLogs'),
        userId: user.id,
        mode: String(body.mode || 'basic_timer'),
        label: String(body.label || 'Study Session'),
        durationSeconds: dur,
        createdAt: new Date().toISOString(),
      };
      store.studyLogs.unshift(created);
      if (pointsAwarded > 0) {
        awardPointsLocal(store, user, pointsAwarded, `Exam Timer Session: ${created.label}`, 'exam_timer');
      }
      saveStore(store);
      return { log: created, pointsAwarded } as T;
    }
  }

  // --- TOOL USERS & MESSAGES ---
  if (path === '/api/tool-users' && method === 'GET') {
    return store.users.map((u) => ({
      id: u.id,
      shortUid: u.shortUid,
      email: u.email,
      displayName: u.displayName,
      username: u.username,
      plan: u.plan,
      role: u.role,
      contributorApproved: u.contributorApproved,
    })) as T;
  }

  if (path === '/api/messages') {
    if (method === 'GET') {
      return store.userMessages.filter(
        (m) => m.senderId === user.id || m.recipientId === user.id || m.visibility === 'public'
      ) as T;
    }
    if (method === 'POST') {
      const vis = ['direct', 'self', 'public'].includes(body.visibility) ? body.visibility : 'direct';
      if (body.isAdminMail && !isElevated) throw new Error('Only Admins can send Admin Mail.');
      const createdRows: any[] = [];
      if (vis === 'self') {
        const c = {
          id: nextId(store, 'userMessages'),
          senderId: user.id,
          recipientId: user.id,
          senderEmail: user.email,
          senderUsername: user.username,
          recipientEmail: user.email,
          recipientUsername: user.username,
          visibility: 'self',
          isAdminMail: Boolean(body.isAdminMail),
          recipientSummary: 'Self Archive',
          subject: String(body.subject),
          body: String(body.body),
          attachmentTitle: String(body.attachmentTitle || ''),
          attachmentNoteId: body.attachmentNoteId ?? null,
          isRead: false,
          createdAt: new Date().toISOString(),
        };
        store.userMessages.unshift(c);
        createdRows.push(c);
      } else if (vis === 'public') {
        const c = {
          id: nextId(store, 'userMessages'),
          senderId: user.id,
          recipientId: null,
          senderEmail: user.email,
          senderUsername: user.username,
          recipientEmail: 'public@asan-study-tool',
          recipientUsername: 'public',
          visibility: 'public',
          isAdminMail: Boolean(body.isAdminMail),
          recipientSummary: 'Public Community Board',
          subject: String(body.subject),
          body: String(body.body),
          attachmentTitle: String(body.attachmentTitle || ''),
          attachmentNoteId: body.attachmentNoteId ?? null,
          isRead: false,
          createdAt: new Date().toISOString(),
        };
        store.userMessages.unshift(c);
        createdRows.push(c);
        pushNotification(store, {
          userId: null,
          senderId: user.id,
          senderLabel: body.isAdminMail ? 'Admin Public Mail' : `@${user.username}`,
          title: String(body.subject),
          message: String(body.body).slice(0, 120),
          type: body.isAdminMail ? 'admin_mail' : 'mail',
        });
      } else {
        const tokens: string[] = Array.isArray(body.recipients)
          ? body.recipients.map((r: unknown) => String(r).trim()).filter(Boolean)
          : typeof body.recipientEmail === 'string'
            ? body.recipientEmail.split(',').map((r: string) => r.trim()).filter(Boolean)
            : [];
        if (tokens.length === 0) throw new Error('Enter at least one recipient.');
        const matched = tokens.map((t) => {
          const u = store.users.find((x) => matchRecipientToken(t, x));
          if (!u) throw new Error(`Recipient not found: ${t}`);
          return u;
        });
        const summary = matched.map((r) => `@${r.username}`).join(', ');
        for (const rec of matched) {
          const c = {
            id: nextId(store, 'userMessages'),
            senderId: user.id,
            recipientId: rec.id,
            senderEmail: user.email,
            senderUsername: user.username,
            recipientEmail: rec.email,
            recipientUsername: rec.username,
            visibility: 'direct',
            isAdminMail: Boolean(body.isAdminMail),
            recipientSummary: summary,
            subject: String(body.subject),
            body: String(body.body),
            attachmentTitle: String(body.attachmentTitle || ''),
            attachmentNoteId: body.attachmentNoteId ?? null,
            isRead: false,
            createdAt: new Date().toISOString(),
          };
          store.userMessages.unshift(c);
          createdRows.push(c);
          pushNotification(store, {
            userId: rec.id,
            senderId: user.id,
            senderLabel: body.isAdminMail ? 'Admin Mail' : `@${user.username}`,
            title: String(body.subject),
            message: String(body.body).slice(0, 140),
            type: body.isAdminMail ? 'admin_mail' : 'mail',
          });
        }
      }
      saveStore(store);
      return createdRows as T;
    }
  }
  if (path.endsWith('/read') && path.startsWith('/api/messages/') && method === 'PATCH') {
    const id = Number(path.split('/')[3]);
    const item = store.userMessages.find((m) => m.id === id && m.recipientId === user.id);
    if (item) {
      item.isRead = true;
      saveStore(store);
    }
    return (item || { ok: true }) as T;
  }
  if (path.startsWith('/api/messages/') && method === 'DELETE') {
    const id = Number(path.split('/').pop());
    store.userMessages = store.userMessages.filter(
      (m) => !(m.id === id && (m.senderId === user.id || m.recipientId === user.id))
    );
    saveStore(store);
    return { ok: true } as T;
  }

  // --- NOTIFICATIONS ---
  if (path === '/api/notifications') {
    if (method === 'GET') {
      return store.notifications.filter((n) => n.userId === user.id || n.userId === null) as T;
    }
    if (method === 'POST') {
      const target = String(body.targetRecipient || '').trim();
      const isBroadcast = !target || target.toLowerCase() === 'all';
      if (isBroadcast && !isElevated) throw new Error('Only Admins can broadcast global notifications.');
      const rec = isBroadcast ? null : store.users.find((u) => matchRecipientToken(target, u));
      if (!isBroadcast && !rec) throw new Error(`Recipient "${target}" not found.`);
      const created = {
        id: nextId(store, 'notifications'),
        userId: rec ? rec.id : null,
        senderId: user.id,
        senderLabel: isElevated ? `${user.role === 'super' ? 'Super' : 'Admin'} (@${user.username})` : `@${user.username}`,
        title: String(body.title || ''),
        message: String(body.message || ''),
        type: String(body.type || 'ping'),
        isRead: false,
        createdAt: new Date().toISOString(),
      };
      store.notifications.unshift(created);
      saveStore(store);
      return created as T;
    }
  }
  if (path.endsWith('/read') && path.startsWith('/api/notifications/') && method === 'PATCH') {
    const id = Number(path.split('/')[3]);
    const item = store.notifications.find((n) => n.id === id && (n.userId === user.id || n.userId === null));
    if (item) {
      item.isRead = true;
      saveStore(store);
    }
    return { ok: true } as T;
  }

  // --- STUDY MATERIALS ---
  if (path === '/api/study-materials' && method === 'GET') {
    const isContribOrAdmin = isElevated || (user.role === 'contributor' && user.contributorApproved);
    const visible = isContribOrAdmin
      ? store.studyMaterials
      : store.studyMaterials.filter((m) => m.category === 'question_paper' || m.uploaderId === user.id);
    return {
      materials: visible,
      purchases: store.materialPurchases.filter((p) => p.buyerId === user.id),
      contributorAccess: isContribOrAdmin,
      contributorRequested: Boolean(user.contributorRequested),
    } as T;
  }
  if (path.endsWith('/acquire') && path.startsWith('/api/study-materials/') && method === 'POST') {
    const id = Number(path.split('/')[3]);
    const item = store.studyMaterials.find((m) => m.id === id);
    if (!item) throw new Error('Study material not found.');
    const accessType = body.accessType === 'buy' ? 'buy' : 'rent';
    const hours = accessType === 'rent' ? Math.max(1, Number(body.hours) || 1) : 0;
    const totalCost = accessType === 'buy' ? item.buyCost || item.hourlyRentCost * 4 : item.hourlyRentCost * hours;
    if (user.points < totalCost) throw new Error(`Insufficient points. Need ${totalCost} pts.`);
    awardPointsLocal(store, user, -totalCost, `${accessType === 'buy' ? 'Purchased' : 'Rented'} "${item.title}"`, accessType === 'buy' ? 'material_buy' : 'material_rent');
    const uploader = store.users.find((u) => u.id === item.uploaderId);
    if (uploader) {
      awardPointsLocal(store, uploader, Math.max(1, Math.round(totalCost * 0.5)), `Royalty: ${item.title}`, 'material_sale');
    }
    const purchase = {
      id: nextId(store, 'materialPurchases'),
      materialId: item.id,
      materialTitle: item.title,
      buyerId: user.id,
      buyerEmail: user.email,
      buyerName: user.displayName,
      uploaderId: item.uploaderId,
      accessType,
      hours,
      hourlyRate: item.hourlyRentCost,
      pageCount: item.pageCount,
      totalCost,
      expiresAt: accessType === 'rent' ? new Date(Date.now() + hours * 3600000).toISOString() : '',
      createdAt: new Date().toISOString(),
    };
    store.materialPurchases.unshift(purchase);
    saveStore(store);
    return { purchase, balanceAfter: user.points, points: user.points } as T;
  }
  if (path.endsWith('/drive') && path.startsWith('/api/study-materials/') && method === 'PATCH') {
    const id = Number(path.split('/')[3]);
    const item = store.studyMaterials.find((m) => m.id === id);
    if (item) {
      item.driveFileId = String(body.driveFileId || '');
      item.driveWebLink = String(body.driveWebLink || '');
      saveStore(store);
    }
    return item as T;
  }
  if (path.startsWith('/api/study-materials/') && method === 'DELETE') {
    const id = Number(path.split('/').pop());
    const item = store.studyMaterials.find((m) => m.id === id);
    if (item) {
      await deleteInbuiltBlob(item.storedFileName);
      store.studyMaterials = store.studyMaterials.filter((m) => m.id !== id);
      saveStore(store);
    }
    return { ok: true } as T;
  }

  // --- CONTRIBUTOR REQUEST ---
  if (path === '/api/contributor/request' && method === 'POST') {
    const cleanNote = String(body.message || body.note || '').trim().slice(0, 800);
    user.contributorRequested = true;
    user.updatedAt = new Date().toISOString();
    const admins = store.users.filter(
      (a) => a.role === 'super' || a.role === 'admin' || a.email.toLowerCase() === ADMIN_OWNER_EMAIL
    );
    const subject = `Contributor Tag Request from @${user.username} (${user.shortUid})`;
    const mailBody = `User ${user.displayName} (@${user.username}, UID: ${user.shortUid}, Email: ${user.email}) requested the Contributor tag.\n\n${
      cleanNote ? `Applicant Note:\n${cleanNote}\n\n` : ''
    }Review in Admin Console -> Contributor Oversight.`;
    for (const adm of admins) {
      store.userMessages.unshift({
        id: nextId(store, 'userMessages'),
        senderId: user.id,
        recipientId: adm.id,
        senderEmail: user.email,
        senderUsername: user.username,
        recipientEmail: adm.email,
        recipientUsername: adm.username,
        visibility: 'direct',
        isAdminMail: false,
        recipientSummary: `@${adm.username}`,
        subject,
        body: mailBody,
        attachmentTitle: '',
        attachmentNoteId: null,
        isRead: false,
        createdAt: new Date().toISOString(),
      });
      pushNotification(store, {
        userId: adm.id,
        senderId: user.id,
        senderLabel: `@${user.username}`,
        title: `Contributor Request: @${user.username}`,
        message: cleanNote || `${user.displayName} requested Contributor tag approval.`,
        type: 'contributor_request',
      });
    }
    saveStore(store);
    return sanitizeUser(user, authMode) as T;
  }

  // --- CONTRIBUTORS' CONSOLE ---
  if (path === '/api/contributor-console' && method === 'GET') {
    const canUse = isElevated || (user.role === 'contributor' && user.contributorApproved);
    if (!canUse) throw new Error('Approved Contributor role required.');
    return {
      folders: store.contributorFolders.filter((f) => f.userId === user.id),
      files: store.contributorFiles.filter((f) => f.userId === user.id),
    } as T;
  }
  if (path === '/api/contributor-console/folders' && method === 'POST') {
    const folderPath = String(body.path || body.name || '').trim().replace(/^\/+|\/+$/g, '');
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) throw new Error('Folder name is required.');
    const existing = store.contributorFolders.find((f) => f.userId === user.id && f.path === folderPath);
    if (existing) return existing as T;
    const created = {
      id: nextId(store, 'contributorFolders'),
      userId: user.id,
      username: user.username,
      name,
      parentId: body.parentId ? Number(body.parentId) : null,
      path: folderPath || name,
      driveFolderId: '',
      masterDriveFolderId: '',
      createdAt: new Date().toISOString(),
    };
    store.contributorFolders.push(created);
    saveStore(store);
    return created as T;
  }
  if (path.includes('/contributor-console/folders/') && path.endsWith('/drive') && method === 'PATCH') {
    const id = Number(path.split('/')[4]);
    const f = store.contributorFolders.find((x) => x.id === id);
    if (f) {
      if (typeof body.driveFolderId === 'string') f.driveFolderId = body.driveFolderId;
      if (typeof body.masterDriveFolderId === 'string') f.masterDriveFolderId = body.masterDriveFolderId;
      saveStore(store);
    }
    return f as T;
  }
  if (path.startsWith('/api/contributor-console/folders/') && method === 'DELETE') {
    const id = Number(path.split('/').pop());
    const target = store.contributorFolders.find((f) => f.id === id);
    if (target) {
      const prefix = `${target.path}/`;
      const removeIds = new Set(
        store.contributorFolders
          .filter((f) => f.userId === target.userId && (f.id === target.id || f.path.startsWith(prefix)))
          .map((f) => f.id)
      );
      for (const file of store.contributorFiles) {
        if (
          file.userId === target.userId &&
          ((file.folderId && removeIds.has(file.folderId)) || file.folderPath === target.path || file.folderPath.startsWith(prefix))
        ) {
          await deleteInbuiltBlob(file.storedFileName);
        }
      }
      store.contributorFiles = store.contributorFiles.filter(
        (file) =>
          !(
            file.userId === target.userId &&
            ((file.folderId && removeIds.has(file.folderId)) || file.folderPath === target.path || file.folderPath.startsWith(prefix))
          )
      );
      store.contributorFolders = store.contributorFolders.filter((f) => !removeIds.has(f.id));
      saveStore(store);
    }
    return { ok: true } as T;
  }
  if (path.includes('/contributor-console/files/') && path.endsWith('/drive') && method === 'PATCH') {
    const id = Number(path.split('/')[4]);
    const item = store.contributorFiles.find((f) => f.id === id);
    if (item) {
      if (typeof body.driveFileId === 'string') item.driveFileId = body.driveFileId;
      if (typeof body.driveWebLink === 'string') item.driveWebLink = body.driveWebLink;
      if (typeof body.masterDriveFileId === 'string') item.masterDriveFileId = body.masterDriveFileId;
      if (typeof body.masterDriveWebLink === 'string') item.masterDriveWebLink = body.masterDriveWebLink;
      saveStore(store);
    }
    return item as T;
  }
  if (path.startsWith('/api/contributor-console/files/') && method === 'DELETE') {
    const id = Number(path.split('/').pop());
    const item = store.contributorFiles.find((f) => f.id === id);
    if (item) {
      await deleteInbuiltBlob(item.storedFileName);
      store.contributorFiles = store.contributorFiles.filter((f) => f.id !== id);
      saveStore(store);
    }
    return { ok: true } as T;
  }

  // --- ADMIN & SUPER ENDPOINTS ---
  if (path === '/api/admin/overview' && method === 'GET') {
    if (!isElevated) throw new Error('Forbidden: Admin responsibility required.');
    const usedBytes =
      store.studyMaterials.reduce((a, m) => a + Number(m.fileSizeBytes || 0), 0) +
      store.contributorFiles.reduce((a, f) => a + Number(f.fileSizeBytes || 0), 0);
    return {
      constantAdminKey: CONSTANT_ADMIN_LICENSE_KEY,
      contributorWeeklyPoints: store.settings.contributorWeeklyPoints,
      storage: {
        usedBytes,
        quotaBytes: 5 * 1024 * 1024 * 1024,
        fileCount: store.studyMaterials.length + store.contributorFiles.length,
        driveMirrorFolder: 'ASAN-user-content',
      },
      analytics: {
        totalUsers: store.users.length,
        basicUsers: store.users.filter((u) => u.plan === 'basic').length,
        proUsers: store.users.filter((u) => u.plan === 'pro').length,
        adminUsers: store.users.filter((u) => u.role === 'admin' || u.role === 'super').length,
        approvedContributors: store.users.filter((u) => u.role === 'contributor' && u.contributorApproved).length,
        pendingContributorRequests: store.users.filter((u) => u.contributorRequested).length,
        totalTasks: store.tasks.length,
        totalNoteDocs: store.notePages.length,
        totalMessages: store.userMessages.length,
        totalPointsCirculating: store.users.reduce((a, u) => a + (u.points || 0), 0),
        totalPointsAwarded: store.pointTransactions.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0),
        activeProKeys: store.licenseKeys.filter((k) => k.status === 'active').length,
        unusedProKeys: store.licenseKeys.filter((k) => k.status === 'unused').length,
        totalMaterialPurchases: store.materialPurchases.length,
        totalMaterialRevenuePts: store.materialPurchases.reduce((a, p) => a + (p.totalCost || 0), 0),
      },
      users: store.users.map((u) => sanitizeUser(u)),
      materials: store.studyMaterials,
      materialPurchases: store.materialPurchases,
      licenseKeys: store.licenseKeys,
      contributorFolders: store.contributorFolders,
      contributorFiles: store.contributorFiles,
    } as T;
  }

  if (path === '/api/admin/contributors' && method === 'POST') {
    if (!isElevated) throw new Error('Forbidden');
    const target = store.users.find((u) => u.id === Number(body.userId));
    if (!target) throw new Error('User not found.');
    const approve = Boolean(body.approve);
    if (target.role !== 'admin' && target.role !== 'super') {
      target.role = approve ? 'contributor' : 'user';
    }
    target.contributorApproved = approve;
    target.contributorRequested = false;
    target.updatedAt = new Date().toISOString();
    sendSystemMail(store, {
      recipient: target,
      senderId: user.id,
      senderLabel: 'Admin Oversight',
      subject: approve ? 'Contributor Tag Approved!' : 'Contributor Tag Paused',
      body: approve
        ? `Your Contributor tag is approved (+${store.settings.contributorWeeklyPoints} pts/week every Sunday).`
        : 'Your Contributor access has been paused by an Admin.',
      notifTitle: approve ? 'Contributor Approved' : 'Contributor Paused',
      notifMessage: approve ? 'Contributors Console unlocked.' : 'Contributor stipend paused.',
      notifType: 'contributor',
    });
    saveStore(store);
    return sanitizeUser(target) as T;
  }

  if (path === '/api/admin/authorize-admin' && method === 'POST') {
    if (!isElevated) throw new Error('Forbidden');
    const q = String(body.email || '').trim();
    const target = store.users.find((u) => matchRecipientToken(q, u));
    if (!target) throw new Error(`No registered account found for ${q}.`);
    const authorize = Boolean(body.authorize ?? true);
    if (target.email.toLowerCase() === ADMIN_OWNER_EMAIL && !authorize) {
      throw new Error('Cannot revoke Super Admin privileges from workspace owner.');
    }
    target.adminAuthorized = authorize;
    target.role =
      target.email.toLowerCase() === ADMIN_OWNER_EMAIL
        ? 'super'
        : authorize
          ? 'admin'
          : target.contributorApproved
            ? 'contributor'
            : 'user';
    target.updatedAt = new Date().toISOString();
    saveStore(store);
    return sanitizeUser(target) as T;
  }

  if (path === '/api/admin/generate-key' && method === 'POST') {
    if (!isElevated) throw new Error('Forbidden');
    const isAnnual = body.term === 'annual';
    let target = user;
    if (body.recipientEmail && String(body.recipientEmail).trim()) {
      const found = store.users.find((u) => matchRecipientToken(String(body.recipientEmail), u));
      if (!found) throw new Error(`Registered user "${body.recipientEmail}" not found.`);
      target = found;
    }
    const now = new Date();
    const keyRec = {
      id: nextId(store, 'licenseKeys'),
      keyCode: generate8CharKey(store),
      keyType: 'pro',
      durationMonths: isAnnual ? 12 : 1,
      issuedToUserId: target.id,
      issuedToEmail: target.email,
      issuedByUserId: user.id,
      activationExpiresAt: addYearsIso(now, 1),
      activatedByUserId: null,
      activatedAt: '',
      subStartsAt: '',
      subEndsAt: '',
      status: 'unused',
      createdAt: now.toISOString(),
    };
    store.licenseKeys.unshift(keyRec);
    sendSystemMail(store, {
      recipient: target,
      senderId: user.id,
      senderLabel: 'Admin Licensing',
      subject: `Your Pro License Key (${keyRec.keyCode})`,
      body: `Pro License Key: ${keyRec.keyCode}`,
      notifTitle: `Pro Key ${keyRec.keyCode}`,
      notifMessage: 'Delivered via Tool Mail.',
      notifType: 'license',
    });
    saveStore(store);
    return { key: keyRec, recipientEmail: target.email } as T;
  }

  if (path === '/api/super/adjust-points' && method === 'POST') {
    if (!isSuper) throw new Error(`Forbidden: Strictly restricted to ${ADMIN_OWNER_EMAIL}.`);
    const target = store.users.find((u) => u.id === Number(body.targetUserId));
    if (!target) throw new Error('Target user not found.');
    const delta = Math.round(Number(body.amount));
    const reason = String(body.reason || '').trim();
    if (!delta || !reason) throw new Error('Non-zero amount and reason are required.');
    const nextPts = Math.max(0, (target.points || 0) + delta);
    const actualDelta = nextPts - (target.points || 0);
    target.points = nextPts;
    target.updatedAt = new Date().toISOString();
    const signLabel = delta > 0 ? `+${delta}` : `${actualDelta}`;
    store.pointTransactions.unshift({
      id: nextId(store, 'pointTransactions'),
      userId: target.id,
      amount: actualDelta,
      reason: `Super Adjustment (${signLabel} pts): ${reason}`,
      category: 'super_adjustment',
      createdAt: new Date().toISOString(),
    });
    sendSystemMail(store, {
      recipient: target,
      senderId: user.id,
      senderEmail: ADMIN_OWNER_EMAIL,
      senderUsername: user.username,
      senderLabel: 'Super Oversight',
      subject: `Points ${delta > 0 ? 'Credited' : 'Deducted'} (${signLabel} pts) — Super Oversight`,
      body: `Hello ${target.displayName},\n\nChange: ${signLabel} pts\nNew Balance: ${nextPts.toLocaleString()} pts\nReason: ${reason}`,
      notifTitle: `Points ${delta > 0 ? 'Added' : 'Deducted'}: ${signLabel} pts`,
      notifMessage: `Reason: ${reason}. New balance: ${nextPts} pts.`,
      notifType: delta > 0 ? 'points' : 'warning',
    });
    saveStore(store);
    return { user: sanitizeUser(target) } as T;
  }

  if (path === '/api/super/terminate-plan' && method === 'POST') {
    if (!isSuper) throw new Error(`Forbidden: Strictly restricted to ${ADMIN_OWNER_EMAIL}.`);
    const reason = String(body.reason || '').trim() || 'Administrative action by Super Developer Mode.';
    if (body.action === 'cancel_key') {
      const k = store.licenseKeys.find((x) => x.id === Number(body.keyId));
      if (!k) throw new Error('License key not found.');
      k.status = 'cancelled';
      saveStore(store);
      return { key: k, message: `License key ${k.keyCode} cancelled.` } as T;
    }
    const target = store.users.find((u) => u.id === Number(body.targetUserId));
    if (!target) throw new Error('Target user not found.');
    const now = new Date();
    let subj = '';
    let msg = '';
    if (body.action === 'terminate_pro') {
      target.plan = 'basic';
      target.viewPlanMode = 'auto';
      target.proStartedAt = '';
      target.proExpiresAt = '';
      subj = 'Your Pro Plan Was Terminated by Super Oversight';
      msg = `Your Pro plan has been terminated.\n\nReason: ${reason}`;
    } else if (body.action === 'grant_pro') {
      target.plan = 'pro';
      target.proStartedAt = now.toISOString();
      target.proExpiresAt = addMonthsIso(now, 1);
      subj = 'Pro Plan Activated by Super Oversight';
      msg = `Pro activated until ${target.proExpiresAt.slice(0, 10)}.\n\nNote: ${reason}`;
    } else if (body.action === 'cancel_contributor') {
      if (target.role !== 'super' && target.role !== 'admin') target.role = 'user';
      target.contributorApproved = false;
      target.contributorRequested = false;
      subj = 'Contributor Approval Cancelled by Super Oversight';
      msg = `Your Contributor approval has been cancelled.\n\nReason: ${reason}`;
    } else if (body.action === 'revoke_admin') {
      if (target.email.toLowerCase() === ADMIN_OWNER_EMAIL) {
        throw new Error('Cannot revoke Super Admin role.');
      }
      target.adminAuthorized = false;
      target.role = target.contributorApproved ? 'contributor' : 'user';
      subj = 'Admin Authorization Revoked by Super Oversight';
      msg = `Your Admin authorization has been revoked.\n\nReason: ${reason}`;
    }
    target.updatedAt = now.toISOString();
    sendSystemMail(store, {
      recipient: target,
      senderId: user.id,
      senderLabel: 'Super Oversight',
      subject: subj,
      body: msg,
      notifTitle: subj,
      notifMessage: reason,
      notifType: 'warning',
    });
    saveStore(store);
    return { user: sanitizeUser(target), message: subj } as T;
  }

  if (path === '/api/super/contributor-weekly-points' && method === 'POST') {
    if (!isSuper) throw new Error('Forbidden');
    const clean = Math.max(0, Math.min(100000, Math.round(Number(body.points) || 0)));
    store.settings.contributorWeeklyPoints = clean;
    saveStore(store);
    return { contributorWeeklyPoints: clean } as T;
  }

  if (path === '/api/super/master-sync-queue' && method === 'GET') {
    if (!isSuper) throw new Error('Forbidden');
    return {
      folders: store.contributorFolders,
      files: store.contributorFiles,
    } as T;
  }

  // --- EXAM BLUEPRINTS ---
  if (path === '/api/exam-blueprints') {
    if (method === 'GET') return store.examBlueprints.filter((b) => b.userId === user.id) as T;
    if (method === 'POST') {
      const totalMarks = Math.max(1, Number(body.totalMarks) || 100);
      const marksScored =
        body.marksScored !== '' && body.marksScored !== null && body.marksScored !== undefined
          ? Number(body.marksScored)
          : null;
      const now = new Date().toISOString();
      const created = {
        id: nextId(store, 'examBlueprints'),
        userId: user.id,
        paperCode: String(body.paperCode || '').toUpperCase(),
        subject: String(body.subject || ''),
        examType: String(body.examType || 'JEE Main'),
        examDate: String(body.examDate || ''),
        examTime: String(body.examTime || '09:00'),
        totalMarks,
        marksScored,
        percentage:
          marksScored !== null ? `${((marksScored / totalMarks) * 100).toFixed(1)}%` : String(body.percentage || ''),
        syllabus: Array.isArray(body.syllabus) ? body.syllabus : [],
        questionPaperUrl: String(body.questionPaperUrl || ''),
        answerSheetUrl: String(body.answerSheetUrl || ''),
        correctedAnswerSheetUrl: String(body.correctedAnswerSheetUrl || ''),
        createdAt: now,
        updatedAt: now,
      };
      store.examBlueprints.unshift(created);
      saveStore(store);
      return created as T;
    }
  }
  if (path.startsWith('/api/exam-blueprints/')) {
    const id = Number(path.split('/').pop());
    if (method === 'PATCH') {
      const item = store.examBlueprints.find((b) => b.id === id && b.userId === user.id);
      if (item) {
        Object.assign(item, body, { updatedAt: new Date().toISOString() });
        saveStore(store);
      }
      return item as T;
    }
    if (method === 'DELETE') {
      store.examBlueprints = store.examBlueprints.filter((b) => !(b.id === id && b.userId === user.id));
      saveStore(store);
      return { ok: true } as T;
    }
  }

  // --- CONTACT ---
  if (path === '/api/contact') {
    if (method === 'GET') {
      return (isElevated ? store.contactMessages : store.contactMessages.filter((c) => c.userId === user.id)) as T;
    }
    if (method === 'POST') {
      const created = {
        id: nextId(store, 'contactMessages'),
        userId: user.id,
        name: String(body.name || user.displayName),
        email: String(body.email || user.email),
        subject: String(body.subject || 'Inquiry'),
        message: String(body.message || ''),
        createdAt: new Date().toISOString(),
      };
      store.contactMessages.unshift(created);
      saveStore(store);
      return created as T;
    }
  }

  throw new Error(`Unsupported inbuilt API endpoint: ${method} ${path}`);
}

export async function inbuiltUploadStudyMaterial<T>(
  file: File,
  metadata: {
    title: string;
    subject: string;
    category: string;
    pageCount?: number;
    hourlyRentCost: number;
    buyCost?: number;
  },
  token: string | null
): Promise<T> {
  const store = loadStore();
  const { user } = resolveUserFromToken(store, token);
  const storedFileName = `inbuilt-sm-${Date.now()}-${randomCode(6)}-${file.name}`;
  await putInbuiltBlob(storedFileName, file);
  const hourly = Math.max(5, Math.min(100, Math.round(metadata.hourlyRentCost)));
  const buy =
    metadata.buyCost && metadata.buyCost >= 5 ? Math.round(metadata.buyCost) : Math.max(hourly, hourly * 4);
  const pointsAwarded = metadata.category === 'question_paper' ? 75 : 0;
  const material = {
    id: nextId(store, 'studyMaterials'),
    uploaderId: user.id,
    uploaderEmail: user.email,
    uploaderName: user.displayName,
    title: metadata.title,
    subject: metadata.subject,
    category: metadata.category,
    fileName: file.name,
    storedFileName,
    mimeType: file.type || 'application/octet-stream',
    fileSizeBytes: file.size,
    pageCount: Math.max(1, Math.round(metadata.pageCount || 1)),
    hourlyRentCost: hourly,
    buyCost: buy,
    driveFileId: '',
    driveWebLink: '',
    status: 'approved',
    createdAt: new Date().toISOString(),
  };
  store.studyMaterials.unshift(material);
  if (pointsAwarded > 0) {
    awardPointsLocal(store, user, pointsAwarded, `Uploaded Question Paper: ${metadata.title}`, 'question_paper');
  }
  saveStore(store);
  return { material, pointsAwarded } as T;
}

export async function inbuiltUploadContributorFile<T>(
  file: File,
  metadata: { folderId?: number | null; folderPath: string },
  token: string | null
): Promise<T> {
  const store = loadStore();
  const { user } = resolveUserFromToken(store, token);
  const storedFileName = `inbuilt-cc-${Date.now()}-${randomCode(6)}-${file.name}`;
  await putInbuiltBlob(storedFileName, file);
  const created = {
    id: nextId(store, 'contributorFiles'),
    userId: user.id,
    username: user.username,
    folderId: metadata.folderId ?? null,
    folderPath: metadata.folderPath || '',
    fileName: file.name,
    storedFileName,
    mimeType: file.type || 'application/octet-stream',
    fileSizeBytes: file.size,
    driveFileId: '',
    driveWebLink: '',
    masterDriveFileId: '',
    masterDriveWebLink: '',
    createdAt: new Date().toISOString(),
  };
  store.contributorFiles.unshift(created);
  saveStore(store);
  return created as T;
}

export async function inbuiltGetMaterialBlob(id: number): Promise<Blob> {
  const store = loadStore();
  const item = store.studyMaterials.find((m) => m.id === id);
  if (!item) throw new Error('Study material not found.');
  const blob = await getInbuiltBlob(item.storedFileName);
  if (!blob) throw new Error('File blob not found in local IndexedDB storage.');
  return blob;
}

export async function inbuiltGetContributorBlob(id: number): Promise<{ blob: Blob; fileName: string; mimeType: string }> {
  const store = loadStore();
  const item = store.contributorFiles.find((f) => f.id === id);
  if (!item) throw new Error('Contributor file not found.');
  const blob = await getInbuiltBlob(item.storedFileName);
  if (!blob) throw new Error('File blob not found in local IndexedDB storage.');
  return { blob, fileName: item.fileName, mimeType: item.mimeType };
}
