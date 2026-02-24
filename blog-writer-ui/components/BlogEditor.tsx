"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Typography from "@tiptap/extension-typography";
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
  Loader2
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  onSave?: () => void;
  isSaving?: boolean;
  blogSlug?: string;
  coverImageUrl?: string;
  title?: string;
  onTitleChange?: (title: string) => void;
  onCoverImageReplace?: (newUrl: string) => void;
}

export default function BlogEditor({ content, onChange, onSave, isSaving, blogSlug, coverImageUrl, title, onTitleChange, onCoverImageReplace }: EditorProps) {
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
          if (target.tagName === "IMG") {
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
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  // Extract alt text from images in content when content changes
  useEffect(() => {
    if (editor && content) {
      // Parse HTML to extract image alt attributes
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, "text/html");
      const images = doc.querySelectorAll("img");
      // Alt text is already in the HTML, TipTap will preserve it
    }
  }, [content, editor]);

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
      insertImage(data.url);
      setIsImageModalOpen(false);
    } catch (error) {
      console.error("Upload error:", error);
      alert(error instanceof Error ? error.message : "Failed to upload image");
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
      insertImage(data.url);
      setIsImageModalOpen(false);
    } catch (error) {
      console.error("Upload error:", error);
      alert(error instanceof Error ? error.message : "Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const insertImage = (url: string) => {
    editor.chain().focus().setImage({ src: url }).run();
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
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-gray-200 p-1 md:p-2 flex items-center justify-between shadow-sm overflow-x-auto">
        <div className="flex items-center space-x-0.5 md:space-x-1 flex-shrink-0 min-w-0">
          {/* Heading Dropdown */}
          <div className="relative">
            <button
              ref={dropdownButtonRef}
              onClick={() => {
                if (!isMenuOpen && dropdownButtonRef.current) {
                  const rect = dropdownButtonRef.current.getBoundingClientRect();
                  setDropdownPosition({
                    top: rect.bottom + 4,
                    left: rect.left,
                  });
                }
                setIsMenuOpen(!isMenuOpen);
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
                  onClick={() => {
                    setIsMenuOpen(false);
                    setDropdownPosition(null);
                  }}
                />
                <div 
                  className="fixed w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-40 py-1 overflow-hidden animate-in fade-in slide-in-from-top-2"
                  style={{
                    top: `${dropdownPosition.top}px`,
                    left: `${dropdownPosition.left}px`,
                  }}
                >
                  <button
                    onClick={() => { editor.chain().focus().setParagraph().run(); setIsMenuOpen(false); setDropdownPosition(null); }}
                    className={cn(
                      "w-full text-left px-4 py-2 text-sm hover:bg-gray-50",
                      !editor.isActive("heading") && "bg-gray-50 font-semibold"
                    )}
                  >
                    Paragraph
                  </button>
                  {[1, 2, 3, 4, 5, 6].map((level) => (
                    <button
                      key={level}
                      onClick={() => { toggleHeading(level as any); setDropdownPosition(null); }}
                      className={cn(
                        "w-full text-left px-4 py-2 text-sm hover:bg-gray-50",
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
              onClick={() => setIsImageModalOpen(true)}
              active={editor.isActive("image")}
              icon={<ImageIcon className="h-4 w-4" />}
              title="Insert Image"
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

          <div className="h-6 w-[1px] bg-gray-200 mx-0.5 md:mx-1 flex-shrink-0" />

          {/* History */}
          <div className="flex items-center space-x-0.5">
            <ToolbarButton
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
              icon={<Undo className="h-4 w-4" />}
              title="Undo"
            />
            <ToolbarButton
              onClick={() => editor.chain().focus().redo().run()}
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
            disabled={isSaving}
            data-testid="save-button"
            className="flex items-center space-x-1 md:space-x-2 bg-black text-white px-3 md:px-4 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-all text-xs md:text-sm font-medium flex-shrink-0"
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
        <div className="max-w-4xl mx-auto p-3 md:p-8 w-full">
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
          
          {/* Cover Image - as inline image */}
          {coverImageUrl && (
            <div className="mb-8">
              <img 
                src={coverImageUrl} 
                alt="Cover" 
                className="w-full h-auto cursor-pointer"
                onClick={() => {
                  setSelectedImage({ src: coverImageUrl, alt: "Cover" });
                  setIsImageEditModalOpen(true);
                }}
              />
            </div>
          )}
          
          {/* Editor Content */}
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Image Edit Modal */}
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
  onInsert: (url: string) => void;
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
                          onInsert(img.url);
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
                        onInsert(urlInput.trim());
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
      alert(error instanceof Error ? error.message : "Failed to upload");
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
      alert(error instanceof Error ? error.message : "Failed to upload");
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
