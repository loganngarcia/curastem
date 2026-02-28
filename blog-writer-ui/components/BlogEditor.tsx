"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { Mark } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Typography from "@tiptap/extension-typography";
import { DOMParser as PMDOMParser, Slice } from "@tiptap/pm/model";
import { ImagePlaceholder } from "./ImagePlaceholder";
import { createPortal } from "react-dom";
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
  Download,
  Globe,
  Undo,
  Redo,
  Image as ImageIcon,
  Upload,
  X,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Pencil,
  AlertCircle,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { cn } from "@/lib/utils";
import ErrorModal from "./ErrorModal";
import { htmlWithInlineImages } from "@/lib/exportUtils";

export interface BlogEditorRef {
  /** Apply AI-generated find/replace edits as a ProseMirror transaction (supports undo/redo). Returns true if any edit was applied. */
  applyAIEdits: (operations: Array<{ find: string; replace: string }>) => boolean;
}

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  onSave?: () => void;
  isSaving?: boolean;
  saveJustCompleted?: boolean;
  saveFailed?: boolean;
  hasChanges?: boolean;
  blogSlug?: string;
  coverImageUrl?: string;
  title?: string;
  date?: string;
  onTitleChange?: (title: string) => void;
  onDateChange?: (date: string) => void;
  onCoverImageReplace?: (newUrl: string) => void;
  /** Called whenever the cover image alt text changes so the parent can persist it to CMS. */
  onCoverImageAltChange?: (newAlt: string) => void;
  /** Called when the user clicks the Edit button on an image. */
  onEditImage?: (imageUrl: string, imageAlt: string) => void;
  /** Called when the user clicks the close button to exit the editor. */
  onClose?: () => void;
  /** When true, bypass placeholder guards and skip the H2-placeholder injection effect */
  isStreaming?: boolean;
}

/**
 * Maps an H2 pull-quote to a short concrete subject phrase.
 * The image API already has style/quality instructions built in —
 * the subject just needs to be simple and specific, e.g. "person talking to boss".
 */
function generateFocusedImagePrompt(h2Text: string): string {
  const text = h2Text.toLowerCase();

  const topics: Array<[RegExp, string]> = [
    [/salary|pay\b|negoti|compens|earn|wage|income/i,  "person negotiating salary with manager"],
    [/job\b|hire|hired|interview|applicat/i,            "person in job interview"],
    [/shy|introvert|anxious|nervous|timid/i,            "shy person speaking up in a meeting"],
    [/communicat|speak|present|public|speech/i,         "person speaking on a microphone"],
    [/network|social|convers|connect/i,                 "two people having a conversation"],
    [/talk.*boss|boss|manag/i,                          "person talking to their boss"],
    [/graduate|school|college|degree|education/i,       "student receiving diploma"],
    [/career|advance|promot/i,                          "person getting promoted at work"],
    [/mentor|guide|coach/i,                             "mentor talking with a student"],
    [/support|help/i,                                   "person receiving support from a colleague"],
    [/practice|prepare|skill|train/i,                   "person practicing a skill at a desk"],
    [/team|together|collaborat/i,                       "two coworkers collaborating"],
    [/confident|strength|success|achieve/i,             "confident person standing at work"],
    [/barrier|obstacle|challenge|overcome/i,            "person breaking through a wall"],
    [/opportunit|door|path|future/i,                    "person walking through an open door"],
    [/research|data|study|evidence/i,                   "person reviewing data on a screen"],
    [/laptop|online|remote|digital|technolog/i,         "person on laptop at home office"],
    [/money|financ|saving|budget/i,                     "person reviewing finances on paper"],
    [/read|write|learn|book/i,                          "person reading at a desk"],
    [/phone|call/i,                                     "person on a phone call"],
  ];

  for (const [pattern, subject] of topics) {
    if (pattern.test(text)) return subject;
  }

  // Fallback: strip filler words and keep the first 3–4 content words as a subject
  const stop = new Set(['the','a','an','is','are','was','were','be','been','have','has','had','do','does','will','would','could','should','can','to','of','in','on','at','by','for','with','and','or','but','not','that','this','it','you','your','they','their','we','our','into','when','what','how','why','very','just','turn','turns','makes','make','clearly','often','key','real','most','more','than','never','always','every']);
  const words = text.replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stop.has(w));
  return words.slice(0, 4).join(' ') || "professional at work";
}

/** Mark for green highlight on AI-edited text (diffs) */
const AIEditHighlight = Mark.create({
  name: "aiEditHighlight",
  parseHTML() {
    return [
      { tag: "span.ai-diff-new" },
      { tag: "span", getAttrs: (node) => (node as HTMLElement).classList?.contains("ai-diff-new") ? {} : false },
    ];
  },
  renderHTML() {
    return ["span", { class: "ai-diff-new" }, 0];
  },
});

const BlogEditor = forwardRef<BlogEditorRef, EditorProps>(function BlogEditor({ content, onChange, onSave, isSaving, saveJustCompleted = false, saveFailed = false, hasChanges = true, blogSlug, coverImageUrl, title, date, onTitleChange, onDateChange, onCoverImageReplace, onCoverImageAltChange, onEditImage, onClose, isStreaming = false }: EditorProps, ref) {
  // Set-based tracking so multiple images can generate simultaneously
  const [generatingImages, setGeneratingImages] = useState<Set<string>>(new Set()); // h2Texts currently generating
  const [regeneratingImages, setRegeneratingImages] = useState<Set<string>>(new Set()); // imageUrls currently regenerating
  // Per-image countdown timers: key (h2Text or imageUrl) → seconds remaining
  const [imageTimers, setImageTimers] = useState<Map<string, number>>(new Map());
  const [imagePrompts, setImagePrompts] = useState<Record<string, string>>({}); // Store prompts for each image URL
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isImageEditModalOpen, setIsImageEditModalOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null);
  // Tracks the cover image alt text / prompt so user edits persist across regenerations
  const [coverImageAlt, setCoverImageAlt] = useState<string>(() =>
    title ? generateFocusedImagePrompt(title) : "professional at work"
  );
  const [isEditingCoverPrompt, setIsEditingCoverPrompt] = useState(false);
  const [cmsImages, setCmsImages] = useState<Array<{ url: string; alt: string; source: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadTab, setUploadTab] = useState<"upload" | "cms" | "url">("upload");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownButtonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const [isToolbarMenuOpen, setIsToolbarMenuOpen] = useState(false);
  const [toolbarMenuPosition, setToolbarMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const toolbarMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [downloadMenuPosition, setDownloadMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const downloadButtonRef = useRef<HTMLButtonElement>(null);
  const h2PlaceholdersProcessedRef = useRef<string>(""); // Track processed content to prevent infinite loops
  const isUpdatingFromEffectRef = useRef<boolean>(false); // Track if we're updating from an effect
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  // Dynamic overflow toolbar
  const toolbarRef = useRef<HTMLDivElement>(null);
  const titleTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [primaryCount, setPrimaryCount] = useState(9); // how many overflow-candidates to show inline
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
      AIEditHighlight,
      Link.configure({
        openOnClick: false,
      }),
      Image.extend({
        parseHTML() {
          return [
            {
              tag: 'img[src]',
              getAttrs: (element) => {
                if (typeof element === 'string') return false;
                if (element.closest('.regenerate-image-btn')) return false;
                return {};
              },
            },
          ];
        },
        renderHTML({ HTMLAttributes }) {
          const { 'data-tiptap-ignore': _, ...cleanAttrs } = HTMLAttributes;
          return ['img', cleanAttrs];
        },
        addNodeView() {
          return ({ node }) => {
            const wrapper = document.createElement("span");
            wrapper.className = "image-with-regenerate";
            wrapper.setAttribute("data-tiptap-ignore", "true");
            wrapper.style.cssText = "position: relative; display: block; width: fit-content; max-width: 100%; margin: 1rem 0;";

            const img = document.createElement("img");
            img.src = node.attrs.src;
            img.alt = node.attrs.alt || "";
            img.style.cssText = "border-radius: 0; display: block; max-width: 100%; height: auto; cursor: pointer;";
            img.className = "max-w-full h-auto rounded-lg cursor-pointer";
            wrapper.appendChild(img);

            // iOS-style button group — flex row anchored bottom-right
            const btnGroup = document.createElement("div");
            btnGroup.className = "image-btn-group";
            btnGroup.setAttribute("contenteditable", "false");
            btnGroup.setAttribute("data-tiptap-ignore", "true");
            btnGroup.style.cssText = "position: absolute; bottom: 12px; right: 12px; display: flex; flex-direction: row; gap: 6px; z-index: 20; pointer-events: auto;";

            const toolbarBtnStyle = "background: var(--cs-surface); color: var(--cs-text-primary); border: none; border-radius: 28px; padding: 8px 13px; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; font-family: Inter, system-ui, sans-serif; letter-spacing: 0.01em; transition: background 0.15s; user-select: none; -webkit-user-select: none;";

            // Edit button
            const editBtn = document.createElement("button");
            editBtn.className = "edit-image-btn";
            editBtn.type = "button";
            editBtn.setAttribute("contenteditable", "false");
            editBtn.setAttribute("data-tiptap-ignore", "true");
            editBtn.title = "Edit with AI";
            editBtn.style.cssText = toolbarBtnStyle;
            const pencilSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            pencilSvg.setAttribute("width", "12"); pencilSvg.setAttribute("height", "12"); pencilSvg.setAttribute("viewBox", "0 0 24 24");
            pencilSvg.setAttribute("fill", "none"); pencilSvg.setAttribute("stroke", "currentColor"); pencilSvg.setAttribute("stroke-width", "2");
            pencilSvg.setAttribute("stroke-linecap", "round"); pencilSvg.setAttribute("stroke-linejoin", "round");
            const pe1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
            pe1.setAttribute("d", "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7");
            const pe2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
            pe2.setAttribute("d", "M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z");
            pencilSvg.append(pe1, pe2);
            const editSpan = document.createElement("span");
            editSpan.textContent = "Edit";
            editBtn.append(pencilSvg, editSpan);

            (editBtn as any).__imageSrc = node.attrs.src;
            (editBtn as any).__imageAlt = node.attrs.alt || "";

            // Regenerate button
            const btn = document.createElement("button");
            btn.className = "regenerate-image-btn";
            btn.type = "button";
            btn.setAttribute("contenteditable", "false");
            btn.setAttribute("data-tiptap-ignore", "true");
            btn.style.cssText = toolbarBtnStyle;
            // RotateCcw icon (refresh)
            const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            iconSvg.setAttribute("width", "12"); iconSvg.setAttribute("height", "12"); iconSvg.setAttribute("viewBox", "0 0 24 24");
            iconSvg.setAttribute("fill", "none"); iconSvg.setAttribute("stroke", "currentColor"); iconSvg.setAttribute("stroke-width", "2");
            iconSvg.setAttribute("stroke-linecap", "round"); iconSvg.setAttribute("stroke-linejoin", "round");
            const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
            p1.setAttribute("d", "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8");
            const p2 = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            p2.setAttribute("points", "3 3 3 8 8 8");
            iconSvg.append(p1, p2);
            const textSpan = document.createElement("span");
            textSpan.textContent = "Regenerate";
            btn.append(iconSvg, textSpan);

            btnGroup.appendChild(editBtn);
            btnGroup.appendChild(btn);
            wrapper.appendChild(btnGroup);

            (btn as any).__textSpan = textSpan;
            (btn as any).__imageSrc = node.attrs.src;

            return { dom: wrapper, ignoreMutation: () => true };
          };
        },
      }).configure({
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
      // Skip if we're updating from an effect to prevent infinite loops
      if (isUpdatingFromEffectRef.current) return;
      
      // TipTap's getHTML() reads from the document model, not DOM
      // Buttons added to DOM shouldn't be serialized, but let's be safe
      const html = editor.getHTML();
      // Use DOMParser to safely remove button elements if they somehow got serialized
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      doc.querySelectorAll('.regenerate-image-btn, button.regenerate-image-btn').forEach(btn => btn.remove());
      // Also remove any stray "Regenerate" text that might have been serialized
      const body = doc.body;
      if (body) {
        // Walk through text nodes and remove standalone "Regenerate" text
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        let node;
        while (node = walker.nextNode()) {
          if (node.textContent?.trim() === 'Regenerate' || node.textContent?.trim().startsWith('Regenerate ')) {
            textNodes.push(node as Text);
          }
        }
        textNodes.forEach(textNode => {
          if (textNode.parentElement && !textNode.parentElement.closest('.regenerate-image-btn')) {
            textNode.remove();
          }
        });
      }
      onChange(body ? body.innerHTML : html);
    },
    editorProps: {
      attributes: {
        class: "prose prose-lg max-w-none focus:outline-none min-h-[500px] pb-32",
      },
      handleDOMEvents: {
        click: (view, event) => {
          const target = event.target as HTMLElement;
          
          // Handle inline prompt editing — click on prompt span to edit in-place
          if (target.classList.contains("placeholder-prompt-span")) {
            event.preventDefault();
            const placeholder = target.closest(".image-placeholder") as HTMLElement;
            if (!placeholder) return false;
            const h2Text = placeholder.getAttribute("data-h2-text") || "";
            const currentPrompt = target.textContent || "";

            const input = document.createElement("input");
            input.type = "text";
            input.value = currentPrompt;
            input.style.cssText = "font-size: 14px; color: #374151; text-align: center; background: rgba(255,255,255,0.9); border: 1px solid #6b7280; border-radius: 6px; padding: 4px 8px; outline: none; width: 80%; max-width: 80%; margin-bottom: 12px;";
            target.parentNode?.replaceChild(input, target);
            input.focus();
            input.select();

            const savePrompt = () => {
              const newPrompt = input.value.trim() || currentPrompt;
              const newSpan = document.createElement("span");
              newSpan.className = "placeholder-prompt-span";
              newSpan.setAttribute("contenteditable", "false");
              newSpan.style.cssText = "font-size: 14px; color: #6b7280; margin-bottom: 12px; text-align: center; max-width: 80%; cursor: text; transition: color 0.15s;";
              newSpan.title = "Click to edit image prompt";
              newSpan.textContent = newPrompt;
              input.parentNode?.replaceChild(newSpan, input);
              // Update TipTap node attribute so the new prompt is used when generating
              if (editor) {
                const { state } = editor;
                const { tr } = state;
                state.doc.descendants((node, pos) => {
                  if (node.type.name === "imagePlaceholder" && node.attrs.h2Text === h2Text) {
                    tr.setNodeMarkup(pos, undefined, { ...node.attrs, imagePrompt: newPrompt });
                    return false;
                  }
                });
                if (tr.steps.length > 0) editor.view.dispatch(tr);
              }
              placeholder.setAttribute("data-image-prompt", newPrompt);
            };

            input.addEventListener("keydown", (e) => {
              if (e.key === "Enter") { e.preventDefault(); savePrompt(); }
              if (e.key === "Escape") {
                const origSpan = document.createElement("span");
                origSpan.className = "placeholder-prompt-span";
                origSpan.setAttribute("contenteditable", "false");
                origSpan.style.cssText = "font-size: 14px; color: #6b7280; margin-bottom: 12px; text-align: center; max-width: 80%; cursor: text; transition: color 0.15s;";
                origSpan.title = "Click to edit image prompt";
                origSpan.textContent = currentPrompt;
                input.parentNode?.replaceChild(origSpan, input);
              }
            });
            input.addEventListener("blur", savePrompt);
            return true;
          }

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
          
          // Handle edit-image button clicks — opens image in chat input for AI editing
          if (target.classList.contains("edit-image-btn") || target.closest(".edit-image-btn")) {
            event.preventDefault();
            event.stopPropagation();
            const button = (target.classList.contains("edit-image-btn") ? target : target.closest(".edit-image-btn")) as HTMLElement;
            const imgContainer = button?.closest(".image-with-regenerate") as HTMLElement;
            const img = imgContainer?.querySelector("img") as HTMLImageElement;
            if (img && onEditImage) {
              onEditImage(img.getAttribute("src") || "", img.getAttribute("alt") || "");
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

  // Expose applyAIEdits to parent — applies find/replace operations as undoable ProseMirror transactions
  useImperativeHandle(ref, () => ({
    applyAIEdits(operations) {
      if (!editor) return false;

      const wrapWithGreenHighlight = (replace: string): string => {
        if (!replace.trim()) return replace;
        // Wrap inner content in span.ai-diff-new so the Mark is preserved by ProseMirror
        const match = replace.match(/^(<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>)([\s\S]*?)(<\/\2>)$/);
        if (match) {
          const [, openTag, , , content, closeTag] = match;
          return `${openTag}<span class="ai-diff-new">${content}</span>${closeTag}`;
        }
        return `<span class="ai-diff-new">${replace}</span>`;
      };

      let html = editor.getHTML();
      let changed = false;

      for (const op of operations) {
        if (op.find && html.includes(op.find)) {
          html = html.split(op.find).join(wrapWithGreenHighlight(op.replace));
          changed = true;
        }
      }

      if (!changed) return false;

      const container = document.createElement("div");
      container.innerHTML = html;
      const parsedDoc = PMDOMParser.fromSchema(editor.schema).parse(container);

      const { state, view } = editor;
      const tr = state.tr.replace(0, state.doc.content.size, new Slice(parsedDoc.content, 0, 0));
      view.dispatch(tr);
      return true;
    },
  }), [editor]);

  // Measure toolbar width and compute how many overflow-candidate buttons fit inline.
  // Reserve plenty for the right pill (Download + Close) so it never gets pushed off screen.
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;

    const compute = () => {
      const W = el.getBoundingClientRect().width;
      const gap = 4;
      const btnWithGap = 40 + gap;
      // Left pill fixed overhead: heading (160px) + undo (44px) + redo (44px) + overflow ⋯ (44px) + pill padding (8px)
      const leftPillOverhead = 160 + 44 + 44 + 44 + 8;
      // Right pill: download (40) + close (40) + pill padding (8) + gap between pills (8)
      const rightReserved = 40 + 40 + 8 + 8;
      const reserved = leftPillOverhead + rightReserved;
      const available = Math.max(0, W - reserved);
      const count = Math.floor(available / btnWithGap);
      setPrimaryCount(Math.max(0, count));
    };

    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => ro.disconnect();
  }, [editor]);

  // Update editor content if it changes externally (e.g. when switching blogs or streaming)
  useEffect(() => {
    if (!editor) return;
    
    const currentEditorContent = editor.getHTML();
    const normalizedContent = content.trim();
    const normalizedEditorContent = currentEditorContent.trim();

    if (normalizedContent === normalizedEditorContent) return;

    if (isStreaming) {
      // During streaming: always sync, skip placeholder guard (placeholders are added after done)
      editor.commands.setContent(content, { emitUpdate: false });
      return;
    }
    
    // Non-streaming: don't overwrite editor-injected placeholders with raw content
    const editorHasPlaceholders = normalizedEditorContent.includes('data-type="imagePlaceholder"') || normalizedEditorContent.includes('image-placeholder');
    const contentHasPlaceholders = normalizedContent.includes('data-type="imagePlaceholder"') || normalizedContent.includes('image-placeholder');
    if (editorHasPlaceholders && !contentHasPlaceholders && normalizedContent.length > 0) {
      return;
    }
    
    // Reset processed ref when content changes externally (e.g., switching blogs)
    h2PlaceholdersProcessedRef.current = "";
    const { from, to } = editor.state.selection;
    editor.commands.setContent(content, { emitUpdate: false });
    try {
      const docSize = editor.state.doc.content.size;
      if (from <= docSize && to <= docSize) {
        editor.commands.setTextSelection({ from: Math.min(from, docSize), to: Math.min(to, docSize) });
      }
    } catch {
      // Selection may be invalid after content change
    }
  }, [content, editor, isStreaming]);

  // Ensure H2 placeholders are added for existing blogs (only once per content, debounced)
  // Skipped during streaming — placeholders are injected once streaming finishes
  useEffect(() => {
    if (!editor || !content || isStreaming) return;
    
    const currentContent = editor.getHTML();
    
    // Skip if we've already processed this exact content
    if (h2PlaceholdersProcessedRef.current === currentContent) return;
    
    // Skip if content is empty or just whitespace
    if (!currentContent.trim()) {
      h2PlaceholdersProcessedRef.current = currentContent;
      return;
    }
    
    // Debounce to prevent rapid re-runs
    const timeoutId = setTimeout(() => {
      // Double-check we haven't processed this content while waiting
      const checkContent = editor.getHTML();
      if (h2PlaceholdersProcessedRef.current === checkContent) return;
      const h2Regex = /<h2[^>]*>(.*?)<\/h2>/gi;
      const h2Matches = Array.from(checkContent.matchAll(h2Regex));
      
      // If no H2s found, mark as processed and return
      if (h2Matches.length === 0) {
        h2PlaceholdersProcessedRef.current = currentContent;
        return;
      }

      // Safety: never add more placeholders than H2s (prevents spamming from effect re-runs)
      const existingPlaceholderCount = (checkContent.match(/class="image-placeholder"/g) || []).length;
      if (existingPlaceholderCount >= h2Matches.length) {
        h2PlaceholdersProcessedRef.current = checkContent;
        return;
      }

      let contentUpdated = false;
      let updatedContent = checkContent;
      const insertedH2Texts = new Set<string>(); // Only one placeholder per unique H2 text

      // Process in reverse order to maintain positions
      for (let i = h2Matches.length - 1; i >= 0; i--) {
        const match = h2Matches[i];
        if (!match || match.index === undefined) continue;

        const h2Text = match[1].replace(/<[^>]*>/g, '').trim();
        if (insertedH2Texts.has(h2Text)) continue; // Skip duplicate H2 headings
        const insertPosition = match.index;

        // Check if there's already an image or placeholder before this H2 (within 300 chars)
        const beforeH2 = updatedContent.slice(Math.max(0, insertPosition - 300), insertPosition);
        if (beforeH2.includes('<img') || beforeH2.includes('image-placeholder') || beforeH2.includes('data-type="imagePlaceholder"')) {
          continue; // Skip if image/placeholder already exists
        }

        insertedH2Texts.add(h2Text);

        // Generate focused single-scene prompt (not the raw H2 pull-quote)
        const imagePrompt = generateFocusedImagePrompt(h2Text);
        
        // Create placeholder HTML - just the node marker, TipTap will render it properly
        // The ImagePlaceholder extension's parseHTML looks for p[data-type="imagePlaceholder"] or p.image-placeholder
        const placeholderHtml = `<p class="image-placeholder" data-type="imagePlaceholder" data-h2-text="${h2Text.replace(/"/g, '&quot;')}" data-image-prompt="${imagePrompt.replace(/"/g, '&quot;')}"></p>`;
        
        // Insert placeholder before the H2
        updatedContent = 
          updatedContent.slice(0, insertPosition) +
          placeholderHtml +
          updatedContent.slice(insertPosition);
        
        contentUpdated = true;
      }
      
      // Update content if placeholders were added
      if (contentUpdated && updatedContent !== checkContent) {
        h2PlaceholdersProcessedRef.current = updatedContent;
        // Mark that we're updating from an effect to prevent onUpdate from triggering
        isUpdatingFromEffectRef.current = true;
        try {
          editor.commands.setContent(updatedContent, { emitUpdate: false });
          // CRITICAL: Sync parent so content sync effect doesn't overwrite and cause a loop
          onChange(updatedContent);
        } finally {
          setTimeout(() => {
            isUpdatingFromEffectRef.current = false;
          }, 100);
        }
      } else {
        // Mark as processed even if no changes were made
        h2PlaceholdersProcessedRef.current = checkContent;
      }
    }, 300); // 300ms debounce
    
    return () => clearTimeout(timeoutId);
  }, [editor, content, onChange, isStreaming]);

  // Keep TipTap DOM buttons in sync with generating/regenerating state + per-image timers
  useEffect(() => {
    if (!editor) return;

    const editorElement = editor.view.dom;

    // Placeholder "Create Image" buttons
    editorElement.querySelectorAll(".create-image-btn").forEach((btn) => {
      const placeholder = btn.closest(".image-placeholder") as HTMLElement;
      if (!placeholder) return;
      const h2Text = placeholder.getAttribute("data-h2-text") || "";
      const isGenerating = generatingImages.has(h2Text);
      if (isGenerating) {
        const secs = imageTimers.get(h2Text);
        const label = secs && secs > 0 ? `Generating... ${secs}s` : "Generating...";
        if (btn.textContent !== label) btn.textContent = label;
        (btn as HTMLButtonElement).disabled = true;
      } else {
        const label = h2Text === "Cover Image" ? "Create Cover Image" : "Create Image";
        if (btn.textContent !== label) btn.textContent = label;
        (btn as HTMLButtonElement).disabled = false;
      }
    });

    // Regenerate buttons inside TipTap NodeViews
    editorElement.querySelectorAll(".regenerate-image-btn").forEach((btn) => {
      let textSpan: HTMLElement | null = (btn as any).__textSpan || btn.querySelector("span");
      if (!textSpan) return;
      (btn as any).__textSpan = textSpan;

      let src: string = (btn as any).__imageSrc || "";
      if (!src) {
        const img = btn.closest(".image-with-regenerate")?.querySelector("img");
        src = img?.getAttribute("src") || "";
        (btn as any).__imageSrc = src;
      }

      const isRegenerating = regeneratingImages.has(src);
      if (isRegenerating) {
        const secs = imageTimers.get(src);
        textSpan.textContent = secs && secs > 0 ? ` ${secs}s` : " Regenerating...";
      } else {
        textSpan.textContent = " Regenerate";
      }
      (btn as HTMLButtonElement).disabled = isRegenerating;
    });
  }, [editor, generatingImages, regeneratingImages, imageTimers, coverImageUrl]);

  // Fetch CMS images when either modal opens
  useEffect(() => {
    if (isImageModalOpen || isImageEditModalOpen) {
      fetchCmsImages();
    }
  }, [isImageModalOpen, isImageEditModalOpen, blogSlug]);

  // Resize title textarea when title prop changes (e.g. switching blogs)
  useEffect(() => {
    const el = titleTextareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const h = Math.min(el.scrollHeight, 200);
    el.style.height = `${h}px`;
  }, [title]);

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

  /** Start a 35-second countdown for the given key, updating imageTimers every second. */
  const startImageTimer = (key: string) => {
    setImageTimers(prev => new Map(prev).set(key, 35));
    const interval = setInterval(() => {
      setImageTimers(prev => {
        const next = new Map(prev);
        const remaining = (next.get(key) ?? 0) - 1;
        if (remaining <= 0) { next.delete(key); clearInterval(interval); }
        else next.set(key, remaining);
        return next;
      });
    }, 1000);
    return interval;
  };

  const handleRegenerateImage = async (currentImageUrl: string, currentAlt: string) => {
    if (!editor || regeneratingImages.has(currentImageUrl)) return;

    setRegeneratingImages(prev => new Set([...prev, currentImageUrl]));
    const timerInterval = startImageTimer(currentImageUrl);
    try {
      const imagePrompt = currentAlt || "professional illustration";
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: imagePrompt, aspect: "16:9", imageSize: "1K" }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to regenerate image");
      }
      const data = await res.json();
      const newImageUrl = data.url;

      const currentContent = editor.getHTML();
      const escapedUrl = currentImageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const imagePattern = new RegExp(`(<p[^>]*>)?<img[^>]+src=["']${escapedUrl}["'][^>]*>(</p>)?`, 'gi');
      const wrappedHtml = `<p dir="auto" class="image-with-regenerate"><img src="${newImageUrl}" alt="${currentAlt}" style="border-radius: 28px;"></p>`;
      editor.commands.setContent(currentContent.replace(imagePattern, wrappedHtml));
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
      clearInterval(timerInterval);
      setImageTimers(prev => { const m = new Map(prev); m.delete(currentImageUrl); return m; });
      setRegeneratingImages(prev => { const s = new Set(prev); s.delete(currentImageUrl); return s; });
    }
  };

  const handleCreatePlaceholderImage = async (h2Text: string, placeholderElement: HTMLElement) => {
    if (!editor || generatingImages.has(h2Text)) return;

    setGeneratingImages(prev => new Set([...prev, h2Text]));
    const timerInterval = startImageTimer(h2Text);
    try {
      // Use focused single-scene prompt instead of raw H2 text
      const storedPrompt = placeholderElement.getAttribute("data-image-prompt");
      const imagePrompt = (storedPrompt && !storedPrompt.startsWith("professional illustration representing"))
        ? storedPrompt
        : generateFocusedImagePrompt(h2Text);

      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: imagePrompt, aspect: "16:9", imageSize: "1K" }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to generate image");
      }
      const data = await res.json();
      const imageUrl = data.url;
      setImagePrompts(prev => ({ ...prev, [imageUrl]: imagePrompt }));

      // Replace placeholder node with real image
      const { state } = editor;
      const { tr } = state;
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'imagePlaceholder' && node.attrs.h2Text === h2Text) {
          const imageNode = state.schema.nodes.paragraph.create(
            { class: "image-with-regenerate" },
            state.schema.nodes.image.create({ src: imageUrl, alt: imagePrompt, style: "border-radius: 28px;" })
          );
          tr.replaceWith(pos, pos + node.nodeSize, imageNode);
          return false;
        }
      });
      if (tr.steps.length > 0) {
        editor.view.dispatch(tr);
      } else {
        // Fallback HTML replace
        const currentContent = editor.getHTML();
        const placeholderPattern = new RegExp(
          `<p[^>]*class="image-placeholder"[^>]*data-h2-text="${h2Text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>.*?</p>`,
          'gs'
        );
        editor.commands.setContent(currentContent.replace(
          placeholderPattern,
          `<p dir="auto" class="image-with-regenerate"><img src="${imageUrl}" alt="${imagePrompt}" style="border-radius: 28px;"></p>`
        ));
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
      clearInterval(timerInterval);
      setImageTimers(prev => { const m = new Map(prev); m.delete(h2Text); return m; });
      setGeneratingImages(prev => { const s = new Set(prev); s.delete(h2Text); return s; });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      handleFileUpload(file);
    }
  };

  const handleDownload = useCallback(
    async (format: "pdf" | "docx") => {
      if (format === "pdf") {
        const htmlContent = await htmlWithInlineImages(content);
        const header = `<html><head><meta charset='utf-8'><title>${(title || "Blog").replace(/</g, "&lt;")}</title><style>@page{size:8.5in 11in;margin:0.5in;}body{margin:0;padding:0;font-family:Inter,sans-serif;font-size:14pt;line-height:1.6;}h1{font-size:28px;font-weight:700;}h2{font-size:22px;font-weight:700;border-bottom:1px solid #ddd;margin-top:1.5em;}h3{font-size:18px;font-weight:600;}img{max-width:100%;height:auto;}</style></head><body>`;
        const titleBlock = title ? `<h1>${title.replace(/</g, "&lt;")}</h1>` : "";
        const dateBlock = date ? `<p style="color:#666;font-size:12pt;">${date.replace(/</g, "&lt;")}</p>` : "";
        const footer = "</body></html>";
        const sourceHTML = header + titleBlock + dateBlock + htmlContent + footer;
        const iframe = document.createElement("iframe");
        iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
        document.body.appendChild(iframe);
        const doc = iframe.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(sourceHTML);
          doc.close();
          setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            setTimeout(() => document.body.removeChild(iframe), 1000);
          }, 250);
        }
      } else if (format === "docx") {
        try {
          const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType } = await import("docx");
          const { fetchImageAsBuffer } = await import("@/lib/exportUtils");
          const parser = new DOMParser();
          const docEl = parser.parseFromString(content, "text/html");
          const docxChildren: unknown[] = [];
          const getRuns = (nodes: NodeListOf<ChildNode>, opts: { bold?: boolean; size?: number } = {}): InstanceType<typeof TextRun>[] => {
            const runs: InstanceType<typeof TextRun>[] = [];
            nodes.forEach((node) => {
              if (node.nodeType === Node.TEXT_NODE && node.textContent) {
                runs.push(new TextRun({ text: node.textContent, bold: opts.bold, size: opts.size ?? 24 }));
              } else if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as HTMLElement;
                if (el.tagName === "STRONG" || el.tagName === "B") {
                  getRuns(el.childNodes, { ...opts, bold: true }).forEach((r) => runs.push(r));
                } else if (el.tagName === "EM" || el.tagName === "I") {
                  getRuns(el.childNodes, opts).forEach((r) => runs.push(r));
                } else if (el.tagName === "IMG") {
                  runs.push(new TextRun({ text: "[Image]", break: 1 }));
                } else {
                  getRuns(el.childNodes, opts).forEach((r) => runs.push(r));
                }
              }
            });
            return runs;
          };
          for (const node of Array.from(docEl.body.childNodes)) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const el = node as HTMLElement;
            if (el.tagName === "H1") {
              docxChildren.push(new Paragraph({ children: getRuns(el.childNodes, { size: 32 }), heading: HeadingLevel.TITLE }));
            } else if (el.tagName === "H2") {
              docxChildren.push(new Paragraph({ children: getRuns(el.childNodes), heading: HeadingLevel.HEADING_1 }));
            } else if (el.tagName === "H3") {
              docxChildren.push(new Paragraph({ children: getRuns(el.childNodes), heading: HeadingLevel.HEADING_2 }));
            } else if (el.tagName === "IMG") {
              const src = el.getAttribute("src");
              if (src) {
                const img = await fetchImageAsBuffer(src);
                if (img) docxChildren.push(new Paragraph({ children: [new ImageRun({ data: img.buffer, type: img.type, transformation: { width: img.width, height: img.height } })], alignment: AlignmentType.CENTER }));
              }
            } else {
              const runs = getRuns(el.childNodes);
              if (runs.length) docxChildren.push(new Paragraph({ children: runs }));
            }
          }
          const doc = new Document({
            sections: [{ properties: {}, children: docxChildren.filter(Boolean) as InstanceType<typeof Paragraph>[] }],
          });
          const blob = await Packer.toBlob(doc);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${(title || "blog").replace(/[^a-z0-9]/gi, "-")}.docx`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (err) {
          console.error("DOCX export failed:", err);
          setErrorModal({
            isOpen: true,
            title: "Export failed",
            message: err instanceof Error ? err.message : "Failed to export DOCX",
            error: err,
          });
        }
      }
      setShowDownloadMenu(false);
    },
    [content, title, date]
  );

  if (!editor) {
    return null;
  }

  const setHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    editor.chain().focus().setHeading({ level }).run();
    setIsMenuOpen(false);
    setDropdownPosition(null);
  };

  const setParagraph = () => {
    editor.chain().focus().setParagraph().run();
    setIsMenuOpen(false);
    setDropdownPosition(null);
  };

  // Human-readable labels for the dropdown (full descriptions)
  const HEADING_LABELS: Record<number, string> = {
    1: "Title (H1)",
    2: "Pull Quote (H2)",
    3: "Section Header (H3)",
    4: "Heading 4",
    5: "Heading 5",
    6: "Heading 6",
  };

  // Short label shown in the toolbar button (P / H1 / H2 / H3 / …)
  const getButtonLabel = () => {
    for (let level = 1; level <= 6; level++) {
      if (editor.isActive("heading", { level })) return `H${level}`;
    }
    return "Paragraph";
  };

  // Full aria/title label
  const getCurrentHeading = () => {
    for (let level = 1; level <= 6; level++) {
      if (editor.isActive("heading", { level })) return HEADING_LABELS[level];
    }
    return "Paragraph";
  };

  // Overflow-candidate items in display priority order (show first = hide last).
  // Heading, Undo, Redo are always visible and handled separately.
  const overflowCandidates = [
    { id: "image",       icon: ImageIcon,      title: "Insert Image",  active: false,                           disabled: false, action: () => setIsImageModalOpen(true) },
    { id: "link",        icon: LinkIcon,       title: "Link",          active: editor.isActive("link"),         disabled: false, action: () => { const u = window.prompt("Enter URL"); if (u) editor.chain().focus().setLink({ href: u }).run(); else if (u === "") editor.chain().focus().unsetLink().run(); } },
    { id: "bulletList",  icon: List,           title: "Bullet List",   active: editor.isActive("bulletList"),   disabled: false, action: () => editor.chain().focus().toggleBulletList().run() },
    { id: "orderedList", icon: ListOrdered,    title: "Numbered List", active: editor.isActive("orderedList"),  disabled: false, action: () => editor.chain().focus().toggleOrderedList().run() },
    { id: "bold",        icon: Bold,           title: "Bold",          active: editor.isActive("bold"),         disabled: false, action: () => editor.chain().focus().toggleBold().run() },
    { id: "italic",      icon: Italic,         title: "Italic",        active: editor.isActive("italic"),       disabled: false, action: () => editor.chain().focus().toggleItalic().run() },
    { id: "underline",   icon: UnderlineIcon,  title: "Underline",     active: editor.isActive("underline"),    disabled: false, action: () => editor.chain().focus().toggleUnderline().run() },
    { id: "quote",       icon: Quote,          title: "Quote",         active: editor.isActive("blockquote"),   disabled: false, action: () => editor.chain().focus().toggleBlockquote().run() },
    { id: "code",        icon: Code,           title: "Code",          active: editor.isActive("code"),         disabled: false, action: () => editor.chain().focus().toggleCode().run() },
  ];

  const primaryItems = overflowCandidates.slice(0, primaryCount);
  const overflowItems = overflowCandidates.slice(primaryCount);
  const hasOverflow = overflowItems.length > 0;

  return (
    <div className="flex flex-col w-full h-full relative">
      {/* Toolbar — floats above content, never takes layout space */}
      <div
        ref={toolbarRef}
        className="absolute top-3 left-3 right-3 flex items-start justify-between"
        style={{ zIndex: 9999, gap: 8 }}
      >
        {/* Left pill — formatting, always visible */}
        <div
          className="flex items-center flex-shrink-0"
          style={{
            height: 40,
            background: "var(--cs-surface)",
            borderRadius: 28,
            gap: 4,
            paddingLeft: 4,
            paddingRight: 4,
          }}
        >
          {/* Heading dropdown — Curastem-style 40×40 */}
          <div className="relative flex-shrink-0">
            <button
              ref={dropdownButtonRef}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!isMenuOpen && dropdownButtonRef.current) {
                  const rect = dropdownButtonRef.current.getBoundingClientRect();
                  const dropdownWidth = 216;
                  const vw = window.innerWidth;
                  let left = rect.left;
                  if (left + dropdownWidth > vw - 8) left = vw - dropdownWidth - 8;
                  if (left < 8) left = 8;
                  setDropdownPosition({ top: rect.bottom + 6, left });
                  setIsMenuOpen(true);
                } else {
                  setIsMenuOpen(false);
                  setDropdownPosition(null);
                }
              }}
              aria-label={`Block type: ${getCurrentHeading()}`}
              aria-expanded={isMenuOpen}
              title={getCurrentHeading()}
              className="flex items-center justify-center gap-1 flex-shrink-0 transition-colors touch-manipulation whitespace-nowrap"
              style={{
                height: 40,
                paddingLeft: 10,
                paddingRight: 6,
                borderRadius: 28,
                background: isMenuOpen ? "var(--cs-hover-default)" : "transparent",
                color: "var(--cs-text-primary)",
                fontSize: 13,
                fontFamily: "Inter, system-ui, sans-serif",
              }}
              onMouseEnter={(e) => { if (!isMenuOpen) e.currentTarget.style.background = "var(--cs-hover-default)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = isMenuOpen ? "var(--cs-hover-default)" : "transparent"; }}
            >
              <span style={{ fontFamily: "Inter", fontWeight: 500 }}>{getButtonLabel()}</span>
              <ChevronDown className={cn("h-3 w-3 flex-shrink-0 transition-transform duration-150", isMenuOpen && "rotate-180")} />
            </button>

            {isMenuOpen && dropdownPosition && typeof document !== "undefined" && createPortal(
              <>
                <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => { setIsMenuOpen(false); setDropdownPosition(null); }} />
                <div
                  style={{
                    position: "fixed",
                    top: dropdownPosition.top,
                    left: dropdownPosition.left,
                    width: 200,
                    zIndex: 9999,
                    padding: 10,
                    background: "var(--cs-surface-menu)",
                    boxShadow: "0px 4px 24px hsla(0, 0%, 0%, 0.08)",
                    borderRadius: 28,
                    outline: "0.33px solid hsla(0, 0%, 0%, 0.2)",
                    outlineOffset: "-0.33px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Paragraph */}
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); setParagraph(); }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 12px",
                      borderRadius: 20,
                      fontSize: 14,
                      fontFamily: "Inter",
                      fontWeight: !editor.isActive("heading") ? 600 : 400,
                      color: "var(--cs-text-primary)",
                      background: !editor.isActive("heading") ? "var(--cs-hover-default)" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cs-hover-medium)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = !editor.isActive("heading") ? "var(--cs-hover-default)" : "transparent"; }}
                  >
                    <span>Paragraph</span>
                    {!editor.isActive("heading") && <span style={{ fontSize: 11, fontWeight: 400, color: "var(--cs-text-secondary)" }}>current</span>}
                  </button>
                  <div style={{ height: 1, background: "hsla(0,0%,0%,0.08)", margin: "2px 4px" }} />
                  {([2, 3, 1, 4, 5, 6] as const).map((level) => {
                    const isActive = editor.isActive("heading", { level });
                    return (
                      <button
                        key={level}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); setHeading(level); }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "8px 12px",
                          borderRadius: 20,
                          fontSize: 14,
                          fontFamily: "Inter",
                          fontWeight: isActive ? 600 : 400,
                          color: "var(--cs-text-primary)",
                          background: isActive ? "var(--cs-hover-default)" : "transparent",
                          border: "none",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cs-hover-medium)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? "var(--cs-hover-default)" : "transparent"; }}
                      >
                        <span>{HEADING_LABELS[level]}</span>
                        {isActive && <span style={{ fontSize: 11, fontWeight: 400, color: "var(--cs-text-secondary)" }}>current</span>}
                      </button>
                    );
                  })}
                </div>
              </>,
              document.body
            )}
          </div>

          {/* Undo / Redo — always visible */}
          <ToolbarButton onClick={() => editor.chain().focus().undo().run()} active={false} disabled={!editor.can().undo()} icon={<Undo className="h-4 w-4" style={{ color: "inherit" }} />} title="Undo" />
          <ToolbarButton onClick={() => editor.chain().focus().redo().run()} active={false} disabled={!editor.can().redo()} icon={<Redo className="h-4 w-4" style={{ color: "inherit" }} />} title="Redo" />

          {/* Dynamic items — hide last when space is tight */}
          {primaryItems.map((item) => (
            <ToolbarButton
              key={item.id}
              onClick={item.action}
              active={item.active}
              disabled={item.disabled}
              icon={<item.icon className="h-4 w-4" style={{ color: "inherit" }} />}
              title={item.title}
            />
          ))}

          {/* Overflow ⋯ — Curastem 40×40 when candidates hidden */}
          {hasOverflow && (
            <button
              ref={toolbarMenuButtonRef}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!isToolbarMenuOpen && toolbarMenuButtonRef.current) {
                  const rect = toolbarMenuButtonRef.current.getBoundingClientRect();
                  const vw = window.innerWidth;
                  const menuW = 192;
                  let left = rect.left;
                  if (left + menuW > vw - 8) left = vw - menuW - 8;
                  if (left < 8) left = 8;
                  setToolbarMenuPosition({ top: rect.bottom + 6, left });
                }
                setIsToolbarMenuOpen(prev => !prev);
              }}
              className="flex items-center justify-center flex-shrink-0 transition-colors touch-manipulation"
              style={{
                width: 40,
                height: 40,
                borderRadius: 28,
                background: isToolbarMenuOpen ? "var(--cs-hover-default)" : "transparent",
                color: "var(--cs-text-primary)",
              }}
              aria-label="More formatting options"
              title="More options"
              onMouseEnter={(e) => { if (!isToolbarMenuOpen) e.currentTarget.style.background = "var(--cs-hover-default)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = isToolbarMenuOpen ? "var(--cs-hover-default)" : "transparent"; }}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          )}

          {/* Overflow menu portal */}
          {isToolbarMenuOpen && toolbarMenuPosition && typeof document !== "undefined" && createPortal(
            <>
              <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => { setIsToolbarMenuOpen(false); setToolbarMenuPosition(null); }} />
              <div
                style={{
                  position: "fixed",
                  top: toolbarMenuPosition.top,
                  left: toolbarMenuPosition.left,
                  width: 192,
                  zIndex: 9999,
                  padding: 10,
                  background: "var(--cs-surface-menu)",
                  boxShadow: "0px 4px 24px hsla(0, 0%, 0%, 0.08)",
                  borderRadius: 28,
                  outline: "0.33px solid hsla(0, 0%, 0%, 0.2)",
                  outlineOffset: "-0.33px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {overflowItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      item.action();
                      setIsToolbarMenuOpen(false);
                      setToolbarMenuPosition(null);
                    }}
                    disabled={item.disabled}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 12px",
                      borderRadius: 20,
                      fontSize: 14,
                      fontFamily: "Inter",
                      color: item.disabled ? "var(--cs-text-secondary)" : "var(--cs-text-primary)",
                      background: item.active ? "var(--cs-hover-default)" : "transparent",
                      opacity: item.disabled ? 0.5 : 1,
                      border: "none",
                      cursor: item.disabled ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                    onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = "var(--cs-hover-medium)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = item.active ? "var(--cs-hover-default)" : "transparent"; }}
                  >
                    <item.icon className="h-4 w-4 flex-shrink-0" style={{ color: "var(--cs-text-secondary)" }} />
                    <span>{item.title}</span>
                  </button>
                ))}
              </div>
            </>,
            document.body
          )}
        </div>

        {/* Right pill — Download + Close (matches DocEditor HeaderActions) */}
        <div
          className="flex items-center flex-shrink-0"
          style={{
            height: 40,
            paddingLeft: 4,
            paddingRight: 4,
            background: "var(--cs-surface)",
            borderRadius: 28,
            gap: 0,
          }}
        >
          {/* Download */}
          <div className="relative flex-shrink-0">
            <button
              ref={downloadButtonRef}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!showDownloadMenu && downloadButtonRef.current) {
                  const rect = downloadButtonRef.current.getBoundingClientRect();
                  const vw = window.innerWidth;
                  const menuW = 128;
                  let left = rect.left;
                  if (left + menuW > vw - 8) left = vw - menuW - 8;
                  if (left < 8) left = 8;
                  setDownloadMenuPosition({ top: rect.bottom + 6, left });
                }
                setShowDownloadMenu((prev) => !prev);
              }}
              aria-label="Download"
              title="Download as PDF or DOCX"
              className="flex items-center justify-center transition-colors touch-manipulation"
              style={{
                width: 40,
                height: 40,
                borderRadius: 28,
                background: showDownloadMenu ? "var(--cs-hover-default)" : "transparent",
                color: "var(--cs-text-primary)",
              }}
              onMouseEnter={(e) => { if (!showDownloadMenu) e.currentTarget.style.background = "var(--cs-hover-default)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = showDownloadMenu ? "var(--cs-hover-default)" : "transparent"; }}
            >
              <Download className="h-4 w-4" style={{ color: "var(--cs-text-primary)" }} aria-hidden />
            </button>
          </div>
          {showDownloadMenu && downloadMenuPosition && typeof document !== "undefined" && createPortal(
            <>
              <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => { setShowDownloadMenu(false); setDownloadMenuPosition(null); }} />
              <div
                style={{
                  position: "fixed",
                  top: downloadMenuPosition.top,
                  left: downloadMenuPosition.left,
                  width: 140,
                  padding: 10,
                  background: "var(--cs-surface-menu)",
                  boxShadow: "0px 4px 24px hsla(0, 0%, 0%, 0.08)",
                  borderRadius: 28,
                  outline: "0.33px solid hsla(0, 0%, 0%, 0.2)",
                  outlineOffset: "-0.33px",
                  zIndex: 9999,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ padding: "4px 12px", fontSize: 12, fontFamily: "Inter", fontWeight: 500, color: "var(--cs-text-secondary)", lineHeight: "16px" }}>
                  Save as
                </div>
                {[
                  { label: ".pdf", format: "pdf" as const },
                  { label: ".docx", format: "docx" as const },
                ].map(({ label, format }) => (
                  <button
                    key={format}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { handleDownload(format); setShowDownloadMenu(false); setDownloadMenuPosition(null); }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 12px",
                      borderRadius: 20,
                      fontSize: 14,
                      fontFamily: "Inter",
                      fontWeight: 400,
                      color: "var(--cs-text-primary)",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cs-hover-medium)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>,
            document.body
          )}

          {/* Close */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close editor"
              data-label="close-editor-button"
              className="flex items-center justify-center transition-colors touch-manipulation flex-shrink-0"
              style={{
                width: 40,
                height: 40,
                borderRadius: 28,
                background: "transparent",
                color: "var(--cs-text-primary)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cs-hover-default)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M11.1016 0.599998L0.601562 11.1M0.601562 0.599998L11.1016 11.1"
                  stroke="var(--cs-text-primary)"
                  strokeOpacity="0.95"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>

      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-y-auto bg-white" style={{ minHeight: 0 }}>
        <div className="w-full mx-auto px-3 pb-3 pt-[80px] md:px-8 md:pb-8 md:pt-[88px] max-w-4xl">
          {/* Title — textarea so long titles wrap instead of clipping */}
          {title !== undefined && (
            <textarea
              value={title}
              onChange={(e) => {
                onTitleChange?.(e.target.value);
                // Auto-resize: collapse first so scrollHeight reflects content, not parent
                const ta = e.target;
                ta.style.height = "0px";
                const h = Math.min(ta.scrollHeight, 200);
                ta.style.height = `${h}px`;
              }}
              ref={(el) => {
                titleTextareaRef.current = el;
                if (el) {
                  el.style.height = "0px";
                  const h = Math.min(el.scrollHeight, 200);
                  el.style.height = `${h}px`;
                }
              }}
              rows={1}
              className="text-2xl md:text-4xl font-bold mb-4 md:mb-6 w-full bg-transparent border-none outline-none focus:outline-none p-0 resize-none overflow-hidden leading-tight"
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
                 data-image-prompt={coverImageAlt}
                 style={{ width: '100%', aspectRatio: '16/9', backgroundColor: '#f6f6f6', borderRadius: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: '2rem 0', position: 'relative', cursor: 'default', minHeight: '200px', padding: '1rem' }}
              >
                {isEditingCoverPrompt ? (
                  <input
                    autoFocus
                    type="text"
                    defaultValue={coverImageAlt}
                    onBlur={(e) => { const v = e.target.value.trim() || coverImageAlt; setCoverImageAlt(v); onCoverImageAltChange?.(v); setIsEditingCoverPrompt(false); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { const v = e.currentTarget.value.trim() || coverImageAlt; setCoverImageAlt(v); onCoverImageAltChange?.(v); setIsEditingCoverPrompt(false); }
                      if (e.key === "Escape") setIsEditingCoverPrompt(false);
                    }}
                    style={{ fontSize: '14px', color: '#374151', marginBottom: '12px', textAlign: 'center', width: '80%', background: 'rgba(255,255,255,0.9)', border: '1px solid #6b7280', borderRadius: '6px', padding: '4px 8px', outline: 'none' }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    title="Click to edit image prompt"
                    onClick={(e) => { e.stopPropagation(); setIsEditingCoverPrompt(true); }}
                    style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px', textAlign: 'center', maxWidth: '80%', cursor: 'text' }}
                  >
                    {coverImageAlt}
                  </span>
                )}
                <button 
                  className="create-image-btn" 
                  style={{ background: 'black', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', fontSize: '14px', cursor: 'pointer', fontWeight: '500' }}
                  onClick={async () => {
                    if (generatingImages.has("Cover Image")) return;
                    setGeneratingImages(prev => new Set([...prev, "Cover Image"]));
                    const coverTimerInterval = startImageTimer("Cover Image");
                    try {
                      const imagePrompt = coverImageAlt || generateFocusedImagePrompt(title);
                      const res = await fetch("/api/images/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ subject: imagePrompt, aspect: "16:9", imageSize: "2K" }),
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
                      clearInterval(coverTimerInterval);
                      setImageTimers(prev => { const m = new Map(prev); m.delete("Cover Image"); return m; });
                      setGeneratingImages(prev => { const s = new Set(prev); s.delete("Cover Image"); return s; });
                    }
                  }}
                  disabled={generatingImages.has("Cover Image")}
                >
                  {generatingImages.has("Cover Image")
                    ? (imageTimers.get("Cover Image") ? `Generating... ${imageTimers.get("Cover Image")}s` : "Generating...")
                    : "Create Cover Image"}
                </button>
              </p>
            </div>
          )}
          
          {/* Cover Image - as inline image */}
          {coverImageUrl && (
            <div className="mb-8 relative image-with-regenerate" style={{ position: 'relative' }}>
              <img 
                src={coverImageUrl} 
                alt={coverImageAlt}
                className="w-full h-auto cursor-pointer"
                style={{ borderRadius: '0px', display: 'block' }}
                onClick={() => {
                  setSelectedImage({ src: coverImageUrl, alt: coverImageAlt });
                  setIsImageEditModalOpen(true);
                }}
              />
              {/* iOS-style button group — same flex row as inline images */}
              <div style={{
                position: 'absolute', bottom: '12px', right: '12px',
                display: 'flex', flexDirection: 'row', gap: '6px', zIndex: 20,
              }}>
              {onEditImage && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onEditImage(coverImageUrl, coverImageAlt);
                  }}
                  className="edit-image-btn"
                  style={{
                    background: 'var(--cs-surface)',
                    color: 'var(--cs-text-primary)',
                    border: 'none',
                    borderRadius: '28px',
                    padding: '8px 13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '12px',
                    fontWeight: '500',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    letterSpacing: '0.01em',
                    transition: 'background 0.15s',
                  }}
                >
                  <Pencil className="h-3 w-3" />
                  <span>Edit</span>
                </button>
              )}
              <button
                className="regenerate-image-btn"
                type="button"
                disabled={regeneratingImages.has(coverImageUrl ?? "")}
                style={{
                  background: 'var(--cs-surface)',
                  color: 'var(--cs-text-primary)',
                  border: 'none',
                  borderRadius: '28px',
                  padding: '8px 13px',
                  cursor: regeneratingImages.has(coverImageUrl ?? "") ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '12px',
                  fontWeight: '500',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  letterSpacing: '0.01em',
                  transition: 'background 0.15s',
                  opacity: regeneratingImages.has(coverImageUrl ?? "") ? 0.6 : 1,
                  pointerEvents: 'auto',
                }}
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (regeneratingImages.has(coverImageUrl ?? "") || !onCoverImageReplace) return;
                  setRegeneratingImages(prev => new Set([...prev, coverImageUrl ?? ""]));
                  const regenCoverKey = coverImageUrl ?? "";
                  const regenCoverTimer = startImageTimer(regenCoverKey);
                  try {
                    const imagePrompt = coverImageAlt || "professional at work";
                    const res = await fetch("/api/images/generate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ subject: imagePrompt, aspect: "16:9", imageSize: "2K" }),
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
                    clearInterval(regenCoverTimer);
                    setImageTimers(prev => { const m = new Map(prev); m.delete(regenCoverKey); return m; });
                    setRegeneratingImages(prev => { const s = new Set(prev); s.delete(regenCoverKey); return s; });
                  }
                }}
              >
                <RotateCcw className="h-3 w-3" />
                <span>{regeneratingImages.has(coverImageUrl ?? "")
                  ? (imageTimers.get(coverImageUrl ?? "") ? `${imageTimers.get(coverImageUrl ?? "")}s` : "Regenerating...")
                  : "Regenerate"}</span>
              </button>
              </div>{/* end button group */}
            </div>
          )}
          
          {/* Editor Content */}
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Publish — fixed bottom-left, floats above content (no layout space / margin) */}
      {onSave && (hasChanges || saveFailed || saveJustCompleted) && (
        <div
          className="absolute bottom-3 right-3 md:bottom-4 md:right-4 flex items-center"
          style={{ zIndex: 9999, pointerEvents: "auto" }}
        >
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || (!hasChanges && !saveFailed)}
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
            ) : isSaving ? (
              <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
            ) : (
              <Globe className="h-4 w-4 flex-shrink-0" />
            )}
            <span data-testid="save-button-text" className="whitespace-nowrap">
              {saveJustCompleted ? "Published!" : saveFailed ? "Retry" : isSaving ? "Publishing…" : "Publish"}
            </span>
          </button>
        </div>
      )}

      {/* Error Modal — portaled to body to escape the BlogEditor stacking context */}
      {typeof document !== "undefined" && createPortal(
        <ErrorModal
          isOpen={errorModal.isOpen}
          onClose={() => setErrorModal({ ...errorModal, isOpen: false })}
          title={errorModal.title}
          message={errorModal.message}
          error={errorModal.error}
          details={errorModal.details}
        />,
        document.body
      )}

      {/* Image Edit Modal — portaled to body so it renders above the sidebar */}
      {isImageEditModalOpen && selectedImage && typeof document !== "undefined" && createPortal(
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
            if (!selectedImage) return;
            // Cover image: stored in React state and propagated to parent
            if (selectedImage.src === coverImageUrl) {
              setCoverImageAlt(newAlt);
              onCoverImageAltChange?.(newAlt);
              setSelectedImage({ ...selectedImage, alt: newAlt });
              return;
            }
            // Inline image: update TipTap node attrs
            if (editor) {
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
        />,
        document.body
      )}

      {/* Image Styles */}
      <style jsx global>{`
        .ProseMirror .ai-diff-new {
          background: rgba(34, 197, 94, 0.4) !important;
          border-radius: 3px;
          padding: 0 2px;
          box-decoration-break: clone;
        }
        .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 0;
          margin: 1rem 0;
          display: block;
          cursor: pointer;
        }
        .ProseMirror img.ProseMirror-selectednode {
          outline: 2px solid #000;
          outline-offset: 2px;
        }
        .ProseMirror .image-with-regenerate {
          position: relative;
          margin: 1rem 0;
        }
        /* Edit + Regenerate — Curastem toolbar colors (inline images + cover) */
        .edit-image-btn,
        .regenerate-image-btn {
          background: var(--cs-surface);
          color: var(--cs-text-primary);
          border: none;
          border-radius: 28px;
          padding: 8px 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          font-weight: 500;
          font-family: Inter, system-ui, sans-serif;
          letter-spacing: 0.01em;
          transition: background 0.15s;
          pointer-events: auto;
        }
        .edit-image-btn:hover,
        .regenerate-image-btn:hover:not(:disabled) {
          background: var(--cs-hover-default) !important;
        }
        .regenerate-image-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .ProseMirror .image-placeholder {
          width: 100%;
          aspect-ratio: 16/9;
          background-color: #f6f6f6;
          border-radius: 28px;
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
          background-color: #f6f6f6 !important;
          border-radius: 28px;
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
      {/* Image Insert Modal — portaled to body so it renders above the sidebar */}
      {isImageModalOpen && typeof document !== "undefined" && createPortal(
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
        />,
        document.body
      )}
    </div>
  );
});

export default BlogEditor;

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
        className="fixed inset-0 bg-black/50 flex items-center justify-center p-0 md:p-4"
        style={{ zIndex: 20000 }}
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
        className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
        style={{ zIndex: 20000 }}
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

/** Curastem-style toolbar button — 40×40, borderRadius 28, hover.default */
function ToolbarButton({
  onClick,
  active,
  disabled,
  icon,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className="flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-30 touch-manipulation cursor-pointer border-none outline-none"
      style={{
        width: 40,
        height: 40,
        borderRadius: 28,
        background: active ? "var(--cs-hover-default)" : "transparent",
        color: "var(--cs-text-primary)",
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active) e.currentTarget.style.background = "var(--cs-hover-default)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? "var(--cs-hover-default)" : "transparent";
      }}
    >
      {icon}
    </button>
  );
}
