import { NextResponse } from "next/server";
import { getFramerClient, getBlogCollection, getFieldIds } from "@/lib/framer";

export async function GET() {
  const framer = await getFramerClient();
  try {
    console.log("Testing Framer connection...");
    
    // Test 1: Get collection
    const collection = await getBlogCollection(framer);
    console.log("✓ Collection found:", collection.name);
    
    // Test 2: Get field IDs
    const fields = await getFieldIds(collection);
    console.log("✓ Field IDs:", fields);
    
    // Test 3: Get items
    const items = await collection.getItems();
    console.log(`✓ Found ${items.length} items`);
    
    // Test 4: Show first item details
    if (items.length > 0) {
      const firstItem = items[0];
      console.log("✓ First item:", {
        id: firstItem.id,
        slug: firstItem.slug,
        fieldDataKeys: Object.keys(firstItem.fieldData || {}),
      });
    }
    
    return NextResponse.json({
      success: true,
      collection: collection.name,
      itemCount: items.length,
      fields,
      firstItem: items.length > 0 ? {
        id: items[0].id,
        slug: items[0].slug,
      } : null,
    });
  } catch (error) {
    console.error("Test failed:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  } finally {
    await framer.disconnect().catch(() => {});
  }
}
