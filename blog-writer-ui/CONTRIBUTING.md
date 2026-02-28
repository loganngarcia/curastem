# Contributing to Curastem Blog Writer

## Why This Exists

Every day, people with important stories to tell—educators, mentors, advocates—spend hours wrestling with content management systems, hunting for stock photos, and formatting text just to share knowledge that could change someone's life. That time should be spent on the story itself, not the technical friction.

This tool exists because **writing should feel like writing, not like data entry**. It's built for teams who want to focus on impact, not infrastructure. When someone has an idea that could help a student graduate or guide someone toward their first job, they shouldn't have to become a web developer to publish it.

We're building this in the open because we believe that **good tools should be accessible**. If you've ever felt frustrated by bloated CMS interfaces or wished you could just "talk" to your website, you understand why this matters. Every contribution—whether it's fixing a bug, improving the UI, or adding a feature—makes it easier for more people to share their knowledge with the world.

---

## What's Happening Here

This is a **Next.js 15** application that acts as an intelligent layer between human creativity and the Framer CMS. It combines:

- **AI-powered content generation** (via Google Gemini) to turn ideas into structured blog posts
- **Automated image creation** using AI to generate brand-consistent visuals
- **Rich text editing** for final human refinement
- **Direct CMS integration** to sync everything to Framer without manual copy-pasting

The entire flow—from "I want to write about X" to "published on the website"—happens in minutes instead of hours.

---

## How to Maintain This

### Development Setup

1. **Clone and Install**:
   ```bash
   git clone <repo-url>
   cd blog-writer-ui
   npm install
   ```

2. **Environment Variables**:
   Copy `.env.example` to `.env.local` and fill in your credentials:
   - `FRAMER_PROJECT_URL` - Your Framer project URL
   - `FRAMER_API_KEY` - Framer API token
   - `FRAMER_BLOG_COLLECTION` - Name of your blog collection (defaults to "Services")
   - `AUTH_PASSWORD` - Password for the login gate
   - `SESSION_SECRET` - Random string for JWT signing (generate with `openssl rand -hex 32`)

3. **Run Locally**:
   ```bash
   npm run dev
   ```
   Visit `http://localhost:3000` and log in with your password.

4. **Deploy**:
   The project is configured for Vercel. Push to your main branch and Vercel will auto-deploy. Make sure all environment variables are set in the Vercel dashboard.

### Key Maintenance Tasks

- **Monitor API Rate Limits**: Both Gemini and Framer APIs have rate limits. The code includes delays and error handling, but watch for 429 errors in production logs.
- **Update Dependencies**: Run `npm audit` regularly and update packages when security patches are released.
- **Test Framer Field Changes**: If your Framer collection structure changes (new fields, renamed fields), update `lib/framer.ts` accordingly.
- **Review Error Logs**: Check Vercel function logs for any recurring errors, especially around image generation or Framer sync.

---

## File Structure & Why Things Are The Way They Are

This structure reflects the decisions we've made so far, but **we're always open to improvements**. If you see a better way to organize things, we'd love to hear it.

```
blog-writer-ui/
├── app/                          # Next.js 15 App Router
│   ├── api/                      # API routes (backend logic)
│   │   ├── auth/                 # Authentication endpoints
│   │   ├── blogs/                # Blog CRUD operations
│   │   ├── chat/                 # AI chat streaming endpoint
│   │   └── settings/             # Settings management
│   ├── chat/                     # Main chat interface page
│   ├── login/                    # Login page
│   ├── layout.tsx                # Root layout (includes robots meta)
│   └── globals.css               # Global styles
│
├── components/                   # Reusable React components
│   ├── BlogEditor.tsx            # Rich text editor (Tiptap)
│   └── SettingsModal.tsx        # Settings overlay modal
│
├── lib/                          # Core business logic
│   ├── framer.ts                 # Framer API client & CMS operations
│   ├── gemini.ts                 # Google Gemini API client for AI generation
│   ├── blog-generator.ts         # Blog content generation logic
│   ├── auth.ts                   # JWT authentication utilities
│   ├── api-utils.ts              # Shared API helpers
│   └── utils.ts                  # General utilities (cn, formatDate, etc.)
│
├── middleware.ts                 # Next.js middleware for auth protection
├── public/                       # Static assets
│   └── robots.txt                # Crawler blocking rules
│
└── Configuration files
    ├── next.config.ts            # Next.js config
    ├── tailwind.config.ts        # Tailwind CSS configuration
    ├── tsconfig.json             # TypeScript configuration
    └── package.json              # Dependencies & scripts
```

### Why This Structure?

**`app/` directory**: Next.js 15 uses the App Router, which groups routes and API endpoints together. This makes it easy to see what's public (`/api/`) vs. what's protected (everything else).

**`lib/` directory**: We separate "how we talk to external services" (Framer, Gemini) from "what we do with that data" (blog generation). This makes it easier to swap out APIs or add new integrations without touching the core logic.

**`components/` directory**: These are reusable UI pieces. The `BlogEditor` uses Tiptap for rich text editing, which gives us full control over formatting without relying on a third-party service.

**`middleware.ts`**: This runs on every request before the page loads. It's the perfect place to check authentication, which is why it lives at the root level—it protects everything.

**Why TypeScript?**: Type safety catches bugs before they hit production. When you're dealing with API responses that can change shape, TypeScript helps ensure we handle all cases.

**Why Tailwind?**: Fast iteration. The UI uses utility classes, so we can tweak spacing, colors, and layouts without hunting through CSS files. The `rounded-[28px]` pattern you'll see everywhere? That's intentional—consistent corner radius creates visual harmony.

---

## Areas We'd Love Help With

We're not perfect, and we know it. Here are areas where contributions would make a huge difference:

- **Error Handling**: Right now, errors are logged but could be more user-friendly. If an image generation fails, can we retry automatically? Can we show better error messages?
- **Performance**: Blog creation involves multiple API calls. Can we parallelize more? Cache responses? Optimize the streaming?
- **Accessibility**: We use semantic HTML, but could the rich text editor be more keyboard-navigable? Are screen readers properly supported?
- **Testing**: We don't have automated tests yet. Adding tests for the Framer integration or the blog generation logic would prevent regressions.
- **Documentation**: The code has comments, but could we add JSDoc to functions? Could we create a "How It Works" diagram?
- **UI/UX Improvements**: Is the chat interface intuitive? Could the blog list be more searchable? Does the editor feel smooth?

---

## How to Contribute

1. **Fork the repo** and create a branch for your changes.
2. **Make your changes** with clear, descriptive commit messages.
3. **Test locally** to ensure everything works with your own API keys.
4. **Open a Pull Request** explaining what you changed and why.

We welcome contributions of all sizes—from fixing typos to adding features. The only thing we ask is that you:
- Keep the code readable (clear variable names, comments where needed)
- Follow the existing patterns (but feel free to suggest better ones!)
- Test your changes before submitting

---

## Questions?

If you're unsure about something or want to discuss a big change before implementing it, feel free to open an issue. We're here to help, and collaboration makes everything better.

Thank you for taking the time to contribute. Every improvement makes it easier for someone, somewhere, to share their story.
