import { Node, mergeAttributes } from '@tiptap/core';

export const ImagePlaceholder = Node.create({
  name: 'imagePlaceholder',

  /** Higher than default (50) so we parse before paragraph and render as imagePlaceholder node */
  priority: 1000,

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      h2Text: {
        default: '',
      },
      imagePrompt: {
        default: '',
      },
    };
  },
  
  parseHTML() {
    return [
      {
        tag: 'p[data-type="imagePlaceholder"]',
        priority: 60, // Higher than default paragraph (50) so we parse first
        getAttrs: (node) => {
          if (typeof node === 'string') return false;
          const el = node as HTMLElement;
          return {
            h2Text: el.getAttribute('data-h2-text') || '',
            imagePrompt: el.getAttribute('data-image-prompt') || '',
          };
        },
      },
      {
        tag: 'p.image-placeholder',
        priority: 60,
        getAttrs: (node) => {
          if (typeof node === 'string') return false;
          const el = node as HTMLElement;
          return {
            h2Text: el.getAttribute('data-h2-text') || '',
            imagePrompt: el.getAttribute('data-image-prompt') || '',
          };
        },
      },
    ];
  },
  
  // Serialize to minimal HTML - NO text content. The NodeView renders the full UI.
  // Including span/button here would add "professional illustration..." and "Create Image" to saved blog content.
  renderHTML({ HTMLAttributes }) {
    return [
      'p',
      mergeAttributes(HTMLAttributes, {
        class: 'image-placeholder',
        'data-type': 'imagePlaceholder',
        'data-h2-text': HTMLAttributes.h2Text,
        'data-image-prompt': HTMLAttributes.imagePrompt,
      }),
    ];
  },
  
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('p');
      dom.className = 'image-placeholder';
      dom.setAttribute('data-type', 'imagePlaceholder');
      dom.setAttribute('data-h2-text', node.attrs.h2Text);
      dom.setAttribute('data-image-prompt', node.attrs.imagePrompt);
      dom.setAttribute('contenteditable', 'false');
      dom.style.cssText = 'width: 100%; aspect-ratio: 16/9; background-color: #f6f6f6; border-radius: 28px; display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 2rem 0; position: relative; cursor: pointer; min-height: 200px; padding: 1rem;';
      
      const promptSpan = document.createElement('span');
      promptSpan.className = 'placeholder-prompt-span';
      promptSpan.setAttribute('contenteditable', 'false');
      promptSpan.style.cssText = 'font-size: 14px; color: #6b7280; margin-bottom: 12px; text-align: center; max-width: 80%; cursor: text; transition: color 0.15s;';
      promptSpan.title = 'Click to edit image prompt';
      promptSpan.textContent = node.attrs.imagePrompt || 'Image placeholder';
      
      const button = document.createElement('button');
      button.className = 'create-image-btn';
      button.setAttribute('contenteditable', 'false');
      button.setAttribute('data-tiptap-ignore', 'true');
      button.style.cssText = 'background: black; color: white; border: none; display: flex; align-items: center; justify-content: center; height: 40px; padding-left: 16px; padding-right: 16px; border-radius: 28px; font-size: 14px; cursor: pointer; font-weight: 500;';
      button.textContent = 'Create Image';
      
      dom.appendChild(promptSpan);
      dom.appendChild(button);
      
      return {
        dom,
        // Ignore mutations inside our custom DOM (button text updates during generation)
        // so ProseMirror doesn't try to reconcile and cause glitches
        ignoreMutation: () => true,
      };
    };
  },
});
