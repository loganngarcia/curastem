import { connect } from "framer-api";

const getFramerConfig = () => ({
  url: process.env.FRAMER_PROJECT_URL?.trim() || "",
  token: process.env.FRAMER_API_KEY?.trim() || "",
  collectionName: (process.env.FRAMER_BLOG_COLLECTION || "Services").trim(),
});

export interface BlogItem {
  id: string;
  slug: string;
  title?: string;
  headline?: string;
  content?: string;
  coverImageUrl?: string;
  blogListImageUrl?: string;
  date?: string;
  featured?: boolean;
}

export interface FieldIds {
  title: string;
  headline: string;
  content: string;
  date: string;
  featured: string;
  coverImage: string;
  blogListImage: string;
}

export async function getFramerClient() {
  const { url, token } = getFramerConfig();
  if (!url || !token) {
    throw new Error("Framer credentials not configured");
  }
  return connect(url, token);
}

export async function getBlogCollection(framer: any) {
  const { collectionName } = getFramerConfig();
  console.log(`Looking for collection: "${collectionName}"`);
  const collections = await framer.getCollections();
  console.log(`Available collections: ${collections.map((c: any) => `"${c.name}" (id: ${c.id})`).join(", ")}`);
  
  const collection = collections.find(
    (c: any) => c.name.trim().toLowerCase() === collectionName.toLowerCase()
  );
  
  if (!collection) {
    const names = collections.map((c: any) => `"${c.name}"`).join(", ");
    throw new Error(`Collection "${collectionName}" not found. Available: ${names || "none"}`);
  }
  
  return collection;
}

export async function getFieldIds(collection: any): Promise<FieldIds> {
  const fields = await collection.getFields();
  
  const getFieldId = (name: string, required: boolean = true): string => {
    const field = fields.find(
      (f: any) => f.name.toLowerCase() === name.toLowerCase()
    );
    if (!field) {
      if (required) {
        throw new Error(`Required field "${name}" not found in "${collection.name}"`);
      }
      return "";
    }
    return field.id;
  };

  const contentId = getFieldId("Content", true);
  const titleId = getFieldId("Title", false);
  
  return {
    title: titleId || contentId,
    headline: getFieldId("Headline", false),
    content: contentId,
    date: getFieldId("Date", false),
    featured: getFieldId("Featured", false),
    coverImage: getFieldId("Fill image", false),
    blogListImage: getFieldId("Zoom out image", false),
  };
}

const getVal = (data: Record<string, unknown>, id: string): unknown => {
  const raw = data[id];
  if (raw == null) return undefined;
  if (typeof raw === "object" && raw && "value" in raw) {
    return (raw as { value: unknown }).value;
  }
  return raw;
};

export async function getBlogs(): Promise<BlogItem[]> {
  const framer = await getFramerClient();
  try {
    const collection = await getBlogCollection(framer);
    const fields = await getFieldIds(collection);
    const items = await collection.getItems();

    const blogs = items.map((item: any) => {
      const fd = (item.fieldData ?? {}) as Record<string, unknown>;
      
      const getUrl = (val: any): string | undefined => {
        if (!val) return undefined;
        return typeof val === "string" ? val : val.url;
      };

      const title = fields.title && fields.title !== fields.content 
        ? (getVal(fd, fields.title) as string) 
        : (getVal(fd, fields.content) as string)?.substring(0, 100);

      return {
        id: item.id,
        slug: item.slug || "",
        title: title || item.slug || "Untitled",
        headline: (getVal(fd, fields.headline) as string) || "",
        content: (getVal(fd, fields.content) as string) || "",
        coverImageUrl: getUrl(getVal(fd, fields.coverImage)),
        blogListImageUrl: getUrl(getVal(fd, fields.blogListImage)),
        date: (getVal(fd, fields.date) as string) || "",
        featured: (getVal(fd, fields.featured) as boolean) || false,
      };
    });

    return blogs;
  } finally {
    await framer.disconnect().catch(() => {});
  }
}

export async function getBlog(slug: string): Promise<BlogItem | null> {
  const blogs = await getBlogs();
  return blogs.find((b) => b.slug === slug) || null;
}

export async function uploadImageToFramer(imageUrl: string): Promise<string> {
  const framer = await getFramerClient();
  try {
    const result = await framer.uploadImage({
      image: imageUrl,
      name: `image-${Date.now()}.png`,
    });
    
    return typeof result === "string" ? result : result.url;
  } finally {
    await framer.disconnect().catch(() => {});
  }
}

export async function createOrUpdateBlog(blog: Partial<BlogItem> & { slug: string }): Promise<BlogItem> {
  const framer = await getFramerClient();
  try {
    const collection = await getBlogCollection(framer);
    const fields = await getFieldIds(collection);
    const items = await collection.getItems();
    const existingItem = items.find((i: any) => i.slug === blog.slug);
    
    const fieldData: any = {};
    if (blog.title !== undefined) fieldData[fields.title] = blog.title;
    if (blog.headline !== undefined) fieldData[fields.headline] = blog.headline;
    if (blog.content !== undefined) fieldData[fields.content] = blog.content;
    if (blog.date !== undefined) fieldData[fields.date] = blog.date;
    if (blog.featured !== undefined) fieldData[fields.featured] = blog.featured;
    if (blog.coverImageUrl !== undefined) fieldData[fields.coverImage] = blog.coverImageUrl;
    if (blog.blogListImageUrl !== undefined) fieldData[fields.blogListImage] = blog.blogListImageUrl;
    
    if (existingItem) {
      await collection.addItems([{ id: existingItem.id, slug: blog.slug, fieldData }]);
    } else {
      await collection.addItems([{ slug: blog.slug, fieldData }]);
    }
    
    await framer.disconnect();
    await new Promise((r) => setTimeout(r, 3000));
    const updated = await getBlog(blog.slug);
    if (!updated) throw new Error("Failed to verify blog update");
    return updated;
  } catch (error) {
    await framer.disconnect().catch(() => {});
    throw error;
  }
}

export async function deleteBlog(slug: string): Promise<void> {
  const framer = await getFramerClient();
  try {
    const collection = await getBlogCollection(framer);
    const items = await collection.getItems();
    const item = items.find((i: any) => i.slug === slug);
    if (item) await collection.deleteItems([{ id: item.id }]);
  } finally {
    await framer.disconnect().catch(() => {});
  }
}
