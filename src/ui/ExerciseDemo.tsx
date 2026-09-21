import { useEffect, useState } from 'react';
import { demoFrameUrl, findDemo } from '@/data/exerciseDemos';

/** YouTube search results URL for an exercise's form, used as the default "Video" link target. */
export function youtubeSearchUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' form')}`;
}

const FRAME_MS = 600;

/**
 * A looping demonstration for one exercise (frame count varies by demo — most are 3, some are
 * fewer), with its instructions (when matched) and a link to search for video of it. Renders
 * nothing when the slug has no demo.
 */
export function ExerciseDemo({ slug, name, videoUrl, size = 'lg' }: { slug: string; name: string; videoUrl?: string; size?: 'sm' | 'lg' }) {
  const demo = findDemo(slug);
  const [frame, setFrame] = useState(1);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!demo || paused) return;
    const id = window.setInterval(() => {
      setFrame((f) => (f % demo.frames) + 1);
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [demo, paused]);

  if (!demo) return null;

  const imgSize = size === 'sm' ? 'w-32 h-32' : 'w-full max-w-xs aspect-square';

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        aria-pressed={paused}
        aria-label={paused ? 'Play' : 'Pause'}
        onClick={() => setPaused((p) => !p)}
        className={`relative overflow-hidden rounded-2xl bg-surface-2 border border-line ${imgSize}`}
      >
        <img
          src={demoFrameUrl(slug, frame)}
          alt={name}
          className={demo.photo ? 'h-full w-full object-cover' : 'demo-frame h-full w-full object-contain'}
        />
      </button>

      <div className="flex items-center gap-1.5" aria-hidden="true">
        {Array.from({ length: demo.frames }, (_, i) => i + 1).map((i) => (
          <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === frame ? 'bg-fg' : 'bg-line'}`} />
        ))}
      </div>

      {demo.instructions.length > 0 && (
        <ol className="w-full list-decimal space-y-1.5 pl-5 text-sm text-muted marker:text-dim">
          {demo.instructions.map((step, i) => (
            <li key={i} className="pl-1">
              {step}
            </li>
          ))}
        </ol>
      )}

      <a
        href={videoUrl ?? youtubeSearchUrl(name)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-4 text-base font-semibold text-fg active:brightness-110"
      >
        Video
      </a>
    </div>
  );
}
