import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { brandConfig, getCustomLogoUrl } from '../../lib/brandConfig';

interface HubcomLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  stacked?: boolean;
  className?: string;
  /** wordmark | product = „Hubcom ServiceDesk“, company = „Hubcom - Citadelle AG“ */
  wordmark?: 'product' | 'company' | 'short';
}

/** Sauberes Platzhalter-SVG: Schild + „H“ im Navy/Akzent der Hubcom-Citadelle-Marke. */
export function HubcomPlaceholderMark({ className }: { className?: string }) {
  const { navy, accent } = brandConfig.colors;
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect x="2" y="2" width="60" height="60" rx="14" fill={navy} />
      <path
        d="M32 10 L50 18 V34 C50 44 42 52 32 56 C22 52 14 44 14 34 V18 Z"
        fill={accent}
        opacity="0.95"
      />
      <path
        d="M32 16 L44 22 V33.5 C44 40.2 38.8 46.2 32 49 C25.2 46.2 20 40.2 20 33.5 V22 Z"
        fill={navy}
      />
      <path
        d="M26 26 V40 H29.2 V34.2 H34.8 V40 H38 V26 H34.8 V31.4 H29.2 V26 H26 Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function HubcomLogo({
  size = 'md',
  showText = true,
  stacked = false,
  className,
  wordmark = 'product',
}: HubcomLogoProps) {
  const [customLogo, setCustomLogo] = useState<string | null>(() => getCustomLogoUrl());

  useEffect(() => {
    const sync = () => setCustomLogo(getCustomLogoUrl());
    window.addEventListener('hubcom-brand-logo-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('hubcom-brand-logo-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const iconSizes = {
    xs: 'w-8 h-8 md:w-9 md:h-9',
    sm: 'w-11 h-11 md:w-12 md:h-12',
    md: 'w-20 h-20 md:w-24 md:h-24',
    lg: 'w-40 h-40 md:w-48 md:h-48',
    xl: 'w-56 h-56 md:w-64 md:h-64',
  };

  const textSizes = {
    xs: 'text-sm md:text-base font-bold tracking-tight',
    sm: 'text-lg md:text-xl font-bold tracking-tight',
    md: 'text-2xl md:text-3xl font-bold tracking-tight',
    lg: 'text-4xl md:text-5xl font-bold tracking-tight',
    xl: 'text-6xl md:text-7xl font-bold tracking-tight',
  };

  const gapSizes = {
    xs: 'gap-2',
    sm: 'gap-3',
    md: 'gap-4',
    lg: 'gap-5',
    xl: 'gap-7',
  };

  const label =
    wordmark === 'company'
      ? brandConfig.companyName
      : wordmark === 'short'
        ? brandConfig.productShortName
        : brandConfig.productName;

  return (
    <div
      className={cn(
        'inline-flex items-center select-none',
        stacked ? 'flex-col text-center' : 'flex-row',
        gapSizes[size],
        className,
      )}
    >
      <div className={cn('relative shrink-0 flex items-center justify-center', iconSizes[size])}>
        {customLogo ? (
          <img
            src={customLogo}
            alt={brandConfig.companyName}
            className="w-full h-full object-contain drop-shadow-sm"
          />
        ) : (
          <HubcomPlaceholderMark className="w-full h-full drop-shadow-sm" />
        )}
      </div>

      {showText && (
        <span
          className={cn(
            'font-sans select-none tracking-tight text-[#0B1F3A] dark:text-white',
            textSizes[size],
          )}
        >
          {wordmark === 'product' ? (
            <>
              <span className="font-semibold">Hubcom </span>
              <span className="font-extrabold text-[#1B6CA8]">ServiceDesk</span>
            </>
          ) : (
            <span className="font-semibold">{label}</span>
          )}
        </span>
      )}
    </div>
  );
}

/** @deprecated Alias für bestehende Imports — bitte HubcomLogo verwenden. */
export { HubcomLogo as GeistDeskLogo };
