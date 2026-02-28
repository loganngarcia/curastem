"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Loader2, Plus, Settings, X as XIcon, Pencil, Save, AlertCircle } from "lucide-react";
import { slugify } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { cn, formatDate } from "@/lib/utils";
import BlogEditor, { type BlogEditorRef } from "@/components/BlogEditor";
import SettingsModal from "@/components/SettingsModal";
import ErrorModal from "@/components/ErrorModal";

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
  /** Zoom-out version for blog list (25% larger, dominant color fill). Generated when cover changes. */
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

function chatTitleFromMessages(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser?.content) {
    const t = firstUser.content.trim().slice(0, 40);
    return t + (firstUser.content.length > 40 ? "…" : "");
  }
  return "New chat";
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

export default function ChatPage() {
  const router = useRouter();
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
  const [searchQuery, setSearchQuery] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Start collapsed on mobile
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
  // When true, streaming text chunks are piped into the editor instead of the chat bubble
  const isBuildingBlogRef = useRef(false);
  const buildingContentRef = useRef("");
  // When true, the blog hasn't been saved to Framer yet — Save button will POST instead of PUT
  const isNewBlogRef = useRef(false);
  // Signals the SSE reader loop to stop after a "done" event is received
  const readerDoneRef = useRef(false);
  // AbortController for the current streaming fetch — used by the Stop button
  const abortControllerRef = useRef<AbortController | null>(null);

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
      if (
        selectedBlog.coverImageUrl &&
        (!blogListImageUrl || blogListImageUrl === selectedBlog.coverImageUrl)
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
    abortControllerRef.current?.abort();
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
    // If the blog is still unsaved, persist current content to localStorage before closing
    if (isNewBlogRef.current && selectedBlog) {
      saveDraft(selectedBlog, editableContent);
      // Keep unsavedBlog in the sidebar so the user can reopen it
    }
    setSelectedBlog(null);
    setIsCreating(false);
    setIsBlogStreaming(false);
    setStreamingBlogContent("");
    isBuildingBlogRef.current = false;
    buildingContentRef.current = "";
    // Don't reset isNewBlogRef or unsavedBlog — keep draft alive in sidebar
  };

  // Computed for sidebar indicator: red dot when unsaved changes, none when saved
  const blogHasChanges = useMemo(() => {
    if (!originalBlogState || !selectedBlog) return false;
    return (
      editableContent !== originalBlogState.content ||
      selectedBlog.title !== originalBlogState.title ||
      (selectedBlog.date || "") !== originalBlogState.date ||
      (selectedBlog.coverImageUrl || "") !== (originalBlogState.coverImageUrl || "")
    );
  }, [originalBlogState, selectedBlog, editableContent]);

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
              }
            }

          } else if (event.t === "tool_start") {
            const toolName = event.n ?? "";
            const statusMap: Record<string, string> = {
              list_blogs: "Fetching blog list...",
              add_image: "Generating and uploading image...",
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
            } else if (toolName === "edit_blog" && result?.operations) {
              // Apply find/replace operations to the editor as undoable ProseMirror transactions
              const ops = result.operations as Array<{ find: string; replace: string }>;
              if (blogEditorRef.current && ops.length > 0) {
                blogEditorRef.current.applyAIEdits(ops);
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
    await sendMessage(messageText);
  };

  const filteredBlogs = blogs
    .filter((blog) => blog.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  return (
    <div className="flex h-screen bg-white overflow-hidden text-black font-sans" role="main" aria-label="Curastem Blog Tool">
      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close sidebar"
          data-label="sidebar-overlay"
          className="fixed inset-0 z-40 md:hidden"
          style={{ background: "var(--cs-overlay)" }}
          onClick={() => setIsSidebarOpen(false)}
          onKeyDown={(e) => e.key === "Enter" && setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar — Curastem design: 260px on mobile (slides in, pushes content like web.tsx) */}
      <aside
        className={cn(
        "curastem-sidebar flex flex-col transition-transform duration-300 ease-out md:transition-none",
        "fixed md:relative left-0 top-0 bottom-0 z-50 md:z-auto h-full",
        "w-[260px] flex-shrink-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        !isSidebarOpen && "md:w-0 md:min-w-0 md:overflow-hidden md:border-r-0"
      )}
      style={{ background: "var(--cs-bg)" }}
      aria-label="Navigation sidebar"
      data-label="sidebar"
    >
        {/* Sidebar Top Nav — padding 8, gap 12, buttons 36×36, borderRadius 28 */}
        <div className="flex flex-col gap-3" style={{ padding: 8 }}>
          <div className="flex items-center justify-between" data-label="sidebar-top-actions-row">
            {isSidebarOpen && (
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                aria-label="Close sidebar"
                data-label="sidebar-close"
                className="flex items-center justify-center rounded-[28px] transition-colors touch-manipulation hover:opacity-90"
                style={{ width: 36, height: 36 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cs-hover-medium)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <path d="M10 14H26M10 22H20" stroke="var(--cs-text-primary)" strokeOpacity="0.95" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {!isSidebarOpen && <div aria-hidden />}
            {isSidebarOpen && (
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                aria-label="Open settings"
                data-label="settings-button"
                className="flex items-center justify-center rounded-[28px] transition-colors touch-manipulation"
                style={{ width: 36, height: 36 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cs-hover-medium)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <Settings className="h-5 w-5" style={{ color: "var(--cs-text-primary)" }} aria-hidden />
              </button>
            )}
          </div>

          {/* Search Bar — height 36, paddingLeft 12, borderRadius 50, background surface */}
          {isSidebarOpen && (
            <div data-label="search-container" style={{ height: 36, paddingLeft: 12, background: "var(--cs-surface)", borderRadius: 50 }} className="flex items-center overflow-hidden">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0 mr-2" aria-hidden>
                <path d="M10.9289 10.8023L14.7616 14.6M12.6167 6.5224C12.6167 8.09311 11.9837 9.5995 10.8571 10.7102C9.73045 11.8208 8.20241 12.4448 6.60911 12.4448C5.01581 12.4448 3.48777 11.8208 2.36113 10.7102C1.2345 9.5995 0.601563 8.09311 0.601562 6.5224C0.601563 4.95168 1.2345 3.44529 2.36113 2.33463C3.48777 1.22396 5.01581 0.599998 6.60911 0.599998C8.20241 0.599998 9.73045 1.22396 10.8571 2.33463C11.9837 3.44529 12.6167 4.95168 12.6167 6.5224Z" stroke="var(--cs-text-primary)" strokeOpacity="0.65" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search blogs..."
                aria-label="Search blogs"
                data-label="search-blogs-input"
                className="flex-1 min-w-0 bg-transparent text-[14px] font-normal outline-none placeholder:opacity-65"
                style={{ color: "var(--cs-text-primary)", fontFamily: "Inter, system-ui, sans-serif" }}
              />
            </div>
          )}

          {/* New chat — same item style as web.tsx (minHeight 36, padding 10, borderRadius 28) */}
          {isSidebarOpen && (
            <div className="flex flex-col" data-label="sidebar-actions">
              <button
                id="new-chat-button"
                data-testid="new-chat-button"
                data-label="new-chat-button"
                aria-label="Start new chat"
                onClick={handleNewChat}
                className="w-full flex items-center gap-3 rounded-[28px] transition-colors touch-manipulation text-[14px] font-normal"
                style={{ minHeight: 36, paddingLeft: 10, paddingRight: 10, color: "var(--cs-text-primary)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cs-hover-strong)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0" aria-hidden>
                  <path
                    d="M14.9998 8.00011C14.9998 11.1823 14.9998 12.773 13.9747 13.7615C12.9496 14.75 11.2992 14.75 7.99988 14.75C4.69983 14.75 3.05019 14.75 2.02509 13.7615C1 12.773 1 11.1816 1 8.00011C1 4.81792 1 3.22719 2.02509 2.23871C3.05019 1.25023 4.7006 1.25023 7.99988 1.25023M6.08114 7.36262C5.81571 7.61895 5.66661 7.96637 5.66659 8.32861V10.2501H7.67167C8.04733 10.2501 8.40821 10.1061 8.6742 9.84958L14.5852 4.14668C14.7168 4.01979 14.8213 3.86913 14.8925 3.70332C14.9637 3.53751 15.0004 3.3598 15.0004 3.18032C15.0004 3.00084 14.9637 2.82313 14.8925 2.65732C14.8213 2.49151 14.7168 2.34085 14.5852 2.21396L14.0011 1.65072C13.8695 1.52369 13.7132 1.42291 13.5412 1.35415C13.3692 1.28539 13.1848 1.25 12.9986 1.25C12.8124 1.25 12.628 1.28539 12.4559 1.35415C12.2839 1.42291 12.1276 1.52369 11.996 1.65072L6.08114 7.36262Z"
                    stroke="var(--cs-text-primary)"
                    strokeOpacity="0.95"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>New chat</span>
              </button>
            </div>
          )}
        </div>

        {/* Sidebar Lists — section padding 8, title 14px secondary, items minHeight 36 padding 10 borderRadius 28 */}
        {isSidebarOpen && (
          <div className="flex-1 overflow-y-auto custom-scrollbar" data-label="sidebar-lists" style={{ padding: 8, paddingTop: 0 }}>
            {/* Your chats — collapsible, default 3 visible; hidden when empty */}
            {chats.length > 0 && (
            <div className="flex flex-col" style={{ marginBottom: 12 }} data-label="your-chats-section">
              <button
                type="button"
                onClick={() => setChatsExpanded((e) => !e)}
                data-label="your-chats-toggle"
                aria-label={chatsExpanded ? "Collapse your chats" : "Expand your chats"}
                aria-expanded={chatsExpanded}
                className="w-full flex items-center justify-between cursor-pointer touch-manipulation rounded-[12px]"
                style={{ padding: "8px 10px" }}
              >
                <span className="text-[14px] font-normal" style={{ color: "var(--cs-text-secondary)", fontFamily: "Inter" }}>Your Chats</span>
                {chats.length >= 4 && (
                  <span className={cn("flex-shrink-0 inline-flex items-center justify-center transition-transform", chatsExpanded && "rotate-90")} style={{ width: 16, height: 24, color: "var(--cs-text-secondary)" }} aria-hidden>
                    <svg width="6" height="10" viewBox="0 0 6 10" fill="none"><path d="M0.601562 8.60001L4.60156 4.60001L0.601562 0.600006" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                )}
              </button>
              <div className="flex flex-col gap-0.5" data-label="chat-list">
                {(chatsExpanded ? chats : chats.slice(0, 3)).map((chat) => (
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
                <h2 className="text-[14px] font-normal" style={{ color: "var(--cs-text-secondary)", fontFamily: "Inter" }} data-label="your-blogs-heading">Your Blogs</h2>
              </div>
          
          <div className="flex flex-col gap-0.5">
            {/* Unsaved new blog — shown at top with red dot */}
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
                {(selectedBlog?.id === unsavedBlog.id ? blogHasChanges : true) && (
                  <div className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" title="Unsaved" aria-hidden />
                )}
              </div>
            )}

            {fetchingBlogs ? (
              <div className="flex justify-center py-4" data-label="blogs-loading">
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--cs-text-secondary)" }} aria-hidden />
              </div>
            ) : filteredBlogs.length === 0 && !unsavedBlog ? (
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
                    <div className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" title="Unsaved changes" aria-hidden />
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
        )}
      </aside>

      {/* Main Area — shifts right on mobile when sidebar opens (web.tsx behavior) */}
      <div
        className={cn(
          "flex-1 flex flex-col relative bg-white min-w-0 min-h-0",
          "transition-transform duration-300 ease-out md:transition-none",
          isSidebarOpen && "translate-x-[260px] md:translate-x-0"
        )}
        data-label="main-content"
      >
        {/* Floating sidebar toggle — always outside toolbar, shown when sidebar is closed */}
        {!isSidebarOpen && !isCreating && (
          <div className="absolute top-2 md:top-4 left-2 md:left-4 right-2 md:right-4 z-30 flex items-center justify-between pointer-events-none" data-label="floating-nav">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open sidebar"
              data-label="open-sidebar-button"
              className="flex items-center justify-center rounded-[28px] transition-colors pointer-events-auto touch-manipulation"
              style={{ width: 36, height: 36 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cs-hover-medium)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path d="M10 14H26M10 22H20" stroke="var(--cs-text-primary)" strokeOpacity="0.95" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div aria-hidden />
          </div>
        )}

        {isCreating ? (
          <div className="flex-1 flex items-center justify-center bg-white">
            <div className="max-w-xs w-full mx-6 p-10 bg-white rounded-[32px] border border-gray-100 shadow-[0_8px_48px_rgba(0,0,0,0.08)] text-center animate-fade-in">
              {/* SVG ring progress */}
              <div className="mb-8 relative h-20 w-20 mx-auto">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80" fill="none">
                  <circle cx="40" cy="40" r="33" stroke="#f3f4f6" strokeWidth="5.5" />
                  <circle
                    cx="40" cy="40" r="33"
                    stroke="black" strokeWidth="5.5"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 33}`}
                    strokeDashoffset={`${2 * Math.PI * 33 * (1 - creationProgress / 100)}`}
                    className="transition-all duration-700 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-semibold tabular-nums">{creationProgress}%</span>
                </div>
              </div>
              <h2 className="text-[17px] font-semibold tracking-tight mb-1.5">Building your blog...</h2>
              <p className="text-gray-400 text-[13px] mb-8 leading-relaxed">{creationStatus || "Preparing…"}</p>
              {/* Progress bar with shimmer */}
              <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-black h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${creationProgress}%` }}
                />
              </div>
            </div>
          </div>
        ) : selectedBlog ? (
          /* Blog Editor */
          <div ref={blogPreviewRef} className="flex-1 overflow-hidden flex flex-col animate-fade-in">
            {loadingBlog ? (
              <div className="flex-1 flex items-center justify-center text-gray-300">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
                  <p className="text-sm">Loading blog content...</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden text-black md:rounded-tl-[28px] md:mt-2 md:ml-2">
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
                          const res = await fetch("/api/images/zoom-out", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ imageUrl: newUrl }),
                          });
                          if (res.ok) {
                            const { zoomOutUrl } = await res.json();
                            setSelectedBlog((prev) =>
                              prev ? { ...prev, blogListImageUrl: zoomOutUrl } : prev
                            );
                          }
                        } catch (err) {
                          console.error("Zoom-out failed:", err);
                        }
                      }}
                      onEditImage={(imageUrl, imageAlt) => {
                        setPendingEditImage({ url: imageUrl, alt: imageAlt });
                        // Focus the chat input
                        setTimeout(() => document.getElementById("chat-input")?.focus(), 50);
                      }}
                    />
              </div>
            )}
          </div>
        ) : streamingBlogContent ? (
          /* Live Streaming Preview */
          <div className="flex-1 flex flex-col overflow-hidden animate-fade-in">
            <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs font-medium text-gray-600 uppercase tracking-wider">Live Preview</span>
              </div>
              <button
                type="button"
                onClick={() => setStreamingBlogContent("")}
                aria-label="Hide live preview"
                data-label="hide-preview-button"
                className="text-[10px] uppercase tracking-widest text-gray-400 hover:text-black transition-colors"
              >
                Hide Preview
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 md:p-12 bg-white">
              <div className="w-full mx-auto prose prose-sm max-w-2xl">
                <div dangerouslySetInnerHTML={{ 
                  __html: streamingBlogContent
                    .replace(/### (.*)/g, '<h3>$1</h3>')
                    .replace(/## (.*)/g, '<h2>$1</h2>')
                    .replace(/\n\n/g, '</p><p>')
                    .replace(/\n/g, '<br>')
                }} />
              </div>
            </div>
          </div>
        ) : (
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 pb-32 md:pb-40 custom-scrollbar" role="log" aria-live="polite" data-label="chat-messages">
            <div className="w-full mx-auto pt-8 md:pt-20 px-4" style={{ maxWidth: 816 }}>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className="animate-fade-in"
                  data-label={`message-${msg.role}-${i}`}
                  role="article"
                  style={{
                    display: "flex",
                    justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                    width: "100%",
                    scrollMarginTop: 24,
                    marginTop: msg.role === "user" ? 24 : 0,
                    marginBottom: msg.role === "user" ? 8 : 0,
                  }}
                >
                  <div
                    style={{
                      maxWidth: msg.role === "user" ? "80%" : "100%",
                      width: msg.role === "user" ? "auto" : "100%",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      style={{
                        padding: msg.role === "user" ? "6px 16px" : 0,
                        borderRadius: msg.role === "user" ? 20 : 0,
                        background: msg.role === "user" ? "var(--cs-hover-message)" : "transparent",
                        color: "var(--cs-text-primary)",
                        fontSize: 16,
                        lineHeight: 1.6,
                        maxWidth: "100%",
                        minWidth: 0,
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        whiteSpace: "pre-wrap",
                        fontFamily: "Inter, system-ui, sans-serif",
                      }}
                    >
                      {msg.content || (loading && i === messages.length - 1 ? <Loader2 className="h-4 w-4 animate-spin opacity-40" style={{ color: "var(--cs-text-secondary)" }} /> : null)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Floating Chat Bar */}
        <div className={cn(
          "absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-white via-white/80 to-transparent pt-16 md:pt-20 z-20",
          selectedBlog && "px-4 md:px-12"
        )}>
          {/* Publish button — centered above chat bar, only when edit ready */}
          {selectedBlog && (blogHasChanges || saveFailed || saveJustCompleted) && (
            <div className="flex justify-center mb-3">
              <button
                type="button"
                onClick={handleSaveBlog}
                disabled={savingBlog || (!blogHasChanges && !saveFailed)}
                data-testid="save-button"
                className="flex items-center gap-2 transition-colors touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  height: 40,
                  paddingLeft: 16,
                  paddingRight: 16,
                  borderRadius: 28,
                  background: saveFailed
                    ? "hsl(0, 84%, 50%)"
                    : saveJustCompleted
                      ? "hsl(142, 71%, 45%)"
                      : "var(--cs-accent)",
                  color: "var(--cs-bg)",
                  fontSize: 14,
                  fontFamily: "Inter",
                  fontWeight: 500,
                }}
              >
                {saveJustCompleted ? (
                  <span className="text-sm leading-none">✓</span>
                ) : saveFailed ? (
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                ) : savingBlog ? (
                  <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 flex-shrink-0" />
                )}
                <span data-testid="save-button-text" className="whitespace-nowrap">
                  {saveJustCompleted ? "Published!" : saveFailed ? "Retry" : savingBlog ? "Publishing…" : "Publish"}
                </span>
              </button>
            </div>
          )}
          <form onSubmit={handleSend} className="w-full max-w-[816px] mx-auto" aria-label="Chat form" data-label="chat-form">
            {/* Pending image thumbnail — Curastem attachment style */}
            {pendingEditImage && (
              <div className="mb-3 flex items-center gap-2">
                <div className="relative flex-shrink-0 w-[86px] h-[86px] rounded-2xl overflow-hidden" style={{ background: "var(--cs-surface)", border: "0.33px solid hsla(0,0%,0%,0.2)" }}>
                  <img src={pendingEditImage.url} alt={pendingEditImage.alt} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPendingEditImage(null)}
                    className="absolute top-1.5 right-1.5 rounded-full p-0.5 transition-colors"
                    style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)" }}
                    aria-label="Remove image from chat"
                    data-label="remove-edit-image"
                  >
                    <XIcon className="h-3 w-3" aria-hidden />
                  </button>
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <Pencil className="h-3 w-3 flex-shrink-0" style={{ color: "var(--cs-text-secondary)" }} aria-hidden />
                    <span className="text-[13px] font-medium" style={{ color: "var(--cs-text-secondary)" }}>Editing image</span>
                  </div>
                  <p className="text-[13px] truncate max-w-[200px]" style={{ color: "var(--cs-text-secondary)" }}>{pendingEditImage.alt || "No description"}</p>
                </div>
              </div>
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
                {/* Text input wrapper — matches TextAreaWrapper */}
                <div
                  className="flex-1 min-w-0 flex items-center"
                  style={{
                    alignSelf: "stretch",
                    paddingTop: 6,
                    paddingBottom: 6,
                  }}
                >
                  <input
                    type="text"
                    id="chat-input"
                    data-testid="chat-input"
                    data-label="chat-input"
                    aria-label="Chat input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={pendingEditImage ? "Describe what to change in this image..." : selectedBlog ? "Edit blog" : "Ask anything"}
                    className="w-full min-w-0 bg-transparent text-[14px] font-normal outline-none placeholder:opacity-65"
                    style={{ color: "var(--cs-text-primary)", fontFamily: "Inter, system-ui, sans-serif", fontSize: 16 }}
                  />
                </div>
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
      </div>

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
      `}</style>
    </div>
  );
}
