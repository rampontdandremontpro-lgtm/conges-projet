import { createBrowserRouter, Navigate } from 'react-router-dom'

import { ProtectedRoute } from '@/auth/ProtectedRoute'
import { RootRedirect } from '@/auth/RootRedirect'
import { SectionGuard } from '@/auth/SectionGuard'
import { AppLayout } from '@/layouts/AppLayout'
import { LoginPage } from '@/pages/auth/LoginPage'
import { NotFound } from '@/pages/shared/NotFound'
import { Preview } from '@/pages/shared/Preview'
import { DashboardGate } from '@/pages/shared/DashboardGate'
import { NewRequest } from '@/pages/collab/NewRequestPage'
import { BalancesPage } from '@/pages/collab/BalancesPage'
import { MyRequestsPage } from '@/pages/collab/MyRequestsPage'
import { DeclareAbsencePage } from '@/pages/collab/DeclareAbsencePage'
import { DocumentsPage } from '@/pages/collab/DocumentsPage'
import { NEW_REQUEST_ROLES, ROLES } from '@/config/navigation'
import { RoleRoute } from '@/auth/RoleRoute'

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <LoginPage /> },
  {
    path: '/app',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/app/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardGate /> },
      {
        path: 'new-request',
        element: (
          <RoleRoute roles={NEW_REQUEST_ROLES}>
            <NewRequest />
          </RoleRoute>
        ),
      },
      {
        path: 'my-requests',
        element: (
          <RoleRoute roles={[ROLES.COLLABORATEUR]}>
            <MyRequestsPage />
          </RoleRoute>
        ),
      },
      {
        path: 'declare-absence',
        element: (
          <RoleRoute roles={[ROLES.COLLABORATEUR]}>
            <DeclareAbsencePage />
          </RoleRoute>
        ),
      },
      {
        path: 'my-documents',
        element: (
          <RoleRoute roles={[ROLES.COLLABORATEUR]}>
            <DocumentsPage />
          </RoleRoute>
        ),
      },
      {
        path: 'my-justificatifs',
        element: <Navigate to="/app/my-documents" replace />,
      },
      {
        path: 'documents',
        element: <Navigate to="/app/my-documents" replace />,
      },
      {
        path: 'my-balances',
        element: (
          <RoleRoute roles={[ROLES.COLLABORATEUR]}>
            <BalancesPage />
          </RoleRoute>
        ),
      },
      { path: 'profile', element: <Preview /> },
      { path: 'settings', element: <Preview /> },
      { path: ':section', element: <SectionGuard /> },
    ],
  },
  { path: '*', element: <NotFound /> },
])
