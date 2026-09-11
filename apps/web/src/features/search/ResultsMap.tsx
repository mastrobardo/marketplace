import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { type SearchPoint } from '@marketplace/contracts';

export interface ResultsMapProps {
  points: { id: string; label: string; point: SearchPoint }[];
}

/**
 * What sits behind the deferred boundary — **today, a statement that there is no map.**
 *
 * This is not a stub standing in for work `W12-T11` skipped. There is no Maps API key: `OPS-12`
 * (Google Cloud project, key, billing, quota alerts) is on the human-blocked list and `W3-T06` owns
 * it. The deliverable of this ticket is the *boundary* — its own chunk, loaded on viewport, with a
 * page that is complete without it (ADR-011 §6, `R9`) — and that boundary is real whether or not a
 * renderer has arrived to sit behind it.
 *
 * When the key lands, this file's contents are replaced and nothing around it moves. The points are
 * already here, already coarsened by the contract, already the right shape for a pin.
 *
 * Adding Leaflet with OpenStreetMap tiles instead was considered and rejected (spec §10 Q3): ~40 KB
 * against a budget already 60 KB over, spent on the one feature ADR-011 §6 calls "the budget's main
 * threat", and a tile policy that does not cover production use — so it works until it is busy.
 */
export default function ResultsMap({ points }: ResultsMapProps): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mp-map__placeholder" data-testid="map-placeholder" data-points={points.length}>
      <p>{t('results.map.pending')}</p>
    </div>
  );
}
