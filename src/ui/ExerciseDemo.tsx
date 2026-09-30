import { useEffect, useMemo, useState } from 'react';
import { findDemo } from '@/data/exerciseDemos';
import { loadCatalogueSteps } from '@/data/catalogue';
import { demoFrameSrc, demoPicture, pictureFitClass } from './demoPicture';

/** YouTube search results URL for an exercise's form, used as the default "Video" link target. */
export function youtubeSearchUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' form')}`;
}

const FRAME_MS = 600;

/**
 * A looping demonstration for one exercise, with its instructions (when there are any) and a link to
 * search for video of it. `slug` is the exercise's `demo` value: a bundled diagram (square, frame
 * count varies — most are 3, some are fewer) or a catalogue key (photographs in a 3:2 box, two frames; its
 * steps are fetched here, the first time the demo is shown, and an entry without any shows none).
 * Renders nothing when the value names no picture. A catalogue key whose pictures are not there
 * (see DemoThumb) drops the picture and keeps the rest: the steps, where there are any, and the
 * Video link.
 */
export function ExerciseDemo({ slug, name, videoUrl, size = 'lg' }: { slug: string; name: string; videoUrl?: string; size?: 'sm' | 'lg' }) {
  const pic = useMemo(() => demoPicture(slug), [slug]);
  const [frame, setFrame] = useState(1);
  const [paused, setPaused] = useState(false);
  /** The key whose picture failed to load: every frame of a missing entry is missing, so the key is what is remembered, not the frame. */
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ slug: string; steps: string[] } | null>(null);

  const frames = pic?.frames ?? 0;
  useEffect(() => {
    if (frames === 0 || paused) return;
    const id = window.setInterval(() => {
      setFrame((f) => (f % frames) + 1);
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [frames, paused]);

  const catalogueSlug = pic?.kind === 'catalogue' ? pic.slug : null;
  useEffect(() => {
    if (catalogueSlug === null) return;
    let live = true;
    loadCatalogueSteps(catalogueSlug).then(
      (steps) => {
        if (live) setLoaded({ slug: catalogueSlug, steps: steps ?? [] });
      },
      () => {
        // The steps are an extra: the pictures stand without them.
      },
    );
    return () => {
      live = false;
    };
  }, [catalogueSlug]);

  // A key that changes under a mounted demo can leave `frame` past the new picture's last one.
  const src = demoFrameSrc(slug, Math.min(frame, Math.max(frames, 1)));
  if (!pic || !src) return null;

  const instructions = pic.kind === 'catalogue' ? (loaded?.slug === pic.slug ? loaded.steps : []) : (findDemo(pic.slug)?.instructions ?? []);
  const wide = pic.shape === 'wide';
  const imgSize = wide ? (size === 'sm' ? 'w-36 h-24' : 'w-full max-w-sm aspect-[3/2]') : size === 'sm' ? 'w-32 h-32' : 'w-full max-w-xs aspect-square';

  return (
    <div className="flex flex-col items-center gap-3">
      {failed === slug ? (
        <span hidden data-testid="demo-missing" />
      ) : (
        <>
          <button
            type="button"
            aria-pressed={paused}
            aria-label={paused ? 'Play' : 'Pause'}
            onClick={() => setPaused((p) => !p)}
            className={`relative overflow-hidden rounded-2xl bg-surface-2 border border-line ${imgSize}`}
          >
            <img src={src} alt={name} data-testid="demo-frame" onError={() => setFailed(slug)} className={`h-full w-full ${pictureFitClass(pic)}`} />
          </button>

          <div className="flex items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: pic.frames }, (_, i) => i + 1).map((i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === frame ? 'bg-fg' : 'bg-line'}`} />
            ))}
          </div>
        </>
      )}

      {instructions.length > 0 && (
        <ol className="w-full list-decimal space-y-1.5 pl-5 text-sm text-muted marker:text-dim" data-testid="demo-steps">
          {instructions.map((step, i) => (
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
