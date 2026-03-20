"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import { Loader2, Plus, Settings, X as XIcon, Pencil } from "lucide-react";
import { slugify } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { cn, formatDate } from "@/lib/utils";
import BlogEditor, { type BlogEditorRef } from "@/components/BlogEditor";
import SettingsModal from "@/components/SettingsModal";
import ErrorModal from "@/components/ErrorModal";
import { ChatMarkdown } from "@/components/ChatMarkdown";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Blog {
  id: string;
  slug: string;
  title: string;
  headline: string;
  date: string;
  content?: string;
  coverImageUrl?: string;
  /** Alt text for the cover image, used for SEO and accessibility. */
  coverImageAlt?: string;
  /** Zoom-out version for blog list (35% larger, edge-dominant color fill). Generated when cover changes. */
  blogListImageUrl?: string;
}

// ---------------------------------------------------------------------------
// Draft persistence — survives editor close and page refresh
// ---------------------------------------------------------------------------
const DRAFT_KEY = "curastem_draft_blog";

function saveDraft(blog: Blog, content: string) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ blog, content })); } catch { /* quota */ }
}
function loadDraft(): { blog: Blog; content: string } | null {
  try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Chat persistence — up to 25 chats on device
// ---------------------------------------------------------------------------
const CHATS_KEY = "curastem_chats";
const MAX_CHATS = 25;

export interface SavedChat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

function loadChats(): SavedChat[] {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveChats(chats: SavedChat[]) {
  try {
    const trimmed = chats.slice(0, MAX_CHATS);
    localStorage.setItem(CHATS_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota */
  }
}

/** Wraps replaced content with green highlight class for AI-edits visibility */
function wrapWithAiHighlight(replace: string): string {
  if (!replace.trim()) return replace;
  const match = replace.match(/^(<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>)([\s\S]*?)(<\/\2>)$/);
  if (match) {
    const [, openTag, , , content, closeTag] = match;
    return `${openTag}<span class="ai-diff-new">${content}</span>${closeTag}`;
  }
  return `<span class="ai-diff-new">${replace}</span>`;
}

function chatTitleFromMessages(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser?.content) {
    const t = firstUser.content.trim().slice(0, 40);
    return t + (firstUser.content.length > 40 ? "…" : "");
  }
  return "New blog";
}

/** Convert any markdown the AI accidentally emits into HTML, and strip blank-paragraph spacers. */
function markdownToHtml(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 dir="auto">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 dir="auto">$1</h2>')
    .replace(/^# (.+)$/gm, '<h3 dir="auto">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Remove blank-paragraph spacers — they create triple-spacing in Framer CMS
    .replace(/<p[^>]*>\s*<br\s*\/?>\s*<\/p>/gi, "")
    .replace(/<p[^>]*>\s*<\/p>/gi, "");
}

const CHAT_PANEL_WIDTH = 400;
const MOBILE_BREAKPOINT = 768;
const CHAT_WIDTH_MIN = 320;
const BLOG_PANEL_MIN = 400;
const BLOG_EDITOR_BG = "hsl(0, 0%, 100%)"; // curastem themeColors.background (light)
const BLOG_EDITOR_SHADOW = "-2px 0 24px 2px rgba(0,0,0,0.04)"; // curastem-style shadow (left edge of right panel)

/** Default chips above input — web.tsx `defaultSuggestions` pattern (light theme values). */
const DEFAULT_CHAT_SUGGESTIONS = [
  "Help with onboarding",
  "Blog ideas",
  "Image suggestions",
] as const;

export default function ChatPage() {
  const router = useRouter();
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  // Controls blog-editor overlay visibility on mobile independently of blog selection.
  // Closing the overlay keeps the blog selected so the chat still has blog context.
  const [isMobileEditorOpen, setIsMobileEditorOpen] = useState(false);
  useEffect(() => {
    const check = () => setIsMobileLayout(typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hello! I'm the Curastem Blog Tool. How can I help you today? You can ask me to create a new blog or list existing ones." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [fetchingBlogs, setFetchingBlogs] = useState(false);
  const [blogError, setBlogError] = useState<string | null>(null);
  const [selectedBlog, setSelectedBlog] = useState<Blog | null>(null);
  const [loadingBlog, setLoadingBlog] = useState(false);
  const [savingBlog, setSavingBlog] = useState(false);
  const [saveJustCompleted, setSaveJustCompleted] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // Image attached to chat input for AI-driven editing
  const [pendingEditImage, setPendingEditImage] = useState<{ url: string; alt: string } | null>(null);
  const [editableContent, setEditableContent] = useState("");
  // Ref always holds the latest editableContent so timeout callbacks read fresh values
  const editableContentRef = useRef("");
  useEffect(() => { editableContentRef.current = editableContent; }, [editableContent]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("curastem_blog_sidebar_open");
      if (saved !== null) return saved === "true";
    }
    return false;
  });
  const [isSidebarBtnHovered, setIsSidebarBtnHovered] = useState(false);
  const [isCloseSidebarHovered, setIsCloseSidebarHovered] = useState(false);
  const [isNewChatTopRightHovered, setIsNewChatTopRightHovered] = useState(false);

  // Spring-animated sidebar motion values — matches web.tsx
  const sidebarX = useMotionValue(-260);
  const sidebarOverlayOpacity = useTransform(sidebarX, [-260, 0], [0, 1]);
  const contentX = useTransform(sidebarX, [-260, 0], [0, 260]);

  useEffect(() => {
    animate(sidebarX, isSidebarOpen ? 0 : -260, {
      type: "spring",
      stiffness: 700,
      damping: 50,
    });
  }, [isSidebarOpen, sidebarX]);

  // Persist sidebar state
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("curastem_blog_sidebar_open", isSidebarOpen.toString());
    }
  }, [isSidebarOpen]);

  const [chatWidth, setChatWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("curastem_blog_chat_width");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) return parsed;
      }
    }
    return CHAT_PANEL_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [chatsExpanded, setChatsExpanded] = useState(false);
  // Tracks a newly generated blog that hasn't been saved to Framer yet
  const [unsavedBlog, setUnsavedBlog] = useState<Blog | null>(null);
  // True while blog HTML is actively streaming — tells BlogEditor to skip placeholder guards
  const [isBlogStreaming, setIsBlogStreaming] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [creationStatus, setCreationStatus] = useState("");
  const [creationProgress, setCreationProgress] = useState(0);
  const [streamingBlogContent, setStreamingBlogContent] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    title?: string;
    message: string;
    error?: Error | string | unknown;
    details?: string;
  }>({
    isOpen: false,
    message: "",
  });
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const blogPreviewRef = useRef<HTMLDivElement>(null);
  const blogEditorRef = useRef<BlogEditorRef>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(CHAT_PANEL_WIDTH);
  const rafRef = useRef<number | null>(null);
  // When true, streaming text chunks are piped into the editor instead of the chat bubble
  const isBuildingBlogRef = useRef(false);
  const buildingContentRef = useRef("");
  // When true, the blog hasn't been saved to Framer yet — Save button will POST instead of PUT
  const isNewBlogRef = useRef(false);
  // Signals the SSE reader loop to stop after a "done" event is received
  const readerDoneRef = useRef(false);
  // AbortController for the current streaming fetch — used by the Stop button
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("curastem_blog_chat_width", String(chatWidth));
    }
  }, [chatWidth]);

  useEffect(() => {
    fetchBlogs();
    setChats(loadChats());
    const draft = loadDraft();
    if (draft) {
      setUnsavedBlog(draft.blog);
    }
    const checkScreenSize = () => {
      setIsSidebarOpen(window.innerWidth >= 768);
    };
    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  // Persist current chat to list when messages change (has at least one user message)
  useEffect(() => {
    const userCount = messages.filter((m) => m.role === "user").length;
    if (userCount === 0) return;
    const id = selectedChatId ?? `chat-${Date.now()}`;
    const title = chatTitleFromMessages(messages);
    setChats((prev) => {
      const existing = prev.find((c) => c.id === id);
      const chat: SavedChat = {
        id,
        title,
        messages,
        createdAt: existing?.createdAt ?? Date.now(),
      };
      const next = existing
        ? prev.map((c) => (c.id === id ? chat : c))
        : [chat, ...prev].slice(0, MAX_CHATS);
      saveChats(next);
      return next;
    });
    if (!selectedChatId) setSelectedChatId(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only persist when messages change
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (blogPreviewRef.current && selectedBlog) {
      blogPreviewRef.current.scrollTop = 0;
    }
  }, [selectedBlog]);

  // Clear "Saved!" feedback after 2 seconds
  useEffect(() => {
    if (!saveJustCompleted) return;
    const t = setTimeout(() => setSaveJustCompleted(false), 2000);
    return () => clearTimeout(t);
  }, [saveJustCompleted]);

  // Clear "Save Failed" indicator after 5 seconds
  useEffect(() => {
    if (!saveFailed) return;
    const t = setTimeout(() => setSaveFailed(false), 5000);
    return () => clearTimeout(t);
  }, [saveFailed]);

  // Auto-save draft to localStorage whenever the unsaved blog content changes
  useEffect(() => {
    if (isNewBlogRef.current && unsavedBlog && editableContent) {
      saveDraft(unsavedBlog, editableContent);
    }
  }, [editableContent, unsavedBlog]);

  const fetchBlogs = async () => {
    setFetchingBlogs(true);
    setBlogError(null);
    try {
      const res = await fetch("/api/blogs");
      let data;
      try {
        data = await res.json();
      } catch (parseError) {
        throw new Error("Invalid response from server");
      }
      
      if (res.ok) {
        if (Array.isArray(data)) {
          setBlogs(data);
          setBlogError(null);
          if (data.length === 0) {
            setBlogError("No blogs found in the collection. Create your first blog below.");
          }
        } else {
          setBlogs([]);
          setBlogError(`Unexpected response format: ${JSON.stringify(data)}`);
        }
      } else {
        const errorMsg = data.message || data.error || data.details || "Unknown error";
        setBlogs([]);
        setBlogError(errorMsg);
      }
    } catch (err) {
      setBlogs([]);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setBlogError(errorMessage);
    } finally {
      setFetchingBlogs(false);
    }
  };


  const [originalBlogState, setOriginalBlogState] = useState<{
    content: string;
    title: string;
    date: string;
    coverImageUrl?: string;
    blogListImageUrl?: string;
  } | null>(null);

  const handleBlogClick = async (blog: Blog) => {
    setLoadingBlog(true);
    if (isMobileLayout) setIsMobileEditorOpen(true);
    try {
      const res = await fetch(`/api/blogs/${blog.slug}`);
      if (res.ok) {
        const fullBlog = await res.json();
        setSelectedBlog(fullBlog);
        setEditableContent(fullBlog.content || "");
        // Store original state for comparison
        setOriginalBlogState({
          content: fullBlog.content || "",
          title: fullBlog.title || "",
          date: fullBlog.date || "",
          coverImageUrl: fullBlog.coverImageUrl,
          blogListImageUrl: fullBlog.blogListImageUrl,
        });
        // Scroll to top of editor
        if (blogPreviewRef.current) {
          blogPreviewRef.current.scrollTop = 0;
        }
      }
    } catch (err) {
      console.error("Failed to fetch blog", err);
    } finally {
      setLoadingBlog(false);
    }
  };

  const handleSaveBlog = async () => {
    if (!selectedBlog || savingBlog) return;

    setSavingBlog(true);
    setSaveFailed(false);
    try {
      let blogListImageUrl = selectedBlog.blogListImageUrl;
      // Always regenerate zoom-out when: no existing one, existing one is just the raw cover URL,
      // OR the cover image URL has changed since the blog was last saved/loaded.
      const coverChanged =
        originalBlogState !== null &&
        (selectedBlog.coverImageUrl || "") !== (originalBlogState.coverImageUrl || "");
      if (
        selectedBlog.coverImageUrl &&
        (!blogListImageUrl || blogListImageUrl === selectedBlog.coverImageUrl || coverChanged)
      ) {
        const zoomRes = await fetch("/api/images/zoom-out", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: selectedBlog.coverImageUrl }),
        });
        if (zoomRes.ok) {
          const { zoomOutUrl } = await zoomRes.json();
          blogListImageUrl = zoomOutUrl;
          setSelectedBlog((prev) =>
            prev ? { ...prev, blogListImageUrl: zoomOutUrl } : prev
          );
        }
      }

      const isNew = isNewBlogRef.current;
      const res = isNew
        ? await fetch("/api/blogs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "save",
              slug: selectedBlog.slug,
              title: selectedBlog.title,
              headline: selectedBlog.headline || "",
              content: editableContent,
              date: selectedBlog.date,
              coverImageUrl: selectedBlog.coverImageUrl,
              coverImageAlt: selectedBlog.coverImageAlt,
              blogListImageUrl: blogListImageUrl ?? selectedBlog.coverImageUrl,
            }),
          })
        : await fetch(`/api/blogs/${selectedBlog.slug}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: editableContent,
              title: selectedBlog.title,
              date: selectedBlog.date,
              coverImageUrl: selectedBlog.coverImageUrl,
              coverImageAlt: selectedBlog.coverImageAlt,
              blogListImageUrl: blogListImageUrl ?? selectedBlog.coverImageUrl,
            }),
          });

      if (res.ok) {
        const updatedBlog = await res.json();
        setSelectedBlog(updatedBlog);
        isNewBlogRef.current = false; // Now exists in Framer — subsequent saves use PUT
        setUnsavedBlog(null); // No longer unsaved
        clearDraft(); // Remove from localStorage
        setOriginalBlogState({
          content: editableContent,
          title: selectedBlog.title,
          date: selectedBlog.date || "",
          coverImageUrl: selectedBlog.coverImageUrl,
          blogListImageUrl: updatedBlog.blogListImageUrl,
        });
        fetchBlogs();
        setSaveJustCompleted(true);
      } else {
        const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
        console.error("Save error response:", errorData);
        const errorMsg = errorData.error || errorData.message || "Failed to save blog";
        const errorDetails = errorData.details || errorData.message || errorMsg;
        throw new Error(`${errorMsg}\n\n${errorDetails}`);
      }
    } catch (err) {
      console.error("Save error:", err);
      setSaveFailed(true);
      const errorMessage = err instanceof Error ? err.message : "Failed to save changes. Please try again.";
      setErrorModal({
        isOpen: true,
        title: "Failed to save blog",
        message: errorMessage.split('\n\n')[0],
        error: err,
        details: `Failed to save blog "${selectedBlog?.title}" to Framer CMS.\n\n${errorMessage}`,
      });
    } finally {
      setSavingBlog(false);
    }
  };

  const handleNewChat = () => {
    readerDoneRef.current = true;
    abortControllerRef.current?.abort();
    setLoading(false);
    setIsBlogStreaming(false);
    setSelectedBlog(null);
    setIsCreating(false);
    setStreamingBlogContent("");
    setOriginalBlogState(null);
    setMessages([
      { role: "assistant", content: "Hello! I'm the Curastem Blog Tool. How can I help you today? You can ask me to create a new blog or list existing ones." },
    ]);
    setSelectedChatId(null);
    setInput("");
    setPendingEditImage(null);
    isBuildingBlogRef.current = false;
    buildingContentRef.current = "";
    abortControllerRef.current = null;
  };

  const handleSelectChat = (chat: SavedChat) => {
    setSelectedBlog(null);
    setIsCreating(false);
    setStreamingBlogContent("");
    setOriginalBlogState(null);
    setMessages(chat.messages);
    setSelectedChatId(chat.id);
  };

  const handleCloseBlog = () => {
    // On mobile: just collapse the editor overlay — keep blog selected so chat retains context
    if (isMobileLayout) {
      setIsMobileEditorOpen(false);
      return;
    }
    // Desktop: fully deselect
    if (isNewBlogRef.current && selectedBlog) {
      saveDraft(selectedBlog, editableContent);
    }
    setSelectedBlog(null);
    setIsCreating(false);
    setIsBlogStreaming(false);
    setStreamingBlogContent("");
    isBuildingBlogRef.current = false;
    buildingContentRef.current = "";
  };

  // Drag-to-resize between chat and blog (curastem style)
  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = chatWidth;
    setIsResizing(true);
  };

  const handleResizePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const deltaX = e.clientX - dragStartXRef.current;
        let newWidth = dragStartWidthRef.current + deltaX;
        const leftSidebarWidth = !isMobileLayout && isSidebarOpen ? 260 : 0;
        const containerWidth = typeof window !== "undefined" ? window.innerWidth - leftSidebarWidth : 1200;
        const maxChatWidth = containerWidth - BLOG_PANEL_MIN;
        newWidth = Math.max(CHAT_WIDTH_MIN, Math.min(newWidth, maxChatWidth));
        if (chatPanelRef.current) {
          chatPanelRef.current.style.width = `${newWidth}px`;
        }
        rafRef.current = null;
      });
    },
    [isMobileLayout, isSidebarOpen]
  );

  const handleResizePointerUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (chatPanelRef.current) {
      const finalWidth = parseInt(chatPanelRef.current.style.width, 10);
      if (!isNaN(finalWidth)) setChatWidth(finalWidth);
    }
    setTimeout(() => setIsResizing(false), 50);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    window.addEventListener("pointermove", handleResizePointerMove);
    window.addEventListener("pointerup", handleResizePointerUp);
    return () => {
      window.removeEventListener("pointermove", handleResizePointerMove);
      window.removeEventListener("pointerup", handleResizePointerUp);
    };
  }, [isResizing, handleResizePointerMove, handleResizePointerUp]);

  // Sidebar dots: red = not yet published to Framer (draft row); yellow = published but local edits not saved
  const blogHasChanges = useMemo(() => {
    if (!originalBlogState || !selectedBlog) return false;
    return (
      editableContent !== originalBlogState.content ||
      selectedBlog.title !== originalBlogState.title ||
      (selectedBlog.date || "") !== originalBlogState.date ||
      (selectedBlog.coverImageUrl || "") !== (originalBlogState.coverImageUrl || "")
    );
  }, [originalBlogState, selectedBlog, editableContent]);

  // Re-baseline originalBlogState.content after TipTap normalizes HTML on first open.
  // TipTap's placeholder effect runs with a 300ms debounce and calls onChange() with the
  // normalized content — which would otherwise make blogHasChanges true before any user edit.
  useEffect(() => {
    if (!selectedBlog?.slug) return;
    const timer = setTimeout(() => {
      setOriginalBlogState(prev =>
        prev ? { ...prev, content: editableContentRef.current } : prev
      );
    }, 700); // 300ms placeholder debounce + buffer
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBlog?.slug]);

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim() || loading) return;

    const userMessage = messageText.trim();

    // Image edit mode — user typed a prompt for an attached image, call image API directly
    if (pendingEditImage) {
      const { url: imageUrl, alt: imageAlt } = pendingEditImage;
      setPendingEditImage(null);
      setLoading(true);
      setMessages(prev => [
        ...prev,
        { role: "user" as const, content: `Edit image: ${userMessage}` },
        { role: "assistant" as const, content: "Editing image…" },
      ]);
      try {
        const res = await fetch("/api/images/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: userMessage, aspect: "16:9", imageSize: "1K", existingImageUrl: imageUrl }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to edit image");
        }
        const data = await res.json();
        const newUrl = data.url;
        const isCoverImage = selectedBlog && imageUrl === selectedBlog.coverImageUrl;
        if (isCoverImage) {
          setSelectedBlog((prev) => (prev ? { ...prev, coverImageUrl: newUrl } : prev));
          try {
            const zoomRes = await fetch("/api/images/zoom-out", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageUrl: newUrl }),
            });
            if (zoomRes.ok) {
              const { zoomOutUrl } = await zoomRes.json();
              setSelectedBlog((prev) => (prev ? { ...prev, blogListImageUrl: zoomOutUrl } : prev));
            }
          } catch {
            /* zoom-out optional */
          }
        } else {
          setEditableContent((prev) =>
            prev.replace(new RegExp(imageUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), newUrl)
          );
        }
        setMessages((prev) => {
          const msgs = [...prev];
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: "Image updated! Click Save Changes when ready." };
          return msgs;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to edit image";
        setMessages(prev => {
          const msgs = [...prev];
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: `Failed to edit image: ${msg}` };
          return msgs;
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    setStreamingBlogContent("");
    buildingContentRef.current = "";
    readerDoneRef.current = false;
    setMessages(prev => [...prev, { role: "user" as const, content: userMessage }]);
    setLoading(true);

    // Create a fresh AbortController for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, { role: "user" as const, content: userMessage }],
          currentBlogSlug: selectedBlog?.slug,
          // Pass current blog HTML so the AI can make targeted edits
          currentBlogContent: selectedBlog ? editableContent : undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        let errorMsg = "Failed to get response";
        try { const data = JSON.parse(text); errorMsg = data.error || errorMsg; } catch { errorMsg = text || errorMsg; }
        throw new Error(errorMsg);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      let assistantMessage = "";
      let editBlogReceived = false;
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done || readerDoneRef.current) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event: { t: string; c?: string; n?: string; a?: Record<string, unknown>; r?: unknown; err?: string };
          try { event = JSON.parse(raw); } catch { continue; }

          if (event.t === "text" && event.c) {
            const chunk = event.c as string;

            if (isBuildingBlogRef.current) {
              // Buffer everything; slice from the first HTML tag to strip any preamble
              buildingContentRef.current += chunk;
              const htmlStart = buildingContentRef.current.indexOf("<");
              if (htmlStart >= 0) {
                setEditableContent(markdownToHtml(buildingContentRef.current.slice(htmlStart)));
              }
              setMessages(prev => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: "Writing your blog…" };
                return msgs;
              });
            } else {
              // Not yet building — check if HTML blog content is starting
              // (AI writes content BEFORE calling create_blog)
              assistantMessage += chunk;
              buildingContentRef.current += chunk;
              const htmlStart = buildingContentRef.current.indexOf("<");
              if (!selectedBlog && htmlStart >= 0) {
                // HTML detected — open editor optimistically before the tool call arrives
                const tempSlug = "new-blog-" + Date.now();
                const tempBlog = { id: "pending", slug: tempSlug, title: "New Blog", headline: "", date: new Date().toISOString() };
                setSelectedBlog(tempBlog);
                setUnsavedBlog(tempBlog);
                setOriginalBlogState({ content: "", title: "New Blog", date: tempBlog.date });
                setEditableContent(markdownToHtml(buildingContentRef.current.slice(htmlStart)));
                isBuildingBlogRef.current = true;
                isNewBlogRef.current = true;
                setIsBlogStreaming(true);
              } else if (!selectedBlog) {
                // Normal chat text (no HTML yet)
                setMessages(prev => {
                  const msgs = [...prev];
                  msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: assistantMessage };
                  return msgs;
                });
              } else {
                // Edit mode: blog is open — show AI's summary in chat (e.g. after edit_blog)
                setMessages(prev => {
                  const msgs = [...prev];
                  msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: assistantMessage };
                  return msgs;
                });
              }
            }

          } else if (event.t === "tool_start") {
            const toolName = event.n ?? "";
            const statusMap: Record<string, string> = {
              list_blogs: "Fetching blog list...",
              add_image: "Generating and uploading image...",
              edit_blog: "Editing blog...",
            };
            if (statusMap[toolName]) {
              setCreationStatus(statusMap[toolName]);
            }

            if (toolName === "create_blog") {
              // Content already streaming — update the title/slug now that we know them
              const title = (event.a?.title as string) || "New Blog";
              const slug = slugify(title);
              setSelectedBlog(prev => {
                const updated = prev ? { ...prev, slug, title } : { id: "pending", slug, title, headline: "", date: new Date().toISOString() };
                setUnsavedBlog(updated);
                return updated;
              });
              isNewBlogRef.current = true;
            }

          } else if (event.t === "tool_done") {
            const toolName = event.n ?? "";
            const result = event.r as Record<string, unknown> | undefined;

            if (toolName === "create_blog" && result) {
              // Editor already open — just confirm the final slug from the server
              if (result.slug) {
                setSelectedBlog(prev => prev ? { ...prev, slug: String(result.slug), title: String(result.title ?? prev.title) } : prev);
              }
            } else if (toolName === "list_blogs") {
              fetchBlogs();
            } else if (toolName === "edit_blog") {
              editBlogReceived = true;
              const ops = (result?.operations ?? []) as Array<{ find: string; replace: string }>;
              if (ops.length === 0) {
                setMessages(prev => {
                  const msgs = [...prev];
                  msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: "I couldn't find an exact match to edit. Try being more specific about which text to change." };
                  return msgs;
                });
              } else if (blogEditorRef.current) {
                const applied = blogEditorRef.current.applyAIEdits(ops);
                if (!applied) {
                  // Editor HTML may differ from what we sent (normalization) — try raw content
                  setEditableContent(prev => {
                    let html = prev;
                    let changed = false;
                    for (const op of ops) {
                      if (op.find && html.includes(op.find)) {
                        html = html.split(op.find).join(wrapWithAiHighlight(op.replace));
                        changed = true;
                      }
                    }
                    return changed ? html : prev;
                  });
                }
              } else {
                // Fallback: apply edits to content when editor ref isn't ready (e.g. loading)
                setEditableContent(prev => {
                  let html = prev;
                  let changed = false;
                  for (const op of ops) {
                    if (op.find && html.includes(op.find)) {
                      html = html.split(op.find).join(wrapWithAiHighlight(op.replace));
                      changed = true;
                    }
                  }
                  return changed ? html : prev;
                });
              }
            } else if (toolName === "add_image" && result?.url) {
              // Insert the image above the specified H2 in the current editor content
              const h2Text = result.h2Text as string;
              const imageUrl = result.url as string;
              const subject = result.subject as string;
              setEditableContent(prev => {
                const h2Pattern = new RegExp(
                  `(<h2[^>]*>[^<]*${h2Text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^<]*<\/h2>)`,
                  "i"
                );
                const match = prev.match(h2Pattern);
                if (!match) return prev;
                const imageHtml = `<p dir="auto" class="image-with-regenerate"><img src="${imageUrl}" alt="${subject}"></p>`;
                return prev.replace(h2Pattern, imageHtml + match[0]);
              });
            }

          } else if (event.t === "tool_error") {
            const errMsg = event.err ?? "Unknown error";
            console.error(`Tool error (${event.n ?? "stream"}):`, errMsg);
            setIsCreating(false);
            setCreationProgress(0);
            setCreationStatus("");
            // Stream-level error (no tool name) = AI failed entirely, show in chat
            if (!event.n) {
              assistantMessage = `Sorry, I ran into an error: ${errMsg}`;
              setMessages(prev => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: assistantMessage };
                return msgs;
              });
            } else if (event.n === "edit_blog" && selectedBlog) {
              setMessages(prev => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: `Couldn't complete the edit: ${errMsg}` };
                return msgs;
              });
            }
          } else if (event.t === "done") {
            if (isBuildingBlogRef.current) {
              isBuildingBlogRef.current = false;
              setIsBlogStreaming(false); // Let BlogEditor add H2 placeholders now
              // Persist the completed draft so it survives close/refresh
              setUnsavedBlog(prev => {
                if (prev) saveDraft(prev, buildingContentRef.current);
                return prev;
              });
              setMessages(prev => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: "Blog written! Review it in the editor and hit Save Changes when ready." };
                return msgs;
              });
            } else if (selectedBlog && !editBlogReceived && assistantMessage.trim()) {
              // Only replace if AI's response CLAIMED to make edits (e.g. "I've updated...") — otherwise keep advice/feedback
              const claimedEdits = /\b(I('ve| have) (updated|made|changed|edited|rewritten|adjusted|modified)|I('ve| have) made the|Here are the changes)\b/i.test(assistantMessage);
              if (claimedEdits) {
                setMessages(prev => {
                  const msgs = [...prev];
                  msgs[msgs.length - 1] = {
                    ...msgs[msgs.length - 1],
                    content: "No edits were applied — the AI described changes but didn't actually make them. Try again with a specific request (e.g. \"change the H3 to say X\" or \"replace paragraph 2 with...\").",
                  };
                  return msgs;
                });
              }
              // If AI gave advice/feedback (not edit claims), keep assistantMessage as-is — already in msgs from text events
            } else if (selectedBlog && editBlogReceived && !assistantMessage.trim()) {
              // Edit mode: AI called edit_blog but sent no summary
              setMessages(prev => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: "Edits applied. Review changes in the editor." };
                return msgs;
              });
            }
            // Signal outer reader loop to stop
            readerDoneRef.current = true;
            break;
          }
        }
      }
    } catch (err) {
      // AbortError = user clicked Stop — not a real error, just clean up quietly
      if (err instanceof Error && err.name === "AbortError") {
        setMessages(prev => {
          const msgs = [...prev];
          if (msgs[msgs.length - 1]?.role === "assistant" && !msgs[msgs.length - 1].content) {
            msgs.pop(); // Remove empty assistant bubble if nothing was generated
          } else if (msgs[msgs.length - 1]?.content === "Writing your blog…") {
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: "Stopped." };
          }
          return msgs;
        });
      } else {
        console.error(err);
        const msg = err instanceof Error ? err.message : String(err);
        setMessages(prev => [...prev, { role: "assistant", content: `Sorry, I encountered an error: ${msg}. Please try again.` }]);
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      setIsCreating(false);
      setIsBlogStreaming(false);
      setCreationProgress(0);
      setCreationStatus("");
      isBuildingBlogRef.current = false;
      buildingContentRef.current = "";
      // Don't reset isNewBlogRef here — it should persist until the user saves
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const messageText = input.trim();
    setInput("");
    // Reset textarea height after clearing
    if (chatTextareaRef.current) {
      chatTextareaRef.current.style.height = "auto";
      chatTextareaRef.current.style.overflowY = "hidden";
    }
    await sendMessage(messageText);
  };

  const filteredBlogs = blogs
    .filter((blog) => blog.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  const filteredChats = chats.filter((chat) =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const userMessageCount = useMemo(
    () => messages.filter((m) => m.role === "user").length,
    [messages]
  );
  /** web.tsx: default suggestion row only before first user message in this chat. */
  const showDefaultSuggestions =
    userMessageCount === 0 && !isCreating && !streamingBlogContent;

  return (
    <div className="flex bg-white overflow-hidden text-black font-sans relative" style={{ height: "100dvh" }} role="main" aria-label="Curastem Blog Tool">

      {/* Open Sidebar Button — always at top-left, absolute, matches web.tsx */}
      {!isSidebarOpen && (
        <button
          data-layer="open sidebar"
          aria-label="Open navigation menu"
          data-label="sidebar-open"
          style={{
            left: 8,
            top: 8,
            position: "absolute",
            zIndex: 100,
            cursor: "ew-resize",
            background: isSidebarBtnHovered ? "var(--cs-hover-medium)" : "transparent",
            borderRadius: "50%",
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            padding: 0,
          }}
          onMouseEnter={() => setIsSidebarBtnHovered(true)}
          onMouseLeave={() => setIsSidebarBtnHovered(false)}
          onClick={(e) => { e.stopPropagation(); setIsSidebarOpen(true); }}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <path d="M10 14H26M10 22H20" stroke="var(--cs-text-primary)" strokeOpacity="0.95" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Mobile Overlay — motion opacity matches web.tsx */}
      {isMobileLayout && (
        <motion.div
          role="presentation"
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--cs-overlay)",
            zIndex: 9999,
            opacity: sidebarOverlayOpacity,
            pointerEvents: isSidebarOpen ? "auto" : "none",
          }}
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar — motion.div with spring animation, absolute overlay (web.tsx pattern) */}
      <motion.div
        data-layer="left sidebar"
        role="navigation"
        aria-label="Navigation sidebar"
        data-label="sidebar"
        style={{
          x: sidebarX,
          width: 260,
          height: "100%",
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          background: "var(--cs-bg)",
          zIndex: 10000,
          display: "flex",
          flexDirection: "column",
          overflow: "visible",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed top nav — pinned inside sidebar */}
        <div
          data-layer="fixed top nav"
          style={{
            width: "100%",
            padding: 8,
            position: "sticky",
            top: 0,
            background: "var(--cs-bg)",
            flexDirection: "column",
            display: "flex",
            gap: 12,
            flexShrink: 0,
            zIndex: 1,
          }}
        >
          {/* Top actions row: close button (left) */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }} data-label="sidebar-top-actions-row">
            <div
              role="button"
              tabIndex={0}
              aria-label="Close navigation sidebar"
              data-label="sidebar-close"
              onClick={(e) => { e.stopPropagation(); setIsSidebarOpen(false); }}
              onMouseEnter={() => setIsCloseSidebarHovered(true)}
              onMouseLeave={() => setIsCloseSidebarHovered(false)}
              style={{
                width: 36,
                height: 36,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                cursor: "ew-resize",
                borderRadius: 28,
                background: isCloseSidebarHovered ? "var(--cs-hover-medium)" : "transparent",
              }}
            >
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path d="M10 14H26M10 22H20" stroke="var(--cs-text-primary)" strokeOpacity="0.95" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>

          {/* Search Bar */}
          <div data-label="search-container" style={{ height: 36, paddingLeft: 12, background: "var(--cs-surface)", borderRadius: 50, overflow: "hidden", display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }} aria-hidden>
              <path d="M10.9289 10.8023L14.7616 14.6M12.6167 6.5224C12.6167 8.09311 11.9837 9.5995 10.8571 10.7102C9.73045 11.8208 8.20241 12.4448 6.60911 12.4448C5.01581 12.4448 3.48777 11.8208 2.36113 10.7102C1.2345 9.5995 0.601563 8.09311 0.601562 6.5224C0.601563 4.95168 1.2345 3.44529 2.36113 2.33463C3.48777 1.22396 5.01581 0.599998 6.60911 0.599998C8.20241 0.599998 9.73045 1.22396 10.8571 2.33463C11.9837 3.44529 12.6167 4.95168 12.6167 6.5224Z" stroke="var(--cs-text-primary)" strokeOpacity="0.65" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search blogs and chats"
              data-label="search-input"
              style={{
                flex: "1 1 0",
                color: "var(--cs-text-primary)",
                fontSize: 14,
                fontFamily: "Inter, system-ui, sans-serif",
                fontWeight: 400,
                background: "transparent",
                border: "none",
                outline: "none",
                padding: 0,
                height: "100%",
              }}
            />
          </div>

          {/* New blog + Settings */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }} data-label="sidebar-actions">
            <button
              id="new-chat-button"
              data-testid="new-chat-button"
              data-label="new-chat-button"
              aria-label="Start new blog"
              onClick={handleNewChat}
              className="w-full flex items-center gap-3 touch-manipulation text-[14px] font-normal"
              style={{ minHeight: 36, paddingLeft: 10, paddingRight: 10, borderRadius: 28, color: "var(--cs-text-primary)", background: "transparent" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cs-hover-strong)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0" aria-hidden>
                <path d="M14.9998 8.00011C14.9998 11.1823 14.9998 12.773 13.9747 13.7615C12.9496 14.75 11.2992 14.75 7.99988 14.75C4.69983 14.75 3.05019 14.75 2.02509 13.7615C1 12.773 1 11.1816 1 8.00011C1 4.81792 1 3.22719 2.02509 2.23871C3.05019 1.25023 4.7006 1.25023 7.99988 1.25023M6.08114 7.36262C5.81571 7.61895 5.66661 7.96637 5.66659 8.32861V10.2501H7.67167C8.04733 10.2501 8.40821 10.1061 8.6742 9.84958L14.5852 4.14668C14.7168 4.01979 14.8213 3.86913 14.8925 3.70332C14.9637 3.53751 15.0004 3.3598 15.0004 3.18032C15.0004 3.00084 14.9637 2.82313 14.8925 2.65732C14.8213 2.49151 14.7168 2.34085 14.5852 2.21396L14.0011 1.65072C13.8695 1.52369 13.7132 1.42291 13.5412 1.35415C13.3692 1.28539 13.1848 1.25 12.9986 1.25C12.8124 1.25 12.628 1.28539 12.4559 1.35415C12.2839 1.42291 12.1276 1.52369 11.996 1.65072L6.08114 7.36262Z" stroke="var(--cs-text-primary)" strokeOpacity="0.95" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>New blog</span>
            </button>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Open settings"
              data-label="settings-button"
              className="w-full flex items-center gap-3 touch-manipulation text-[14px] font-normal"
              style={{ minHeight: 36, paddingLeft: 10, paddingRight: 10, borderRadius: 28, color: "var(--cs-text-primary)", background: "transparent" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cs-hover-strong)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <Settings className="h-4 w-4 flex-shrink-0" style={{ color: "var(--cs-text-primary)" }} aria-hidden />
              <span>Settings</span>
            </button>
          </div>
        </div>

        {/* Sidebar scrollable lists */}
        <div className="flex-1 overflow-y-auto custom-scrollbar" data-label="sidebar-lists" style={{ padding: 8, paddingTop: 0 }}>
            {/* Your chats — collapsible, default 3 visible; hidden when empty and not searching */}
            {(chats.length > 0 && filteredChats.length > 0) && (
            <div className="flex flex-col" style={{ marginBottom: 12 }} data-label="your-chats-section">
              <button
                type="button"
                onClick={() => setChatsExpanded((e) => !e)}
                data-label="your-chats-toggle"
                aria-label={chatsExpanded ? "Collapse your chats" : "Expand your chats"}
                aria-expanded={chatsExpanded}
                className="w-full flex items-center justify-start cursor-pointer touch-manipulation rounded-[12px]"
                style={{ padding: "8px 10px", gap: 4 }}
              >
                <span className="text-[14px] font-normal" style={{ color: "var(--cs-text-secondary)", fontFamily: "Inter" }}>Your chats</span>
                {filteredChats.length >= 4 && !searchQuery && (
                  <span className={cn("flex-shrink-0 inline-flex items-center justify-center transition-transform", chatsExpanded && "rotate-90")} style={{ width: 12, height: 24, color: "var(--cs-text-secondary)" }} aria-hidden>
                    <svg width="6" height="10" viewBox="0 0 6 10" fill="none"><path d="M0.601562 8.60001L4.60156 4.60001L0.601562 0.600006" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                )}
              </button>
              <div className="flex flex-col gap-0.5" data-label="chat-list">
                {(chatsExpanded || searchQuery ? filteredChats : filteredChats.slice(0, 3)).map((chat) => (
                  <div
                    key={chat.id}
                    data-label="chat-item"
                    data-chat-id={chat.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open chat: ${chat.title}`}
                    onClick={() => handleSelectChat(chat)}
                    onKeyDown={(e) => e.key === "Enter" && handleSelectChat(chat)}
                    className="flex items-center justify-between rounded-[28px] cursor-pointer transition-colors touch-manipulation text-[14px] font-normal relative"
                    style={{
                      minHeight: 36,
                      paddingLeft: 10,
                      paddingRight: 10,
                      marginBottom: 2,
                      color: "var(--cs-text-primary)",
                      background: selectedChatId === chat.id && !selectedBlog ? "var(--cs-hover-medium)" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (selectedChatId !== chat.id || selectedBlog) e.currentTarget.style.background = "var(--cs-hover-strong)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = selectedChatId === chat.id && !selectedBlog ? "var(--cs-hover-medium)" : "transparent";
                    }}
                  >
                    <span className="truncate flex-1" style={{ fontFamily: "Inter" }}>{chat.title}</span>
                  </div>
                ))}
              </div>
            </div>
            )}

            {/* Your blogs */}
            <div data-label="your-blogs-section">
              <div className="rounded-[12px]" style={{ padding: "8px 10px", marginBottom: 8 }}>
                <h2 className="text-[14px] font-normal" style={{ color: "var(--cs-text-secondary)", fontFamily: "Inter" }} data-label="your-blogs-heading">Blogs</h2>
                {fetchingBlogs && (
                  <div className="flex items-center gap-2 mt-1.5" data-label="blogs-loading">
                    <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" style={{ color: "var(--cs-text-secondary)" }} aria-hidden />
                    <span className="text-[13px]" style={{ color: "var(--cs-text-secondary)", fontFamily: "Inter" }}>Loading</span>
                  </div>
                )}
              </div>
          
          <div className="flex flex-col gap-0.5">
            {/* Draft not in CMS yet — red dot (not published) */}
            {unsavedBlog && (
              <div
                role="button"
                tabIndex={0}
                aria-label={`Open unsaved blog: ${unsavedBlog.title}`}
                data-label="unsaved-blog-item"
                onClick={() => {
                  // Restore from in-memory buffer first, then fall back to localStorage
                  const memContent = buildingContentRef.current;
                  const htmlIdx = memContent.indexOf("<");
                  if (htmlIdx >= 0) {
                    setEditableContent(markdownToHtml(memContent.slice(htmlIdx)));
                  } else {
                    const draft = loadDraft();
                    setEditableContent(draft?.content ? markdownToHtml(draft.content) : "");
                  }
                  setSelectedBlog(unsavedBlog);
                  isNewBlogRef.current = true;
                  setOriginalBlogState({ content: "", title: unsavedBlog.title, date: unsavedBlog.date });
                }}
                className="flex items-center justify-between rounded-[28px] cursor-pointer transition-colors touch-manipulation text-[14px] font-normal relative"
                style={{
                  minHeight: 36,
                  paddingLeft: 10,
                  paddingRight: 10,
                  marginBottom: 2,
                  color: "var(--cs-text-primary)",
                  background: selectedBlog?.id === unsavedBlog.id ? "var(--cs-hover-medium)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (selectedBlog?.id !== unsavedBlog.id) e.currentTarget.style.background = "var(--cs-hover-strong)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = selectedBlog?.id === unsavedBlog.id ? "var(--cs-hover-medium)" : "transparent";
                }}
              >
                <span className="truncate flex-1" style={{ fontFamily: "Inter" }}>{unsavedBlog.title}</span>
                <div
                  className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0"
                  title="Not published yet"
                  aria-label="Not published"
                />
              </div>
            )}

            {!fetchingBlogs && filteredBlogs.length === 0 && !unsavedBlog ? (
              <div className="px-3 py-2 text-[14px] italic" style={{ color: "var(--cs-text-secondary)" }} data-label="no-blogs">
                {searchQuery ? "No matching blogs" : "No blogs yet"}
              </div>
            ) : (
              filteredBlogs.map((blog) => (
                <div
                  key={blog.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open blog: ${blog.title}`}
                  data-label="blog-item"
                  data-blog-id={blog.id}
                  onClick={() => handleBlogClick(blog)}
                  onKeyDown={(e) => e.key === "Enter" && handleBlogClick(blog)}
                  className="flex items-center justify-between rounded-[28px] cursor-pointer transition-colors touch-manipulation text-[14px] font-normal relative"
                  style={{
                    minHeight: 36,
                    paddingLeft: 10,
                    paddingRight: 10,
                    marginBottom: 2,
                    color: "var(--cs-text-primary)",
                    background: selectedBlog?.id === blog.id ? "var(--cs-hover-medium)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (selectedBlog?.id !== blog.id) e.currentTarget.style.background = "var(--cs-hover-strong)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = selectedBlog?.id === blog.id ? "var(--cs-hover-medium)" : "transparent";
                  }}
                >
                  <span className="truncate flex-1" style={{ fontFamily: "Inter" }}>{blog.title}</span>
                  {selectedBlog?.id === blog.id && !loadingBlog && blogHasChanges && (
                    <div
                      className="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"
                      title="Published — unsaved changes"
                      aria-label="Unsaved changes"
                    />
                  )}
                  {loadingBlog && selectedBlog?.id === blog.id && (
                    <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" style={{ color: "var(--cs-text-secondary)" }} />
                  )}
                </div>
              ))
            )}
          </div>
            </div>
          </div>
      </motion.div>

      {/* Main Area — chat left, blog right (web.tsx / curastem layout) */}
      {/* Desktop: paddingLeft animates to 260 when sidebar open. Mobile: x shifts right. */}
      <motion.div
        data-layer="main-content-layout"
        data-label="main-content"
        animate={{ paddingLeft: !isMobileLayout && isSidebarOpen ? 260 : 0 }}
        transition={{ type: "spring", stiffness: 700, damping: 50 }}
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          x: isMobileLayout ? contentX : 0,
        }}
      >
        {/* Chat Panel — left, always visible on desktop; shrinks when blog open; resizable via drag */}
        <motion.div
          ref={chatPanelRef}
          className="flex flex-col min-w-0 flex-shrink-0 relative bg-white"
          animate={{
            width: !isMobileLayout && selectedBlog ? chatWidth : "100%",
            flexGrow: !isMobileLayout && selectedBlog ? 0 : 1,
          }}
          transition={isResizing ? { duration: 0 } : { type: "spring", stiffness: 700, damping: 50 }}
          style={{ flexShrink: 0, display: "flex", flexDirection: "column", position: "relative", zIndex: 20 }}
        >

          {isCreating ? (
            <div className="flex-1 flex items-center justify-center bg-white">
              <div className="max-w-xs w-full mx-6 p-10 bg-white rounded-[32px] border border-gray-100 shadow-[0_8px_48px_rgba(0,0,0,0.08)] text-center animate-fade-in">
                <div className="mb-8 relative h-20 w-20 mx-auto">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80" fill="none">
                    <circle cx="40" cy="40" r="33" stroke="#f3f4f6" strokeWidth="5.5" />
                    <circle cx="40" cy="40" r="33" stroke="black" strokeWidth="5.5" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 33}`} strokeDashoffset={`${2 * Math.PI * 33 * (1 - creationProgress / 100)}`} className="transition-all duration-700 ease-out" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-semibold tabular-nums">{creationProgress}%</span>
                  </div>
                </div>
                <h2 className="text-[17px] font-semibold tracking-tight mb-1.5">Building your blog...</h2>
                <p className="text-gray-400 text-[13px] mb-8 leading-relaxed">{creationStatus || "Preparing…"}</p>
                <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-black h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${creationProgress}%` }} />
                </div>
              </div>
            </div>
          ) : streamingBlogContent ? (
            <div className="flex-1 flex flex-col overflow-hidden animate-fade-in">
              <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-xs font-medium text-gray-600 uppercase tracking-wider">Live Preview</span>
                </div>
                <button type="button" onClick={() => setStreamingBlogContent("")} aria-label="Hide live preview" data-label="hide-preview-button" className="text-[10px] uppercase tracking-widest text-gray-400 hover:text-black transition-colors">
                  Hide Preview
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 md:p-12 bg-white">
                <div className="w-full mx-auto prose prose-sm max-w-2xl">
                  <div dangerouslySetInnerHTML={{ __html: streamingBlogContent.replace(/### (.*)/g, "<h3>$1</h3>").replace(/## (.*)/g, "<h2>$1</h2>").replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>") }} />
                </div>
              </div>
            </div>
          ) : (
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 pb-32 md:pb-40 custom-scrollbar" role="log" aria-live="polite" data-label="chat-messages">
              <div className="w-full mx-auto pt-8 md:pt-20 px-4" style={{ maxWidth: 816 }}>
                {messages.map((msg, i) => {
                  // Don't render empty assistant placeholder bubbles — the pulsing star below handles that state
                  if (!msg.content && msg.role === "assistant") return null;
                  return (
                    <div key={i} className="animate-fade-in" data-label={`message-${msg.role}-${i}`} role="article" style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", width: "100%", scrollMarginTop: 24, marginTop: msg.role === "user" ? 24 : 0, marginBottom: msg.role === "user" ? 8 : 0 }}>
                      <div style={{ maxWidth: msg.role === "user" ? "80%" : "100%", width: msg.role === "user" ? "auto" : "100%", display: "flex", flexDirection: "column", gap: 8, alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                        <div style={{ padding: msg.role === "user" ? "6px 16px" : 0, borderRadius: msg.role === "user" ? 20 : 0, background: msg.role === "user" ? "var(--cs-hover-message)" : "transparent", color: "var(--cs-text-primary)", fontSize: 16, lineHeight: 1.6, maxWidth: "100%", minWidth: 0, fontFamily: "Inter, system-ui, sans-serif" }}>
                          <ChatMarkdown content={msg.content} />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Pulsing star — shown while AI is thinking (matches web.tsx pulseStar animation) */}
                {loading && (
                  messages.length === 0 ||
                  messages[messages.length - 1].role === "user" ||
                  !messages[messages.length - 1].content
                ) && (
                  <div style={{ marginLeft: 0, paddingBottom: 8, paddingTop: 8 }}>
                    <div style={{ animation: "pulseStar 1.5s infinite ease-in-out", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="AI thinking" role="img">
                        <g clipPath="url(#clipPulseStar)">
                          <path d="M9.291 1.32935C9.59351 0.762163 10.4065 0.762164 10.709 1.32935L13.4207 6.41384C13.4582 6.48418 13.5158 6.54176 13.5861 6.57927L18.6706 9.29099C19.2378 9.59349 19.2378 10.4065 18.6706 10.709L13.5861 13.4207C13.5158 13.4582 13.4582 13.5158 13.4207 13.5862L10.709 18.6706C10.4065 19.2378 9.59351 19.2378 9.291 18.6706L6.57927 13.5862C6.54176 13.5158 6.48417 13.4582 6.41384 13.4207L1.32934 10.709C0.762155 10.4065 0.762157 9.59349 1.32935 9.29099L6.41384 6.57927C6.48417 6.54176 6.54176 6.48418 6.57927 6.41384L9.291 1.32935Z" fill="var(--cs-text-primary)" />
                        </g>
                        <defs>
                          <clipPath id="clipPulseStar">
                            <rect width="20" height="20" fill="white" />
                          </clipPath>
                        </defs>
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        {/* New Chat (top right of chat panel) — same position and control as web.tsx RightContentPanel */}
        {messages.length > 0 && (
          <>
            <style>{`
              [data-layer="new chat"] { background: transparent; }
              [data-layer="new chat"]:hover { background: var(--cs-hover-medium); }
            `}</style>
            <div
              data-svg-wrapper
              data-layer="new chat"
              aria-label="Start new chat"
              role="button"
              tabIndex={0}
              onMouseEnter={() => setIsNewChatTopRightHovered(true)}
              onMouseLeave={() => setIsNewChatTopRightHovered(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setIsNewChatTopRightHovered(false);
                  handleNewChat();
                }
              }}
              style={{
                right: 8,
                top: 8,
                position: "absolute",
                zIndex: 100,
                cursor: "pointer",
                borderRadius: "50%",
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onClick={(e) => {
                e.stopPropagation();
                setIsNewChatTopRightHovered(false);
                handleNewChat();
              }}
            >
              {isNewChatTopRightHovered && (
                <div
                  style={{
                    position: "absolute",
                    right: "100%",
                    top: "50%",
                    transform: "translate(-8px, -50%)",
                    whiteSpace: "nowrap",
                    background: "var(--cs-surface)",
                    color: "var(--cs-text-primary)",
                    padding: "6px 10px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontFamily: "Inter, system-ui, sans-serif",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                    pointerEvents: "none",
                  }}
                >
                  New chat
                </div>
              )}
              <svg
                width="36"
                height="36"
                viewBox="0 0 36 36"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ pointerEvents: "none" }}
                aria-hidden
              >
                <path
                  d="M24.9998 18.0001C24.9998 21.1823 24.9998 22.773 23.9747 23.7615C22.9496 24.75 21.2992 24.75 17.9999 24.75C14.6998 24.75 13.0502 24.75 12.0251 23.7615C11 22.773 11 21.1816 11 18.0001C11 14.8179 11 13.2272 12.0251 12.2387C13.0502 11.2502 14.7006 11.2502 17.9999 11.2502M16.0811 17.3626C15.8157 17.619 15.6666 17.9664 15.6666 18.3286V20.2501H17.6717C18.0473 20.2501 18.4082 20.1061 18.6742 19.8496L24.5852 14.1467C24.7168 14.0198 24.8213 13.8691 24.8925 13.7033C24.9637 13.5375 25.0004 13.3598 25.0004 13.1803C25.0004 13.0008 24.9637 12.8231 24.8925 12.6573C24.8213 12.4915 24.7168 12.3409 24.5852 12.214L24.0011 11.6507C23.8695 11.5237 23.7132 11.4229 23.5412 11.3541C23.3692 11.2854 23.1848 11.25 22.9986 11.25C22.8124 11.25 22.628 11.2854 22.4559 11.3541C22.2839 11.4229 22.1276 11.5237 21.996 11.6507L16.0811 17.3626Z"
                  stroke="var(--cs-text-primary)"
                  strokeOpacity={0.95}
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </>
        )}

        {/* Chat input area — web.tsx bottom stack: optional default suggestions, then input bar */}
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center",
            showDefaultSuggestions
              ? cn("px-4", selectedBlog ? "md:px-12" : "md:px-6")
              : cn(
                  "bg-gradient-to-t from-white via-white/80 to-transparent p-4 md:p-6 pt-16 md:pt-20",
                  selectedBlog && "md:px-12"
                )
          )}
          style={{
            width: "100%",
            justifyContent: "flex-end",
            pointerEvents: showDefaultSuggestions ? "none" : undefined,
            paddingTop: showDefaultSuggestions ? 36 : undefined,
            paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
          }}
        >
          <form
            onSubmit={handleSend}
            className="w-full max-w-[816px] mx-auto relative"
            aria-label="Chat form"
            data-label="chat-form"
            style={{ pointerEvents: "auto" }}
          >
            {showDefaultSuggestions && (
              <>
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background:
                      "linear-gradient(180deg, hsla(0, 0%, 98%, 0) 0%, hsl(0, 0%, 100%) 36px)",
                    pointerEvents: "none",
                    zIndex: -1,
                  }}
                />
                <div
                  data-layer="ai suggested replies"
                  className="AiSuggestedReplies ai-suggested-replies-scroll"
                  style={{
                    width: "100%",
                    maxWidth: 816,
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "flex-start",
                    alignItems: "center",
                    gap: 8,
                    paddingLeft: isMobileLayout ? 16 : 24,
                    paddingRight: isMobileLayout ? 16 : 24,
                    paddingBottom: 4,
                    paddingTop: 1,
                    overflowX: "auto",
                    pointerEvents: "auto",
                    whiteSpace: "nowrap",
                  }}
                  onPointerDownCapture={(e) => e.stopPropagation()}
                  onTouchStartCapture={(e) => e.stopPropagation()}
                  onTouchMoveCapture={(e) => e.stopPropagation()}
                  onTouchEndCapture={(e) => e.stopPropagation()}
                >
                  {DEFAULT_CHAT_SUGGESTIONS.map((suggestion, index) => (
                    <div
                      key={suggestion}
                      role="button"
                      tabIndex={0}
                      aria-label={suggestion}
                      data-label={`default-suggestion-${index + 1}`}
                      className={`Suggestion${index + 1}`}
                      onClick={() => {
                        if (!loading) void sendMessage(suggestion);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (!loading) void sendMessage(suggestion);
                        }
                      }}
                      style={{
                        maxWidth: 380,
                        paddingLeft: 12,
                        paddingRight: 12,
                        paddingTop: 8,
                        paddingBottom: 8,
                        overflow: "visible",
                        borderRadius: 24,
                        outline: "none",
                        justifyContent: "flex-start",
                        alignItems: "center",
                        gap: 6,
                        display: "inline-flex",
                        cursor: loading ? "default" : "pointer",
                        flexShrink: 0,
                        background: "hsl(0, 0%, 100%)",
                        border: "0.33px solid hsla(0, 0%, 0%, 0.2)",
                        color: "var(--cs-text-secondary)",
                        transition: "background-color 0.2s ease",
                        pointerEvents: "auto",
                        opacity: loading ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!loading) {
                          e.currentTarget.style.backgroundColor = "hsl(0, 0%, 96%)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "hsl(0, 0%, 100%)";
                      }}
                      onFocus={(e) => {
                        requestAnimationFrame(() => {
                          if (e.currentTarget.matches(":focus-visible")) {
                            e.currentTarget.style.outline = "1px solid hsl(204, 100%, 50%)";
                            e.currentTarget.style.outlineOffset = "2px";
                            e.currentTarget.style.boxShadow =
                              "0 0 0 1px hsla(0, 0%, 10%, 1)";
                          }
                        });
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.outline = "none";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <div
                        style={{
                          justifyContent: "center",
                          display: "flex",
                          flexDirection: "column",
                          color: "var(--cs-text-secondary)",
                          fontSize: 15,
                          fontFamily: "Inter, system-ui, sans-serif",
                          fontWeight: 400,
                          lineHeight: "22.5px",
                          wordWrap: "break-word",
                        }}
                      >
                        {suggestion}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {/* Chat input bar — exact Curastem design (web.tsx ChatInputBar) */}
            <div
              data-layer="chat-input-bar"
              className="flex flex-col overflow-visible"
              style={{
                flex: "1 1 0",
                minWidth: 0,
                width: "100%",
                maxWidth: "100%",
                minHeight: 56,
                maxHeight: 384,
                padding: 0,
                background: "var(--cs-bg)",
                border: "0.33px solid hsla(0, 0%, 0%, 0.2)",
                boxShadow: "0px 8px 24px hsla(0, 0%, 0%, 0.04)",
                borderRadius: 28,
                justifyContent: "flex-end",
                gap: 16,
              }}
            >
              {/* Pending image — inside the input bar for accessibility */}
              {pendingEditImage && (
                <div
                  className="flex items-center gap-3 flex-shrink-0"
                  style={{
                    padding: "10px 10px 0 10px",
                    borderBottom: "0.33px solid hsla(0, 0%, 0%, 0.12)",
                    paddingBottom: 10,
                  }}
                >
                  <div className="relative flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden" style={{ background: "var(--cs-surface)", border: "0.33px solid hsla(0,0%,0%,0.15)" }}>
                    <img src={pendingEditImage.url} alt={pendingEditImage.alt} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <Pencil className="h-3 w-3 flex-shrink-0" style={{ color: "var(--cs-text-secondary)" }} aria-hidden />
                      <span className="text-[13px] font-medium" style={{ color: "var(--cs-text-secondary)" }}>Editing image</span>
                    </div>
                    <p className="text-[13px] truncate" style={{ color: "var(--cs-text-secondary)" }}>{pendingEditImage.alt || "No description"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingEditImage(null)}
                    className="flex-shrink-0 rounded-full p-2 transition-colors touch-manipulation"
                    style={{ background: "transparent", color: "var(--cs-text-primary)" }}
                    aria-label="Remove image from chat"
                    data-label="remove-edit-image"
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cs-hover-subtle)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <XIcon className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 8,
                  width: "100%",
                  padding: "0 10px 10px 10px",
                }}
              >
                {/* Plus button — matches web.tsx upload trigger */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Add image to chat"
                  data-label="upload-trigger"
                  onClick={() => document.getElementById("chat-image-input")?.click()}
                  onKeyDown={(e) => e.key === "Enter" && document.getElementById("chat-image-input")?.click()}
                  className="flex items-center justify-center flex-shrink-0 cursor-pointer rounded-full transition-colors"
                  style={{
                    width: 36,
                    height: 36,
                    marginBottom: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cs-hover-subtle)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <input
                    id="chat-image-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file?.type.startsWith("image/")) return;
                      const url = URL.createObjectURL(file);
                      setPendingEditImage({ url, alt: file.name });
                      e.target.value = "";
                    }}
                  />
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.95 }}>
                    <path d="M12 5V19M5 12H19" stroke="var(--cs-text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                {/* Auto-growing textarea — matches web.tsx contenteditable height behaviour */}
                <textarea
                  ref={chatTextareaRef}
                  id="chat-input"
                  data-testid="chat-input"
                  data-label="chat-input"
                  aria-label="Chat input"
                  value={input}
                  rows={1}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "0px";
                    const next = Math.min(e.target.scrollHeight, 148);
                    e.target.style.height = next + "px";
                    e.target.style.overflowY = e.target.scrollHeight > 148 ? "auto" : "hidden";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (input.trim() && !loading) handleSend(e as unknown as React.FormEvent);
                    }
                  }}
                  placeholder={pendingEditImage ? "Describe what to change in this image..." : selectedBlog ? "Edit blog" : "Ask anything"}
                  style={{
                    flex: "1 1 0",
                    minWidth: 0,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    resize: "none",
                    overflowY: "hidden",
                    color: "var(--cs-text-primary)",
                    fontFamily: "Inter, system-ui, sans-serif",
                    fontSize: 16,
                    lineHeight: "24px",
                    padding: "6px 0",
                    minHeight: 36,
                    maxHeight: 148,
                  }}
                />
                {/* Send / Stop — matches web.tsx SendButton */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {loading ? (
                    <button
                      type="button"
                      aria-label="Stop generation"
                      data-label="stop-generation-button"
                      onClick={() => abortControllerRef.current?.abort()}
                      className="cursor-pointer touch-manipulation"
                      style={{ width: 36, height: 36 }}
                    >
                      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                        <rect width="36" height="36" rx="18" fill="var(--cs-text-primary)" fillOpacity="0.95" />
                        <rect x="12" y="12" width="12" height="12" rx="2" fill="var(--cs-bg)" fillOpacity="0.95" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      type="submit"
                      id="chat-submit"
                      data-testid="chat-submit"
                      data-label="send-message-button"
                      aria-label="Send message"
                      disabled={!input.trim()}
                      className="cursor-pointer touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        width: 36,
                        height: 36,
                        display: input.trim() ? "block" : "none",
                      }}
                    >
                      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                        <rect width="36" height="36" rx="18" fill="var(--cs-text-primary)" fillOpacity="0.95" />
                        <path
                          fillRule="evenodd"
                          clipRule="evenodd"
                          d="M14.5611 18.1299L16.8709 15.8202V23.3716C16.8709 23.9948 17.3762 24.5 17.9994 24.5C18.6226 24.5 19.1278 23.9948 19.1278 23.3716V15.8202L21.4375 18.1299C21.8782 18.5706 22.5927 18.5706 23.0334 18.1299C23.4741 17.6893 23.4741 16.9748 23.0334 16.5341L17.9994 11.5L12.9653 16.5341C12.5246 16.9748 12.5246 17.6893 12.9653 18.1299C13.406 18.5706 14.1204 18.5706 14.5611 18.1299Z"
                          fill="var(--cs-bg)"
                          fillOpacity="0.95"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
            </form>
        </div>
        </motion.div>

        {/* Resize Handle — between chat and blog (curastem style) */}
        {!isMobileLayout && selectedBlog && (
          <div
            role="separator"
            aria-label="Resize chat panel"
            onPointerDown={handleResizePointerDown}
            style={{
              width: 12,
              marginLeft: -6,
              marginRight: -6,
              cursor: "ew-resize",
              zIndex: 30,
              position: "relative",
              flexShrink: 0,
            }}
          />
        )}

        {/* Desktop: Blog Editor — slides in from right (curastem style: same bg + shadow) */}
        <AnimatePresence>
          {!isMobileLayout && selectedBlog && (
            <motion.div
              data-layer="desktop-blog-panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 700, damping: 50 }}
              style={{
                flex: 1,
                position: "relative",
                zIndex: 30,
                background: BLOG_EDITOR_BG,
                boxShadow: BLOG_EDITOR_SHADOW,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                borderRadius: "28px 0 0 28px",
                marginLeft: 2,
              }}
            >
              {loadingBlog ? (
                <div className="flex-1 flex items-center justify-center text-gray-300">
                  <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
                    <p className="text-sm">Loading blog content...</p>
                  </div>
                </div>
              ) : (
                <div ref={blogPreviewRef} className="flex-1 flex flex-col overflow-hidden text-black">
                  <BlogEditor
                    ref={blogEditorRef}
                    content={editableContent}
                    onChange={setEditableContent}
                    onSave={handleSaveBlog}
                    onClose={handleCloseBlog}
                    isSaving={savingBlog}
                    saveJustCompleted={saveJustCompleted}
                    saveFailed={saveFailed}
                    hasChanges={blogHasChanges}
                    isStreaming={isBlogStreaming}
                    blogSlug={selectedBlog?.slug}
                    coverImageUrl={selectedBlog?.coverImageUrl}
                    title={selectedBlog?.title}
                    date={selectedBlog?.date}
                    onTitleChange={(newTitle) => {
                      if (!selectedBlog) return;
                      setSelectedBlog({ ...selectedBlog, title: newTitle });
                    }}
                    onDateChange={(newDate) => {
                      if (!selectedBlog) return;
                      setSelectedBlog({ ...selectedBlog, date: newDate });
                    }}
                    onCoverImageReplace={async (newUrl) => {
                      if (!selectedBlog) return;
                      setSelectedBlog({ ...selectedBlog, coverImageUrl: newUrl });
                      try {
                        const res = await fetch("/api/images/zoom-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrl: newUrl }) });
                        if (res.ok) {
                          const { zoomOutUrl } = await res.json();
                          setSelectedBlog((prev) => prev ? { ...prev, blogListImageUrl: zoomOutUrl } : prev);
                        }
                      } catch (err) {
                        console.error("Zoom-out failed:", err);
                      }
                    }}
                    onCoverImageAltChange={(newAlt) => {
                      if (!selectedBlog) return;
                      setSelectedBlog((prev) => prev ? { ...prev, coverImageAlt: newAlt } : prev);
                    }}
                    onEditImage={(imageUrl, imageAlt) => {
                      setPendingEditImage({ url: imageUrl, alt: imageAlt });
                      setTimeout(() => document.getElementById("chat-input")?.focus(), 50);
                    }}
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Mobile: Blog editor overlay — slides up from bottom, X hides it but keeps blog selected */}
      <AnimatePresence>
        {isMobileLayout && selectedBlog && isMobileEditorOpen && (
          <motion.div
            data-layer="mobile-blog-overlay"
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: "0%", opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              // Use 100dvh so iOS Safari keyboard doesn't push content off screen
              height: "100dvh",
              zIndex: 2000,
              background: BLOG_EDITOR_BG,
              display: "flex",
              flexDirection: "column",
              // Pad bottom by safe area so content never hides behind home indicator
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {loadingBlog ? (
              <div className="flex-1 flex items-center justify-center text-gray-300">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
                  <p className="text-sm">Loading blog content...</p>
                </div>
              </div>
            ) : (
              <div ref={blogPreviewRef} className="flex-1 flex flex-col overflow-hidden text-black" style={{ minHeight: 0 }}>
                <BlogEditor
                  ref={blogEditorRef}
                  content={editableContent}
                  onChange={setEditableContent}
                  onSave={handleSaveBlog}
                  onClose={handleCloseBlog}
                  isSaving={savingBlog}
                  saveJustCompleted={saveJustCompleted}
                  saveFailed={saveFailed}
                  hasChanges={blogHasChanges}
                  isStreaming={isBlogStreaming}
                  blogSlug={selectedBlog?.slug}
                  coverImageUrl={selectedBlog?.coverImageUrl}
                  title={selectedBlog?.title}
                  date={selectedBlog?.date}
                  onTitleChange={(newTitle) => {
                    if (!selectedBlog) return;
                    setSelectedBlog({ ...selectedBlog, title: newTitle });
                  }}
                  onDateChange={(newDate) => {
                    if (!selectedBlog) return;
                    setSelectedBlog({ ...selectedBlog, date: newDate });
                  }}
                  onCoverImageReplace={async (newUrl) => {
                    if (!selectedBlog) return;
                    setSelectedBlog({ ...selectedBlog, coverImageUrl: newUrl });
                    try {
                      const res = await fetch("/api/images/zoom-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrl: newUrl }) });
                      if (res.ok) {
                        const { zoomOutUrl } = await res.json();
                        setSelectedBlog((prev) => prev ? { ...prev, blogListImageUrl: zoomOutUrl } : prev);
                      }
                    } catch (err) {
                      console.error("Zoom-out failed:", err);
                    }
                  }}
                  onCoverImageAltChange={(newAlt) => {
                    if (!selectedBlog) return;
                    setSelectedBlog((prev) => prev ? { ...prev, coverImageAlt: newAlt } : prev);
                  }}
                  onEditImage={(imageUrl, imageAlt) => {
                    setPendingEditImage({ url: imageUrl, alt: imageAlt });
                    // Close overlay so user can type in the real chat input
                    setIsMobileEditorOpen(false);
                    setTimeout(() => document.getElementById("chat-input")?.focus(), 300);
                  }}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile: "Open editor" pill — shown when a blog is selected but editor overlay is closed */}
      <AnimatePresence>
        {isMobileLayout && selectedBlog && !isMobileEditorOpen && (
          <motion.button
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setIsMobileEditorOpen(true)}
            aria-label="Open blog editor"
            style={{
              position: "fixed",
              bottom: `calc(80px + env(safe-area-inset-bottom))`,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1500,
              background: "var(--cs-text-primary)",
              color: "var(--cs-bg)",
              border: "none",
              borderRadius: 28,
              height: 40,
              paddingLeft: 20,
              paddingRight: 20,
              fontSize: 14,
              fontWeight: 500,
              fontFamily: "Inter, system-ui, sans-serif",
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
              whiteSpace: "nowrap",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            View editor
          </motion.button>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />

      {/* Error Modal */}
      <ErrorModal
        isOpen={errorModal.isOpen}
        onClose={() => setErrorModal({ ...errorModal, isOpen: false })}
        title={errorModal.title}
        message={errorModal.message}
        error={errorModal.error}
        details={errorModal.details}
      />

      <style jsx global>{`
        /* iOS Safari: fill the actual visual viewport, not the layout viewport (100vh).
           This prevents layout jumping when the address bar hides/shows. */
        @supports (height: 100dvh) {
          html, body { height: 100dvh; }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.1);
        }
        @keyframes pulseStar {
          0%   { opacity: 0.5; transform: scale(0.85); }
          50%  { opacity: 1;   transform: scale(1.0);  }
          100% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}
