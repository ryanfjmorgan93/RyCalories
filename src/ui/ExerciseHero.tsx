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
export function ExerciseHero({ demo, className = '', children, arena = false }: { demo: string | undefined; className?: string; children?: ReactNode; arena?: boolean }) {
  const src = robotSrc(demo);
  const [failed, setFailed] = useState<string | null>(null);
  const showRender = src !== undefined && failed !== src;
  return (
    <div data-testid="exercise-hero" data-render={showRender ? 'robot' : 'glow'} className={`relative isolate overflow-hidden bg-black ${className}`}>
      {arena && showRender && <ArenaLights />}
      {showRender && (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          decoding="async"
          loading="lazy"
          onError={() => setFailed(src)}
          // In the arena the figure stands under the lights, whole, on the floor; elsewhere it fills its frame.
          className={arena ? 'absolute inset-x-0 bottom-0 -z-10 h-[calc(100%-2.75rem)] w-full object-contain object-bottom' : 'absolute inset-0 -z-10 h-full w-full object-cover object-[50%_40%]'}
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

/**
 * The arena's ceiling over a lead render (v5, after the owner's Third Space reference): a ring of
 * round lights in perspective and the warm pool they throw, all above the robot and screened onto
 * the black, so nothing is drawn over the figure itself.
 */
function ArenaLights() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-[5] mix-blend-screen">
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 55% 60% at 50% 0%, rgba(255,226,180,0.2), rgba(255,226,180,0.05) 50%, transparent 72%)' }} />
      <svg className="absolute inset-x-0 top-0 h-[70px] w-full" viewBox="0 0 390 70" preserveAspectRatio="none">
        <defs>
          <radialGradient id="arena-lamp" cx="50%" cy="45%" r="60%">
            <stop offset="0" stopColor="#fff6e6" stopOpacity="0.95" />
            <stop offset="0.55" stopColor="#ffe9c7" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffe9c7" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d="M-20,8 Q195,58 410,8" fill="none" stroke="rgba(255,240,215,0.22)" strokeWidth="1.5" />
        <ellipse cx="128" cy="20" rx="30" ry="7" fill="url(#arena-lamp)" />
        <ellipse cx="195" cy="26" rx="32" ry="7.5" fill="url(#arena-lamp)" />
        <ellipse cx="262" cy="20" rx="30" ry="7" fill="url(#arena-lamp)" />
        <ellipse cx="160" cy="40" rx="27" ry="6" fill="url(#arena-lamp)" opacity="0.8" />
        <ellipse cx="230" cy="40" rx="27" ry="6" fill="url(#arena-lamp)" opacity="0.8" />
        <ellipse cx="72" cy="10" rx="26" ry="5.5" fill="url(#arena-lamp)" opacity="0.7" />
        <ellipse cx="318" cy="10" rx="26" ry="5.5" fill="url(#arena-lamp)" opacity="0.7" />
      </svg>
    </div>
  );
}
