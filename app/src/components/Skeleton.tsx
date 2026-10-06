import { cn } from '../lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-xl', className)} />;
}

export function ConversationSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="space-y-1 px-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl px-3 py-3" style={{ opacity: 1 - i * 0.11 }}>
          <Skeleton className="h-13 w-13 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2.5">
            <div className="flex justify-between">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessagesSkeleton() {
  const rows = [
    { own: false, w: 'w-48' },
    { own: false, w: 'w-64' },
    { own: true, w: 'w-40' },
    { own: false, w: 'w-56' },
    { own: true, w: 'w-60' },
    { own: true, w: 'w-32' },
    { own: false, w: 'w-44' },
  ];
  return (
    <div className="flex flex-col gap-2.5 px-4 py-6">
      {rows.map((r, i) => (
        <div key={i} className={cn('flex', r.own ? 'justify-end' : 'justify-start')}>
          <Skeleton className={cn('h-10 rounded-3xl', r.w)} />
        </div>
      ))}
    </div>
  );
}
