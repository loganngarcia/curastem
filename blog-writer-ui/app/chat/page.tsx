"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Plus, Settings, Search, Menu } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn, formatDate } from "@/lib/utils";
import BlogEditor from "@/components/BlogEditor";
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
  const [editableContent, setEditableContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Start collapsed on mobile
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

  useEffect(() => {
    fetchBlogs();
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
    try {
      const res = await fetch(`/api/blogs/${selectedBlog.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          content: editableContent,
          title: selectedBlog.title,
          date: selectedBlog.date,
          coverImageUrl: selectedBlog.coverImageUrl,
          blogListImageUrl: selectedBlog.coverImageUrl, // Use same image for both cover and list
        }),
      });

      if (res.ok) {
        const updatedBlog = await res.json();
        setSelectedBlog(updatedBlog);
        // Update original state after successful save
        setOriginalBlogState({
          content: editableContent,
          title: selectedBlog.title,
          date: selectedBlog.date || "",
          coverImageUrl: selectedBlog.coverImageUrl,
        });
        fetchBlogs();
        // Show success feedback
        const saveButtonText = document.querySelector('[data-testid="save-button-text"]');
        if (saveButtonText) {
          const originalText = saveButtonText.textContent;
          saveButtonText.textContent = "Saved!";
          setTimeout(() => {
            if (saveButtonText) saveButtonText.textContent = originalText;
          }, 2000);
        }
      } else {
        const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
        console.error("Save error response:", errorData);
        const errorMsg = errorData.error || errorData.message || "Failed to save blog";
        const errorDetails = errorData.details || errorData.message || errorMsg;
        throw new Error(`${errorMsg}\n\n${errorDetails}`);
      }
    } catch (err) {
      console.error("Save error:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to save changes. Please try again.";
      setErrorModal({
        isOpen: true,
        title: "Failed to save blog",
        message: errorMessage.split('\n\n')[0], // Show first line as main message
        error: err,
        details: `Failed to save blog "${selectedBlog?.title}" to Framer CMS.\n\n${errorMessage}`,
      });
    } finally {
      setSavingBlog(false);
    }
  };

  const handleCloseBlog = () => {
    setSelectedBlog(null);
    setIsCreating(false);
    setStreamingBlogContent("");
  };

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim() || loading) return;

    const userMessage = messageText.trim();
    setStreamingBlogContent("");
    setMessages(prev => [...prev, { role: "user" as const, content: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          messages: [...messages, { role: "user" as const, content: userMessage }] 
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let errorMsg = "Failed to get response";
        try {
          const data = JSON.parse(text);
          errorMsg = data.error || errorMsg;
        } catch (e) {
          errorMsg = text || errorMsg;
        }
        throw new Error(errorMsg);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      let assistantMessage = "";
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        
        // Check for stream-level errors
        if (chunk.includes("[ERROR:")) {
          const errorMatch = chunk.match(/\[ERROR: (.*?)\]/);
          throw new Error(errorMatch ? errorMatch[1] : "Stream error");
        }

        assistantMessage += chunk;
        
        // If the message contains blog-like content (H2, H3), show it in the streaming preview
        if (assistantMessage.includes("##") || assistantMessage.includes("###")) {
          setStreamingBlogContent(assistantMessage);
        }
        
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1].content = assistantMessage;
          return newMessages;
        });

        const toolMatch = assistantMessage.match(/\[TOOL:(\w+)(\{.*?\})\]/);
        if (toolMatch) {
          const toolName = toolMatch[1];
          const toolArgs = JSON.parse(toolMatch[2]);
          
          if (toolName === "create_blog") {
            handleCreateBlog(toolArgs.title);
            break;
          } else if (toolName === "list_blogs") {
            fetchBlogs();
            setMessages(prev => [...prev, { role: "assistant", content: "I've updated the blog list in the sidebar for you." }]);
            break;
          } else if (toolName === "add_image" && selectedBlog) {
            // AI wants to add an image at a specific location
            const { h2Text, subject } = toolArgs;
            if (h2Text && subject) {
              // Find the H2 and add image above it
              const currentContent = editableContent;
              const h2Pattern = new RegExp(`(<h2[^>]*>[^<]*${h2Text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*</h2>)`, 'i');
              const match = currentContent.match(h2Pattern);
              
              if (match) {
                // Generate image
                try {
                  const res = await fetch("/api/images/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ subject, aspect: "16:9" }),
                  });
                  
                  if (res.ok) {
                    const data = await res.json();
                    // Use the subject as alt text (it's the image prompt)
                    const imageHtml = `<p dir="auto" class="image-with-regenerate"><img src="${data.url}" alt="${subject}"></p>`;
                    const newContent = currentContent.replace(h2Pattern, imageHtml + match[0]);
                    setEditableContent(newContent);
                    setMessages(prev => [...prev, { role: "assistant", content: `I've added an image above "${h2Text}".` }]);
                  }
                } catch (err) {
                  console.error("Failed to add image:", err);
                }
              }
            }
            break;
          }
        }
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev => [...prev, { role: "assistant", content: `Sorry, I encountered an error: ${msg}. Please try again.` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const messageText = input.trim();
    setInput("");
    await sendMessage(messageText);
  };

  const handleCreateBlog = async (title: string) => {
    setIsCreating(true);
    setCreationStatus("Starting blog creation...");
    setCreationProgress(10);
    setMessages(prev => [...prev, { role: "assistant", content: `I'm starting to build your blog: "${title}". I'll generate the content and images, then sync everything to Framer. This usually takes about 2 minutes.` }]);
    
    try {
      // Step 1: Generate content and initial Framer entry
      setCreationStatus("Generating content and creating Framer entry...");
      setCreationProgress(30);
      const res = await fetch("/api/blogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, action: "create" }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || data.details || "Failed to create blog");
      }

      const blog = await res.json();
      setCreationProgress(100);
      setCreationStatus("Blog created successfully!");
      setMessages(prev => [...prev, { role: "assistant", content: `Successfully created blog: "${blog.title}"! You can now see it in your sidebar and edit it.` }]);
      
      // Auto-select the new blog
      handleBlogClick(blog);
      fetchBlogs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev => [...prev, { role: "assistant", content: `❌ Failed to create blog: ${msg}` }]);
    } finally {
      setIsCreating(false);
      setCreationStatus("");
      setCreationProgress(0);
    }
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
            {fetchingBlogs ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
              </div>
            ) : filteredBlogs.length === 0 ? (
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
        {/* Top Bar / Toggle Sidebar Button - Only show when sidebar is closed */}
        {!isSidebarOpen && (
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
          <div className="flex-1 flex items-center justify-center bg-gray-50/50">
            <div className="max-w-md w-full p-8 bg-white rounded-[28px] border border-gray-200 shadow-xl text-center animate-fade-in">
              <div className="mb-6 relative h-24 w-24 mx-auto">
                <div className="absolute inset-0 border-4 border-gray-100 rounded-full"></div>
                <div 
                  className="absolute inset-0 border-4 border-black rounded-full transition-all duration-500 ease-out"
                  style={{ 
                    clipPath: `polygon(50% 50%, -50% -50%, ${creationProgress > 25 ? '150% -50%' : '50% -50%'}, ${creationProgress > 50 ? '150% 150%' : '50% 50%'}, ${creationProgress > 75 ? '-50% 150%' : '50% 50%'}, -50% -50%)`,
                    transform: `rotate(${creationProgress * 3.6}deg)`
                  }}
                ></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-black" />
                </div>
              </div>
              <h2 className="text-xl font-bold mb-2">Building your blog...</h2>
              <p className="text-gray-500 text-sm mb-6">{creationStatus}</p>
              <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-black h-full transition-all duration-500 ease-out"
                  style={{ width: `${creationProgress}%` }}
                ></div>
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
                      content={editableContent} 
                      onChange={setEditableContent}
                      onSave={handleSaveBlog}
                      isSaving={savingBlog}
                      hasChanges={hasChanges}
                      blogSlug={selectedBlog?.slug}
                      coverImageUrl={selectedBlog?.coverImageUrl}
                      title={selectedBlog?.title}
                      date={selectedBlog?.date}
                      onTitleChange={(newTitle) => {
                        if (!selectedBlog) return;
                        // Only update local state - save happens on button click
                        setSelectedBlog({ ...selectedBlog, title: newTitle });
                      }}
                      onDateChange={(newDate) => {
                        if (!selectedBlog) return;
                        // Only update local state - save happens on button click
                        setSelectedBlog({ ...selectedBlog, date: newDate });
                      }}
                  onCoverImageReplace={async (newUrl) => {
                    if (!selectedBlog) return;
                    // Update both coverImageUrl and blogListImageUrl (they use the same image)
                    setSelectedBlog({ ...selectedBlog, coverImageUrl: newUrl });
                    // Also update in the save handler so both are saved together
                    // The save will handle updating both fields
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
            <input
              type="text"
              id="chat-input"
              data-testid="chat-input"
              aria-label="Chat input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={selectedBlog ? `Tell AI how to improve this blog...` : "What should we write about today?"}
              disabled={loading}
              className="w-full bg-gray-50 border border-gray-200 rounded-[28px] py-3 md:py-4 pl-4 md:pl-6 pr-12 md:pr-14 text-sm md:text-base text-black placeholder:text-gray-400 focus:outline-none focus:border-gray-300 focus:bg-white transition-all disabled:opacity-50 shadow-sm"
            />
            <button
              type="submit"
              id="chat-submit"
              data-testid="chat-submit"
              aria-label="Send message"
              disabled={loading || !input.trim()}
              className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 p-2 bg-black text-white rounded-[28px] hover:bg-gray-800 active:bg-gray-700 transition-colors disabled:opacity-10 touch-manipulation"
            >
              {loading ? <Loader2 className="h-4 w-4 md:h-5 md:w-5 animate-spin" /> : <Send className="h-4 w-4 md:h-5 md:w-5" />}
            </button>
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
