# Contributing to Curastem

**Thank you for wanting to contribute!** Every contribution helps make mentorship more accessible to students who need it. Whether you're fixing a bug, improving accessibility, adding a feature, or improving documentation — you're part of something bigger.

---

## Getting Started

If you're contributing, the process is similar to other open source repos: fork the repo, make your changes, test them, and submit a PR. If you have any questions or would like help getting started, reach out by opening an issue or emailing us at [help@curastem.org](mailto:help@curastem.org).

---

## Where to Start

### 1. **Find Something to Work On**

- **Check open issues** — Look for issues labeled `good first issue` or `help wanted`
- **Report bugs** — Found something broken? Open an issue with details
- **Suggest features** — Have an idea? Start a discussion
- **Prototype with AI** — Got an idea? Prototype it quickly with AI and share in discussion
- **Improve docs** — Documentation improvements are always welcome
- **Fix accessibility** — Help us make mentorship accessible to everyone

### 2. **Set Up Your Environment**

#### Prerequisites
- An AI code editor (Claude Code, Codex, or Cursor recommended) 

#### Fork and Clone
```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/curastem.git
cd curastem
```

#### Get Familiar with the Codebase
- **Main component**: `app/web.tsx` — This is the heart of Curastem
- **Code standards**: See `.cursorrules` for Framer component best practices
- **Architecture**: Single Framer code component that powers Curastem.org

#### Firebase (own project vs production)

The repo ships with a `FIREBASE_CONFIG` object in `app/web.tsx` (and a matching relay in `curastem-jobs-api/src/app/auth/popup.ts` for the `/auth/popup` flow). That points at the production Curastem Firebase project. **Publishing the repo is fine**; Web API keys are client-visible by design and must be restricted in Firebase and Google Cloud (authorized domains, API restrictions, App Check as needed).

If you want to **run your own stack** without using the Curastem Firebase project, replace that config with your own Web app settings from the Firebase console, or load it from your build-time environment and keep secrets out of the repo. The relay page must use the **same** project as the Framer client so sign-in and token exchange stay consistent.

Firebase is Auth-only in this repo. Firestore and Firebase Storage rules live under `curastem-jobs-api/firebase/` and intentionally deny every read/write; user data and uploads are stored through the Cloudflare Worker in D1 and R2.

---


## How to Contribute

### Making Changes

1. **Create a branch**
   ```bash
   git checkout -b your-feature-name
   ```

2. **Make your changes**
   - Follow the code standards in `.cursorrules`
   - Write clear, self-documenting code
   - Add comments explaining the "why," not just the "what"
   - Test in Framer's preview mode

3. **Test your changes**
   - Test in Framer Canvas (should be lightweight)
   - Test in Framer Preview (full functionality)
   - Test on mobile if your changes affect mobile UX
   - Check accessibility (keyboard navigation, screen readers)

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "Description of your changes"
   ```
   Write clear commit messages that explain what and why.

5. **Push to your fork**
   ```bash
   git push origin your-feature-name
   ```

6. **Open a Pull Request**
   - Go to the original repo on GitHub
   - Click "New Pull Request"
   - Select your fork and branch
   - Fill out the PR template (if available)
   - Describe what you changed and why

---

## Code Standards

We maintain high standards to keep the codebase maintainable for a large open-source community:

- **TypeScript** — Strong typing, avoid `any`
- **Accessibility** — Semantic HTML, ARIA labels, keyboard navigation
- **Performance** — Use `useIsStaticRenderer()` for animated components
- **Browser APIs** — Always guard with `typeof window !== "undefined"`
- **Comments** — Explain the "why," not just the "what"

See `.cursorrules` for detailed Framer component guidelines.

---

## What to Contribute

### 🐛 Bug Fixes
- Fix broken functionality
- Improve error handling
- Fix accessibility issues
- Improve mobile responsiveness

### ✨ Features
- New mentorship features
- UI/UX improvements
- Performance optimizations
- Integration improvements

### 📚 Documentation
- Improve README clarity
- Add code comments
- Write usage examples
- Improve setup instructions

### ♿ Accessibility
- Improve keyboard navigation
- Add ARIA labels
- Improve screen reader support
- Fix color contrast issues

---

## Pull Request Process

1. **Wait for review** — We'll review your PR as soon as possible
2. **Address feedback** — We may request changes or ask questions
3. **Get approved** — Once approved, we'll merge your contribution
4. **Celebrate!** — You've helped make mentorship more accessible 🎉

---

## Questions?

- **Open an issue** — For bugs, feature requests, or questions
- **Email us** — [help@curastem.org](mailto:help@curastem.org)
- **Check existing issues** — Your question might already be answered

---

## Code of Conduct

Be respectful, inclusive, and supportive. We're all here to help students get the mentorship they deserve.

---

**Thank you for contributing to Curastem. Every line of code, every bug fix, every improvement makes mentorship more accessible. You're making a difference.** 🩵
