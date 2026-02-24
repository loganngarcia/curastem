import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  // Always return masked values - never expose actual credentials
  const config = {
    framerProjectUrl: maskValue(process.env.FRAMER_PROJECT_URL, "url"),
    framerApiKey: maskApiKey(process.env.FRAMER_API_KEY),
    poeApiKey: maskApiKey(process.env.POE_API_KEY),
    framerBlogCollection: process.env.FRAMER_BLOG_COLLECTION || "Services",
    isConfigured: {
      framerProjectUrl: !!process.env.FRAMER_PROJECT_URL,
      framerApiKey: !!process.env.FRAMER_API_KEY,
      poeApiKey: !!process.env.POE_API_KEY,
      framerBlogCollection: !!process.env.FRAMER_BLOG_COLLECTION,
    },
  };
  
  return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { framerProjectUrl, framerApiKey, poeApiKey, framerBlogCollection } = body;
    
    // Only update fields that are provided (partial updates)
    // Check if required fields exist in env vars if not provided
    if (!framerProjectUrl && !process.env.FRAMER_PROJECT_URL) {
      return NextResponse.json(
        { error: "Framer Project URL is required" },
        { status: 400 }
      );
    }
    
    if (!framerApiKey && !process.env.FRAMER_API_KEY) {
      return NextResponse.json(
        { error: "Framer API Key is required" },
        { status: 400 }
      );
    }
    
    // Use Vercel API to update environment variables
    // All Vercel credentials must be in environment variables - never hardcoded
    const vercelToken = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;
    const teamId = process.env.VERCEL_TEAM_ID;
    
    if (!vercelToken || !projectId || !teamId) {
      // If Vercel API credentials aren't set, return instructions instead of error
      return NextResponse.json({
        success: false,
        message: "Vercel API credentials not configured. To update settings automatically, please add VERCEL_TOKEN, VERCEL_PROJECT_ID, and VERCEL_TEAM_ID to your Vercel environment variables.",
        instructions: [
          "To update settings manually:",
          "1. Go to your Vercel project dashboard",
          "2. Navigate to Settings > Environment Variables",
          "3. Add or update the following variables:",
          framerProjectUrl ? `   - FRAMER_PROJECT_URL: ${framerProjectUrl}` : "",
          framerApiKey ? `   - FRAMER_API_KEY: ${framerApiKey}` : "",
          poeApiKey ? `   - POE_API_KEY: ${poeApiKey}` : "",
          framerBlogCollection ? `   - FRAMER_BLOG_COLLECTION: ${framerBlogCollection}` : "",
          "4. Redeploy your application",
        ].filter(Boolean),
        manualUpdate: true,
      });
    }
    
    // Only include fields that were provided
    const envVars: Array<{ key: string; value: string; type: string }> = [];
    
    if (framerProjectUrl) {
      envVars.push({ key: "FRAMER_PROJECT_URL", value: framerProjectUrl, type: "encrypted" });
    }
    
    if (framerApiKey) {
      envVars.push({ key: "FRAMER_API_KEY", value: framerApiKey, type: "encrypted" });
    }
    
    if (framerBlogCollection !== undefined) {
      envVars.push({ key: "FRAMER_BLOG_COLLECTION", value: framerBlogCollection || "Services", type: "encrypted" });
    }
    
    if (poeApiKey !== undefined) {
      // Allow clearing POE_API_KEY by sending empty string
      envVars.push({ key: "POE_API_KEY", value: poeApiKey || "", type: "encrypted" });
    }
    
    if (envVars.length === 0) {
      return NextResponse.json(
        { error: "No fields provided to update" },
        { status: 400 }
      );
    }
    
    // Get existing env vars to find IDs for deletion
    const listResponse = await fetch(
      `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${teamId}`,
      {
        headers: {
          Authorization: `Bearer ${vercelToken}`,
        },
      }
    );
    
    const existingEnvs: Array<{ id: string; key: string }> = listResponse.ok
      ? await listResponse.json()
      : [];
    
    // Update each environment variable via Vercel API
    const results = [];
    for (const envVar of envVars) {
      try {
        // Find and delete existing env var by key
        const existing = existingEnvs.find((e) => e.key === envVar.key);
        if (existing) {
          await fetch(
            `https://api.vercel.com/v10/projects/${projectId}/env/${existing.id}?teamId=${teamId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${vercelToken}`,
              },
            }
          ).catch(() => {}); // Ignore errors
        }
        
        // Add new env var
        const response = await fetch(
          `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${teamId}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${vercelToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              key: envVar.key,
              value: envVar.value,
              type: envVar.type,
              target: ["production", "preview", "development"],
            }),
          }
        );
        
        if (!response.ok) {
          const error = await response.text();
          results.push({ key: envVar.key, success: false, error });
        } else {
          results.push({ key: envVar.key, success: true });
        }
      } catch (err) {
        results.push({ key: envVar.key, success: false, error: String(err) });
      }
    }
    
    const allSuccess = results.every((r) => r.success);
    
    if (allSuccess) {
      return NextResponse.json({
        success: true,
        message: "Settings updated successfully! The application will use these new values on the next deployment.",
        note: "To apply changes immediately, trigger a redeploy from the Vercel dashboard.",
      });
    } else {
      return NextResponse.json({
        success: false,
        message: "Some settings failed to update. Please check the Vercel dashboard.",
        results,
      });
    }
  } catch (error) {
    console.error("Settings update error:", error);
    return NextResponse.json(
      { error: `Failed to update settings: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

function maskApiKey(key: string | undefined): string {
  if (!key) return "••••••••";
  if (key.length < 8) return "••••••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}

function maskValue(value: string | undefined, type: "url" | "key"): string {
  if (!value) return "••••••••";
  if (type === "url") {
    // Show domain but mask the project ID part
    try {
      const url = new URL(value);
      const pathParts = url.pathname.split("/");
      const projectPart = pathParts[pathParts.length - 1];
      if (projectPart && projectPart.length > 8) {
        return `${url.origin}${pathParts.slice(0, -1).join("/")}/••••${projectPart.slice(-4)}`;
      }
      return `${url.origin}/••••••••`;
    } catch {
      return "••••••••";
    }
  }
  return maskApiKey(value);
}
