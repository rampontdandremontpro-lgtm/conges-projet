import { createBrowserRouter } from 'react-router-dom'

import { AppLayout } from '@/layouts/AppLayout'
import { Preview } from '@/pages/Preview'
import { LoginPlaceholder } from '@/pages/LoginPlaceholder'
import { NotFound } from '@/pages/NotFound'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Preview /> },
      { path: 'app/:section', element: <Preview /> },
    ],
  },
  { path: '/login', element: <LoginPlaceholder /> },
  { path: '*', element: <NotFound /> },
])
