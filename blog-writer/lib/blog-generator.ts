import { slugify } from "./utils";

export interface BlogContent {
  title: string;
  headline: string;
  content: string;
  slug: string;
}

export interface ImageConfig {
  subject: string;
  accentHue: string;
  aspect: string;
  type?: "cover" | "inline";
  insertBefore?: string;
}

const ACCENT_COLORS = ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Pink"];

export function getRandomAccentColor(): string {
  return ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)];
}

export function generateBlogContent(title: string): BlogContent {
  const slug = slugify(title);
  const headline = generateHeadline(title);
  const content = generateContent(title);
  
  return {
    title,
    headline,
    content,
    slug,
  };
}

function generateHeadline(title: string): string {
  const lower = title.toLowerCase();
  
  if (lower.includes("makermods") && lower.includes("vla")) {
    return "MakerMods Virtual Learning Academy (VLA) offers flexible, career-focused education that fits your schedule.";
  }
  if (lower.includes("kitten")) {
    return "Bringing a kitten home is exciting. A little preparation helps ensure a smooth transition for both of you.";
  }
  if (lower.includes("big tech") || lower.includes("bigtech")) {
    return "Big tech layoffs create uncertainty, but they also open doors for fresh talent and new approaches.";
  }
  if (lower.includes("job") && (lower.includes("end of year") || lower.includes("end of 2026"))) {
    return "The end of the year brings a surge in hiring activity. Understanding these seasonal patterns can help job seekers time their applications and prepare for opportunities.";
  }
  if (lower.includes("curastem") && lower.includes("free")) {
    return "Career and education support should be available to anyone who needs it, without barriers based on background or income.";
  }
  if (lower.includes("job") && lower.includes("switch")) {
    return "Career paths are no longer linear. Understanding why people change jobs helps both employees and employers navigate the modern workforce.";
  }
  
  return `Exploring ${title.toLowerCase()} can provide valuable insights for your career journey.`;
}

function generateContent(title: string): string {
  const lower = title.toLowerCase();
  
  const h2 = (text: string) => `<h2 dir="auto">${text}</h2>`;
  const h3 = (text: string) => `<h3 dir="auto">${text}</h3>`;
  const p = (text: string) => `<p dir="auto">${text}</p>`;
  
  // Job switching content
  if (lower.includes("job") && lower.includes("switch")) {
    return [
      p(`The idea of one job for life is fading. People now change roles, companies, and even careers more frequently than ever. Research from the Bureau of Labor Statistics shows that the average person holds 12 different jobs between ages 18 and 52. Some switches are voluntary, others forced by layoffs or industry shifts. Understanding why people move helps both job seekers and employers make better decisions.`),
      "<p><br></p>",
      h2("People switch when growth stalls."),
      "<p><br></p>",
      h3("The need for advancement"),
      p(`One of the most common reasons people leave is the lack of growth opportunities. When employees stop learning, stop being challenged, or see no path to promotion, they start looking elsewhere. This is especially true for high performers who want to develop new skills and take on bigger responsibilities. Companies that treat roles as static and employees as replaceable often face higher turnover, which costs more than development in the long run.`),
      "<p><br></p>",
      h3("Recognition and compensation"),
      p(`Beyond titles and tasks, people want to feel valued. When hard work goes unnoticed or compensation falls behind market rates, motivation drops. Many job seekers report that feeling undervalued was a major factor in their decision to leave. Regular feedback, fair pay, and visible appreciation can prevent many departures.`),
      "<p><br></p>",
      h2("Culture and fit matter as much as compensation."),
      "<p><br></p>",
      h3("Why environment drives decisions"),
      p(`Workplace culture influences daily satisfaction more than most people realize. Toxic environments, poor management, lack of flexibility, or misalignment with personal values can make even high-paying jobs unbearable. Job seekers increasingly prioritize culture fit, work-life balance, and psychological safety when evaluating opportunities. A supportive environment often outweighs a higher paycheck.`),
      "<p><br></p>",
      h3("Remote and hybrid expectations"),
      p(`The shift to remote work has changed priorities. Many people now expect flexibility as a standard benefit, not a perk. Companies demanding full office attendance often lose talent to competitors offering hybrid options. This trend shows how workplace expectations evolve and why employers must adapt to retain good people.`),
      "<p><br></p>",
      h2("Life changes reshape career priorities."),
      "<p><br></p>",
      p(`Personal circumstances often trigger career moves. Relocation, family needs, health changes, or pursuing further education can all prompt a job search. These transitions are normal and usually reflect shifting life priorities rather than dissatisfaction with a role. Employers who accommodate life changes build loyalty, while rigid policies push talented people away.`),
      "<p><br></p>",
      h2("Layoffs and industry disruption force movement."),
      "<p><br></p>",
      p(`Not all job changes are voluntary. Economic downturns, company restructuring, automation, and industry shifts can eliminate roles overnight. Workers in declining fields often must reskill or pivot to new industries. While stressful, these moments can lead to unexpected opportunities and career growth.`),
      "<p><br></p>",
      h2("Better opportunities appear unexpectedly."),
      "<p><br></p>",
      p(`Sometimes the right opportunity arrives at the right time. A compelling offer, an exciting project, or a chance to work with talented people can prompt a move even when current roles are satisfactory. Staying open to possibilities keeps careers dynamic and prevents stagnation.`),
      "<p><br></p>",
      h2("The new normal is movement, not loyalty."),
      "<p><br></p>",
      p(`Long-term loyalty to one employer is no longer the default. Modern careers involve continuous learning, networking, and strategic moves. Both employees and employers benefit from viewing relationships as valuable but time-bound partnerships. This mindset reduces guilt about leaving and encourages investment in transferable skills.`),
      "<p><br></p>",
      h2("Curastem supports people through career transitions."),
      "<p><br></p>",
      h3("Help when you are considering a switch"),
      p(`Whether you are thinking about leaving, already searching, or forced to change by circumstances, Curastem provides guidance. From resume reviews to interview prep to exploring new fields, we help you navigate transitions with confidence. Career switches are major decisions. Having support makes them easier.`),
      "<p><br></p>",
      h3("Resources for every stage"),
      p(`Curastem offers tools and support for job seekers at every stage. Compare industries, research companies, practice common questions, and connect with others who have made similar moves. You do not have to figure it out alone.`),
    ].join("");
  }
  
  // Curastem free content
  if (lower.includes("curastem") && lower.includes("free")) {
    return [
      p(`Curastem is free for everyone. No income limits. No application fees. No barriers based on where you live or what your background is. Career and education support should be available to anyone who needs it, and that is what Curastem provides. People from all over the world use Curastem to explore options, compare paths, and get guidance without worrying about cost.`),
      "<p><br></p>",
      h2("Why free matters."),
      "<p><br></p>",
      p(`Career decisions shape lives. Education opens doors. When these resources come with price tags, many people get left out. Curastem believes that help with resumes, interviews, school choices, and career planning should not depend on your bank account. By removing cost barriers, we give more people a fair shot at building the future they want.`),
      "<p><br></p>",
      h2("What free includes."),
      "<p><br></p>",
      p(`Everything on Curastem is available without payment. Resume guidance, interview practice, career exploration tools, education comparisons, and personalized recommendations. There are no premium tiers or locked features. You get full access to all tools and resources from the moment you start using the platform.`),
      "<p><br></p>",
      h2("How free works."),
      "<p><br></p>",
      p(`Curastem is supported by partnerships, grants, and community contributions rather than user fees. This model lets us focus on helping people rather than extracting revenue. We keep costs low and invest resources in improving tools and expanding what we offer. The goal is sustainable, accessible support for career and education growth.`),
      "<p><br></p>",
      h2("Who free is for."),
      "<p><br></p>",
      p(`Everyone. Students figuring out what comes after school. Workers considering a career change. People returning to the workforce after a break. Anyone exploring education options. Curastem serves people at all stages of their journey, regardless of income, location, or background. The platform is designed to be useful whether you are just starting out or well into your career.`),
      "<p><br></p>",
      h2("Making the most of free resources."),
      "<p><br></p>",
      p(`Start with whatever challenge is most pressing. Compare programs, practice interview answers, explore career paths, or get feedback on your resume. Use the tools that fit your needs and skip what does not apply right now. Come back whenever you need more help. Curastem stays free no matter how many times you use it.`),
    ].join("");
  }
  
  // Default/generic content
  return [
    p(`${title} is an important topic that affects many people's career decisions. Understanding the landscape helps you make informed choices about your professional future.`),
    "<p><br></p>",
    h2("Understanding the basics."),
    "<p><br></p>",
    p(`Getting started with any career path requires research and preparation. The more you know about your options, the better equipped you are to make decisions that align with your goals and values.`),
    "<p><br></p>",
    h2("Key considerations."),
    "<p><br></p>",
    p(`When exploring ${title.toLowerCase()}, consider your personal circumstances, long-term goals, and the current market conditions. Each person's situation is unique, and what works for one may not work for another.`),
    "<p><br></p>",
    h2("Next steps."),
    "<p><br></p>",
    p(`Use Curastem's tools to explore your options, compare paths, and get personalized guidance. Our resources are free and designed to help you navigate your career journey with confidence.`),
  ].join("");
}

export function generateImageConfigs(title: string): ImageConfig[] {
  const slug = slugify(title);
  const lower = title.toLowerCase();
  
  // Job switching article
  if (lower.includes("job") && lower.includes("switch")) {
    return [
      {
        subject: "professional at crossroads considering career change",
        accentHue: getRandomAccentColor(),
        aspect: "16:9",
        type: "cover",
      },
      {
        subject: "person climbing career ladder reaching new level",
        accentHue: getRandomAccentColor(),
        aspect: "16:9",
        type: "inline",
        insertBefore: "People switch when growth stalls.",
      },
      {
        subject: "person finding work life balance in modern office",
        accentHue: getRandomAccentColor(),
        aspect: "16:9",
        type: "inline",
        insertBefore: "Culture and fit matter as much as compensation.",
      },
      {
        subject: "person adapting to new career after industry change",
        accentHue: getRandomAccentColor(),
        aspect: "16:9",
        type: "inline",
        insertBefore: "The new normal is movement, not loyalty.",
      },
    ];
  }
  
  // Curastem free article
  if (lower.includes("curastem") && lower.includes("free")) {
    return [
      {
        subject: "person accessing free educational resources online",
        accentHue: getRandomAccentColor(),
        aspect: "16:9",
        type: "cover",
      },
      {
        subject: "diverse group of students using free learning tools",
        accentHue: getRandomAccentColor(),
        aspect: "16:9",
        type: "inline",
        insertBefore: "Why free matters.",
      },
      {
        subject: "person exploring career options with guidance",
        accentHue: getRandomAccentColor(),
        aspect: "16:9",
        type: "inline",
        insertBefore: "What free includes.",
      },
    ];
  }
  
  // Default configs
  return [
    {
      subject: `abstract illustration representing ${title.toLowerCase().substring(0, 30)}`,
      accentHue: getRandomAccentColor(),
      aspect: "16:9",
      type: "cover",
    },
    {
      subject: "professional in modern workspace",
      accentHue: getRandomAccentColor(),
      aspect: "16:9",
      type: "inline",
      insertBefore: "Understanding the basics.",
    },
  ];
}
