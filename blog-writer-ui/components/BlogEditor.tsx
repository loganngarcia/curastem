"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Typography from "@tiptap/extension-typography";
import { ImagePlaceholder } from "./ImagePlaceholder";
import { 
  Bold, 
  Italic, 
  Underline as UnderlineIcon, 
  Link as LinkIcon, 
  Quote, 
  Code, 
  List, 
  ListOrdered, 
  ChevronDown,
  Save,
  Undo,
  Redo,
  Image as ImageIcon,
  Upload,
  X,
  Loader2,
  MoreHorizontal,
  Sparkles
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import ErrorModal from "./ErrorModal";

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  onSave?: () => void;
  isSaving?: boolean;
  hasChanges?: boolean;
  blogSlug?: string;
  coverImageUrl?: string;
  title?: string;
  date?: string;
  onTitleChange?: (title: string) => void;
  onDateChange?: (date: string) => void;
  onCoverImageReplace?: (newUrl: string) => void;
}

export default function BlogEditor({ content, onChange, onSave, isSaving, hasChanges = true, blogSlug, coverImageUrl, title, date, onTitleChange, onDateChange, onCoverImageReplace }: EditorProps) {
  const [generatingImageFor, setGeneratingImageFor] = useState<string | null>(null);
  const [regeneratingImage, setRegeneratingImage] = useState<string | null>(null);
  const [imagePrompts, setImagePrompts] = useState<Record<string, string>>({}); // Store prompts for each image URL
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isImageEditModalOpen, setIsImageEditModalOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null);
  const [cmsImages, setCmsImages] = useState<Array<{ url: string; alt: string; source: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadTab, setUploadTab] = useState<"upload" | "cms" | "url">("upload");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownButtonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const [isToolbarMenuOpen, setIsToolbarMenuOpen] = useState(false);
  const [toolbarMenuPosition, setToolbarMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const toolbarMenuButtonRef = useRef<HTMLButtonElement>(null);
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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
      }),
      Underline,
      Typography,
      Link.configure({
        openOnClick: false,
      }),
      Image.configure({
        allowBase64: true,
        inline: true,
        HTMLAttributes: {
          class: "max-w-full h-auto rounded-lg cursor-pointer",
        },
      }),
      ImagePlaceholder,
      Placeholder.configure({
        placeholder: "Start writing your blog post...",
      }),
    ],
    content: content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "prose prose-lg max-w-none focus:outline-none min-h-[500px] pb-32",
      },
      handleDOMEvents: {
        click: (view, event) => {
          const target = event.target as HTMLElement;
          
          // Handle placeholder image button clicks
          if (target.classList.contains("create-image-btn") || target.closest(".create-image-btn")) {
            event.preventDefault();
            const button = target.classList.contains("create-image-btn") ? target : target.closest(".create-image-btn") as HTMLElement;
            const placeholder = button?.closest(".image-placeholder") as HTMLElement;
            if (placeholder) {
              const h2Text = placeholder.getAttribute("data-h2-text") || "";
              handleCreatePlaceholderImage(h2Text, placeholder);
            }
            return true;
          }
          
          // Handle regenerate button clicks
          if (target.classList.contains("regenerate-image-btn") || target.closest(".regenerate-image-btn")) {
            event.preventDefault();
            event.stopPropagation();
            const button = target.classList.contains("regenerate-image-btn") ? target : target.closest(".regenerate-image-btn") as HTMLElement;
            const imgContainer = button?.closest(".image-with-regenerate") as HTMLElement;
            const img = imgContainer?.querySelector("img") as HTMLImageElement;
            if (img) {
              const src = img.getAttribute("src") || "";
              const alt = img.getAttribute("alt") || "";
              handleRegenerateImage(src, alt);
            }
            return true;
          }
          
          // Handle regular image clicks (but not regenerate button)
          if (target.tagName === "IMG" && !target.closest(".regenerate-image-btn")) {
            event.preventDefault();
            const src = target.getAttribute("src") || "";
            const alt = target.getAttribute("alt") || "";
            setSelectedImage({ src, alt });
            setIsImageEditModalOpen(true);
            return true;
          }
          return false;
        },
      },
    },
  });

  // Update editor content if it changes externally (e.g. when switching blogs)
  // Only update if content actually changed to preserve undo/redo history
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      // Store current selection
      const { from, to } = editor.state.selection;
      // Set content - this will reset history, but only happens when switching blogs
      // which is expected behavior
      editor.commands.setContent(content);
      // Try to restore selection if possible
      try {
        const docSize = editor.state.doc.content.size;
        if (from <= docSize && to <= docSize) {
          editor.commands.setTextSelection({ from: Math.min(from, docSize), to: Math.min(to, docSize) });
        }
      } catch {
        // Selection might be invalid after content change, that's okay
      }
    }
  }, [content, editor]);

  // Add regenerate buttons to images after editor renders
  useEffect(() => {
    if (!editor) return;
    
    const addRegenerateButtons = () => {
      const editorElement = editor.view.dom;
      const images = editorElement.querySelectorAll("img");
      
      images.forEach((img) => {
        let parent = img.parentElement;
        // Ensure parent is a paragraph
        if (!parent || parent.tagName !== "P") {
          // Wrap img in paragraph if needed
          const wrapper = document.createElement("p");
          wrapper.className = "image-with-regenerate";
          wrapper.setAttribute("dir", "auto");
          img.parentNode?.insertBefore(wrapper, img);
          wrapper.appendChild(img);
          parent = wrapper;
        }
        
        if (parent && !parent.classList.contains("image-with-regenerate")) {
          parent.classList.add("image-with-regenerate");
        }
        
        // Remove existing regenerate button if any
        const existingBtn = parent.querySelector(".regenerate-image-btn");
        if (existingBtn) existingBtn.remove();
        
        // Create regenerate button with Sparkles icon
        const regenerateBtn = document.createElement("button");
        regenerateBtn.className = "regenerate-image-btn";
        regenerateBtn.type = "button";
        // Create Sparkles icon SVG
        const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        iconSvg.setAttribute("width", "12");
        iconSvg.setAttribute("height", "12");
        iconSvg.setAttribute("viewBox", "0 0 24 24");
        iconSvg.setAttribute("fill", "none");
        iconSvg.setAttribute("stroke", "currentColor");
        iconSvg.setAttribute("stroke-width", "2");
        iconSvg.setAttribute("stroke-linecap", "round");
        iconSvg.setAttribute("stroke-linejoin", "round");
        // Sparkles icon paths (multiple small stars/sparkles)
        const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path1.setAttribute("d", "M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z");
        const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path2.setAttribute("d", "M19 3L19.5 5.5L22 6L19.5 6.5L19 9L18.5 6.5L16 6L18.5 5.5L19 3Z");
        const path3 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path3.setAttribute("d", "M5 21L5.5 18.5L8 18L5.5 17.5L5 15L4.5 17.5L2 18L4.5 18.5L5 21Z");
        iconSvg.appendChild(path1);
        iconSvg.appendChild(path2);
        iconSvg.appendChild(path3);
        regenerateBtn.appendChild(iconSvg);
        const textNode = document.createTextNode(" Regenerate");
        regenerateBtn.appendChild(textNode);
        regenerateBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const src = img.getAttribute("src") || "";
          const alt = img.getAttribute("alt") || "";
          handleRegenerateImage(src, alt);
        };
        parent.appendChild(regenerateBtn);
      });
    };
    
    // Add buttons after a short delay to ensure DOM is ready
    const timeout = setTimeout(addRegenerateButtons, 100);
    
    // Also add when content changes
    editor.on("update", addRegenerateButtons);
    
    return () => {
      clearTimeout(timeout);
      editor.off("update", addRegenerateButtons);
    };
  }, [editor]);

  // Fetch CMS images when modal opens
  useEffect(() => {
    if (isImageModalOpen) {
      fetchCmsImages();
    }
  }, [isImageModalOpen, blogSlug]);

  const fetchCmsImages = async () => {
    try {
      const url = blogSlug 
        ? `/api/images/cms?slug=${encodeURIComponent(blogSlug)}`
        : "/api/images/cms";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setCmsImages(data.images || []);
      }
    } catch (error) {
      console.error("Failed to fetch CMS images:", error);
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/images/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Upload failed");
      }

      const data = await res.json();
      // Use filename as alt text (remove extension)
      const altText = file.name.replace(/\.[^/.]+$/, "") || "Uploaded image";
      insertImage(data.url, altText);
      setIsImageModalOpen(false);
    } catch (error) {
      console.error("Upload error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to upload image";
      setErrorModal({
        isOpen: true,
        title: "Failed to upload image",
        message: errorMessage,
        error: error,
        details: "Failed to upload image file to Framer CMS.",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleUrlUpload = async (imageUrl: string) => {
    if (!imageUrl.trim()) return;
    
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("imageUrl", imageUrl.trim());

      const res = await fetch("/api/images/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Upload failed");
      }

      const data = await res.json();
      // Extract filename from URL for alt text
      const urlParts = imageUrl.trim().split('/');
      const filename = urlParts[urlParts.length - 1].split('?')[0].replace(/\.[^/.]+$/, "") || "Image from URL";
      insertImage(data.url, filename);
      setIsImageModalOpen(false);
    } catch (error) {
      console.error("Upload error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to upload image";
      setErrorModal({
        isOpen: true,
        title: "Failed to upload image",
        message: errorMessage,
        error: error,
        details: `Failed to upload image from URL: ${imageUrl}`,
      });
    } finally {
      setUploading(false);
    }
  };

  const insertImage = (url: string, alt: string = "") => {
    editor.chain().focus().setImage({ src: url, alt }).run();
  };

  const handleRegenerateImage = async (currentImageUrl: string, currentAlt: string) => {
    if (!editor || regeneratingImage) return;
    
    setRegeneratingImage(currentImageUrl);
    
    try {
      // Use the alt text as the image prompt (it contains the original subject)
      const imagePrompt = currentAlt || "professional illustration";
      
      // Call API to generate new image
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: imagePrompt, aspect: "16:9" }),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to regenerate image");
      }
      
      const data = await res.json();
      const newImageUrl = data.url;
      
      // Replace the old image with the new one in editor content
      const currentContent = editor.getHTML();
      // Escape special regex characters
      const escapedUrl = currentImageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match img tag with its parent paragraph if it exists
      const imagePattern = new RegExp(`(<p[^>]*>)?<img[^>]+src=["']${escapedUrl}["'][^>]*>(</p>)?`, 'gi');
      
      // Create new image wrapped in paragraph with regenerate class
      const wrappedHtml = `<p dir="auto" class="image-with-regenerate"><img src="${newImageUrl}" alt="${currentAlt}"></p>`;
      
      const newContent = currentContent.replace(imagePattern, wrappedHtml);
      editor.commands.setContent(newContent);
      
      // Update the prompt mapping
      setImagePrompts(prev => ({ ...prev, [newImageUrl]: imagePrompt }));
      
    } catch (error) {
      console.error("Failed to regenerate image:", error);
      setErrorModal({
        isOpen: true,
        title: "Failed to regenerate image",
        message: error instanceof Error ? error.message : "Failed to regenerate image",
        error: error,
        details: "Failed to regenerate image.",
      });
    } finally {
      setRegeneratingImage(null);
    }
  };

  const handleCreatePlaceholderImage = async (h2Text: string, placeholderElement: HTMLElement) => {
    if (!editor || generatingImageFor) return;
    
    setGeneratingImageFor(h2Text);
    
    try {
      // Get image prompt from data attribute, or generate from H2 text
      const imagePrompt = placeholderElement.getAttribute("data-image-prompt") || 
                         `professional illustration representing ${h2Text.toLowerCase()}`;
      
      // Call API to generate image
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: imagePrompt, aspect: "16:9" }),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to generate image");
      }
      
      const data = await res.json();
      const imageUrl = data.url;
      
      // Store the prompt for this image
      setImagePrompts(prev => ({ ...prev, [imageUrl]: imagePrompt }));
      
      // Find the placeholder node in the editor and replace it with an image
      const { state } = editor;
      const { tr } = state;
      
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'imagePlaceholder' && 
            node.attrs.h2Text === h2Text) {
          // Replace placeholder node with image, using imagePrompt as alt text
          const imageNode = state.schema.nodes.paragraph.create(
            { class: "image-with-regenerate" },
            state.schema.nodes.image.create({ src: imageUrl, alt: imagePrompt })
          );
          tr.replaceWith(pos, pos + node.nodeSize, imageNode);
          return false; // Stop searching
        }
      });
      
      if (tr.steps.length > 0) {
        editor.view.dispatch(tr);
      } else {
        // Fallback: replace in HTML if node replacement didn't work
        const currentContent = editor.getHTML();
        const placeholderPattern = new RegExp(
          `<p[^>]*class="image-placeholder"[^>]*data-h2-text="${h2Text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>.*?</p>`,
          'gs'
        );
        const imageHtml = `<p dir="auto" class="image-with-regenerate"><img src="${imageUrl}" alt="${imagePrompt}"></p>`;
        const newContent = currentContent.replace(placeholderPattern, imageHtml);
        editor.commands.setContent(newContent);
      }
      
    } catch (error) {
      console.error("Failed to generate image:", error);
      setErrorModal({
        isOpen: true,
        title: "Failed to generate image",
        message: error instanceof Error ? error.message : "Failed to generate image",
        error: error,
        details: "Failed to generate image for placeholder.",
      });
    } finally {
      setGeneratingImageFor(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      handleFileUpload(file);
    }
  };

  if (!editor) {
    return null;
  }

  const toggleHeading = (level: any) => {
    editor.chain().focus().toggleHeading({ level }).run();
    setIsMenuOpen(false);
    setDropdownPosition(null);
  };

  const getCurrentHeading = () => {
    if (editor.isActive("heading", { level: 1 })) return "Heading 1";
    if (editor.isActive("heading", { level: 2 })) return "Heading 2";
    if (editor.isActive("heading", { level: 3 })) return "Heading 3";
    if (editor.isActive("heading", { level: 4 })) return "Heading 4";
    if (editor.isActive("heading", { level: 5 })) return "Heading 5";
    if (editor.isActive("heading", { level: 6 })) return "Heading 6";
    return "Paragraph";
  };

  return (
    <div className="flex flex-col w-full h-full relative">
      {/* Fixed Toolbar */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-gray-200 p-1 md:p-2 flex items-center justify-between shadow-sm overflow-x-auto overflow-y-visible">
        <div className="flex items-center space-x-0.5 md:space-x-1 flex-shrink-0 min-w-0">
          {/* Heading Dropdown */}
          <div className="relative">
            <button
              ref={dropdownButtonRef}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!isMenuOpen && dropdownButtonRef.current) {
                  const rect = dropdownButtonRef.current.getBoundingClientRect();
                  const viewportWidth = window.innerWidth;
                  const dropdownWidth = 192; // w-48 = 12rem = 192px
                  let left = rect.left;
                  
                  // Ensure dropdown doesn't go off-screen on the right
                  if (left + dropdownWidth > viewportWidth - 16) {
                    left = viewportWidth - dropdownWidth - 16;
                  }
                  
                  // Ensure dropdown doesn't go off-screen on the left
                  if (left < 16) {
                    left = 16;
                  }
                  
                  setDropdownPosition({
                    top: rect.bottom + 4,
                    left: left,
                  });
                  setIsMenuOpen(true);
                } else {
                  setIsMenuOpen(false);
                  setDropdownPosition(null);
                }
              }}
              className="flex items-center space-x-1 md:space-x-2 px-2 md:px-3 py-1.5 rounded-lg hover:bg-gray-100 active:bg-gray-200 text-xs md:text-sm font-medium transition-colors touch-manipulation"
            >
              <span className="hidden sm:inline">{getCurrentHeading()}</span>
              <span className="sm:hidden">H</span>
              <ChevronDown className="h-3 w-3 md:h-4 md:w-4" />
            </button>
            
            {isMenuOpen && dropdownPosition && (
              <>
                <div 
                  className="fixed inset-0 z-30" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMenuOpen(false);
                    setDropdownPosition(null);
                  }}
                />
                <div 
                  className="fixed w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 overflow-hidden"
                  style={{
                    top: `${dropdownPosition.top}px`,
                    left: `${dropdownPosition.left}px`,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      editor.chain().focus().setParagraph().run();
                      setIsMenuOpen(false);
                      setDropdownPosition(null);
                    }}
                    className={cn(
                      "w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors touch-manipulation",
                      !editor.isActive("heading") && "bg-gray-50 font-semibold"
                    )}
                  >
                    Paragraph
                  </button>
                  {[1, 2, 3, 4, 5, 6].map((level) => (
                    <button
                      key={level}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleHeading(level as any);
                        setDropdownPosition(null);
                      }}
                      className={cn(
                        "w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors touch-manipulation",
                        editor.isActive("heading", { level }) && "bg-gray-50 font-semibold"
                      )}
                    >
                      Heading {level}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="h-6 w-[1px] bg-gray-200 mx-0.5 md:mx-1 flex-shrink-0" />

          {/* Formatting Buttons */}
          <div className="flex items-center space-x-0.5">
            {/* Always visible on mobile */}
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              active={editor.isActive("bold")}
              icon={<Bold className="h-4 w-4" />}
              title="Bold"
            />
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              active={editor.isActive("italic")}
              icon={<Italic className="h-4 w-4" />}
              title="Italic"
            />
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              active={editor.isActive("underline")}
              icon={<UnderlineIcon className="h-4 w-4" />}
              title="Underline"
            />
            <ToolbarButton
              onClick={() => setIsImageModalOpen(true)}
              active={editor.isActive("image")}
              icon={<ImageIcon className="h-4 w-4" />}
              title="Insert Image"
            />
            
            {/* Hidden on mobile, shown in overflow menu */}
            <div className="hidden md:flex items-center space-x-0.5">
              <ToolbarButton
                onClick={() => {
                  const url = window.prompt("Enter URL");
                  if (url) {
                    editor.chain().focus().setLink({ href: url }).run();
                  } else if (url === "") {
                    editor.chain().focus().unsetLink().run();
                  }
                }}
                active={editor.isActive("link")}
                icon={<LinkIcon className="h-4 w-4" />}
                title="Link"
              />
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                active={editor.isActive("blockquote")}
                icon={<Quote className="h-4 w-4" />}
                title="Quote"
              />
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleCode().run()}
                active={editor.isActive("code")}
                icon={<Code className="h-4 w-4" />}
                title="Code"
              />
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                active={editor.isActive("bulletList")}
                icon={<List className="h-4 w-4" />}
                title="Bullet List"
              />
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                active={editor.isActive("orderedList")}
                icon={<ListOrdered className="h-4 w-4" />}
                title="Ordered List"
              />
            </div>

            {/* Mobile overflow menu */}
            <div className="md:hidden relative">
              <button
                ref={toolbarMenuButtonRef}
                onClick={() => {
                  if (!isToolbarMenuOpen && toolbarMenuButtonRef.current) {
                    const rect = toolbarMenuButtonRef.current.getBoundingClientRect();
                    setToolbarMenuPosition({
                      top: rect.bottom + 4,
                      left: rect.left,
                    });
                  }
                  setIsToolbarMenuOpen(!isToolbarMenuOpen);
                }}
                className="p-1.5 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors touch-manipulation"
                title="More options"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              
              {isToolbarMenuOpen && toolbarMenuPosition && (
                <>
                  <div 
                    className="fixed inset-0 z-30" 
                    onClick={() => {
                      setIsToolbarMenuOpen(false);
                      setToolbarMenuPosition(null);
                    }}
                  />
                  <div 
                    className="fixed bg-white border border-gray-200 rounded-xl shadow-xl z-40 py-1 overflow-hidden animate-in fade-in slide-in-from-top-2"
                    style={{
                      top: `${toolbarMenuPosition.top}px`,
                      left: `${toolbarMenuPosition.left}px`,
                      minWidth: "160px",
                    }}
                  >
                    <button
                      onClick={() => {
                        const url = window.prompt("Enter URL");
                        if (url) {
                          editor.chain().focus().setLink({ href: url }).run();
                        } else if (url === "") {
                          editor.chain().focus().unsetLink().run();
                        }
                        setIsToolbarMenuOpen(false);
                        setToolbarMenuPosition(null);
                      }}
                      className={cn(
                        "w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2",
                        editor.isActive("link") && "bg-gray-50 font-semibold"
                      )}
                    >
                      <LinkIcon className="h-4 w-4" />
                      Link
                    </button>
                    <button
                      onClick={() => {
                        editor.chain().focus().toggleBlockquote().run();
                        setIsToolbarMenuOpen(false);
                        setToolbarMenuPosition(null);
                      }}
                      className={cn(
                        "w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2",
                        editor.isActive("blockquote") && "bg-gray-50 font-semibold"
                      )}
                    >
                      <Quote className="h-4 w-4" />
                      Quote
                    </button>
                    <button
                      onClick={() => {
                        editor.chain().focus().toggleCode().run();
                        setIsToolbarMenuOpen(false);
                        setToolbarMenuPosition(null);
                      }}
                      className={cn(
                        "w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2",
                        editor.isActive("code") && "bg-gray-50 font-semibold"
                      )}
                    >
                      <Code className="h-4 w-4" />
                      Code
                    </button>
                    <button
                      onClick={() => {
                        editor.chain().focus().toggleBulletList().run();
                        setIsToolbarMenuOpen(false);
                        setToolbarMenuPosition(null);
                      }}
                      className={cn(
                        "w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2",
                        editor.isActive("bulletList") && "bg-gray-50 font-semibold"
                      )}
                    >
                      <List className="h-4 w-4" />
                      Bullet List
                    </button>
                    <button
                      onClick={() => {
                        editor.chain().focus().toggleOrderedList().run();
                        setIsToolbarMenuOpen(false);
                        setToolbarMenuPosition(null);
                      }}
                      className={cn(
                        "w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2",
                        editor.isActive("orderedList") && "bg-gray-50 font-semibold"
                      )}
                    >
                      <ListOrdered className="h-4 w-4" />
                      Numbered List
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="h-6 w-[1px] bg-gray-200 mx-0.5 md:mx-1 flex-shrink-0" />

          {/* History */}
          <div className="flex items-center space-x-0.5">
            <ToolbarButton
              onClick={() => {
                editor.chain().focus().undo().run();
              }}
              disabled={!editor.can().undo()}
              icon={<Undo className="h-4 w-4" />}
              title="Undo"
            />
            <ToolbarButton
              onClick={() => {
                editor.chain().focus().redo().run();
              }}
              disabled={!editor.can().redo()}
              icon={<Redo className="h-4 w-4" />}
              title="Redo"
            />
          </div>
        </div>

        {/* Save Button */}
        {onSave && (
          <button
            onClick={onSave}
            disabled={isSaving || !hasChanges}
            data-testid="save-button"
            className="flex items-center space-x-1 md:space-x-2 bg-black text-white px-3 md:px-4 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-xs md:text-sm font-medium flex-shrink-0"
          >
            {isSaving ? (
              <span className="animate-spin">◌</span>
            ) : (
              <Save className="h-3 w-3 md:h-4 md:w-4" />
            )}
            <span className="hidden sm:inline" data-testid="save-button-text">{isSaving ? "Saving..." : "Save Changes"}</span>
            <span className="sm:hidden">{isSaving ? "..." : "Save"}</span>
          </button>
        )}
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="w-full mx-auto p-3 md:p-8 max-w-4xl">
          {/* Title */}
          {title !== undefined && (
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange?.(e.target.value)}
              className="text-2xl md:text-4xl font-bold mb-4 md:mb-6 w-full bg-transparent border-none outline-none focus:outline-none p-0 resize-none"
              placeholder="Blog title..."
            />
          )}

          {/* Date */}
          {date !== undefined && onDateChange && (
            <div className="mb-4 md:mb-6">
              <input
                type="text"
                value={date ? (() => {
                  const d = new Date(date);
                  const month = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  const year = d.getFullYear();
                  return `${month}/${day}/${year}`;
                })() : ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value) {
                    onDateChange('');
                    return;
                  }
                  // Parse mm/dd/yyyy format
                  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                  if (match) {
                    const [, month, day, year] = match;
                    const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                    if (!isNaN(dateObj.getTime())) {
                      onDateChange(dateObj.toISOString());
                    }
                  }
                }}
                placeholder="mm/dd/yyyy"
                className="text-base md:text-lg text-gray-700 bg-transparent border-none outline-none focus:outline-none p-0 transition-colors w-full placeholder:text-gray-400"
              />
            </div>
          )}

          {/* Cover Image Placeholder - shown if no cover image exists */}
          {title && !coverImageUrl && onCoverImageReplace && (
            <div className="mb-6 md:mb-8">
              <p className="image-placeholder" 
                 data-type="imagePlaceholder" 
                 data-h2-text="Cover Image" 
                 data-image-prompt={`professional cover image for blog post about ${title.toLowerCase()}`}
                 style={{ width: '100%', aspectRatio: '16/9', backgroundColor: '#e5e7eb', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: '2rem 0', position: 'relative', cursor: 'pointer', minHeight: '200px', padding: '1rem' }}
              >
                <span style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px', textAlign: 'center', maxWidth: '80%' }}>
                  Cover & Blog List Image: professional cover image for blog post about {title.toLowerCase()}
                </span>
                <button 
                  className="create-image-btn" 
                  style={{ background: 'black', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', fontSize: '14px', cursor: 'pointer', fontWeight: '500' }}
                  onClick={async () => {
                    if (generatingImageFor) return;
                    setGeneratingImageFor("Cover Image");
                    try {
                      const imagePrompt = `professional cover image for blog post about ${title.toLowerCase()}`;
                      const res = await fetch("/api/images/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ subject: imagePrompt, aspect: "16:9" }),
                      });
                      if (!res.ok) throw new Error("Failed to generate image");
                      const data = await res.json();
                      onCoverImageReplace(data.url);
                    } catch (error) {
                      console.error("Failed to generate cover image:", error);
                      setErrorModal({
                        isOpen: true,
                        title: "Failed to generate image",
                        message: error instanceof Error ? error.message : "Failed to generate image",
                        error: error,
                        details: "Failed to generate cover image.",
                      });
                    } finally {
                      setGeneratingImageFor(null);
                    }
                  }}
                  disabled={!!generatingImageFor}
                >
                  {generatingImageFor === "Cover Image" ? "Generating..." : "Create Cover Image"}
                </button>
              </p>
            </div>
          )}
          
          {/* Cover Image - as inline image */}
          {coverImageUrl && (
            <div className="mb-8 relative image-with-regenerate">
              <img 
                src={coverImageUrl} 
                alt={title ? `professional cover image for blog post about ${title.toLowerCase()}` : "Cover image"} 
                className="w-full h-auto cursor-pointer"
                onClick={() => {
                  const altText = title ? `professional cover image for blog post about ${title.toLowerCase()}` : "Cover image";
                  setSelectedImage({ src: coverImageUrl, alt: altText });
                  setIsImageEditModalOpen(true);
                }}
              />
              <button
                className="regenerate-image-btn"
                type="button"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (regeneratingImage || !onCoverImageReplace) return;
                  setRegeneratingImage(coverImageUrl);
                  try {
                    const imagePrompt = title ? `professional cover image for blog post about ${title.toLowerCase()}` : "professional cover image";
                    const res = await fetch("/api/images/generate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ subject: imagePrompt, aspect: "16:9" }),
                    });
                    if (!res.ok) throw new Error("Failed to regenerate image");
                    const data = await res.json();
                    onCoverImageReplace(data.url);
                  } catch (error) {
                    console.error("Failed to regenerate cover image:", error);
                    setErrorModal({
                      isOpen: true,
                      title: "Failed to regenerate image",
                      message: error instanceof Error ? error.message : "Failed to regenerate image",
                      error: error,
                      details: "Failed to regenerate cover image.",
                    });
                  } finally {
                    setRegeneratingImage(null);
                  }
                }}
                disabled={!!regeneratingImage}
              >
                <Sparkles className="h-3 w-3" />
                <span>Regenerate</span>
              </button>
            </div>
          )}
          
          {/* Editor Content */}
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Image Edit Modal */}
      {/* Error Modal */}
      <ErrorModal
        isOpen={errorModal.isOpen}
        onClose={() => setErrorModal({ ...errorModal, isOpen: false })}
        title={errorModal.title}
        message={errorModal.message}
        error={errorModal.error}
        details={errorModal.details}
      />

      {isImageEditModalOpen && selectedImage && (
        <ImageEditModal
          image={selectedImage}
          onClose={() => {
            setIsImageEditModalOpen(false);
            setSelectedImage(null);
          }}
          onReplace={(newUrl) => {
            // Check if this is the cover image
            if (selectedImage.src === coverImageUrl && onCoverImageReplace) {
              onCoverImageReplace(newUrl);
              setIsImageEditModalOpen(false);
              setSelectedImage(null);
              return;
            }
            
            // Otherwise, replace image in editor content
            if (editor && selectedImage) {
              // Find and replace the image with matching src
              const { state } = editor;
              const { tr } = state;
              let updated = false;
              
              state.doc.descendants((node, pos) => {
                if (node.type.name === "image" && node.attrs.src === selectedImage.src && !updated) {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: newUrl });
                  updated = true;
                }
              });
              
              if (updated) {
                editor.view.dispatch(tr);
                setIsImageEditModalOpen(false);
                setSelectedImage(null);
              }
            }
          }}
          onAltTextChange={(newAlt) => {
            if (editor && selectedImage) {
              // Find and update the image with matching src
              const { state } = editor;
              const { tr } = state;
              let updated = false;
              
              state.doc.descendants((node, pos) => {
                if (node.type.name === "image" && node.attrs.src === selectedImage.src && !updated) {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt: newAlt });
                  updated = true;
                }
              });
              
              if (updated) {
                editor.view.dispatch(tr);
                setSelectedImage({ ...selectedImage, alt: newAlt });
              }
            }
          }}
          cmsImages={cmsImages}
        />
      )}

      {/* Image Styles */}
      <style jsx global>{`
        .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 0.5rem;
          margin: 1rem 0;
          display: block;
          cursor: pointer;
        }
        .ProseMirror img.ProseMirror-selectednode {
          outline: 2px solid #000;
          outline-offset: 2px;
        }
        .ProseMirror p.image-with-regenerate {
          position: relative;
          margin: 1rem 0;
        }
        .ProseMirror .regenerate-image-btn {
          position: absolute;
          bottom: 8px;
          right: 8px;
          background: rgba(0, 0, 0, 0.8);
          color: white;
          border: none;
          border-radius: 6px;
          padding: 6px 10px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 500;
          transition: all 0.2s;
          z-index: 10;
          backdrop-filter: blur(4px);
          opacity: 0.8;
        }
        .ProseMirror .regenerate-image-btn:hover:not(:disabled) {
          background: rgba(0, 0, 0, 0.9);
          transform: scale(1.05);
          opacity: 1;
        }
        .ProseMirror .regenerate-image-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .ProseMirror p.image-with-regenerate:hover .regenerate-image-btn {
          opacity: 1;
        }
        .ProseMirror .image-placeholder {
          width: 100%;
          aspect-ratio: 16/9;
          background-color: #e5e7eb;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 2rem 0;
          position: relative;
          cursor: pointer;
          min-height: 200px;
        }
        .ProseMirror .image-placeholder .create-image-btn {
          background: black;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
          font-weight: 500;
          transition: opacity 0.2s;
        }
        .ProseMirror .image-placeholder .create-image-btn:hover:not(:disabled) {
          opacity: 0.9;
        }
        .ProseMirror .image-placeholder .create-image-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          outline-offset: 2px;
        }
        .ProseMirror ul,
        .ProseMirror ol {
          list-style-position: outside;
          padding-left: 1.5em;
          margin: 1rem 0;
        }
        .ProseMirror ul {
          list-style-type: disc;
        }
        .ProseMirror ol {
          list-style-type: decimal;
        }
        .ProseMirror li {
          margin: 0.5rem 0;
        }
        .ProseMirror p.image-placeholder {
          width: 100% !important;
          aspect-ratio: 16/9;
          background-color: #e5e7eb !important;
          border-radius: 8px;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          margin: 2rem 0 !important;
          position: relative;
          cursor: pointer;
          min-height: 200px;
          padding: 1rem !important;
        }
        .ProseMirror p.image-placeholder span {
          font-size: 14px;
          color: #6b7280;
          margin-bottom: 12px;
          text-align: center;
          max-width: 80%;
        }
        .ProseMirror p.image-placeholder .create-image-btn {
          background: black;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
          font-weight: 500;
          transition: opacity 0.2s;
        }
        .ProseMirror p.image-placeholder .create-image-btn:hover:not(:disabled) {
          opacity: 0.9;
        }
        .ProseMirror p.image-placeholder .create-image-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>

      {/* Image Modal */}
      {isImageModalOpen && (
        <ImageModal
          onClose={() => setIsImageModalOpen(false)}
          onInsert={insertImage}
          onUpload={handleFileUpload}
          onUrlUpload={handleUrlUpload}
          cmsImages={cmsImages}
          uploadTab={uploadTab}
          setUploadTab={setUploadTab}
          uploading={uploading}
          fileInputRef={fileInputRef}
          onFileSelect={handleFileSelect}
        />
      )}
    </div>
  );
}

interface ImageModalProps {
  onClose: () => void;
  onInsert: (url: string, alt?: string) => void;
  onUpload: (file: File) => void;
  onUrlUpload: (url: string) => void;
  cmsImages: Array<{ url: string; alt: string; source: string }>;
  uploadTab: "upload" | "cms" | "url";
  setUploadTab: (tab: "upload" | "cms" | "url") => void;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function ImageModal({
  onClose,
  onInsert,
  onUpload,
  onUrlUpload,
  cmsImages,
  uploadTab,
  setUploadTab,
  uploading,
  fileInputRef,
  onFileSelect,
}: ImageModalProps) {
  const [urlInput, setUrlInput] = useState("");

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      onUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-0 md:p-4"
        onClick={onClose}
      >
        <div 
          className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col h-full md:h-auto mx-0 md:mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold">Insert Image</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 overflow-x-auto">
            <button
              onClick={() => setUploadTab("upload")}
              className={cn(
                "px-3 md:px-4 py-3 md:py-2 text-sm font-medium transition-colors flex-shrink-0 touch-manipulation min-h-[44px]",
                uploadTab === "upload"
                  ? "border-b-2 border-black text-black"
                  : "text-gray-600 hover:text-black active:text-gray-800"
              )}
            >
              Upload
            </button>
            <button
              onClick={() => setUploadTab("cms")}
              className={cn(
                "px-3 md:px-4 py-3 md:py-2 text-sm font-medium transition-colors flex-shrink-0 touch-manipulation min-h-[44px]",
                uploadTab === "cms"
                  ? "border-b-2 border-black text-black"
                  : "text-gray-600 hover:text-black active:text-gray-800"
              )}
            >
              <span className="hidden sm:inline">CMS Images </span>({cmsImages.length})
            </button>
            <button
              onClick={() => setUploadTab("url")}
              className={cn(
                "px-3 md:px-4 py-3 md:py-2 text-sm font-medium transition-colors flex-shrink-0 touch-manipulation min-h-[44px]",
                uploadTab === "url"
                  ? "border-b-2 border-black text-black"
                  : "text-gray-600 hover:text-black active:text-gray-800"
              )}
            >
              From URL
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            {uploadTab === "upload" && (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 md:p-12 text-center hover:border-gray-400 active:border-gray-500 transition-colors touch-manipulation"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onFileSelect}
                  className="hidden"
                />
                <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600 mb-2">
                  Drag and drop an image here, or
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="text-black font-medium hover:underline disabled:opacity-50"
                >
                  browse files
                </button>
                {uploading && (
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-gray-600">Uploading...</span>
                  </div>
                )}
              </div>
            )}

            {uploadTab === "cms" && (
              <div>
                {cmsImages.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No images found in CMS</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                    {cmsImages.map((img, i) => (
                      <div
                        key={i}
                        onClick={() => {
                          onInsert(img.url, img.alt || "CMS image");
                          onClose();
                        }}
                        className="relative aspect-video rounded-lg overflow-hidden bg-gray-100 cursor-pointer group hover:ring-2 hover:ring-black transition-all"
                      >
                        <img
                          src={img.url}
                          alt={img.alt}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs text-center p-2 bg-black/50 rounded">
                            {img.source}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {uploadTab === "url" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Image URL
                  </label>
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://example.com/image.jpg"
                    className="w-full px-4 py-3 md:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black text-base"
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => {
                      if (urlInput.trim()) {
                        onUrlUpload(urlInput.trim());
                      }
                    }}
                    disabled={!urlInput.trim() || uploading}
                    className="flex-1 bg-black text-white px-4 py-3 md:py-2 rounded-lg hover:bg-gray-800 active:bg-gray-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 touch-manipulation min-h-[44px]"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Uploading...</span>
                      </>
                    ) : (
                      "Upload & Insert"
                    )}
                  </button>
                  <button
                    onClick={() => {
                      if (urlInput.trim()) {
                        // Extract filename from URL for alt text
                        const urlParts = urlInput.trim().split('/');
                        const filename = urlParts[urlParts.length - 1].split('?')[0].replace(/\.[^/.]+$/, "") || "Image from URL";
                        onInsert(urlInput.trim(), filename);
                        onClose();
                      }
                    }}
                    disabled={!urlInput.trim()}
                    className="px-4 py-3 md:py-2 border border-gray-300 rounded-lg hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 transition-colors touch-manipulation min-h-[44px]"
                  >
                    Insert Directly
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

interface ImageEditModalProps {
  image: { src: string; alt: string };
  onClose: () => void;
  onReplace: (url: string) => void;
  onAltTextChange: (alt: string) => void;
  cmsImages: Array<{ url: string; alt: string; source: string }>;
}

function ImageEditModal({
  image,
  onClose,
  onReplace,
  onAltTextChange,
  cmsImages,
}: ImageEditModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [altText, setAltText] = useState(image.alt);
  const [replaceTab, setReplaceTab] = useState<"upload" | "cms" | "url">("cms");
  const [urlInput, setUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);
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

  const handleFileUploadLocal = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/images/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Upload failed");
      }
      const data = await res.json();
      onReplace(data.url);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to upload";
      setErrorModal({
        isOpen: true,
        title: "Failed to upload image",
        message: errorMessage,
        error: error,
        details: "Failed to upload image file to replace existing image.",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleUrlUploadLocal = async (url: string) => {
    if (!url.trim()) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("imageUrl", url.trim());
      const res = await fetch("/api/images/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Upload failed");
      }
      const data = await res.json();
      onReplace(data.url);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to upload";
      setErrorModal({
        isOpen: true,
        title: "Failed to upload image",
        message: errorMessage,
        error: error,
        details: `Failed to upload image from URL: ${url}`,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div 
          className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col mx-0 md:mx-4 h-full md:h-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold">Edit Image</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Current Image Preview */}
          <div className="p-4 border-b border-gray-200">
            <img 
              src={image.src} 
              alt={image.alt || "Preview"} 
              className="w-full max-h-48 object-contain rounded-lg bg-gray-50"
            />
          </div>

          {/* Alt Text Editor */}
          <div className="p-4 border-b border-gray-200">
            <label className="block text-sm font-medium mb-2">
              Alt Text
            </label>
            <textarea
              value={altText}
              onChange={(e) => {
                setAltText(e.target.value);
                onAltTextChange(e.target.value);
              }}
              placeholder="Describe this image for accessibility..."
              className="w-full px-4 py-3 md:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black min-h-[80px] resize-y text-base"
              rows={3}
            />
          </div>

          {/* Replace Image Section */}
          <div className="flex-1 overflow-y-auto p-4">
            <h3 className="text-sm font-semibold mb-3">Replace Image</h3>
            
            {/* Tabs */}
            <div className="flex border-b border-gray-200 mb-4 overflow-x-auto">
              <button
                onClick={() => setReplaceTab("upload")}
                className={cn(
                  "px-3 md:px-4 py-3 md:py-2 text-sm font-medium transition-colors flex-shrink-0 touch-manipulation min-h-[44px]",
                  replaceTab === "upload"
                    ? "border-b-2 border-black text-black"
                    : "text-gray-600 hover:text-black active:text-gray-800"
                )}
              >
                Upload
              </button>
              <button
                onClick={() => setReplaceTab("cms")}
                className={cn(
                  "px-3 md:px-4 py-3 md:py-2 text-sm font-medium transition-colors flex-shrink-0 touch-manipulation min-h-[44px]",
                  replaceTab === "cms"
                    ? "border-b-2 border-black text-black"
                    : "text-gray-600 hover:text-black active:text-gray-800"
                )}
              >
                <span className="hidden sm:inline">CMS Images </span>({cmsImages.length})
              </button>
              <button
                onClick={() => setReplaceTab("url")}
                className={cn(
                  "px-3 md:px-4 py-3 md:py-2 text-sm font-medium transition-colors flex-shrink-0 touch-manipulation min-h-[44px]",
                  replaceTab === "url"
                    ? "border-b-2 border-black text-black"
                    : "text-gray-600 hover:text-black active:text-gray-800"
                )}
              >
                From URL
              </button>
            </div>

            {/* Upload Tab */}
            {replaceTab === "upload" && (
              <div
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file && file.type.startsWith("image/")) {
                    handleFileUploadLocal(file);
                  }
                }}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 md:p-8 text-center hover:border-gray-400 active:border-gray-500 transition-colors touch-manipulation"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && file.type.startsWith("image/")) {
                      handleFileUploadLocal(file);
                    }
                  }}
                  className="hidden"
                />
                <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                <p className="text-gray-600 mb-2 text-sm">
                  Drag and drop or{" "}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-black font-medium hover:underline active:text-gray-700 touch-manipulation min-h-[44px] px-2"
                  >
                    browse files
                  </button>
                </p>
                {uploading && (
                  <div className="mt-2 flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-gray-600">Uploading...</span>
                  </div>
                )}
              </div>
            )}

            {/* CMS Images Tab */}
            {replaceTab === "cms" && (
              <div>
                {cmsImages.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    No images found in CMS
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
                    {cmsImages.map((img, i) => (
                      <div
                        key={i}
                        onClick={() => onReplace(img.url)}
                        className="relative aspect-video rounded-lg overflow-hidden bg-gray-100 cursor-pointer group hover:ring-2 hover:ring-black transition-all"
                      >
                        <img
                          src={img.url}
                          alt={img.alt}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* URL Tab */}
            {replaceTab === "url" && (
              <div className="space-y-3">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  className="w-full px-4 py-3 md:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black text-base"
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => {
                      if (urlInput.trim()) {
                        handleUrlUploadLocal(urlInput.trim());
                      }
                    }}
                    disabled={!urlInput.trim() || uploading}
                    className="flex-1 bg-black text-white px-4 py-3 md:py-2 rounded-lg hover:bg-gray-800 active:bg-gray-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 touch-manipulation min-h-[44px]"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Uploading...</span>
                      </>
                    ) : (
                      "Upload & Replace"
                    )}
                  </button>
                  <button
                    onClick={() => {
                      if (urlInput.trim()) {
                        onReplace(urlInput.trim());
                      }
                    }}
                    disabled={!urlInput.trim()}
                    className="px-4 py-3 md:py-2 border border-gray-300 rounded-lg hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 transition-colors touch-manipulation min-h-[44px]"
                  >
                    Replace Directly
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-gray-200 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-3 md:py-2 bg-black text-white rounded-lg hover:bg-gray-800 active:bg-gray-700 transition-colors touch-manipulation min-h-[44px] w-full"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {/* Error Modal */}
      <ErrorModal
        isOpen={errorModal.isOpen}
        onClose={() => setErrorModal({ ...errorModal, isOpen: false })}
        title={errorModal.title}
        message={errorModal.message}
        error={errorModal.error}
        details={errorModal.details}
      />
    </>
  );
}

function ToolbarButton({ 
  onClick, 
  active, 
  disabled, 
  icon, 
  title 
}: { 
  onClick: () => void; 
  active?: boolean; 
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      disabled={disabled}
      title={title}
      className={cn(
        "p-1.5 md:p-2 rounded-lg transition-colors disabled:opacity-30 touch-manipulation",
        "min-w-[36px] min-h-[36px] flex items-center justify-center",
        active 
          ? "bg-black text-white" 
          : "text-gray-600 hover:bg-gray-100 active:bg-gray-200"
      )}
    >
      {icon}
    </button>
  );
}
