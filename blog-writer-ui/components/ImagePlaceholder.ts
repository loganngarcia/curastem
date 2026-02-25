import { Node, mergeAttributes } from '@tiptap/core';

export const ImagePlaceholder = Node.create({
  name: 'imagePlaceholder',
  
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
  
  renderHTML({ HTMLAttributes }) {
    return [
      'p',
      mergeAttributes(HTMLAttributes, {
        class: 'image-placeholder',
        'data-h2-text': HTMLAttributes.h2Text,
        'data-image-prompt': HTMLAttributes.imagePrompt,
        style: 'width: 100%; aspect-ratio: 16/9; background-color: #f6f6f6; border-radius: 28px; display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 2rem 0; position: relative; cursor: pointer; min-height: 200px; padding: 1rem;',
      }),
      [
        'span',
        {
          style: 'font-size: 14px; color: #6b7280; margin-bottom: 12px; text-align: center; max-width: 80%;',
        },
        HTMLAttributes.imagePrompt || 'Image placeholder',
      ],
      [
        'button',
        {
          class: 'create-image-btn',
          style: 'background: black; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 500;',
        },
        'Create Image',
      ],
    ];
  },
  
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('p');
      dom.className = 'image-placeholder';
      dom.setAttribute('data-h2-text', node.attrs.h2Text);
      dom.setAttribute('data-image-prompt', node.attrs.imagePrompt);
      dom.style.cssText = 'width: 100%; aspect-ratio: 16/9; background-color: #f6f6f6; border-radius: 28px; display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 2rem 0; position: relative; cursor: pointer; min-height: 200px; padding: 1rem;';
      
      const promptSpan = document.createElement('span');
      promptSpan.style.cssText = 'font-size: 14px; color: #6b7280; margin-bottom: 12px; text-align: center; max-width: 80%;';
      promptSpan.textContent = node.attrs.imagePrompt || 'Image placeholder';
      
      const button = document.createElement('button');
      button.className = 'create-image-btn';
      button.style.cssText = 'background: black; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 500;';
      button.textContent = 'Create Image';
      
      dom.appendChild(promptSpan);
      dom.appendChild(button);
      
      return {
        dom,
      };
    };
  },
});
