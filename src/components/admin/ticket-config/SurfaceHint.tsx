import { Info } from 'lucide-react';

export function SurfaceHint({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
      <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden />
      <p>{text}</p>
    </div>
  );
}
