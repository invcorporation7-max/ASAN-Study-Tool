import React from 'react';

interface UserAvatarBadgeProps {
  name: string;
  photoUrl?: string;
  plan?: string;
  role?: string;
  contributorApproved?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const UserAvatarBadge: React.FC<UserAvatarBadgeProps> = ({
  name,
  photoUrl,
  plan = 'basic',
  role = 'user',
  contributorApproved = false,
  size = 'md',
}) => {
  const isSuper = role === 'super';
  const isAdmin = role === 'admin';
  const isContributor = Boolean(contributorApproved) || role === 'contributor';
  const isPro = plan === 'pro';

  const dim =
    size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-12 w-12 text-base' : 'h-9 w-9 text-sm';

  // Ring & Glow rules:
  // - Super: Purple + Amber Developer Ring + Golden/Violet Glow
  // - Admin: Golden ring + Red glow
  // - Approved Contributor: Red glow (Rainbow ring + red glow if also Pro, else Red ring + red glow)
  // - Pro: Rainbow gradient ring
  // - Basic / Normal: Plain Blue ring
  let ringClass = 'bg-blue-600';
  let glowClass = '';
  let badgeTitle = 'Basic Plan (Blue Ring)';

  if (isSuper) {
    ringClass = 'bg-gradient-to-tr from-violet-600 via-amber-400 to-rose-500';
    glowClass = 'shadow-[0_0_14px_rgba(124,58,237,0.62)]';
    badgeTitle = 'Super Developer Mode';
  } else if (isAdmin) {
    ringClass = 'bg-gradient-to-tr from-amber-300 via-yellow-500 to-amber-600';
    glowClass = 'shadow-[0_0_12px_rgba(239,68,68,0.68)]';
    badgeTitle = 'Admin (Golden Ring + Red Glow)';
  } else if (isContributor && isPro) {
    ringClass = 'bg-gradient-to-tr from-rose-500 via-amber-400 via-emerald-400 to-blue-600';
    glowClass = 'shadow-[0_0_12px_rgba(239,68,68,0.68)]';
    badgeTitle = 'Pro + Approved Contributor (Rainbow Ring + Red Glow)';
  } else if (isContributor) {
    ringClass = 'bg-red-600';
    glowClass = 'shadow-[0_0_12px_rgba(239,68,68,0.68)]';
    badgeTitle = 'Approved Contributor (Red Glow)';
  } else if (isPro) {
    ringClass = 'bg-gradient-to-tr from-rose-500 via-amber-400 via-emerald-400 to-blue-600';
    badgeTitle = 'Pro Plan (Rainbow Ring)';
  }

  const initials = (name || 'S').trim().charAt(0).toUpperCase();

  return (
    <div
      title={badgeTitle}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full p-[2.5px] ${ringClass} ${glowClass}`}
    >
      <div
        className={`flex ${dim} items-center justify-center overflow-hidden rounded-full bg-white font-semibold text-slate-800 ring-1 ring-white`}
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={name}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-700">
            {initials}
          </span>
        )}
      </div>
    </div>
  );
};
