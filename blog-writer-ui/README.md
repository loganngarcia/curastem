# Curastem Blog Writer

A high-performance internal tool designed to help teams research, draft, and publish high-quality blogs to a Framer CMS in minutes instead of hours.

## What This Does

This tool acts as an intelligent bridge between your ideas and your website. It combines AI-powered content generation with direct Framer CMS integration, allowing you to:

- Turn a simple topic into a structured, SEO-optimized blog post
- Automatically generate brand-consistent images
- Edit content in a familiar rich-text editor
- Publish directly to Framer CMS with one click

## Access & Getting Started

**📍 Hosted at:** [https://curastemblogs.vercel.app](https://curastemblogs.vercel.app)

**🔐 Need Access?** This is a protected internal tool. To create and edit blogs, please contact:

**sally@curastem.org**

Once you have access, you can start using the tool immediately.

## Quick Start

1. **Brainstorm**: Use the chat bar to describe what you want to write about.
2. **Review & Refine**: Watch the live preview as the content is built. You can ask the AI to change the tone or add more detail.
3. **Direct Edit**: Use the built-in editor to make final manual tweaks to title, content, and images.
4. **Publish**: Once satisfied, hit "Save Changes" to sync directly to Framer CMS.

**Having Issues?** Contact **sally@curastem.org** for help with access, bugs, or questions about the publishing flow.

## Use Cases

- **Rapid Drafting**: Turn a simple topic or a few bullet points into a structured, SEO-optimized blog post with proper headings and flow.
- **Visual Content Creation**: Automatically generate brand-consistent vector illustrations for every section of your blog.
- **Content Refresh**: Quickly update existing blogs with new information or improved formatting.
- **One-Click Publishing**: Sync your finished work directly to the Framer CMS, complete with cover images, headlines, and metadata.

## Why It's Internal

This tool is designed as an **internal team tool**, not a public-facing application:

- **Security & Access Control**: Protected by authentication; only authorized team members can access
- **API Keys Stay Private**: Your Framer API keys are server-side only, never exposed to clients
- **Team-Focused Workflow**: All team members work within the same Framer CMS collection
- **Cost Efficiency**: Shared resources, no per-user costs, simple deployment

**Want to use it?** Just ask! Contact **sally@curastem.org** to get access.

## Running Your Own Instance

If you want to run your own instance of this tool, you will need to provide your own API keys:

### Requirements

1. **Google Gemini API**: For AI text and image generation
2. **Framer API**: For CMS integration
3. **Auth**: A custom password and session secret for the login gate

### Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Run development server
npm run dev

# Build for production
npm run build
```

See `.env.example` for the required variables.

## Technical Details

### Tech Stack

- **Next.js 15** - React framework with App Router
- **Tiptap** - Rich text editor for blog content
- **Google Gemini** - AI text generation and image generation
- **Framer API** - Direct CMS integration for publishing
- **Vercel** - Hosting and deployment
- **Tailwind CSS** - Styling and responsive design

### Architecture Decisions

**Why Serverless Functions?**
- Perfect for internal tools with sporadic usage
- No server management or scaling concerns
- Pay-per-use model (free tier covers our needs)

**Why Direct CMS Integration?**
- No intermediate database needed
- Single source of truth (Framer CMS)
- Real-time updates visible immediately

**Why Google Gemini?**
- Cost-effective AI generation
- Supports both text and image generation
- Easy to integrate via Google AI SDK

## Hosting: Vercel Free Tier

This tool is hosted on **Vercel's Free (Hobby) Tier**, which is perfect for our use case.

### Free Tier Limitations

- **10-second timeout** for serverless functions
- **100GB bandwidth** per month
- **100 hours** of execution time per month
- Automatic deployments from Git (unlimited)
- Preview deployments for every branch/PR

### Why These Limitations Work Perfectly for Us

**Small Internal Tool = Perfect Fit:**

1. **Low Traffic Volume**
   - Internal tools typically see 10-50 requests per day, not thousands
   - Free tier bandwidth (100GB/month) is more than sufficient
   - Execution time (100 hours/month) easily covers our needs

2. **Short-Lived Operations**
   - Blog creation takes 1-3 minutes (well under 10-second timeout per API call)
   - Image uploads are quick (< 5 seconds)
   - CMS updates are instant (< 2 seconds)
   - We break long operations into multiple API calls, each under the timeout

3. **Predictable Usage Patterns**
   - Team members use the tool during work hours
   - No sudden traffic spikes or viral growth
   - Usage is consistent and manageable

4. **Cost-Effective for Internal Tools**
   - **$0/month** hosting cost
   - No need for paid tiers until we outgrow free tier (unlikely for internal use)
   - All budget goes to API costs (Gemini), not infrastructure

5. **Easy Maintenance**
   - Automatic deployments from Git
   - Preview deployments for testing
   - No server management or scaling concerns

### When We'd Need to Upgrade

We'd consider upgrading to Vercel Pro if:
- We exceed 100GB bandwidth/month (would require ~3,000 blog creations/day)
- We need longer function timeouts (unlikely with our architecture)
- We need team collaboration features (already handled by Git + Framer CMS)
- We want advanced analytics (not needed for internal tools)

**Current Status:** Free tier handles our needs perfectly. No upgrade planned.

---

*An Open Source Project by Curastem*
