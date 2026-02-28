"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Square, Loader2, Plus, Settings, Search, Menu, X as XIcon, Pencil } from "lucide-react";
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
    // Restore any unsaved draft from a previous session
    const draft = loadDraft();
    if (draft) {
      setUnsavedBlog(draft.blog);
    }
    // Set sidebar open on desktop, closed on mobile
    const checkScreenSize = () => {
      setIsSidebarOpen(window.innerWidth >= 768);
    };
    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

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
    setSaveFailed(false); // Reset any previous failure indicator
    try {
      // New blogs (not yet in Framer) use POST; existing blogs use PUT
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
              blogListImageUrl: selectedBlog.coverImageUrl,
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
        // Replace old URL with new URL in editor content
        setEditableContent(prev => prev.replace(new RegExp(imageUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), data.url));
        setMessages(prev => {
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

  const filteredBlogs = blogs.filter(blog => 
    blog.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-white overflow-hidden text-black font-sans">
      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <div className={cn(
        "bg-gray-50 flex flex-col transition-all duration-300 ease-in-out border-r border-gray-200",
        "fixed md:relative z-50 md:z-auto h-full",
        isSidebarOpen ? "w-full md:w-[260px]" : "w-0 -translate-x-full md:translate-x-0 md:overflow-hidden",
        !isSidebarOpen && "md:border-r-0"
      )}>
        {/* Sidebar Top Nav */}
        <div className="p-2 flex flex-col gap-3">
          <div className="flex items-center justify-between px-2 pt-2">
            {isSidebarOpen && (
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="p-2 hover:bg-gray-200 active:bg-gray-300 rounded-[28px] transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <Menu className="h-5 w-5 text-gray-600" />
              </button>
            )}
            {!isSidebarOpen && <div />}
            {isSidebarOpen && (
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => setIsSettingsOpen(true)}
                  className="p-2 hover:bg-gray-200 active:bg-gray-300 rounded-[28px] transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <Settings className="h-5 w-5 text-gray-600" />
                </button>
              </div>
            )}
          </div>

          {/* Search Bar - Only show when sidebar is open */}
          {isSidebarOpen && (
            <div className="px-2">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-gray-600 transition-colors" />
                <input 
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search blogs..."
                  className="w-full bg-white border border-gray-200 rounded-[28px] py-3 md:py-2 pl-10 pr-4 text-base md:text-sm text-black placeholder:text-gray-400 focus:ring-1 focus:ring-gray-300 focus:bg-white transition-all outline-none"
                />
              </div>
            </div>
          )}

          {/* Actions - Only show when sidebar is open */}
          {isSidebarOpen && (
            <div className="flex flex-col gap-0.5 px-2">
              <button 
                id="new-blog-button"
                data-testid="new-blog-button"
                aria-label="Create new blog"
                onClick={() => {
                  // Close current editor (equivalent to Close Editor)
                  setSelectedBlog(null);
                  setIsCreating(false);
                  setStreamingBlogContent("");
                  setOriginalBlogState(null);
                  // Send message to AI to create a blog - AI will decide the title
                  sendMessage("Create a new blog");
                }}
                className="w-full flex items-center gap-3 px-3 py-3 md:py-2.5 rounded-[28px] hover:bg-gray-200 active:bg-gray-300 transition-colors text-base md:text-sm text-gray-700 touch-manipulation min-h-[44px]"
              >
                <Plus className="h-4 w-4" />
                <span>New blog</span>
              </button>
            </div>
          )}
        </div>

        {/* Blog List - Only show when sidebar is open */}
        {isSidebarOpen && (
          <div className="flex-1 overflow-y-auto px-2 py-4 custom-scrollbar">
            <div className="px-3 mb-2">
              <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Your blogs</h2>
            </div>
          
          <div className="flex flex-col gap-0.5">
            {/* Unsaved new blog — shown at top with red dot */}
            {unsavedBlog && (
              <div
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
                className={cn(
                  "group px-3 py-3 md:py-2.5 rounded-[28px] transition-all cursor-pointer text-base md:text-sm relative flex items-center justify-between touch-manipulation min-h-[44px]",
                  selectedBlog?.id === unsavedBlog.id
                    ? "bg-gray-200 text-black font-medium"
                    : "text-gray-600 hover:bg-gray-100 active:bg-gray-200 hover:text-black"
                )}
              >
                <span className="truncate flex-1">{unsavedBlog.title}</span>
                <div className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" title="Unsaved" />
              </div>
            )}

            {fetchingBlogs ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
              </div>
            ) : filteredBlogs.length === 0 && !unsavedBlog ? (
              <div className="px-3 py-2 text-xs text-gray-400 italic">
                {searchQuery ? "No matching blogs" : "No blogs yet"}
              </div>
            ) : (
              filteredBlogs.map(blog => (
                <div 
                  key={blog.id} 
                  onClick={() => handleBlogClick(blog)}
                  className={cn(
                    "group px-3 py-3 md:py-2.5 rounded-[28px] transition-all cursor-pointer text-base md:text-sm relative flex items-center justify-between touch-manipulation min-h-[44px]",
                    selectedBlog?.id === blog.id
                      ? "bg-gray-200 text-black font-medium"
                      : "text-gray-600 hover:bg-gray-100 active:bg-gray-200 hover:text-black"
                  )}
                >
                  <span className="truncate flex-1">{blog.title}</span>
                  {selectedBlog?.id === blog.id && !loadingBlog && (
                    <div className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                  )}
                  {loadingBlog && selectedBlog?.id === blog.id && (
                    <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                  )}
                </div>
              ))
            )}
          </div>
          </div>
        )}
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col relative bg-white">
        {/* Floating sidebar toggle — only shown on the chat/creating screen, not when editor is open
            (when a blog is open, the toggle lives inside the editor toolbar to avoid overlap) */}
        {!isSidebarOpen && !selectedBlog && !isCreating && (
          <div className="absolute top-2 md:top-4 left-2 md:left-4 right-2 md:right-4 z-30 flex items-center justify-between pointer-events-none">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 rounded-[28px] transition-colors border border-gray-200 pointer-events-auto touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <Menu className="h-5 w-5 text-gray-600" />
            </button>
            <div />
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
              <div className="flex-1 flex flex-col overflow-hidden bg-white text-black md:rounded-tl-[28px] md:mt-2 md:ml-2 md:border-l md:border-t md:border-gray-100 shadow-sm">
                {(() => {
                  // Check if there are actual changes
                  const hasChanges = originalBlogState && selectedBlog ? (
                    editableContent !== originalBlogState.content ||
                    selectedBlog.title !== originalBlogState.title ||
                    (selectedBlog.date || '') !== originalBlogState.date ||
                    (selectedBlog.coverImageUrl || '') !== (originalBlogState.coverImageUrl || '')
                  ) : false;

                  return (
                    <BlogEditor 
                      ref={blogEditorRef}
                      content={editableContent} 
                      onChange={setEditableContent}
                      onSave={handleSaveBlog}
                      isSaving={savingBlog}
                      saveJustCompleted={saveJustCompleted}
                      saveFailed={saveFailed}
                      hasChanges={hasChanges}
                      isStreaming={isBlogStreaming}
                      onShowSidebar={!isSidebarOpen ? () => setIsSidebarOpen(true) : undefined}
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
                      }}
                      onEditImage={(imageUrl, imageAlt) => {
                        setPendingEditImage({ url: imageUrl, alt: imageAlt });
                        // Focus the chat input
                        setTimeout(() => document.getElementById("chat-input")?.focus(), 50);
                      }}
                    />
                  );
                })()}
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
                onClick={() => setStreamingBlogContent("")}
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
          /* Chat Messages */
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6 pb-32 md:pb-40 custom-scrollbar">
            <div className="w-full mx-auto pt-8 md:pt-20 px-4">
              {messages.map((msg, i) => (
                <div key={i} className={cn(
                  "flex flex-col mb-8 animate-fade-in",
                  msg.role === "user" ? "items-end" : "items-start"
                )}>
                  <div className={cn(
                    "p-3 md:p-4 rounded-[28px] text-sm md:text-base leading-relaxed shadow-sm border",
                    msg.role === "user"
                      ? "bg-gray-900 text-white border-gray-800 rounded-tr-none max-w-[85%] md:max-w-[75%]"
                      : "bg-white text-gray-800 border-gray-100 rounded-tl-none w-full max-w-full md:max-w-[85%]"
                  )}>
                    {msg.content || (loading && i === messages.length - 1 ? <Loader2 className="h-4 w-4 animate-spin opacity-20" /> : null)}
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
          {selectedBlog && (
            <div className="w-full max-w-[768px] mx-auto mb-4 px-3 md:px-4 py-2 bg-gray-50 border border-gray-200 rounded-[28px] flex items-center justify-between animate-slide-up">
              <div className="flex items-center space-x-2 min-w-0 flex-1">
                <div className="h-2 w-2 bg-gray-400 rounded-full animate-pulse flex-shrink-0"></div>
                <span className="text-gray-500 truncate font-normal" style={{ fontSize: '14px', fontFamily: 'inherit' }}>
                  Editing: <span className="text-black font-normal">{selectedBlog.title}</span>
                </span>
              </div>
              <button 
                onClick={handleCloseBlog}
                className="text-black hover:opacity-80 transition-opacity flex-shrink-0 font-normal"
                style={{ fontSize: '14px', fontFamily: 'inherit', letterSpacing: '0.05em' }}
              >
                Close Editor
              </button>
            </div>
          )}
          <form onSubmit={handleSend} className="w-full max-w-[768px] mx-auto relative group">
            {/* Pending image thumbnail attached to chat input */}
            {pendingEditImage && (
              <div className="mb-2 flex items-center gap-2 px-2">
                <div className="relative flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-gray-200 shadow-sm bg-gray-50">
                  <img src={pendingEditImage.url} alt={pendingEditImage.alt} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPendingEditImage(null)}
                    className="absolute top-0.5 right-0.5 bg-black/70 hover:bg-black rounded-full p-0.5 transition-colors"
                    aria-label="Remove image"
                  >
                    <XIcon className="h-3 w-3 text-white" />
                  </button>
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <Pencil className="h-3 w-3 text-gray-400 flex-shrink-0" />
                    <span className="text-xs text-gray-500 font-medium">Editing image</span>
                  </div>
                  <p className="text-xs text-gray-400 truncate max-w-[200px]">{pendingEditImage.alt || "No description"}</p>
                </div>
              </div>
            )}
            <input
              type="text"
              id="chat-input"
              data-testid="chat-input"
              aria-label="Chat input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={pendingEditImage ? "Describe what to change in this image..." : selectedBlog ? "Tell AI how to improve this blog..." : "What should we write about today?"}
              className="w-full bg-gray-50 border border-gray-200 rounded-[28px] py-3 md:py-4 pl-4 md:pl-6 pr-12 md:pr-14 text-sm md:text-base text-black placeholder:text-gray-400 focus:outline-none focus:border-gray-300 focus:bg-white transition-all shadow-sm"
            />
            {loading ? (
              <button
                type="button"
                aria-label="Stop generation"
                onClick={() => abortControllerRef.current?.abort()}
                className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 p-2 bg-black text-white rounded-[28px] hover:bg-gray-800 active:bg-gray-700 transition-colors touch-manipulation"
              >
                <Square className="h-4 w-4 md:h-5 md:w-5" fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                id="chat-submit"
                data-testid="chat-submit"
                aria-label="Send message"
                disabled={!input.trim()}
                className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 p-2 bg-black text-white rounded-[28px] hover:bg-gray-800 active:bg-gray-700 transition-colors disabled:opacity-10 touch-manipulation"
              >
                <Send className="h-4 w-4 md:h-5 md:w-5" />
              </button>
            )}
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

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />
    </div>
  );
}
