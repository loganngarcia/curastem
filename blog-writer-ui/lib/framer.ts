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
  /** Alt text for the cover image, used for SEO and accessibility. */
  coverImageAlt?: string;
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
        // Handle typed format: { type: "image", value: "..." }
        if (typeof val === "object" && val !== null) {
          // If it has a value property, check if value is a string URL
          if ("value" in val) {
            const value = val.value;
            if (typeof value === "string") {
              return value;
            }
            // If value is an object with url property
            if (value && typeof value === "object" && "url" in value && typeof value.url === "string") {
              return value.url;
            }
          }
          // If it has a url property directly
          if ("url" in val && typeof val.url === "string") {
            return val.url;
          }
        }
        // Handle plain string
        if (typeof val === "string") {
          return val;
        }
        return undefined;
      };

      const title = fields.title && fields.title !== fields.content 
        ? (getVal(fd, fields.title) as string) 
        : (getVal(fd, fields.content) as string)?.substring(0, 100);

      const coverImageRaw = getVal(fd, fields.coverImage);
      const coverImageAlt = (coverImageRaw && typeof coverImageRaw === "object" && "alt" in coverImageRaw)
        ? (coverImageRaw as { alt?: string }).alt
        : undefined;

      return {
        id: item.id,
        slug: item.slug || "",
        title: title || item.slug || "Untitled",
        headline: (getVal(fd, fields.headline) as string) || "",
        content: (getVal(fd, fields.content) as string) || "",
        coverImageUrl: getUrl(coverImageRaw),
        coverImageAlt,
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
    
    // Framer API requires fieldData values to be in typed format: { type: "string", value: "..." }
    // Based on error: expects StringFieldDataEntryInput | FormattedTextFieldDataEntryInput | etc.
    const fieldData: any = {};
    
    if (blog.title !== undefined) {
      fieldData[fields.title] = { type: "string", value: blog.title };
      console.log(`[createOrUpdateBlog] Setting title field (${fields.title}):`, blog.title);
    }
    if (blog.headline !== undefined) {
      fieldData[fields.headline] = { type: "string", value: blog.headline };
      console.log(`[createOrUpdateBlog] Setting headline field (${fields.headline}):`, blog.headline);
    }
    if (blog.content !== undefined) {
      // Content is HTML, so use formattedText type
      fieldData[fields.content] = { type: "formattedText", value: blog.content };
      console.log(`[createOrUpdateBlog] Setting content field (${fields.content}), length:`, blog.content?.length || 0);
    }
    if (blog.date !== undefined) {
      fieldData[fields.date] = { type: "date", value: blog.date };
    }
    if (blog.featured !== undefined) {
      fieldData[fields.featured] = { type: "boolean", value: blog.featured };
    }
    if (blog.coverImageUrl !== undefined) {
      // Include alt text if provided — Framer image fields support an optional alt property
      fieldData[fields.coverImage] = blog.coverImageAlt
        ? { type: "image", value: blog.coverImageUrl, alt: blog.coverImageAlt }
        : { type: "image", value: blog.coverImageUrl };
      console.log(`[createOrUpdateBlog] Setting coverImage field (${fields.coverImage}):`, blog.coverImageUrl, blog.coverImageAlt ? `(alt: "${blog.coverImageAlt}")` : "");
    }
    if (blog.blogListImageUrl !== undefined) {
      fieldData[fields.blogListImage] = { type: "image", value: blog.blogListImageUrl };
    }
    
    console.log(`[createOrUpdateBlog] Field data to update:`, Object.keys(fieldData));
    
    // According to Framer API docs: "If an id is provided and matches an existing Item, that Item will be updated."
    // So we can use addItems for both create and update
    if (existingItem) {
      console.log(`[createOrUpdateBlog] Updating existing item with id: ${existingItem.id}`);
      console.log(`[createOrUpdateBlog] Using addItems with id to update:`, {
        id: existingItem.id,
        slug: blog.slug,
        fieldCount: Object.keys(fieldData).length,
        fields: Object.keys(fieldData),
        sampleFieldData: Object.entries(fieldData).slice(0, 2),
      });
      
      try {
        // Use addItems with id to update existing item
        await collection.addItems([{ 
          id: existingItem.id, 
          slug: blog.slug, 
          fieldData 
        }]);
        console.log(`[createOrUpdateBlog] Update call completed using addItems with id`);
      } catch (addItemsError) {
        console.error(`[createOrUpdateBlog] addItems failed:`, addItemsError);
        console.error(`[createOrUpdateBlog] Error details:`, {
          message: addItemsError instanceof Error ? addItemsError.message : String(addItemsError),
          stack: addItemsError instanceof Error ? addItemsError.stack : undefined,
          name: addItemsError instanceof Error ? addItemsError.name : undefined,
        });
        throw addItemsError;
      }
      
      // Wait a moment for changes to propagate
      await new Promise((r) => setTimeout(r, 1000));
    } else {
      console.log(`[createOrUpdateBlog] Creating new item`);
      try {
        // Use addItems without id to create new item
        await collection.addItems([{ 
          slug: blog.slug, 
          fieldData 
        }]);
        console.log(`[createOrUpdateBlog] Create call completed`);
      } catch (addItemsError) {
        console.error(`[createOrUpdateBlog] addItems create failed:`, addItemsError);
        throw addItemsError;
      }
      
      // Wait a moment for the item to be created
      await new Promise((r) => setTimeout(r, 1000));
      
      // Fetch the newly created item from the SAME connection before disconnecting
      console.log(`[createOrUpdateBlog] Fetching newly created item from same connection...`);
      const allItems = await collection.getItems();
      const newItem = allItems.find((i: any) => i.slug === blog.slug);
      
      if (!newItem) {
        console.error(`[createOrUpdateBlog] Newly created item not found in collection`);
        await framer.disconnect();
        throw new Error("Failed to find newly created blog item");
      }
      
      // Construct BlogItem from the created item
      const fd = (newItem.fieldData ?? {}) as Record<string, unknown>;
      const getUrl = (val: any): string | undefined => {
        if (!val) return undefined;
        // Handle typed format: { type: "image", value: "..." }
        if (typeof val === "object" && val !== null) {
          // If it has a value property, check if value is a string URL
          if ("value" in val) {
            const value = val.value;
            if (typeof value === "string") {
              return value;
            }
            // If value is an object with url property
            if (value && typeof value === "object" && "url" in value && typeof value.url === "string") {
              return value.url;
            }
          }
          // If it has a url property directly
          if ("url" in val && typeof val.url === "string") {
            return val.url;
          }
        }
        // Handle plain string
        if (typeof val === "string") {
          return val;
        }
        return undefined;
      };

      const createdBlog: BlogItem = {
        id: newItem.id,
        slug: newItem.slug || blog.slug,
        title: (getVal(fd, fields.title) as string) || blog.title || blog.slug,
        headline: (getVal(fd, fields.headline) as string) || blog.headline || "",
        content: (getVal(fd, fields.content) as string) || blog.content || "",
        coverImageUrl: getUrl(getVal(fd, fields.coverImage)),
        blogListImageUrl: getUrl(getVal(fd, fields.blogListImage)),
        date: (getVal(fd, fields.date) as string) || blog.date || new Date().toISOString(),
        featured: (getVal(fd, fields.featured) as boolean) || blog.featured || false,
      };
      
      await framer.disconnect();
      console.log(`[createOrUpdateBlog] Successfully created blog:`, {
        id: createdBlog.id,
        slug: createdBlog.slug,
        title: createdBlog.title,
      });
      
      return createdBlog;
    }
    
    // For updates, verify before disconnecting
    console.log(`[createOrUpdateBlog] Waiting for CMS to sync...`);
    await new Promise((r) => setTimeout(r, 1000));
    
    // Fetch updated item from the SAME connection
    console.log(`[createOrUpdateBlog] Fetching updated item from same connection...`);
    const allItemsUpdated = await collection.getItems();
    const updatedItem = allItemsUpdated.find((i: any) => i.slug === blog.slug);
    
    await framer.disconnect();
    console.log(`[createOrUpdateBlog] Disconnected from Framer`);
    
    if (!updatedItem) {
      console.error(`[createOrUpdateBlog] Updated item not found in collection`);
      throw new Error("Failed to find updated blog item");
    }
    
    // Construct BlogItem from the updated item
    const fd = (updatedItem.fieldData ?? {}) as Record<string, unknown>;
    const getUrl = (val: any): string | undefined => {
      if (!val) return undefined;
      // Handle typed format: { type: "image", value: "..." }
      if (typeof val === "object" && val !== null) {
        // If it has a value property, check if value is a string URL
        if ("value" in val) {
          const value = val.value;
          if (typeof value === "string") {
            return value;
          }
          // If value is an object with url property
          if (value && typeof value === "object" && "url" in value && typeof value.url === "string") {
            return value.url;
          }
        }
        // If it has a url property directly
        if ("url" in val && typeof val.url === "string") {
          return val.url;
        }
      }
      // Handle plain string
      if (typeof val === "string") {
        return val;
      }
      return undefined;
    };

    const updated: BlogItem = {
      id: updatedItem.id,
      slug: updatedItem.slug || blog.slug,
      title: (getVal(fd, fields.title) as string) || blog.title || "",
      headline: (getVal(fd, fields.headline) as string) || blog.headline || "",
      content: (getVal(fd, fields.content) as string) || blog.content || "",
      coverImageUrl: getUrl(getVal(fd, fields.coverImage)),
      blogListImageUrl: getUrl(getVal(fd, fields.blogListImage)),
      date: (getVal(fd, fields.date) as string) || blog.date || "",
      featured: (getVal(fd, fields.featured) as boolean) || blog.featured || false,
    };
    
    console.log(`[createOrUpdateBlog] Successfully updated blog:`, {
      id: updated.id,
      title: updated.title,
      contentLength: updated.content?.length || 0,
    });
    return updated;
  } catch (error) {
    console.error(`[createOrUpdateBlog] Error:`, error);
    const errorDetails = error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name,
    } : { error: String(error) };
    console.error(`[createOrUpdateBlog] Full error details:`, JSON.stringify(errorDetails, null, 2));
    
    // Try to extract more details from the error
    let detailedMessage = "Failed to update blog in Framer CMS";
    if (error instanceof Error) {
      detailedMessage = `${detailedMessage}: ${error.message}`;
      if (error.stack) {
        console.error(`[createOrUpdateBlog] Error stack:`, error.stack);
      }
    } else {
      detailedMessage = `${detailedMessage}: ${String(error)}`;
    }
    
    await framer.disconnect().catch(() => {});
    throw new Error(detailedMessage);
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
