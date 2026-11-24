import type { ComponentType } from 'react';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

interface AdminCardProps {
  title: string;
  description: string;
  icon: LucideIcon | ComponentType<{ className?: string }>;
  path: string;
  badge?: string;
  color?: string;
  bgColor?: string;
  borderColor?: string;
  onClick: () => void | Promise<unknown>;
  className?: string;
  actionLabel?: string;
  /** When true, card is not activatable and shows disabledReason if provided. */
  disabled?: boolean;
  disabledReason?: string;
}

export function AdminCard({
  title,
  description,
  icon: Icon,
  path,
  badge,
  color = 'text-primary',
  bgColor = 'bg-primary/10',
  borderColor = 'border-primary/20',
  onClick,
  className,
  actionLabel,
  disabled = false,
  disabledReason,
}: AdminCardProps) {
  const label = actionLabel || 'Configure Section';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn('group h-full', className)}
    >
      <Card
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label={disabled ? `${title}. ${disabledReason || 'Nicht verfügbar'}` : `${title}. ${label}`}
        data-path={path}
        onClick={() => {
          if (disabled) return;
          void onClick();
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void onClick();
          }
        }}
        className={cn(
          'h-full border-slate-100 rounded-3xl overflow-hidden bg-white transition-all duration-300',
          disabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2',
        )}
      >
        <CardHeader className="pb-4">
          <div className="flex justify-between items-start mb-4">
            <div
              className={cn(
                'w-12 h-12 rounded-2xl flex items-center justify-center border transition-transform duration-300',
                bgColor,
                color,
                borderColor,
                !disabled && 'group-hover:scale-110',
              )}
            >
              <Icon className="w-6 h-6" aria-hidden />
            </div>
            {badge ? (
              <Badge
                variant="outline"
                className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 border-slate-200 text-slate-400"
              >
                {badge}
              </Badge>
            ) : null}
          </div>
          <CardTitle
            className={cn(
              'text-xl font-bold text-slate-900 transition-colors',
              !disabled && 'group-hover:text-primary',
            )}
          >
            {title}
          </CardTitle>
          <CardDescription className="text-sm text-slate-500 leading-relaxed min-h-[40px]">
            {description}
          </CardDescription>
          {disabled && disabledReason ? (
            <p className="text-[11px] font-semibold text-amber-700 mt-2" role="status">
              {disabledReason}
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between pt-2 border-t border-slate-50 mt-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {disabled ? 'Nicht verfügbar' : label}
            </span>
            <div
              className={cn(
                'w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 transition-all duration-300',
                !disabled && 'group-hover:bg-primary group-hover:text-white',
              )}
              aria-hidden
            >
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
