import { type ReactElement } from 'react';
import { Link, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../shared/LanguageSwitcher.js';

/**
 * The shell every route renders into: skip link, banner, navigation, main, contentinfo.
 *
 * The landmarks are not decoration — `TODO.md` §7 runs axe nightly, and a page with no `main` fails
 * before any feature is even looked at. A route renders its own single `h1`; the layout has none.
 *
 * Exported as `Component` because that is the name the router calls and the only component name
 * ADR-011 R1 allows a route module to export. `tests/route-modules.test.ts` is the gate.
 */
export function Component(): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mp-shell">
      <a className="mp-skip-link" href="#main">
        {t('nav.skipToContent')}
      </a>

      <header className="mp-header">
        <div className="mp-header__inner">
          <Link className="mp-brand" to="/">
            {t('app.name')}
            <span className="mp-brand__tagline">{t('app.tagline')}</span>
          </Link>
          <nav className="mp-nav" aria-label={t('nav.home')}>
            <Link to="/">{t('nav.home')}</Link>
            <LanguageSwitcher />
          </nav>
        </div>
      </header>

      <main className="mp-main" id="main">
        <Outlet />
      </main>

      <footer className="mp-footer">
        <div className="mp-footer__inner">
          © {new Date().getFullYear()} {t('app.name')} — {t('footer.rights')}
        </div>
      </footer>
    </div>
  );
}
