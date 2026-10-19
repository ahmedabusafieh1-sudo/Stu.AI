import React, { useState } from 'react';
import {
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Settings,
  LogOut,
  ChevronLeft,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

interface SidebarProps {
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings }) => {
  const { user, t, logout } = useAuth();
  const {
    conversations,
    activeConversationId,
    selectConversation,
    createNewConversation,
    startNewChat,
    renameConversation,
    deleteConversation,
    isSidebarOpen,
    setSidebarOpen,
  } = useChat();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const startRename = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditingTitle(currentTitle);
  };

  const saveRename = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (editingTitle.trim()) {
      await renameConversation(id, editingTitle.trim());
    }
    setEditingId(null);
  };

  const cancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const confirmDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteConversation(id);
    setDeletingId(null);
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Physical Left Sidebar Drawer */}
      <aside
        className={`fixed md:relative top-0 bottom-0 left-0 h-full bg-[#111111] border-r border-[#3A3A3A] flex flex-col z-40 transition-all duration-300 ease-in-out overflow-hidden ${
          isSidebarOpen
            ? 'w-72 translate-x-0 opacity-100'
            : 'w-0 -translate-x-full opacity-0 pointer-events-none border-r-0 md:w-0'
        }`}
      >
        <div className="w-72 flex flex-col h-full shrink-0">
        {/* Header: New Chat */}
        <div className="p-3 border-b border-[#3A3A3A] flex items-center justify-between">
          <button
            onClick={() => {
              startNewChat();
              if (window.innerWidth < 768) setSidebarOpen(false);
            }}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[#232323] hover:bg-[#2B2B2B] text-white text-sm font-medium border border-[#3A3A3A] transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>{t.newChat}</span>
          </button>

          {/* Close drawer button on mobile */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-2 text-[#B5B5B5] hover:text-white"
            aria-label="إغلاق القائمة"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="px-2 py-1.5 text-xs font-semibold text-[#888888] uppercase tracking-wider">
            {t.conversations}
          </div>

          {conversations.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#888888]">
              {t.noConversations}
            </div>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.id === activeConversationId;
              const isEditing = conv.id === editingId;
              const isConfirmingDelete = conv.id === deletingId;

              return (
                <div
                  key={conv.id}
                  onClick={() => {
                    if (!isEditing && !isConfirmingDelete) {
                      selectConversation(conv.id);
                      if (window.innerWidth < 768) setSidebarOpen(false);
                    }
                  }}
                  className={`group relative flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer select-none ${
                    isActive
                      ? 'bg-[#232323] text-white font-medium border border-[#3A3A3A]'
                      : 'text-[#B5B5B5] hover:bg-[#1c1c1c] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 flex-1 min-w-0 pr-1">
                    <MessageSquare className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-400' : 'text-[#888888]'}`} />
                    
                    {isEditing ? (
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        className="w-full bg-[#2B2B2B] text-white text-xs px-2 py-1 rounded border border-[#3A3A3A] focus:outline-none focus:border-white"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveRename(conv.id, e as any);
                          if (e.key === 'Escape') cancelRename(e as any);
                        }}
                      />
                    ) : (
                      <span className="truncate text-xs sm:text-sm text-right" dir="auto">
                        {conv.title}
                      </span>
                    )}
                  </div>

                  {/* Actions: Rename / Delete */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isEditing ? (
                      <>
                        <button
                          onClick={(e) => saveRename(conv.id, e)}
                          className="p-1 text-emerald-400 hover:text-emerald-300"
                          title="حفظ"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={cancelRename}
                          className="p-1 text-[#888888] hover:text-white"
                          title="إلغاء"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : isConfirmingDelete ? (
                      <div className="flex items-center gap-1 bg-[#451a1a] px-1.5 py-0.5 rounded text-xs">
                        <button
                          onClick={(e) => confirmDelete(conv.id, e)}
                          className="text-red-300 hover:text-white font-semibold"
                        >
                          حذف
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingId(null);
                          }}
                          className="text-[#B5B5B5] hover:text-white"
                        >
                          لا
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={(e) => startRename(conv.id, conv.title, e)}
                          className="p-1 text-[#888888] hover:text-white"
                          title="تعديل العنوان"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingId(conv.id);
                          }}
                          className="p-1 text-[#888888] hover:text-red-400"
                          title="حذف"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer: User Profile & Settings */}
        <div className="p-3 border-t border-[#3A3A3A] bg-[#111111]">
          {user && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0 pr-1">
                <div className="w-8 h-8 rounded-full bg-[#2B2B2B] border border-[#3A3A3A] flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {user.displayName.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{user.displayName}</div>
                  <div className="text-[11px] text-[#888888] truncate">{user.email}</div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={onOpenSettings}
                  className="p-1.5 text-[#B5B5B5] hover:text-white hover:bg-[#232323] rounded-lg transition-colors"
                  title={t.settings}
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  onClick={logout}
                  className="p-1.5 text-[#B5B5B5] hover:text-red-400 hover:bg-[#232323] rounded-lg transition-colors"
                  title={t.logout}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      </aside>
    </>
  );
};
