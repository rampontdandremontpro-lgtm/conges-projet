import { createBrowserRouter, Navigate } from 'react-router-dom'

import { ProtectedRoute } from '@/auth/ProtectedRoute'
import { RootRedirect } from '@/auth/RootRedirect'
import { SectionGuard } from '@/auth/SectionGuard'
import { AppLayout } from '@/layouts/AppLayout'
import { LoginPage } from '@/pages/auth/LoginPage'
import { NotFound } from '@/pages/shared/NotFound'
import { DashboardGate } from '@/pages/shared/DashboardGate'
import { NewRequest } from '@/pages/collab/NewRequestPage'
import { HistoryPage } from '@/pages/collab/HistoryPage'
import { MyRequestsPage } from '@/pages/collab/MyRequestsPage'
import { DeclareAbsencePage } from '@/pages/collab/DeclareAbsencePage'
import { DocumentsPage } from '@/pages/collab/DocumentsPage'
import { NotificationsPage } from '@/pages/collab/NotificationsPage'
import { RequestDetailPage } from '@/pages/collab/RequestDetailPage'
import { ProfilePage } from '@/pages/collab/ProfilePage'
import { SettingsPage } from '@/pages/collab/SettingsPage'
import { ManagerRequestsPage } from '@/pages/manager/RequestsPage'
import { ManagerRequestDecisionPage } from '@/pages/manager/RequestDecisionPage'
import { ManagerAlertsPage } from '@/pages/manager/AlertsPage'
import { ManagerPresencePage } from '@/pages/manager/PresencePage'
import { ManagerMyBalancePage } from '@/pages/manager/MyBalancePage'
import { RhAllRequestsPage } from '@/pages/rh/AllRequestsPage'
import { RhPrepareRequestPage } from '@/pages/rh/PrepareRequestPage'
import { RhRequestDecisionPage } from '@/pages/rh/RequestDecisionPage'
import { RhAbsencesPage } from '@/pages/rh/AbsencesPage'
import { RhDerogationsPage } from '@/pages/rh/DerogationsPage'
import { RhBalancesPage } from '@/pages/rh/BalancesPage'
import { RhExportsPage } from '@/pages/rh/ExportsPage'
import { RhDocumentsPage } from '@/pages/rh/DocumentsPage'
import { RhLeaveTypesPage } from '@/pages/rh/LeaveTypesPage'
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
        path: 'rh-all-requests',
        element: (
          <RoleRoute roles={[ROLES.RH]}>
            <RhAllRequestsPage />
          </RoleRoute>
        ),
      },
      {
        path: 'rh-prepare-request',
        element: (
          <RoleRoute roles={[ROLES.RH]}>
            <RhPrepareRequestPage />
          </RoleRoute>
        ),
      },
      {
        path: 'rh-all-requests/:id',
        element: (
          <RoleRoute roles={[ROLES.RH]}>
            <RhRequestDecisionPage />
          </RoleRoute>
        ),
      },
      {
        path: 'rh-absences',
        element: (
          <RoleRoute roles={[ROLES.RH]}>
            <RhAbsencesPage />
          </RoleRoute>
        ),
      },
      {
        path: 'rh-derogations',
        element: (
          <RoleRoute roles={[ROLES.RH]}>
            <RhDerogationsPage />
          </RoleRoute>
        ),
      },
      {
        path: 'rh-balances',
        element: (
          <RoleRoute roles={[ROLES.RH]}>
            <RhBalancesPage />
          </RoleRoute>
        ),
      },
      {
        path: 'rh-exports',
        element: (
          <RoleRoute roles={[ROLES.RH]}>
            <RhExportsPage />
          </RoleRoute>
        ),
      },
      {
        path: 'rh-pdf-documents',
        element: (
          <RoleRoute roles={[ROLES.RH]}>
            <RhDocumentsPage />
          </RoleRoute>
        ),
      },
      {
        path: 'rh-leave-types',
        element: (
          <RoleRoute roles={[ROLES.RH]}>
            <RhLeaveTypesPage />
          </RoleRoute>
        ),
      },
      { path: 'rh-balance-movements', element: <Navigate to="/app/rh-balances" replace /> },
      { path: 'rh-justificatifs', element: <Navigate to="/app/rh-absences" replace /> },
      { path: 'rh-authorized-absences', element: <Navigate to="/app/rh-absences" replace /> },
      { path: 'rh-requests', element: <Navigate to="/app/rh-all-requests" replace /> },
      {
        path: 'rh-requests/:id',
        element: (
          <RoleRoute roles={[ROLES.RH]}>
            <RhRequestDecisionPage />
          </RoleRoute>
        ),
      },
      {
        path: 'requests',
        element: (
          <RoleRoute roles={[ROLES.RESPONSABLE_SERVICE]}>
            <ManagerRequestsPage />
          </RoleRoute>
        ),
      },
      {
        path: 'requests/:id',
        element: (
          <RoleRoute roles={[ROLES.RESPONSABLE_SERVICE]}>
            <ManagerRequestDecisionPage />
          </RoleRoute>
        ),
      },
      {
        path: 'alerts',
        element: (
          <RoleRoute roles={[ROLES.RESPONSABLE_SERVICE]}>
            <ManagerAlertsPage />
          </RoleRoute>
        ),
      },
      {
        path: 'service-presence',
        element: (
          <RoleRoute roles={[ROLES.RESPONSABLE_SERVICE]}>
            <ManagerPresencePage />
          </RoleRoute>
        ),
      },
      {
        path: 'new-request',
        element: (
          <RoleRoute roles={NEW_REQUEST_ROLES}>
            <NewRequest />
          </RoleRoute>
        ),
      },
      {
        path: 'new-request/:id',
        element: (
          <RoleRoute roles={[ROLES.COLLABORATEUR, ROLES.RESPONSABLE_SERVICE, ROLES.RH]}>
            <NewRequest />
          </RoleRoute>
        ),
      },
      {
        path: 'my-requests',
        element: (
          <RoleRoute roles={[ROLES.COLLABORATEUR, ROLES.RESPONSABLE_SERVICE, ROLES.RH]}>
            <MyRequestsPage />
          </RoleRoute>
        ),
      },
      {
        path: 'my-requests/:source/:id',
        element: (
          <RoleRoute roles={[ROLES.COLLABORATEUR, ROLES.RESPONSABLE_SERVICE, ROLES.RH]}>
            <RequestDetailPage />
          </RoleRoute>
        ),
      },
      {
        path: 'declare-absence',
        element: (
          <RoleRoute roles={[ROLES.COLLABORATEUR, ROLES.RESPONSABLE_SERVICE, ROLES.RH]}>
            <DeclareAbsencePage />
          </RoleRoute>
        ),
      },
      {
        path: 'declare-absence/:id',
        element: (
          <RoleRoute roles={[ROLES.COLLABORATEUR, ROLES.RESPONSABLE_SERVICE, ROLES.RH]}>
            <DeclareAbsencePage />
          </RoleRoute>
        ),
      },
      {
        path: 'my-balance',
        element: (
          <RoleRoute roles={[ROLES.RESPONSABLE_SERVICE, ROLES.RH]}>
            <ManagerMyBalancePage />
          </RoleRoute>
        ),
      },
      {
        path: 'my-documents',
        element: (
          <RoleRoute roles={[ROLES.COLLABORATEUR, ROLES.RESPONSABLE_SERVICE, ROLES.RH]}>
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
        path: 'notifications',
        element: (
          <RoleRoute roles={[ROLES.COLLABORATEUR, ROLES.RESPONSABLE_SERVICE, ROLES.RH, ROLES.DIRECTEUR]}>
            <NotificationsPage />
          </RoleRoute>
        ),
      },
      {
        path: 'history',
        element: (
          <RoleRoute roles={[ROLES.COLLABORATEUR, ROLES.RESPONSABLE_SERVICE, ROLES.RH]}>
            <HistoryPage />
          </RoleRoute>
        ),
      },
      { path: 'my-balances', element: <Navigate to="/app/history" replace /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: ':section', element: <SectionGuard /> },
    ],
  },
  { path: '*', element: <NotFound /> },
])
