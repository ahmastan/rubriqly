import type { RouteObject } from 'react-router'
import { PageFallback } from './components/PageFallback'

// Every page is its own download, fetched when it's first opened. Landing page visitors don't
// download the app, and people using the app don't download the landing page.
const page =
  <M,>(load: () => Promise<M>, pick: (module: M) => React.ComponentType) =>
  () =>
    load().then((module) => ({ Component: pick(module) }))

export const routes: RouteObject[] = [
  // Marketing pages, outside the app shell. Same domain, same build.
  {
    path: '/',
    lazy: page(
      () => import('./pages/landing/LandingPage'),
      (m) => m.LandingPage,
    ),
    hydrateFallbackElement: <PageFallback dark />,
  },
  {
    path: '/privacy',
    lazy: page(
      () => import('./pages/landing/LegalPages'),
      (m) => m.PrivacyPage,
    ),
    hydrateFallbackElement: <PageFallback dark />,
  },
  {
    path: '/terms',
    lazy: page(
      () => import('./pages/landing/LegalPages'),
      (m) => m.TermsPage,
    ),
    hydrateFallbackElement: <PageFallback dark />,
  },
  {
    path: '/contact',
    lazy: page(
      () => import('./pages/landing/LegalPages'),
      (m) => m.ContactPage,
    ),
    hydrateFallbackElement: <PageFallback dark />,
  },
  // Accounts, outside the app shell (which needs one).
  {
    path: '/signin',
    lazy: page(
      () => import('./pages/AuthPages'),
      (m) => m.SignInPage,
    ),
    hydrateFallbackElement: <PageFallback />,
  },
  {
    path: '/signup',
    lazy: page(
      () => import('./pages/AuthPages'),
      (m) => m.SignUpPage,
    ),
    hydrateFallbackElement: <PageFallback />,
  },
  // The app. Every page here needs an account (AppLayout sends others to /signin).
  {
    lazy: page(
      () => import('./components/AppLayout'),
      (m) => m.AppLayout,
    ),
    hydrateFallbackElement: <PageFallback />,
    children: [
      {
        path: '/check/new',
        lazy: page(
          () => import('./pages/NewCheckPage'),
          (m) => m.NewCheckPage,
        ),
      },
      {
        path: '/checks/:checkId',
        lazy: page(
          () => import('./pages/ResultsPage'),
          (m) => m.ResultsPage,
        ),
      },
      {
        path: '/rubrics',
        lazy: page(
          () => import('./pages/RubricsPage'),
          (m) => m.RubricsPage,
        ),
      },
      {
        path: '/rubrics/scan',
        lazy: page(
          () => import('./pages/RubricScanPage'),
          (m) => m.RubricScanPage,
        ),
      },
      {
        path: '/rubrics/new',
        lazy: page(
          () => import('./pages/BuilderPage'),
          (m) => m.BuilderPage,
        ),
      },
      {
        path: '/rubrics/:rubricId/edit',
        lazy: page(
          () => import('./pages/BuilderPage'),
          (m) => m.BuilderPage,
        ),
      },
      {
        path: '/settings',
        lazy: page(
          () => import('./pages/SettingsPage'),
          (m) => m.SettingsPage,
        ),
      },
      {
        path: '*',
        lazy: page(
          () => import('./pages/NotFoundPage'),
          (m) => m.NotFoundPage,
        ),
      },
    ],
  },
]
