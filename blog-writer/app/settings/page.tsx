"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Settings, Save, ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";

interface SettingsConfig {
  framerProjectUrl: string;
  framerApiKey: string;
  poeApiKey: string;
  framerBlogCollection: string;
  isConfigured?: {
    framerProjectUrl: boolean;
    framerApiKey: boolean;
    poeApiKey: boolean;
    framerBlogCollection: boolean;
  };
}

export default function SettingsPage() {
  const router = useRouter();
  const [config, setConfig] = useState<SettingsConfig>({
    framerProjectUrl: "",
    framerApiKey: "",
    poeApiKey: "",
    framerBlogCollection: "Services",
  });
  const [originalConfig, setOriginalConfig] = useState<SettingsConfig | null>(null);
  const [showFramerKey, setShowFramerKey] = useState(false);
  const [showPoeKey, setShowPoeKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        const loadedConfig = {
          framerProjectUrl: data.framerProjectUrl || "",
          framerApiKey: data.framerApiKey || "",
          poeApiKey: data.poeApiKey || "",
          framerBlogCollection: data.framerBlogCollection || "Services",
          isConfigured: data.isConfigured,
        };
        setConfig(loadedConfig);
        setOriginalConfig(loadedConfig);
      }
    } catch (err) {
      console.error("Failed to fetch settings", err);
    } finally {
      setLoading(false);
    }
  };

  const isMaskedValue = (value: string): boolean => {
    return value.includes("••••") || value === "";
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    
    // Only send values that have been changed (not masked placeholders)
    const payload: Partial<SettingsConfig> = {};
    
    if (originalConfig) {
      if (config.framerProjectUrl && !isMaskedValue(config.framerProjectUrl) && config.framerProjectUrl !== originalConfig.framerProjectUrl) {
        payload.framerProjectUrl = config.framerProjectUrl;
      }
      if (config.framerApiKey && !isMaskedValue(config.framerApiKey) && config.framerApiKey !== originalConfig.framerApiKey) {
        payload.framerApiKey = config.framerApiKey;
      }
      if (config.poeApiKey && !isMaskedValue(config.poeApiKey) && config.poeApiKey !== originalConfig.poeApiKey) {
        payload.poeApiKey = config.poeApiKey;
      }
      if (config.framerBlogCollection && config.framerBlogCollection !== originalConfig.framerBlogCollection) {
        payload.framerBlogCollection = config.framerBlogCollection;
      }
    } else {
      // If no original config, send all non-masked values
      if (config.framerProjectUrl && !isMaskedValue(config.framerProjectUrl)) {
        payload.framerProjectUrl = config.framerProjectUrl;
      }
      if (config.framerApiKey && !isMaskedValue(config.framerApiKey)) {
        payload.framerApiKey = config.framerApiKey;
      }
      if (config.poeApiKey && !isMaskedValue(config.poeApiKey)) {
        payload.poeApiKey = config.poeApiKey;
      }
      if (config.framerBlogCollection) {
        payload.framerBlogCollection = config.framerBlogCollection;
      }
    }
    
    // Validate required fields
    if (!payload.framerProjectUrl && !config.isConfigured?.framerProjectUrl) {
      setMessage({
        type: "error",
        text: "Framer Project URL is required",
      });
      setSaving(false);
      return;
    }
    
    if (!payload.framerApiKey && !config.isConfigured?.framerApiKey) {
      setMessage({
        type: "error",
        text: "Framer API Key is required",
      });
      setSaving(false);
      return;
    }
    
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      
      if (res.ok && data.success) {
        setMessage({
          type: "success",
          text: data.message || "Settings saved successfully!",
        });
        
        // Reload settings to get updated masked values
        await fetchSettings();
        
        if (data.note) {
          setTimeout(() => {
            alert(data.note);
          }, 500);
        }
      } else if (data.manualUpdate) {
        // Show instructions for manual update
        setMessage({
          type: "success",
          text: data.message || "Settings prepared. Please update manually in Vercel dashboard.",
        });
        
        if (data.instructions) {
          setTimeout(() => {
            alert("Manual Update Instructions:\n\n" + data.instructions.join("\n"));
          }, 500);
        }
      } else {
        setMessage({
          type: "error",
          text: data.error || data.message || "Failed to save settings",
        });
        
        if (data.results) {
          console.error("Update results:", data.results);
        }
      }
    } catch (err) {
      setMessage({
        type: "error",
        text: "Failed to save settings. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center space-x-4">
          <button
            onClick={() => router.push("/chat")}
            className="text-gray-500 hover:text-black"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center space-x-2">
            <Settings className="h-6 w-6" />
            <h1 className="text-2xl font-bold">Settings</h1>
          </div>
        </div>

        <div className="space-y-6 rounded-xl bg-white p-6 shadow-sm">
          {message && (
            <div
              className={`rounded-lg border p-4 ${
                message.type === "success"
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  Framer Project URL
                </label>
                {config.isConfigured?.framerProjectUrl && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">Configured</span>
                )}
              </div>
              <input
                type="text"
                value={config.framerProjectUrl}
                onChange={(e) =>
                  setConfig({ ...config, framerProjectUrl: e.target.value })
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                placeholder={config.isConfigured?.framerProjectUrl ? "Enter new URL to update" : "https://framer.com/projects/..."}
              />
              {config.isConfigured?.framerProjectUrl && isMaskedValue(config.framerProjectUrl) && (
                <p className="mt-1 text-xs text-gray-500">
                  Current value is hidden. Enter a new value to update it.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  Framer API Key
                </label>
                {config.isConfigured?.framerApiKey && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">Configured</span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showFramerKey ? "text" : "password"}
                  value={config.framerApiKey}
                  onChange={(e) =>
                    setConfig({ ...config, framerApiKey: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                  placeholder={config.isConfigured?.framerApiKey ? "Enter new API key to update" : "Enter Framer API key"}
                />
                <button
                  type="button"
                  onClick={() => setShowFramerKey(!showFramerKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black"
                >
                  {showFramerKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {config.isConfigured?.framerApiKey && isMaskedValue(config.framerApiKey) && (
                <p className="mt-1 text-xs text-gray-500">
                  Current value is hidden. Enter a new value to update it.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  Poe API Key (Optional)
                </label>
                {config.isConfigured?.poeApiKey && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">Configured</span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPoeKey ? "text" : "password"}
                  value={config.poeApiKey}
                  onChange={(e) =>
                    setConfig({ ...config, poeApiKey: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                  placeholder={config.isConfigured?.poeApiKey ? "Enter new API key to update" : "Enter Poe API key (optional)"}
                />
                <button
                  type="button"
                  onClick={() => setShowPoeKey(!showPoeKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black"
                >
                  {showPoeKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {config.isConfigured?.poeApiKey && isMaskedValue(config.poeApiKey) && (
                <p className="mt-1 text-xs text-gray-500">
                  Current value is hidden. Enter a new value to update it.
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Required for AI chat functionality. Get your key from poe.com/settings
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  Framer Blog Collection Name
                </label>
                {config.isConfigured?.framerBlogCollection && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">Configured</span>
                )}
              </div>
              <input
                type="text"
                value={config.framerBlogCollection}
                onChange={(e) =>
                  setConfig({ ...config, framerBlogCollection: e.target.value })
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                placeholder="Services"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <button
              onClick={() => router.push("/chat")}
              className="px-4 py-2 text-gray-700 hover:text-black"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center space-x-2 rounded-lg bg-black px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              <span>Save Settings</span>
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-lg bg-blue-50 border border-blue-200 p-4">
          <h3 className="font-semibold text-blue-900 mb-2">Security Notice</h3>
          <p className="text-sm text-blue-800">
            All credentials are stored securely in Vercel environment variables and are never exposed in the codebase.
            Values shown with "••••" are masked for security. Enter new values to update them.
          </p>
        </div>
      </div>
    </div>
  );
}
