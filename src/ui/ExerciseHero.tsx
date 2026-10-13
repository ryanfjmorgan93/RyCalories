import { useState, type ReactNode } from 'react';
import { robotSrc } from './demoPicture';

/**
 * The picture at the head of an exercise (look A, G2): its robot render on black with the accent
 * glow rising from underneath, or, where there is no render, the glow alone on black. Never a
 * photograph of a person; the technique frames stay behind the "How to" tap. Whatever is passed as
 * children sits on top, above the glow, so the name and the numbers stay readable.
 *
 * The render is bundled (public/robots/), so nothing is fetched. If the file is somehow missing
 * (a restore from another build), the image drops out and the glow remains.
 */
export function ExerciseHero({ demo, className = '', children }: { demo: string | undefined; className?: string; children?: ReactNode }) {
  const src = robotSrc(demo);
  const [failed, setFailed] = useState<string | null>(null);
  const showRender = src !== undefined && failed !== src;
  return (
    <div data-testid="exercise-hero" data-render={showRender ? 'robot' : 'glow'} className={`relative isolate overflow-hidden bg-black ${className}`}>
      {showRender && (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          decoding="async"
          loading="lazy"
          onError={() => setFailed(src)}
          className="absolute inset-0 -z-10 h-full w-full object-cover object-[50%_40%]"
        />
      )}
      <div aria-hidden="true" className="ember-glow absolute inset-0 -z-10" />
      {children}
    </div>
  );
}

/** A list row's picture: the robot render in a small glowing tile, or the glow alone. */
export function RobotThumb({ demo, className = '' }: { demo: string | undefined; className?: string }) {
  return <ExerciseHero demo={demo} className={`h-12 w-12 shrink-0 rounded-[10px] ${className}`} />;
}
