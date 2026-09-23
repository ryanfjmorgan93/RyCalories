export function ChevronIcon({ expanded }: { expanded?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={expanded ? 'rotate-180' : ''}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function AskIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 20l1-5.5A8.38 8.38 0 0 1 3 11.5 8.5 8.5 0 0 1 11.5 3a8.5 8.5 0 0 1 9.5 8.5Z" />
    </svg>
  );
}

/** A pencil, for the exercise cue — the owner's own note, styled neutral rather than alarm orange. */
export function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    </svg>
  );
}
