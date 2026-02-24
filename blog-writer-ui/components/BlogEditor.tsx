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
  Redo
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  onSave?: () => void;
  isSaving?: boolean;
}

export default function BlogEditor({ content, onChange, onSave, isSaving }: EditorProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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
    },
  });

  // Update editor content if it changes externally (e.g. when switching blogs)
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  if (!editor) {
    return null;
  }

  const toggleHeading = (level: any) => {
    editor.chain().focus().toggleHeading({ level }).run();
    setIsMenuOpen(false);
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
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-gray-200 p-2 flex items-center justify-between shadow-sm">
        <div className="flex items-center space-x-1">
          {/* Heading Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="flex items-center space-x-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 text-sm font-medium transition-colors"
            >
              <span>{getCurrentHeading()}</span>
              <ChevronDown className="h-4 w-4" />
            </button>
            
            {isMenuOpen && (
              <>
                <div 
                  className="fixed inset-0 z-30" 
                  onClick={() => setIsMenuOpen(false)}
                />
                <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-40 py-1 overflow-hidden animate-in fade-in slide-in-from-top-2">
                  <button
                    onClick={() => { editor.chain().focus().setParagraph().run(); setIsMenuOpen(false); }}
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
                      onClick={() => toggleHeading(level as any)}
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

          <div className="h-6 w-[1px] bg-gray-200 mx-1" />

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

          <div className="h-6 w-[1px] bg-gray-200 mx-1" />

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
            className="flex items-center space-x-2 bg-black text-white px-4 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-all text-sm font-medium"
          >
            {isSaving ? (
              <span className="animate-spin">◌</span>
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span>{isSaving ? "Saving..." : "Save Changes"}</span>
          </button>
        )}
      </div>

      {/* Editor Content */}
      <div className="flex-1 p-8 overflow-y-auto bg-white">
        <div className="max-w-4xl mx-auto">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
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
        "p-2 rounded-lg transition-colors disabled:opacity-30",
        active 
          ? "bg-black text-white" 
          : "text-gray-600 hover:bg-gray-100"
      )}
    >
      {icon}
    </button>
  );
}
