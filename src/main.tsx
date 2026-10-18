import React, { Component, ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './context/AuthContext';
import { ChatProvider } from './context/ChatContext';
import './index.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#171717] text-white flex flex-col items-center justify-center p-6 text-center select-none" dir="rtl">
          <div className="w-16 h-16 rounded-2xl bg-[#232323] border border-[#3A3A3A] flex items-center justify-center mb-4 text-2xl">
            ⚠️
          </div>
          <h1 className="text-xl font-bold mb-2">عذراً، حدث خطأ أثناء تحميل الصفحة</h1>
          <p className="text-sm text-[#B5B5B5] max-w-md mb-6 leading-relaxed">
            {this.state.error?.message || 'يرجى إعادة تحميل الصفحة لمتابعة استخدام Stu.Ai.'}
          </p>
          <button
            onClick={() => {
              if ('caches' in window) {
                caches.keys().then((names) => {
                  names.forEach((name) => caches.delete(name));
                });
              }
              window.location.reload();
            }}
            className="px-6 py-2.5 bg-white text-black font-bold rounded-xl text-sm hover:bg-[#e5e5e5] transition-colors shadow"
          >
            تحديث الصفحة
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Register or update Service Worker safely
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.update();
      })
      .catch((err) => {
        console.warn('[PWA] ServiceWorker registration failed:', err);
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ChatProvider>
          <App />
        </ChatProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
