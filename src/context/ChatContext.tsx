import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

export interface AttachmentItem {
  id?: string;
  file?: File;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;
  uploadStatus: 'uploading' | 'ready' | 'failed';
  error?: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: 'streaming' | 'complete' | 'failed' | 'aborted';
  sequence: number;
  citations?: any[];
  searchGrounding?: any;
  attachments?: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    status: string;
  }[];
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatContextType {
  conversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  pendingAttachments: AttachmentItem[];
  useSearchGrounding: boolean;
  quizModalOpen: boolean;
  quizInitialTopic: string;
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setUseSearchGrounding: (active: boolean) => void;
  setQuizModalOpen: (open: boolean, topic?: string) => void;
  selectConversation: (id: string) => Promise<void>;
  createNewConversation: () => Promise<string | null>;
  renameConversation: (id: string, newTitle: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  uploadFiles: (files: FileList | File[]) => Promise<void>;
  removePendingAttachment: (index: number) => void;
  clearPendingAttachments: () => void;
  sendMessage: (content: string, actionType?: string) => Promise<void>;
  stopStreaming: () => void;
  retryLastMessage: () => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentItem[]>([]);
  const [useSearchGrounding, setUseSearchGrounding] = useState(false);
  const [quizModalOpen, setQuizModalOpenState] = useState(false);
  const [quizInitialTopic, setQuizInitialTopic] = useState('');
  const [isSidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );

  const abortControllerRef = useRef<AbortController | null>(null);

  // Load conversations when authenticated
  useEffect(() => {
    if (user && user.isVerified) {
      loadConversations();
    } else {
      setConversations([]);
      setActiveConversationId(null);
      setMessages([]);
    }
  }, [user]);

  const loadConversations = async () => {
    try {
      const res = await fetch('/api/chat/conversations');
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
        if (data.conversations?.length > 0 && !activeConversationId) {
          selectConversation(data.conversations[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  };

  const selectConversation = async (id: string) => {
    setActiveConversationId(id);
    try {
      const res = await fetch(`/api/chat/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error('Failed to load conversation messages:', err);
    }
  };

  const createNewConversation = async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'محادثة جديدة' }),
      });
      if (res.ok) {
        const data = await res.json();
        const newConv = data.conversation;
        setConversations((prev) => [newConv, ...prev]);
        setActiveConversationId(newConv.id);
        setMessages([]);
        setPendingAttachments([]);
        return newConv.id;
      }
    } catch (err) {
      console.error('Failed to create new conversation:', err);
    }
    return null;
  };

  const renameConversation = async (id: string, newTitle: string) => {
    try {
      const res = await fetch(`/api/chat/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (res.ok) {
        const data = await res.json();
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, title: data.conversation.title } : c))
        );
      }
    } catch (err) {
      console.error('Failed to rename conversation:', err);
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      const res = await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConversationId === id) {
          const remaining = conversations.filter((c) => c.id !== id);
          if (remaining.length > 0) {
            selectConversation(remaining[0].id);
          } else {
            setActiveConversationId(null);
            setMessages([]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  // Upload attachments
  const uploadFiles = async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    // Create preliminary UI items
    const newItems: AttachmentItem[] = fileList.map((f) => ({
      file: f,
      originalName: f.name,
      mimeType: f.type || 'application/octet-stream',
      sizeBytes: f.size,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
      uploadStatus: 'uploading',
    }));

    setPendingAttachments((prev) => [...prev, ...newItems]);

    // Send formData
    const formData = new FormData();
    fileList.forEach((f) => formData.append('files', f));

    try {
      const res = await fetch('/api/attachments/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (res.ok && data.attachments) {
        const uploadedList = data.attachments;
        setPendingAttachments((prev) =>
          prev.map((item) => {
            const matched = uploadedList.find((u: any) => u.originalName === item.originalName);
            if (matched) {
              return {
                ...item,
                id: matched.id,
                uploadStatus: 'ready',
              };
            }
            return item;
          })
        );
      } else {
        // Mark all as failed
        setPendingAttachments((prev) =>
          prev.map((item) => ({
            ...item,
            uploadStatus: 'failed',
            error: data.error || 'فشل رفع الملف',
          }))
        );
      }
    } catch (err: any) {
      setPendingAttachments((prev) =>
        prev.map((item) => ({
          ...item,
          uploadStatus: 'failed',
          error: err.message,
        }))
      );
    }
  };

  const removePendingAttachment = (index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const clearPendingAttachments = () => {
    setPendingAttachments([]);
  };

  const setQuizModalOpen = (open: boolean, topic: string = '') => {
    setQuizModalOpenState(open);
    setQuizInitialTopic(topic);
  };

  // Send message with SSE streaming
  const sendMessage = async (content: string, actionType: string = 'normal') => {
    let targetConvId = activeConversationId;
    if (!targetConvId) {
      targetConvId = await createNewConversation();
      if (!targetConvId) return;
    }

    const readyAttachmentIds = pendingAttachments
      .filter((a) => a.id && a.uploadStatus === 'ready')
      .map((a) => a.id!);

    const userMessageAttachments = pendingAttachments.map((a) => ({
      id: a.id || '',
      originalName: a.originalName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      status: a.uploadStatus,
    }));

    // Optimistically append user message to UI
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversationId: targetConvId,
      role: 'user',
      content: content.trim(),
      status: 'complete',
      sequence: messages.length + 1,
      attachments: userMessageAttachments,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMsg]);
    clearPendingAttachments();

    // Prepare streaming assistant message
    setIsStreaming(true);
    setStreamingContent('');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`/api/chat/conversations/${targetConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          attachmentIds: readyAttachmentIds,
          actionType,
          useSearchGrounding,
          idempotencyKey: `msg-${Date.now()}-${Math.random()}`,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'فشل إرسال الرسالة.');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let serverAssistantMsgId = '';
      let capturedCitations: any[] = [];
      let capturedGrounding: any = null;

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            const eventMatch = line.match(/^event:\s*(\w+)/m);
            const dataMatch = line.match(/^data:\s*(.*)$/m);

            const eventType = eventMatch ? eventMatch[1] : 'message';
            const dataStr = dataMatch ? dataMatch[1] : '';

            if (dataStr) {
              try {
                const parsed = JSON.parse(dataStr);
                if (eventType === 'start') {
                  serverAssistantMsgId = parsed.assistantMessageId;
                } else if (eventType === 'chunk') {
                  accumulatedText += parsed.chunk;
                  setStreamingContent(accumulatedText);
                } else if (eventType === 'grounding') {
                  capturedGrounding = parsed;
                } else if (eventType === 'done') {
                  serverAssistantMsgId = parsed.messageId;
                  accumulatedText = parsed.content;
                  capturedCitations = parsed.citations || [];
                  capturedGrounding = parsed.searchGrounding || capturedGrounding;
                } else if (eventType === 'error') {
                  throw new Error(parsed.error);
                }
              } catch (parseErr) {
                // Ignore parse errors on raw tokens
              }
            }
          }
        }
      }

      // Add final completed assistant message to messages
      const finalAssistantMsg: ChatMessage = {
        id: serverAssistantMsgId || `asst-${Date.now()}`,
        conversationId: targetConvId,
        role: 'assistant',
        content: accumulatedText,
        status: 'complete',
        sequence: messages.length + 2,
        citations: capturedCitations,
        searchGrounding: capturedGrounding,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, finalAssistantMsg]);
      // Refresh conversation title if it was first message
      loadConversations();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Handled by stopStreaming
      } else {
        const errorMsg: ChatMessage = {
          id: `err-${Date.now()}`,
          conversationId: targetConvId,
          role: 'assistant',
          content: `⚠️ خطأ: ${err.message}`,
          status: 'failed',
          sequence: messages.length + 2,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
      abortControllerRef.current = null;
    }
  };

  const stopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      if (streamingContent && activeConversationId) {
        const partialMsg: ChatMessage = {
          id: `partial-${Date.now()}`,
          conversationId: activeConversationId,
          role: 'assistant',
          content: streamingContent + '\n\n*(تم إيقاف التوليد)*',
          status: 'aborted',
          sequence: messages.length + 2,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, partialMsg]);
      }
      setStreamingContent('');
    }
  };

  const retryLastMessage = async () => {
    if (messages.length === 0) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      sendMessage(lastUserMsg.content);
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;

  return (
    <ChatContext.Provider
      value={{
        conversations,
        activeConversationId,
        activeConversation,
        messages,
        isStreaming,
        streamingContent,
        pendingAttachments,
        useSearchGrounding,
        quizModalOpen,
        quizInitialTopic,
        isSidebarOpen,
        setSidebarOpen,
        setUseSearchGrounding,
        setQuizModalOpen,
        selectConversation,
        createNewConversation,
        renameConversation,
        deleteConversation,
        uploadFiles,
        removePendingAttachment,
        clearPendingAttachments,
        sendMessage,
        stopStreaming,
        retryLastMessage,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within a ChatProvider');
  return context;
};
