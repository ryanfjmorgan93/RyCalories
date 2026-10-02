/** Marks a row that is a library entry rather than one of the owner's exercises. */
export function LibraryLabel({ className = '' }: { className?: string }) {
  return (
    <span data-testid="library-label" className={`shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted ${className}`}>
      Library
    </span>
  );
}
