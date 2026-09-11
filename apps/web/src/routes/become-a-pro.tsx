import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthWall, Card } from '@marketplace/ui';
import { type TranslationKey } from '../i18n/locales/es.js';

/**
 * The supply side — ADR-011 §2 puts `/:lang/become-a-pro` in `W12-T10` because the home page's CTA
 * needs somewhere to go, and a marketplace with no providers has nothing to sell. Half the
 * cold-start answer (`R3`) is a reason for a tradesperson to sign up.
 *
 * The segment is not translated: `/es/become-a-pro`, the same rule `/es/search` follows
 * (ADR-011 Amendment 1).
 *
 * **Where this page stops is the point.** Registration is `W2-T01`/`W2-T05` and is not in M11, so
 * there is no form and no link to one. What there is instead is a sentence saying so — the same
 * honesty the legal slots ship with. The alternatives are a button that 404s, or a disabled control
 * that tells a visitor only that something is broken; ADR-011 asks for *"a real boundary the
 * milestone can be demoed against, not an unfinished edge"*, and a boundary you can read is one.
 *
 * The shared auth-wall component **is** `W12-T12`'s, and it now exists — so this page uses it
 * rather than its own paragraph. That was the plan when this file was written: *"building the
 * component here would be inventing the thing that ticket is for."* A shared component with one
 * call site is a guess about the second; this is the second.
 */
const BENEFITS: { key: string; title: TranslationKey; body: TranslationKey }[] = [
  { key: 'leads', title: 'pro.benefits.leads.title', body: 'pro.benefits.leads.body' },
  { key: 'control', title: 'pro.benefits.control.title', body: 'pro.benefits.control.body' },
  { key: 'payment', title: 'pro.benefits.payment.title', body: 'pro.benefits.payment.body' },
];

export function Component(): ReactElement {
  const { t } = useTranslation();

  return (
    <article data-testid="become-a-pro">
      <h1>{t('pro.title')}</h1>
      <p className="mp-lead">{t('pro.intro')}</p>

      <section className="mp-section" aria-labelledby="pro-benefits">
        <h2 id="pro-benefits">{t('pro.benefits.title')}</h2>
        <ul className="mp-card-grid" role="list">
          {BENEFITS.map((benefit) => (
            <li key={benefit.key}>
              <Card title={t(benefit.title)} description={t(benefit.body)} />
            </li>
          ))}
        </ul>
      </section>

      <AuthWall title={t('pro.title')} description={t('pro.pending')} />
    </article>
  );
}
