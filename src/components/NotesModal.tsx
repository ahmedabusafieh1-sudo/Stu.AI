import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Plus,
  Trash2,
  Check,
  Loader2,
  BookOpen,
  Calendar,
  FileText,
  Search,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

interface NoteItem {
  id: string;
  userId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export const NotesModal: React.FC = () => {
  const { t } = useAuth();
  const { notesModalOpen, setNotesModalOpen } = useChat();

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState('');
  const [currentContent, setCurrentContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentTitleRef = useRef(currentTitle);
  const currentContentRef = useRef(currentContent);
  const activeNoteIdRef = useRef(activeNoteId);

  // Keep refs synchronized for unmount/close immediate save
  useEffect(() => {
    currentTitleRef.current = currentTitle;
  }, [currentTitle]);

  useEffect(() => {
    currentContentRef.current = currentContent;
  }, [currentContent]);

  useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
  }, [activeNoteId]);

  // Load user notes from backend when modal opens
  useEffect(() => {
    if (notesModalOpen) {
      loadNotes();
    }
  }, [notesModalOpen]);

  const loadNotes = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/notes');
      if (res.ok) {
        const data = await res.json();
        const loadedNotes: NoteItem[] = data.notes || [];
        setNotes(loadedNotes);

        if (loadedNotes.length > 0) {
          // If no active note or active note not in list, select the latest one
          const currentExists = loadedNotes.find((n) => n.id === activeNoteIdRef.current);
          if (!currentExists) {
            const first = loadedNotes[0];
            setActiveNoteId(first.id);
            setCurrentTitle(first.title);
            setCurrentContent(first.content);
          }
        } else {
          // No notes yet, create a fresh starter note
          handleNewNote();
        }
      }
    } catch (err) {
      console.error('Failed to load notes:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Perform save to backend
  const saveNoteToServer = async (
    noteId: string | null,
    titleToSave: string,
    contentToSave: string
  ): Promise<NoteItem | null> => {
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: noteId || undefined,
          title: titleToSave.trim() || 'مذكرة دراسية',
          content: contentToSave,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const savedNote: NoteItem = data.note;

        setNotes((prev) => {
          const idx = prev.findIndex((n) => n.id === savedNote.id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = savedNote;
            return copy;
          }
          return [savedNote, ...prev];
        });

        if (!noteId) {
          setActiveNoteId(savedNote.id);
        }

        setSaveStatus('saved');
        setTimeout(() => {
          setSaveStatus('idle');
        }, 2000);

        return savedNote;
      }
    } catch (err) {
      console.error('Failed to save note:', err);
      setSaveStatus('idle');
    }
    return null;
  };

  // Schedule auto-save on change
  const triggerAutoSave = (newTitle: string, newContent: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    setSaveStatus('saving');
    debounceTimerRef.current = setTimeout(() => {
      saveNoteToServer(activeNoteIdRef.current, newTitle, newContent);
    }, 800);
  };

  // Handle title edit
  const handleTitleChange = (val: string) => {
    setCurrentTitle(val);
    triggerAutoSave(val, currentContent);
  };

  // Handle content edit
  const handleContentChange = (val: string) => {
    setCurrentContent(val);
    triggerAutoSave(currentTitle, val);
  };

  // Switch to another note
  const handleSelectNote = async (note: NoteItem) => {
    if (note.id === activeNoteId) return;

    // Immediately flush save on previous note if pending
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      await saveNoteToServer(activeNoteIdRef.current, currentTitleRef.current, currentContentRef.current);
    }

    setActiveNoteId(note.id);
    setCurrentTitle(note.title);
    setCurrentContent(note.content);
    setSaveStatus('idle');
  };

  // Create new note
  const handleNewNote = async () => {
    // Flush current note if pending
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      await saveNoteToServer(activeNoteIdRef.current, currentTitleRef.current, currentContentRef.current);
    }

    const defaultTitle = `مذكرة ${notes.length + 1}`;
    const defaultContent = '';
    setCurrentTitle(defaultTitle);
    setCurrentContent(defaultContent);
    setActiveNoteId(null);

    // Save immediately so it gets an ID
    const created = await saveNoteToServer(null, defaultTitle, defaultContent);
    if (created) {
      setActiveNoteId(created.id);
    }
  };

  // Delete note
  const handleDeleteNote = async (noteIdToDelete: string) => {
    if (!window.confirm(t.confirmDeleteNote || 'هل أنت متأكد من حذف هذه المذكرة؟')) {
      return;
    }

    try {
      const res = await fetch(`/api/notes/${noteIdToDelete}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setNotes((prev) => prev.filter((n) => n.id !== noteIdToDelete));

        if (activeNoteId === noteIdToDelete) {
          const remaining = notes.filter((n) => n.id !== noteIdToDelete);
          if (remaining.length > 0) {
            setActiveNoteId(remaining[0].id);
            setCurrentTitle(remaining[0].title);
            setCurrentContent(remaining[0].content);
          } else {
            handleNewNote();
          }
        }
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  // Close modal and guarantee auto-save
  const handleClose = async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    // Perform guaranteed save of current editor state before closing
    if (currentTitleRef.current.trim() || currentContentRef.current.trim()) {
      await saveNoteToServer(
        activeNoteIdRef.current,
        currentTitleRef.current,
        currentContentRef.current
      );
    }
    setNotesModalOpen(false);
  };

  if (!notesModalOpen) return null;

  const filteredNotes = notes.filter((n) => {
    const q = searchQuery.toLowerCase();
    return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-4xl h-[88vh] max-h-[720px] bg-[#1E1E1E] border border-[#3A3A3A] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#F5F5F5] select-none">
        {/* Top Header */}
        <div className="h-14 px-4 sm:px-6 border-b border-[#3A3A3A] bg-[#171717] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm sm:text-base">{t.notesTitle || 'المفكرة والمذكرات الدراسية'}</h3>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Auto-Save Indicator */}
            <div className="text-xs flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#252525] border border-[#3A3A3A] text-[#B5B5B5]">
              {saveStatus === 'saving' ? (
                <>
                  <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
                  <span className="text-amber-300 text-[11px]">{t.saving || 'جاري الحفظ...'}</span>
                </>
              ) : (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400 text-[11px]">{t.saveAuto || 'تم الحفظ تلقائياً'}</span>
                </>
              )}
            </div>

            {/* Close Button */}
            <button
              onClick={handleClose}
              className="p-1.5 text-[#888888] hover:text-white rounded-lg hover:bg-[#2B2B2B] transition-colors"
              title={t.close || 'إغلاق وحفظ'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body: Split into Notes List (Sidebar) & Editor */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0">
          {/* Notes List Column */}
          <div className="w-full md:w-64 lg:w-72 border-b md:border-b-0 md:border-l border-[#3A3A3A] bg-[#1A1A1A] flex flex-col shrink-0">
            {/* Search and New Note Action */}
            <div className="p-3 border-b border-[#3A3A3A]/70 space-y-2">
              <button
                onClick={handleNewNote}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-white text-black font-semibold text-xs hover:bg-[#E5E5E5] transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>{t.newNote || 'مذكرة جديدة'}</span>
              </button>

              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث في المذكرات..."
                  className="w-full bg-[#121212] text-xs text-white px-2.5 py-1.5 pr-8 rounded-lg border border-[#3A3A3A] focus:outline-none focus:border-blue-400 placeholder-[#666666]"
                />
                <Search className="w-3.5 h-3.5 text-[#666666] absolute right-2.5 top-2.5" />
              </div>
            </div>

            {/* Scrollable List of Notes */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-8 text-[#888888] text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                  <span>جاري التحميل...</span>
                </div>
              ) : filteredNotes.length === 0 ? (
                <div className="text-center py-8 px-4 text-[#888888] text-xs">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-[#555555]" />
                  <p>{t.noNotes || 'لا توجد مذكرات بعد.'}</p>
                </div>
              ) : (
                filteredNotes.map((note) => {
                  const isSelected = note.id === activeNoteId;
                  const dateStr = new Date(note.updatedAt || note.createdAt).toLocaleDateString('ar-EG', {
                    month: 'short',
                    day: 'numeric',
                  });

                  return (
                    <div
                      key={note.id}
                      onClick={() => handleSelectNote(note)}
                      className={`group relative p-2.5 rounded-xl cursor-pointer transition-all border ${
                        isSelected
                          ? 'bg-[#282828] border-blue-500/50 shadow-sm'
                          : 'bg-transparent border-transparent hover:bg-[#222222] text-[#B5B5B5]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1 mb-1">
                        <h4
                          className={`text-xs font-semibold truncate ${
                            isSelected ? 'text-white' : 'text-[#D5D5D5]'
                          }`}
                        >
                          {note.title || 'بدون عنوان'}
                        </h4>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteNote(note.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-[#888888] hover:text-red-400 p-1 rounded transition-opacity"
                          title={t.deleteNote || 'حذف المذكرة'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-[11px] text-[#777777] line-clamp-2 leading-relaxed">
                        {note.content || 'مذكرة فارغة...'}
                      </p>

                      <div className="mt-1 flex items-center gap-1 text-[10px] text-[#666666]">
                        <Calendar className="w-2.5 h-2.5" />
                        <span>{dateStr}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Active Note Editor Pane */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#1E1E1E]">
            {/* Title Bar */}
            <div className="p-3 sm:p-4 border-b border-[#3A3A3A] flex items-center justify-between gap-2">
              <input
                type="text"
                value={currentTitle}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="عنوان المذكرة..."
                className="flex-1 bg-transparent text-white font-bold text-base sm:text-lg focus:outline-none placeholder-[#666666]"
                dir="auto"
              />

              {activeNoteId && (
                <button
                  onClick={() => handleDeleteNote(activeNoteId)}
                  className="p-1.5 text-[#777777] hover:text-red-400 rounded-lg hover:bg-[#2B2B2B] transition-colors"
                  title={t.deleteNote || 'حذف'}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Note Content Textarea */}
            <div className="flex-1 p-3 sm:p-5 flex flex-col">
              <textarea
                value={currentContent}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="اكتب مذكرتك وملاحظاتك الدراسية هنا بحرية... يتم حفظ كل حرف فوراً وتلقائياً بمجرد الكتابة أو إغلاق النافذة."
                dir="auto"
                className="flex-1 w-full bg-transparent text-[#F5F5F5] text-sm sm:text-base leading-relaxed resize-none focus:outline-none placeholder-[#555555] font-sans"
              />
            </div>

            {/* Bottom Status bar */}
            <div className="px-4 py-2 bg-[#171717] border-t border-[#3A3A3A] flex items-center justify-between text-[11px] text-[#777777]">
              <span>
                {currentContent.length} حرفاً • {currentContent.trim() ? currentContent.trim().split(/\s+/).length : 0} كلمة
              </span>
              <span>تحفظ وتسترجع في أي وقت ومن أي جهاز</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
