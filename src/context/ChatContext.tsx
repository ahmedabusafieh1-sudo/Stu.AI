import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

export interface AttachmentItem {
  id?: string;
  tempKey?: string;
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
    previewUrl?: string;
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
  const inFlightUploadsRef = useRef<
    Map<string, Promise<{ id: string; originalName: string; mimeType: string; sizeBytes: number; status: string } | null>>
  >(new Map());

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

    const MAX_DOC_SIZE = 100 * 1024 * 1024; // 100 MB
    const MAX_IMG_SIZE = 50 * 1024 * 1024; // 50 MB

    const oversizedItems: AttachmentItem[] = [];
    const validFiles: { file: File; tempKey: string }[] = [];

    fileList.forEach((f) => {
      const isImg = f.type.startsWith('image/');
      const limit = isImg ? MAX_IMG_SIZE : MAX_DOC_SIZE;
      if (f.size > limit) {
        oversizedItems.push({
          file: f,
          originalName: f.name,
          mimeType: f.type || 'application/octet-stream',
          sizeBytes: f.size,
          uploadStatus: 'failed',
          error: `حجم الملف (${(f.size / (1024 * 1024)).toFixed(1)} MB) يتجاوز الحد الأقصى (${isImg ? 50 : 100} MB)`,
        });
      } else {
        const tempKey = `att_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        validFiles.push({ file: f, tempKey });
      }
    });

    // Create preliminary UI items for valid files
    const validUiItems: AttachmentItem[] = validFiles.map(({ file, tempKey }) => ({
      tempKey,
      file,
      originalName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      uploadStatus: 'uploading',
    }));

    setPendingAttachments((prev) => [...prev, ...oversizedItems, ...validUiItems]);

    if (validFiles.length === 0) return;

    // Send formData for valid files
    const formData = new FormData();
    validFiles.forEach(({ file }) => formData.append('files', file));

    const uploadBatchPromise = (async () => {
      try {
        const res = await fetch('/api/attachments/upload', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (res.ok && data.attachments) {
          return data.attachments as { id: string; originalName: string; mimeType: string; sizeBytes: number; status: string }[];
        }
        throw new Error(data.error || 'فشل رفع الملفات');
      } catch (err: any) {
        console.error('Upload fetch error:', err);
        throw err;
      }
    })();

    // Store per-file promises so sendMessage can await them if sent early
    validFiles.forEach(({ file, tempKey }) => {
      const singlePromise = uploadBatchPromise
        .then((uploadedList) => {
          const matched = uploadedList.find((u) => u.originalName === file.name);
          return matched || null;
        })
        .catch((_) => null);
      inFlightUploadsRef.current.set(tempKey, singlePromise);
    });

    uploadBatchPromise
      .then((uploadedList) => {
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
      })
      .catch((err) => {
        setPendingAttachments((prev) =>
          prev.map((item) => {
            if (validFiles.some((vf) => vf.tempKey === item.tempKey && item.uploadStatus === 'uploading')) {
              return {
                ...item,
                uploadStatus: 'failed',
                error: err.message || 'فشل رفع الملف',
              };
            }
            return item;
          })
        );
      });
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

    // 1. Snapshot all pending attachments that aren't marked as failed
    const attachmentsToProcess = pendingAttachments.filter((a) => a.uploadStatus !== 'failed');
    if (!content.trim() && attachmentsToProcess.length === 0) return;

    // 2. Clear input attachments immediately so the tray is empty and ready
    clearPendingAttachments();

    // 3. Optimistically append user message to UI immediately with previews
    const tempUserMsgId = `temp-${Date.now()}`;
    const initialUserAttachments = attachmentsToProcess.map((a) => ({
      id: a.id || '',
      originalName: a.originalName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      status: a.uploadStatus,
      previewUrl: a.previewUrl,
    }));

    const tempUserMsg: ChatMessage = {
      id: tempUserMsgId,
      conversationId: targetConvId,
      role: 'user',
      content: content.trim(),
      status: 'complete',
      sequence: messages.length + 1,
      attachments: initialUserAttachments,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMsg]);

    // 4. Prepare streaming assistant message state
    setIsStreaming(true);
    setStreamingContent('');

    // 5. Await in-flight uploads for any attachment still uploading
    const resolvedAttachmentIds: string[] = [];
    const updatedUserAttachments = [...initialUserAttachments];

    for (let i = 0; i < attachmentsToProcess.length; i++) {
      const att = attachmentsToProcess[i];
      if (att.id && att.uploadStatus === 'ready') {
        resolvedAttachmentIds.push(att.id);
      } else if (att.uploadStatus === 'uploading' && att.tempKey) {
        const uploadPromise = inFlightUploadsRef.current.get(att.tempKey);
        if (uploadPromise) {
          try {
            const uploaded = await uploadPromise;
            if (uploaded && uploaded.id) {
              resolvedAttachmentIds.push(uploaded.id);
              updatedUserAttachments[i] = {
                ...updatedUserAttachments[i],
                id: uploaded.id,
                status: 'ready',
              };
            } else {
              updatedUserAttachments[i] = {
                ...updatedUserAttachments[i],
                status: 'failed',
              };
            }
          } catch {
            updatedUserAttachments[i] = {
              ...updatedUserAttachments[i],
              status: 'failed',
            };
          }
        }
      }
    }

    // Update the optimistic message in state with the resolved IDs
    setMessages((prev) =>
      prev.map((m) => (m.id === tempUserMsgId ? { ...m, attachments: updatedUserAttachments } : m))
    );

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`/api/chat/conversations/${targetConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          attachmentIds: resolvedAttachmentIds,
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
              let parsed: any = null;
              try {
                parsed = JSON.parse(dataStr);
              } catch {
                // Ignore parse errors on raw tokens
              }

              if (parsed) {
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
                  throw new Error(parsed.error || 'حدث خطأ في خدمة الذكاء الاصطناعي.');
                }
              }
            }
          }
        }
      }

      // Add final completed assistant message to messages
      if (accumulatedText.trim().length > 0) {
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
      } else {
        const fallbackFailMsg: ChatMessage = {
          id: serverAssistantMsgId || `asst-${Date.now()}`,
          conversationId: targetConvId,
          role: 'assistant',
          content: '⚠️ تعذر استلام الرد من الذكاء الاصطناعي، يرجى المحاولة مرة أخرى.',
          status: 'failed',
          sequence: messages.length + 2,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, fallbackFailMsg]);
      }
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
