import { Suspense, lazy, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { type SearchPoint } from '@marketplace/contracts';

/**
 * The map's code-split boundary — the part of `R9` that is actually a code decision.
 *
 * ADR-011 §6: *"the results page renders the **list without the map**; the map is a separate chunk
 * loaded on viewport or on interaction… If the map fails to load, the page still works."* Maps are
 * named there as "the budget's main threat", and `W12-T15` sets ≤170 KB of initial JS.
 *
 * Three things make that true rather than stated:
 *
 * 1. `lazy(() => import(...))` — a real dynamic import, so Rollup emits a separate chunk. A build
 *    test asserts that, because a refactor that makes this static still *works* and silently moves
 *    the map into the initial bundle, and no behavioural test can see it.
 * 2. `IntersectionObserver`, inside an effect — the chunk is not requested until the region is
 *    scrolled to. In an effect because `R2` forbids a browser global at module scope: this module
 *    is imported by a route, and `W12-T14` will import routes on a Worker.
 * 3. Nothing above awaits it. The region renders its own heading and a fallback immediately; the
 *    list does not wait, and a chunk that never arrives changes nothing.
 */
const ResultsMap = lazy(() => import('./ResultsMap.js'));

export interface MapRegionProps {
  points: { id: string; label: string; point: SearchPoint }[];
}

export function MapRegion({ points }: MapRegionProps): ReactElement {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const [isVisible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null || isVisible) return;

    // No `IntersectionObserver` — jsdom, an old browser, a Worker render. Showing the map is the
    // safe fallback: the failure mode of loading it too eagerly is a slower page, and the failure
    // mode of never loading it is a feature that silently does not exist.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [isVisible]);

  return (
    <section
      className="mp-map"
      ref={ref}
      aria-labelledby="results-map"
      data-testid="map-region"
      data-loaded={isVisible}
    >
      <h2 id="results-map" className="mp-visually-hidden">
        {t('results.map.title')}
      </h2>
      {/* `Suspense` is what makes a failed or slow chunk a non-event. The fallback is the same
          sentence the placeholder shows, so there is no flash of a different message. */}
      {isVisible ? (
        <Suspense fallback={<p className="mp-map__placeholder">{t('results.map.pending')}</p>}>
          <ResultsMap points={points} />
        </Suspense>
      ) : (
        <p className="mp-map__placeholder">{t('results.map.pending')}</p>
      )}
    </section>
  );
}
