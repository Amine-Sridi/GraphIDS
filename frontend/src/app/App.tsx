import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { router } from './routes';
import { AuthProvider } from './context/AuthContext';

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster
        theme="dark"
        position="top-right"
        richColors
        toastOptions={{
          style: {
            background: '#161b22',
            border: '1px solid #21262d',
            color: '#e6edf3',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          },
        }}
      />
    </AuthProvider>
  );
}
