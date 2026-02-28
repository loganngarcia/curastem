"use client";

import { useState, useEffect } from "react";
import { Settings, Save, X, Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

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

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [config, setConfig] = useState<SettingsConfig>({
    framerProjectUrl: "",
    framerApiKey: "",
    poeApiKey: "",
    framerBlogCollection: "Services",
  });
  const [originalConfig, setOriginalConfig] = useState<SettingsConfig | null>(null);
  const [showFramerKey, setShowFramerKey] = useState(false);
  const [showPoeKey, setShowPoeKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
    }
  }, [isOpen]);

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
    }
  };

  const isMaskedValue = (value: string): boolean => {
    return value.includes("••••") || value === "";
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    
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
    }

    if (Object.keys(payload).length === 0) {
      setMessage({ type: "error", text: "No changes detected to save." });
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
        await fetchSettings();
      } else {
        setMessage({
          type: "error",
          text: data.error || data.message || "Failed to save settings",
        });
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

  if (!isOpen) return null;

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-label="settings-modal"
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div 
          className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col mx-0 md:mx-4 h-full md:h-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <Settings className="h-5 w-5 md:h-6 md:w-6" />
              <h1 className="text-xl md:text-2xl font-bold">Settings</h1>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="space-y-6">
                {message && (
                  <div
                    className={cn(
                      "rounded-lg border p-4",
                      message.type === "success"
                        ? "border-green-200 bg-green-50 text-green-800"
                        : "border-red-200 bg-red-50 text-red-800"
                    )}
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
                        <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded">Configured</span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={config.framerProjectUrl}
                      onChange={(e) => setConfig({ ...config, framerProjectUrl: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-3 md:py-2 focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-base"
                      placeholder={config.isConfigured?.framerProjectUrl ? "Enter new URL to update" : "https://framer.com/projects/..."}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-gray-700">
                        Framer API Key
                      </label>
                      {config.isConfigured?.framerApiKey && (
                        <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded">Configured</span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={showFramerKey ? "text" : "password"}
                        value={config.framerApiKey}
                        onChange={(e) => setConfig({ ...config, framerApiKey: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                        placeholder={config.isConfigured?.framerApiKey ? "Enter new API key to update" : "Enter Framer API key"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowFramerKey(!showFramerKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black"
                      >
                        {showFramerKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-gray-700">
                        Poe API Key
                      </label>
                      {config.isConfigured?.poeApiKey && (
                        <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded">Configured</span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={showPoeKey ? "text" : "password"}
                        value={config.poeApiKey}
                        onChange={(e) => setConfig({ ...config, poeApiKey: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                        placeholder={config.isConfigured?.poeApiKey ? "Enter new API key to update" : "Enter Poe API key"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPoeKey(!showPoeKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black"
                      >
                        {showPoeKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-gray-700">
                        Framer Blog Collection Name
                      </label>
                      {config.isConfigured?.framerBlogCollection && (
                        <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded">Configured</span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={config.framerBlogCollection}
                      onChange={(e) => setConfig({ ...config, framerBlogCollection: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-3 md:py-2 focus:border-black focus:outline-none focus:ring-1 focus:ring-black text-base"
                      placeholder="Services"
                    />
                  </div>
                </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 p-4 md:p-6 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-3 md:py-2 text-gray-700 hover:text-black active:text-gray-900 transition-colors touch-manipulation min-h-[44px]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center space-x-2 rounded-lg bg-black px-4 py-3 md:py-2 text-white hover:bg-gray-800 active:bg-gray-700 disabled:opacity-50 transition-colors touch-manipulation min-h-[44px]"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              <span>Save Settings</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
