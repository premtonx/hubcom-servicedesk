import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

interface EmailCcInputProps {
  value: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
  className?: string;
}

/** CC-Empfänger als Chips; Enter/Komma/Semikolon bestätigt; ungültige Adressen werden abgelehnt. */
export function EmailCcInput({
  value,
  onChange,
  placeholder = 'cc@beispiel.de, weitere@…',
  className,
}: EmailCcInputProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = (raw: string) => {
    const parts = parseEmailList(raw);
    if (parts.length === 0) {
      setDraft('');
      return;
    }
    const next = [...value];
    let hadInvalid = false;
    for (const part of parts) {
      if (!isValidEmail(part)) {
        hadInvalid = true;
        continue;
      }
      if (!next.includes(part)) next.push(part);
    }
    if (hadInvalid) {
      setError('Ungültige E-Mail-Adresse');
    } else {
      setError(null);
    }
    onChange(next);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      commit(draft);
      return;
    }
    if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className={cn('flex-1 min-w-0', className)}>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 min-h-8 rounded-lg border border-border/60 bg-muted/40 px-2 py-1',
          error && 'border-rose-300',
        )}
      >
        {value.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 rounded-md bg-background border border-border/50 px-1.5 py-0.5 font-mono text-[11px] text-foreground"
          >
            {email}
            <button
              type="button"
              className="text-muted-foreground hover:text-rose-600"
              onClick={() => onChange(value.filter((e) => e !== email))}
              aria-label={`${email} entfernen`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-[11px] font-mono text-foreground placeholder:text-muted-foreground/70 py-0.5"
        />
      </div>
      {error ? <p className="text-[10px] text-rose-600 mt-0.5">{error}</p> : null}
    </div>
  );
}
