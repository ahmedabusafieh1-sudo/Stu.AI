import { describe, it, expect } from 'vitest';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { AuthProvider } from '../src/context/AuthContext';
import { ChatProvider } from '../src/context/ChatContext';
import { App } from '../src/App';

describe('App Component Render', () => {
  it('renders without throwing exceptions', () => {
    const html = ReactDOMServer.renderToString(
      <AuthProvider>
        <ChatProvider>
          <App />
        </ChatProvider>
      </AuthProvider>
    );
    expect(html).toBeDefined();
    expect(html).toContain('Stu.Ai');
    console.log('App successfully rendered HTML length:', html.length);
  });
});
