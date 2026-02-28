import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  // Always return masked values - never expose actual credentials
  const config = {
    framerProjectUrl: maskValue(process.env.FRAMER_PROJECT_URL, "url"),
    framerApiKey: maskApiKey(process.env.FRAMER_API_KEY),
    framerBlogCollection: process.env.FRAMER_BLOG_COLLECTION || "Services",
    isConfigured: {
      framerProjectUrl: !!process.env.FRAMER_PROJECT_URL,
      framerApiKey: !!process.env.FRAMER_API_KEY,
      framerBlogCollection: !!process.env.FRAMER_BLOG_COLLECTION,
    },
  };
  
  return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { framerProjectUrl, framerApiKey, framerBlogCollection } = body;
    
    // Use Vercel API to update environment variables
    const vercelToken = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;
    const teamId = process.env.VERCEL_TEAM_ID;
    
    if (!vercelToken || !projectId || !teamId) {
      return NextResponse.json({
        success: false,
        message: "Vercel API credentials not configured. Please add VERCEL_TOKEN, VERCEL_PROJECT_ID, and VERCEL_TEAM_ID to your Vercel environment variables.",
        manualUpdate: true,
      });
    }
    
    const envVars: Array<{ key: string; value: string; type: string }> = [];
    if (framerProjectUrl) envVars.push({ key: "FRAMER_PROJECT_URL", value: framerProjectUrl, type: "plain" });
    if (framerApiKey) envVars.push({ key: "FRAMER_API_KEY", value: framerApiKey, type: "encrypted" });
    if (framerBlogCollection !== undefined) envVars.push({ key: "FRAMER_BLOG_COLLECTION", value: framerBlogCollection || "Services", type: "plain" });
    
    if (envVars.length === 0) {
      return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
    }
    
    // Get existing env vars to find IDs for deletion/update
    const listResponse = await fetch(
      `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${teamId}`,
      { headers: { Authorization: `Bearer ${vercelToken}` } }
    );
    
    const existingEnvs: Array<{ id: string; key: string }> = listResponse.ok
      ? (await listResponse.json()).envs || []
      : [];
    
    const results = [];
    for (const envVar of envVars) {
      try {
        const existing = existingEnvs.find((e) => e.key === envVar.key);
        if (existing) {
          // Update existing
          const response = await fetch(
            `https://api.vercel.com/v9/projects/${projectId}/env/${existing.id}?teamId=${teamId}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${vercelToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                value: envVar.value,
                target: ["production", "preview", "development"],
              }),
            }
          );
          results.push({ key: envVar.key, success: response.ok });
        } else {
          // Create new
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
          results.push({ key: envVar.key, success: response.ok });
        }
      } catch (err) {
        results.push({ key: envVar.key, success: false, error: String(err) });
      }
    }
    
    const allSuccess = results.every((r) => r.success);
    return NextResponse.json({
      success: allSuccess,
      message: allSuccess 
        ? "Settings updated successfully! Please redeploy on Vercel to apply changes." 
        : "Some settings failed to update.",
      results,
    });
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
