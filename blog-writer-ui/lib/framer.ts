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
  
  // Try exact match first
  let collection = collections.find(
    (c: any) => c.name.trim() === collectionName
  );
  
  // Try case-insensitive match
  if (!collection) {
    collection = collections.find(
      (c: any) => c.name.trim().toLowerCase() === collectionName.toLowerCase()
    );
  }
  
  // If still not found and there's only one collection, use it as a fallback
  if (!collection && collections.length === 1) {
    console.log(`Collection "${collectionName}" not found, but only one collection exists: "${collections[0].name}". Using it as fallback.`);
    collection = collections[0];
  }
  
  if (!collection) {
    const names = collections.map((c: any) => `"${c.name}"`).join(", ");
    throw new Error(`Collection "${collectionName}" not found. Available: ${names || "none"}`);
  }
  
  return collection;
}

export async function getFieldIds(collection: any): Promise<FieldIds> {
  const fields = await collection.getFields();
  console.log(`Available fields in "${collection.name}": ${fields.map((f: any) => `"${f.name}" (id: ${f.id})`).join(", ")}`);
  
  const getFieldId = (name: string, required: boolean = true): string => {
    const field = fields.find(
      (f: any) => f.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (!field) {
      // Try fuzzy match for "Content" if not found
      if (name.toLowerCase() === "content") {
        const contentField = fields.find((f: any) => 
          f.name.toLowerCase().includes("content") || 
          f.name.toLowerCase().includes("body") ||
          f.name.toLowerCase().includes("text") ||
          f.name.toLowerCase().includes("desc")
        );
        if (contentField) return contentField.id;
      }
      
      // Try fuzzy match for "Title" if not found
      if (name.toLowerCase() === "title") {
        const titleField = fields.find((f: any) => 
          f.name.toLowerCase().includes("title") || 
          f.name.toLowerCase().includes("name") ||
          f.name.toLowerCase().includes("headline")
        );
        if (titleField) return titleField.id;
      }
      
      if (required) {
        throw new Error(`Required field "${name}" not found in "${collection.name}". Available: ${fields.map((f: any) => `"${f.name}"`).join(", ")}`);
      }
      return "";
    }
    return field.id;
  };

  const contentId = getFieldId("Content", true);
  const titleId = getFieldId("Title", false);
  const headlineId = getFieldId("Headline", false);
  
  return {
    title: titleId || headlineId || contentId,
    headline: headlineId || titleId,
    content: contentId,
    date: getFieldId("Date", false) || getFieldId("Created At", false),
    featured: getFieldId("Featured", false),
    coverImage: getFieldId("Fill image", false) || getFieldId("Image", false) || getFieldId("Cover", false),
    blogListImage: getFieldId("Zoom out image", false) || getFieldId("Thumbnail", false),
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
    console.log(`[uploadImageToFramer] Uploading image:`, {
      isDataUrl: imageUrl.startsWith("data:"),
      isHttpUrl: imageUrl.startsWith("http"),
      length: imageUrl.length,
    });
    
    const result = await framer.uploadImage({
      image: imageUrl,
      name: `image-${Date.now()}.png`,
    });
    
    console.log(`[uploadImageToFramer] Upload result type:`, typeof result, result);
    
    // uploadImage returns an ImageAsset object
    // It should have a url property or be usable directly
    let framerImageUrl: string;
    if (typeof result === "string") {
      framerImageUrl = result;
    } else if (result && typeof result === "object") {
      // ImageAsset object - try common properties
      framerImageUrl = (result as any).url || (result as any).src || (result as any).href || String(result);
    } else {
      throw new Error(`Unexpected uploadImage return type: ${typeof result}`);
    }
    
    console.log(`[uploadImageToFramer] Extracted URL:`, framerImageUrl);
    return framerImageUrl;
  } catch (error) {
    console.error(`[uploadImageToFramer] Error:`, error);
    throw error;
  } finally {
    await framer.disconnect().catch(() => {});
  }
}

export async function createOrUpdateBlog(blog: Partial<BlogItem> & { slug: string }): Promise<BlogItem> {
  const framer = await getFramerClient();
  try {
    console.log(`[createOrUpdateBlog] Starting update for slug: ${blog.slug}`);
    const collection = await getBlogCollection(framer);
    const fields = await getFieldIds(collection);
    console.log(`[createOrUpdateBlog] Field IDs:`, fields);
    
    const items = await collection.getItems();
    const existingItem = items.find((i: any) => i.slug === blog.slug);
    console.log(`[createOrUpdateBlog] Existing item found:`, existingItem ? { id: existingItem.id, slug: existingItem.slug } : "none");
    
    const fieldData: any = {};
    if (blog.title !== undefined) {
      fieldData[fields.title] = blog.title;
      console.log(`[createOrUpdateBlog] Setting title field (${fields.title}):`, blog.title);
    }
    if (blog.headline !== undefined) {
      fieldData[fields.headline] = blog.headline;
      console.log(`[createOrUpdateBlog] Setting headline field (${fields.headline}):`, blog.headline);
    }
    if (blog.content !== undefined) {
      fieldData[fields.content] = blog.content;
      console.log(`[createOrUpdateBlog] Setting content field (${fields.content}), length:`, blog.content?.length || 0);
    }
    if (blog.date !== undefined) fieldData[fields.date] = blog.date;
    if (blog.featured !== undefined) fieldData[fields.featured] = blog.featured;
    if (blog.coverImageUrl !== undefined) {
      fieldData[fields.coverImage] = blog.coverImageUrl;
      console.log(`[createOrUpdateBlog] Setting coverImage field (${fields.coverImage}):`, blog.coverImageUrl);
    }
    if (blog.blogListImageUrl !== undefined) fieldData[fields.blogListImage] = blog.blogListImageUrl;
    
    console.log(`[createOrUpdateBlog] Field data to update:`, Object.keys(fieldData));
    
    if (existingItem) {
      console.log(`[createOrUpdateBlog] Updating existing item with id: ${existingItem.id}`);
      // Use setAttributes() to update existing items (correct Framer API method)
      // setAttributes expects { slug?, fieldData } structure
      // fieldData uses field IDs as keys and simple values (strings, numbers, etc.)
      const updatePayload: any = { fieldData };
      // Only include slug if it's being changed
      if (blog.slug && blog.slug !== existingItem.slug) {
        updatePayload.slug = blog.slug;
      }
      
      console.log(`[createOrUpdateBlog] Calling setAttributes with:`, {
        hasSlug: !!updatePayload.slug,
        fieldCount: Object.keys(fieldData).length,
        fields: Object.keys(fieldData),
      });
      
      const updatedItem = await existingItem.setAttributes(updatePayload);
      if (!updatedItem) {
        throw new Error("setAttributes returned null - item may have been deleted");
      }
      console.log(`[createOrUpdateBlog] Update call completed using setAttributes()`, { id: updatedItem.id });
      
      // Wait a moment for changes to propagate before disconnecting
      await new Promise((r) => setTimeout(r, 1000));
    } else {
      console.log(`[createOrUpdateBlog] Creating new item`);
      // Use addItems() only for creating new items
      await collection.addItems([{ slug: blog.slug, fieldData }]);
      console.log(`[createOrUpdateBlog] Create call completed`);
      // Wait a moment for new item to be available
      await new Promise((r) => setTimeout(r, 2000));
    }
    
    // Disconnect after update/create is complete
    await framer.disconnect();
    console.log(`[createOrUpdateBlog] Disconnected from Framer, waiting for propagation...`);
    
    // Wait additional time for CMS to sync
    await new Promise((r) => setTimeout(r, 2000));
    
    console.log(`[createOrUpdateBlog] Fetching updated blog...`);
    const updated = await getBlog(blog.slug);
    if (!updated) {
      console.error(`[createOrUpdateBlog] Failed to fetch updated blog after save`);
      throw new Error("Failed to verify blog update");
    }
    console.log(`[createOrUpdateBlog] Successfully retrieved updated blog:`, {
      id: updated.id,
      title: updated.title,
      contentLength: updated.content?.length || 0,
    });
    return updated;
  } catch (error) {
    console.error(`[createOrUpdateBlog] Error:`, error);
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
// trigger deployment Tue Feb 24 12:26:16 PST 2026
