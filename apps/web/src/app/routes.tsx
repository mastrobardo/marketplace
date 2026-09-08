import { type RouteObject } from 'react-router';
import { RootLayout } from './RootLayout.js';
import { HomePage } from '../pages/HomePage.js';
import { NotFoundPage } from '../pages/NotFoundPage.js';

/**
 * The route table. A slice adds its routes as children of the layout route, so every page inherits
 * the shell — including the not-found page, which is the `path: '*'` child rather than a sibling.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: HomePage },
      { path: '*', Component: NotFoundPage },
    ],
  },
];
