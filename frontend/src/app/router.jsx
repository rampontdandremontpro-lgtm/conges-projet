import { createBrowserRouter, Navigate } from 'react-router-dom'

import { ProtectedRoute } from '@/auth/ProtectedRoute'
import { RootRedirect } from '@/auth/RootRedirect'
import { SectionGuard } from '@/auth/SectionGuard'
import { AppLayout } from '@/layouts/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { NotFound } from '@/pages/NotFound'
import { Preview } from '@/pages/Preview'
import { DashboardGate } from '@/pages/DashboardGate'
import { NewRequest } from '@/pages/NewRequest'
import { NEW_REQUEST_ROLES } from '@/config/navigation'
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
      { path: 'profile', element: <Preview /> },
      { path: 'settings', element: <Preview /> },
      { path: ':section', element: <SectionGuard /> },
    ],
  },
  { path: '*', element: <NotFound /> },
])
