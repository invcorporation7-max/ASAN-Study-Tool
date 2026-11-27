import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as schema from './schema.ts';

dotenv.config();

declare global {
  var _postgresPool: Pool | undefined;
  var _schemaEnsured: Promise<void> | undefined;
  var _dbStatus: { connected: boolean; mode: 'postgres' | 'local-fallback'; reason?: string } | undefined;
}

export function normalizeDatabaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    // Catch cases where '#' in password got parsed as hash fragment
    if (!parsed.hash) return trimmed;
  } catch {
    // Fall through to safe manual repair
  }

  const schemeIdx = trimmed.indexOf('://');
  if (schemeIdx === -1) return trimmed;
  const scheme = trimmed.slice(0, schemeIdx + 3);
  const rest = trimmed.slice(schemeIdx + 3);
  const atIdx = rest.lastIndexOf('@');
  if (atIdx === -1) return trimmed;

  const userinfo = rest.slice(0, atIdx);
  const hostAndAfter = rest.slice(atIdx + 1);
  const colonIdx = userinfo.indexOf(':');
  if (colonIdx === -1) return trimmed;

  const user = userinfo.slice(0, colonIdx);
  const rawPass = userinfo.slice(colonIdx + 1);
  let decodedPass = rawPass;
  try {
    decodedPass = decodeURIComponent(rawPass);
  } catch {
    decodedPass = rawPass;
  }
  const encodedPass = encodeURIComponent(decodedPass);
  return `${scheme}${user}:${encodedPass}@${hostAndAfter}`;
}

export function isPostgresConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL?.trim() ||
      (process.env.SQL_HOST?.trim() && process.env.SQL_DB_NAME?.trim())
  );
}

export const createPool = () => {
  if (!global._postgresPool) {
    const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
    if (rawDatabaseUrl) {
      const databaseUrl = normalizeDatabaseUrl(rawDatabaseUrl);
      const isLocal =
        databaseUrl.includes('localhost') ||
        databaseUrl.includes('127.0.0.1') ||
        databaseUrl.includes('sslmode=disable');
      global._postgresPool = new Pool({
        connectionString: databaseUrl,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: 10,
        connectionTimeoutMillis: 12000,
      });
    } else {
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        max: 10,
        connectionTimeoutMillis: 12000,
      });
    }

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err instanceof Error ? err.message : err);
      global._schemaEnsured = undefined;
      global._dbStatus = {
        connected: false,
        mode: 'local-fallback',
        reason: classifyDatabaseError(err),
      };
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });

function classifyDatabaseError(err: unknown): string {
  const parts: string[] = [];
  const collect = (e: unknown, depth = 0) => {
    if (!e || depth > 3) return;
    if (typeof e === 'object') {
      const obj = e as { code?: string; message?: string; errors?: unknown[] };
      if (obj.code) parts.push(String(obj.code));
      if (obj.message) parts.push(String(obj.message));
      if (Array.isArray(obj.errors)) {
        for (const sub of obj.errors) collect(sub, depth + 1);
      }
      if ('cause' in obj) collect((obj as { cause?: unknown }).cause, depth + 1);
    } else if (typeof e === 'string') {
      parts.push(e);
    }
  };
  collect(err);
  const combined = parts.join(' | ');
  if (/ENETUNREACH|EHOSTUNREACH/i.test(combined)) {
    return 'IPv6 host unreachable (ENETUNREACH). Use Supabase Session Pooler IPv4 URI (pooler.supabase.com:5432).';
  }
  if (/ERR_INVALID_URL|Invalid URL/i.test(combined)) {
    return 'Invalid DATABASE_URL format (ERR_INVALID_URL). Check scheme postgresql:// and credentials.';
  }
  if (/password authentication failed|28P01|28000/i.test(combined)) {
    return 'Database password or pooler username rejected (28P01). Verify postgres.<project-ref> and password.';
  }
  if (/Tenant or user not found/i.test(combined)) {
    return 'Supabase pooler tenant/user mismatch. Ensure username is postgres.<project-ref> matching region host.';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(combined)) {
    return 'Database hostname not found (ENOTFOUND). Check Supabase host or unpause paused project.';
  }
  if (/ECONNREFUSED|ENOENT/i.test(combined)) {
    return 'Database connection refused or socket unavailable.';
  }
  if (/timeout|ETIMEDOUT/i.test(combined)) {
    return 'Database connection timed out. Check Supabase pooler availability and SSL settings.';
  }
  return 'Postgres unreachable; running on local fallback store.';
}

export function getDatabaseStatus(): {
  configured: boolean;
  connected: boolean;
  mode: 'postgres' | 'local-fallback';
  reason?: string;
} {
  const configured = isPostgresConfigured();
  if (!configured) {
    return {
      configured: false,
      connected: false,
      mode: 'local-fallback',
      reason: 'DATABASE_URL not set',
    };
  }
  if (global._dbStatus) {
    return { configured, ...global._dbStatus };
  }
  return {
    configured,
    connected: false,
    mode: 'local-fallback',
    reason: 'Pending initialization',
  };
}

export async function ensureDatabaseSchema(): Promise<boolean> {
  if (!isPostgresConfigured()) {
    global._dbStatus = {
      connected: false,
      mode: 'local-fallback',
      reason: 'DATABASE_URL not set',
    };
    return false;
  }
  if (global._dbStatus?.connected && global._schemaEnsured) {
    return true;
  }
  if (!global._schemaEnsured) {
    global._schemaEnsured = (async () => {
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            uid TEXT NOT NULL UNIQUE,
            short_uid TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL,
            display_name TEXT NOT NULL DEFAULT 'Student',
            username TEXT NOT NULL DEFAULT '',
            photo_url TEXT NOT NULL DEFAULT '',
            plan TEXT NOT NULL DEFAULT 'basic',
            view_plan_mode TEXT NOT NULL DEFAULT 'auto',
            role TEXT NOT NULL DEFAULT 'user',
            password_hash TEXT NOT NULL DEFAULT '',
            auth_mode TEXT NOT NULL DEFAULT 'google',
            points INTEGER NOT NULL DEFAULT 500,
            pro_started_at TEXT NOT NULL DEFAULT '',
            pro_expires_at TEXT NOT NULL DEFAULT '',
            last_expiry_reminder_for TEXT NOT NULL DEFAULT '',
            contributor_approved BOOLEAN NOT NULL DEFAULT false,
            contributor_requested BOOLEAN NOT NULL DEFAULT false,
            admin_authorized BOOLEAN NOT NULL DEFAULT false,
            admin_first_gift_claimed BOOLEAN NOT NULL DEFAULT false,
            last_weekly_grant_week TEXT NOT NULL DEFAULT '',
            spectra_url TEXT NOT NULL DEFAULT 'https://www.khanacademy.org',
            drive_folder_id TEXT NOT NULL DEFAULT '',
            schedule_sheet_id TEXT NOT NULL DEFAULT '',
            workspace_permissions TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'google';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace_permissions TEXT NOT NULL DEFAULT '';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS infinite_points BOOLEAN NOT NULL DEFAULT false;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS elite_started_at TEXT NOT NULL DEFAULT '';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS elite_expires_at TEXT NOT NULL DEFAULT '';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS elite_visual_effects BOOLEAN NOT NULL DEFAULT true;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS active_pro_gifted BOOLEAN NOT NULL DEFAULT false;

          CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS tasks (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            subject TEXT NOT NULL DEFAULT 'General',
            priority TEXT NOT NULL DEFAULT 'medium',
            status TEXT NOT NULL DEFAULT 'todo',
            due_date TEXT NOT NULL DEFAULT '',
            due_time TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS calendar_events (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            event_date TEXT NOT NULL,
            event_time TEXT NOT NULL DEFAULT '09:00',
            category TEXT NOT NULL DEFAULT 'study',
            notes TEXT NOT NULL DEFAULT '',
            meet_link TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS notebooks (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            subject TEXT NOT NULL DEFAULT 'General',
            color TEXT NOT NULL DEFAULT '#2563EB',
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS note_pages (
            id SERIAL PRIMARY KEY,
            notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            section_name TEXT NOT NULL DEFAULT 'Main Notes',
            title TEXT NOT NULL,
            pages_data JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS exam_schedules (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            subject TEXT NOT NULL,
            paper_name TEXT NOT NULL DEFAULT '',
            exam_type TEXT NOT NULL,
            custom_exam_type TEXT NOT NULL DEFAULT '',
            reading_minutes INTEGER NOT NULL DEFAULT 15,
            writing_minutes INTEGER NOT NULL DEFAULT 180,
            seating_time TEXT NOT NULL DEFAULT '',
            alarm_enabled BOOLEAN NOT NULL DEFAULT true,
            hourly_alarm BOOLEAN NOT NULL DEFAULT true,
            status TEXT NOT NULL DEFAULT 'scheduled',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS study_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            mode TEXT NOT NULL,
            label TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS contact_messages (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            subject TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS user_messages (
            id SERIAL PRIMARY KEY,
            sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            sender_email TEXT NOT NULL,
            sender_username TEXT NOT NULL DEFAULT '',
            recipient_email TEXT NOT NULL DEFAULT '',
            recipient_username TEXT NOT NULL DEFAULT '',
            visibility TEXT NOT NULL DEFAULT 'direct',
            is_admin_mail BOOLEAN NOT NULL DEFAULT false,
            recipient_summary TEXT NOT NULL DEFAULT '',
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            attachment_title TEXT NOT NULL DEFAULT '',
            attachment_note_id INTEGER REFERENCES note_pages(id) ON DELETE SET NULL,
            is_read BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS body_html TEXT NOT NULL DEFAULT '';
          ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb;
          ALTER TABLE user_messages ADD COLUMN IF NOT EXISTS question_spec_json JSONB;

          CREATE TABLE IF NOT EXISTS license_keys (
            id SERIAL PRIMARY KEY,
            key_code TEXT NOT NULL UNIQUE,
            key_type TEXT NOT NULL DEFAULT 'pro',
            duration_months INTEGER NOT NULL DEFAULT 1,
            source_type TEXT NOT NULL DEFAULT 'points',
            no_refund BOOLEAN NOT NULL DEFAULT false,
            purchase_cost INTEGER NOT NULL DEFAULT 0,
            platform_fee INTEGER NOT NULL DEFAULT 0,
            coupon_code TEXT NOT NULL DEFAULT '',
            issued_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            issued_to_email TEXT NOT NULL DEFAULT '',
            issued_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            activation_expires_at TEXT NOT NULL,
            activated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            activated_at TEXT NOT NULL DEFAULT '',
            sub_starts_at TEXT NOT NULL DEFAULT '',
            sub_ends_at TEXT NOT NULL DEFAULT '',
            cancelled_at TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'unused',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'points';
          ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS no_refund BOOLEAN NOT NULL DEFAULT false;
          ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS purchase_cost INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS platform_fee INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS coupon_code TEXT NOT NULL DEFAULT '';
          ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS cancelled_at TEXT NOT NULL DEFAULT '';

          CREATE TABLE IF NOT EXISTS point_transactions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            amount INTEGER NOT NULL,
            reason TEXT NOT NULL,
            category TEXT NOT NULL,
            verification_status TEXT NOT NULL DEFAULT 'pending',
            verified_by_user_id INTEGER,
            verified_by_label TEXT NOT NULL DEFAULT '',
            verification_note TEXT NOT NULL DEFAULT '',
            verified_at TEXT NOT NULL DEFAULT '',
            reverted_transaction_id INTEGER,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending';
          ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS verified_by_user_id INTEGER;
          ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS verified_by_label TEXT NOT NULL DEFAULT '';
          ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS verification_note TEXT NOT NULL DEFAULT '';
          ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS verified_at TEXT NOT NULL DEFAULT '';
          ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS reverted_transaction_id INTEGER;

          CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            sender_label TEXT NOT NULL DEFAULT 'System',
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'info',
            is_read BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS study_materials (
            id SERIAL PRIMARY KEY,
            uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            uploader_email TEXT NOT NULL,
            uploader_name TEXT NOT NULL,
            title TEXT NOT NULL,
            subject TEXT NOT NULL DEFAULT 'General',
            category TEXT NOT NULL DEFAULT 'study_notes',
            description TEXT NOT NULL DEFAULT '',
            file_name TEXT NOT NULL,
            stored_file_name TEXT NOT NULL,
            mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            file_size_bytes BIGINT NOT NULL DEFAULT 0,
            page_count INTEGER NOT NULL DEFAULT 1,
            hourly_rent_cost INTEGER NOT NULL DEFAULT 10,
            buy_cost INTEGER NOT NULL DEFAULT 40,
            drive_file_id TEXT NOT NULL DEFAULT '',
            drive_web_link TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'approved',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
          ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS media_kind TEXT NOT NULL DEFAULT 'pdf';

          CREATE TABLE IF NOT EXISTS material_purchases (
            id SERIAL PRIMARY KEY,
            material_id INTEGER NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
            material_title TEXT NOT NULL DEFAULT '',
            buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            buyer_email TEXT NOT NULL,
            buyer_name TEXT NOT NULL,
            uploader_id INTEGER NOT NULL,
            access_type TEXT NOT NULL DEFAULT 'rent',
            hours INTEGER NOT NULL DEFAULT 1,
            hourly_rate INTEGER NOT NULL DEFAULT 10,
            page_count INTEGER NOT NULL DEFAULT 1,
            base_cost INTEGER NOT NULL DEFAULT 0,
            platform_fee INTEGER NOT NULL DEFAULT 3,
            discount_percent INTEGER NOT NULL DEFAULT 0,
            coupon_code TEXT NOT NULL DEFAULT '',
            total_cost INTEGER NOT NULL DEFAULT 10,
            status TEXT NOT NULL DEFAULT 'active',
            cancelled_at TEXT NOT NULL DEFAULT '',
            refund_amount INTEGER NOT NULL DEFAULT 0,
            expires_at TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          ALTER TABLE material_purchases ADD COLUMN IF NOT EXISTS base_cost INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE material_purchases ADD COLUMN IF NOT EXISTS platform_fee INTEGER NOT NULL DEFAULT 3;
          ALTER TABLE material_purchases ADD COLUMN IF NOT EXISTS discount_percent INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE material_purchases ADD COLUMN IF NOT EXISTS coupon_code TEXT NOT NULL DEFAULT '';
          ALTER TABLE material_purchases ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
          ALTER TABLE material_purchases ADD COLUMN IF NOT EXISTS cancelled_at TEXT NOT NULL DEFAULT '';
          ALTER TABLE material_purchases ADD COLUMN IF NOT EXISTS refund_amount INTEGER NOT NULL DEFAULT 0;

          CREATE TABLE IF NOT EXISTS exam_blueprints (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            paper_code TEXT NOT NULL,
            subject TEXT NOT NULL,
            exam_type TEXT NOT NULL DEFAULT 'JEE Main',
            exam_date TEXT NOT NULL,
            exam_time TEXT NOT NULL DEFAULT '09:00',
            total_marks INTEGER NOT NULL DEFAULT 100,
            marks_scored INTEGER,
            percentage TEXT NOT NULL DEFAULT '',
            syllabus JSONB NOT NULL DEFAULT '[]'::jsonb,
            question_paper_url TEXT NOT NULL DEFAULT '',
            answer_sheet_url TEXT NOT NULL DEFAULT '',
            corrected_answer_sheet_url TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS contributor_folders (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            username TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL,
            parent_id INTEGER,
            path TEXT NOT NULL,
            drive_folder_id TEXT NOT NULL DEFAULT '',
            master_drive_folder_id TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS contributor_files (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            username TEXT NOT NULL DEFAULT '',
            folder_id INTEGER REFERENCES contributor_folders(id) ON DELETE SET NULL,
            folder_path TEXT NOT NULL DEFAULT '',
            file_name TEXT NOT NULL,
            stored_file_name TEXT NOT NULL,
            mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            file_size_bytes BIGINT NOT NULL DEFAULT 0,
            drive_file_id TEXT NOT NULL DEFAULT '',
            drive_web_link TEXT NOT NULL DEFAULT '',
            master_drive_file_id TEXT NOT NULL DEFAULT '',
            master_drive_web_link TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS exam_countdowns (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            scope TEXT NOT NULL DEFAULT 'user',
            title TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '',
            target_date TEXT NOT NULL,
            target_time TEXT NOT NULL DEFAULT '',
            pinned_by_default BOOLEAN NOT NULL DEFAULT false,
            created_by_label TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS pro_refund_requests (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_email TEXT NOT NULL,
            username TEXT NOT NULL DEFAULT '',
            display_name TEXT NOT NULL DEFAULT '',
            short_uid TEXT NOT NULL DEFAULT '',
            plan_term TEXT NOT NULL DEFAULT 'monthly',
            refund_basis TEXT NOT NULL DEFAULT 'time_remaining_minus_5',
            points_paid INTEGER NOT NULL DEFAULT 0,
            remaining_percent INTEGER NOT NULL DEFAULT 0,
            remaining_days INTEGER NOT NULL DEFAULT 0,
            total_days INTEGER NOT NULL DEFAULT 30,
            requested_refund_points INTEGER NOT NULL DEFAULT 0,
            reason TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            admin_note TEXT NOT NULL DEFAULT '',
            reviewed_by_user_id INTEGER,
            reviewed_by_label TEXT NOT NULL DEFAULT '',
            reviewed_at TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS forum_rooms (
            id SERIAL PRIMARY KEY,
            room_type TEXT NOT NULL DEFAULT 'group',
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            subject TEXT NOT NULL DEFAULT 'General',
            dm_key TEXT NOT NULL DEFAULT '',
            created_by_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS forum_members (
            id SERIAL PRIMARY KEY,
            room_id INTEGER NOT NULL REFERENCES forum_rooms(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            member_role TEXT NOT NULL DEFAULT 'member',
            last_read_at TIMESTAMP NOT NULL DEFAULT NOW(),
            joined_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS forum_posts (
            id SERIAL PRIMARY KEY,
            room_id INTEGER NOT NULL REFERENCES forum_rooms(id) ON DELETE CASCADE,
            author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            post_kind TEXT NOT NULL DEFAULT 'question',
            title TEXT NOT NULL DEFAULT '',
            content_html TEXT NOT NULL DEFAULT '',
            content_text TEXT NOT NULL DEFAULT '',
            subject TEXT NOT NULL DEFAULT 'General',
            exam_board TEXT NOT NULL DEFAULT 'Competitive / Custom',
            question_spec JSONB,
            answer_key JSONB,
            official_explanation_html TEXT NOT NULL DEFAULT '',
            is_solved BOOLEAN NOT NULL DEFAULT false,
            accepted_reply_id INTEGER,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS forum_attempts (
            id SERIAL PRIMARY KEY,
            post_id INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            attempt_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            is_correct BOOLEAN,
            score_note TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS forum_replies (
            id SERIAL PRIMARY KEY,
            post_id INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
            author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            parent_reply_id INTEGER,
            reply_kind TEXT NOT NULL DEFAULT 'opinion',
            content_html TEXT NOT NULL DEFAULT '',
            content_text TEXT NOT NULL DEFAULT '',
            attempt_payload JSONB,
            is_accepted_solution BOOLEAN NOT NULL DEFAULT false,
            accepted_points_awarded INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS forum_reply_votes (
            id SERIAL PRIMARY KEY,
            reply_id INTEGER NOT NULL REFERENCES forum_replies(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS forum_attachments (
            id SERIAL PRIMARY KEY,
            post_id INTEGER REFERENCES forum_posts(id) ON DELETE CASCADE,
            reply_id INTEGER REFERENCES forum_replies(id) ON DELETE CASCADE,
            message_id INTEGER REFERENCES user_messages(id) ON DELETE CASCADE,
            uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            file_name TEXT NOT NULL,
            stored_file_name TEXT NOT NULL,
            mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            file_size_bytes BIGINT NOT NULL DEFAULT 0,
            page_count INTEGER NOT NULL DEFAULT 1,
            kind TEXT NOT NULL DEFAULT 'image',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS formula_equations (
            id SERIAL PRIMARY KEY,
            author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            author_name TEXT NOT NULL DEFAULT 'Contributor',
            author_username TEXT NOT NULL DEFAULT 'contributor',
            title TEXT NOT NULL,
            subject TEXT NOT NULL DEFAULT 'Physics',
            case_name TEXT NOT NULL DEFAULT 'General',
            expression TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            symbols_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          ALTER TABLE formula_equations ADD COLUMN IF NOT EXISTS case_name TEXT NOT NULL DEFAULT 'General';

          CREATE TABLE IF NOT EXISTS coupons (
            id SERIAL PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL DEFAULT '',
            scope TEXT NOT NULL DEFAULT 'all',
            discount_type TEXT NOT NULL DEFAULT 'percent',
            discount_value INTEGER NOT NULL DEFAULT 10,
            max_uses INTEGER NOT NULL DEFAULT 0,
            used_count INTEGER NOT NULL DEFAULT 0,
            expires_at TEXT NOT NULL DEFAULT '',
            active BOOLEAN NOT NULL DEFAULT true,
            created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS app_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            app_key TEXT NOT NULL DEFAULT 'formula_calculator',
            app_name TEXT NOT NULL DEFAULT 'Formula Equation Calculator',
            billing_mode TEXT NOT NULL DEFAULT 'metered_hourly',
            hourly_rate INTEGER NOT NULL DEFAULT 30,
            base_cost INTEGER NOT NULL DEFAULT 0,
            platform_fee INTEGER NOT NULL DEFAULT 8,
            discount_percent INTEGER NOT NULL DEFAULT 0,
            coupon_code TEXT NOT NULL DEFAULT '',
            total_cost INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            started_at TEXT NOT NULL DEFAULT '',
            expires_at TEXT NOT NULL DEFAULT '',
            cancelled_at TEXT NOT NULL DEFAULT '',
            refund_amount INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS plan_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            tier TEXT NOT NULL DEFAULT 'pro',
            term TEXT NOT NULL DEFAULT 'monthly',
            source_type TEXT NOT NULL DEFAULT 'points',
            key_code TEXT NOT NULL DEFAULT '',
            no_refund BOOLEAN NOT NULL DEFAULT false,
            base_cost INTEGER NOT NULL DEFAULT 0,
            platform_fee INTEGER NOT NULL DEFAULT 25,
            coupon_code TEXT NOT NULL DEFAULT '',
            total_cost INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            started_at TEXT NOT NULL DEFAULT '',
            expires_at TEXT NOT NULL DEFAULT '',
            cancelled_at TEXT NOT NULL DEFAULT '',
            refund_amount INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_forum_members_room_user ON forum_members(room_id, user_id);
          CREATE INDEX IF NOT EXISTS idx_forum_posts_room_created ON forum_posts(room_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_forum_replies_post_created ON forum_replies(post_id, created_at ASC);
          CREATE INDEX IF NOT EXISTS idx_forum_attempts_post_user ON forum_attempts(post_id, user_id);
        `);
      } finally {
        client.release();
      }
    })();
  }
  try {
    await global._schemaEnsured;
    global._dbStatus = { connected: true, mode: 'postgres' };
    return true;
  } catch (err) {
    global._schemaEnsured = undefined;
    const reason = classifyDatabaseError(err);
    global._dbStatus = { connected: false, mode: 'local-fallback', reason };
    console.warn('Postgres connection unavailable, using local fallback store:', err instanceof Error ? err.message : err);
    return false;
  }
}

export async function verifyDatabaseConnection(): Promise<boolean> {
  if (!isPostgresConfigured()) {
    global._dbStatus = {
      connected: false,
      mode: 'local-fallback',
      reason: 'DATABASE_URL not set',
    };
    return false;
  }
  if (!global._dbStatus?.connected) {
    return ensureDatabaseSchema();
  }
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    global._schemaEnsured = undefined;
    const reason = classifyDatabaseError(err);
    global._dbStatus = { connected: false, mode: 'local-fallback', reason };
    return ensureDatabaseSchema();
  }
}
