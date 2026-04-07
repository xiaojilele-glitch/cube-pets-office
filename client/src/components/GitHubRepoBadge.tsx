import { ExternalLink, Github, Star } from 'lucide-react';

import {
  GITHUB_REPOSITORY,
  GITHUB_REPOSITORY_URL,
  IS_GITHUB_PAGES,
} from '@/lib/deploy-target';
import { cn } from '@/lib/utils';

type GitHubRepoBadgeProps = {
  className?: string;
};

export function GitHubRepoBadge({ className }: GitHubRepoBadgeProps) {
  if (!IS_GITHUB_PAGES) return null;

  return (
    <a
      href={GITHUB_REPOSITORY_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${GITHUB_REPOSITORY} on GitHub`}
      className={cn(
        'glass-panel group block rounded-[24px] p-3.5 text-white/90',
        'transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white/18',
        'active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-cyan-400/35',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-white/10 text-white shadow-sm">
          <Github className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/50">
            GitHub / Star
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-white">
            {GITHUB_REPOSITORY}
          </p>
          <p className="mt-1 truncate text-[11px] text-white/50">
            {GITHUB_REPOSITORY_URL.replace(/^https?:\/\//, '')}
          </p>
        </div>

        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] bg-white/10 text-white/60 transition-colors group-hover:bg-white/15">
          <ExternalLink className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-[11px] text-white/50">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 font-medium text-white/60">
          <Star className="h-3.5 w-3.5 fill-current" />
          Open repository
        </span>
        <span className="text-right">Tap or click to visit on GitHub</span>
      </div>
    </a>
  );
}
