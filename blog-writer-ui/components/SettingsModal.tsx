"use client";

import { useState, useEffect } from "react";
import { Save, Eye, EyeOff, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface SettingsConfig {
  framerProjectUrl: string;
  framerApiKey: string;
  framerBlogCollection: string;
  isConfigured?: {
    framerProjectUrl: boolean;
    framerApiKey: boolean;
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
    framerBlogCollection: "Services",
  });
  const [originalConfig, setOriginalConfig] = useState<SettingsConfig | null>(null);
  const [showFramerKey, setShowFramerKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isCloseHovered, setIsCloseHovered] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(typeof window !== "undefined" && window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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

  const inputWrapperStyle = {
    alignSelf: "stretch" as const,
    height: 44,
    padding: "0 16px",
    background: "var(--cs-surface)",
    border: "0.33px solid hsla(0, 0%, 0%, 0.12)",
    borderRadius: 28,
    display: "flex" as const,
    alignItems: "center" as const,
  };

  const labelStyle = {
    color: "var(--cs-text-primary)",
    fontSize: 14,
    fontFamily: "Inter",
    fontWeight: 400,
  };

  const inputStyle = {
    width: "100%" as const,
    background: "transparent",
    border: "none",
    color: "var(--cs-text-primary)",
    fontSize: 14,
    outline: "none" as const,
    fontFamily: "Inter",
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-label="settings-modal"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 30000,
          display: "flex",
          justifyContent: isMobile ? "flex-end" : "center",
          alignItems: isMobile ? "flex-end" : "center",
          pointerEvents: "auto",
        }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: isMobile ? 0.2 : 0.1 }}
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--cs-overlay)",
          }}
          onClick={onClose}
        />

        <motion.div
          initial={isMobile ? { y: "100%", scale: 0, opacity: 0 } : { opacity: 0 }}
          animate={isMobile ? { y: "0%", scale: 1, opacity: 1 } : { opacity: 1 }}
          exit={isMobile ? { y: "100%", scale: 0, opacity: 0 } : { opacity: 0 }}
          transition={{ duration: isMobile ? 0.25 : 0.1, ease: "easeInOut" }}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: isMobile ? "none" : "1 1 0",
            width: isMobile ? "100%" : undefined,
            maxWidth: isMobile ? "none" : 400,
            maxHeight: isMobile ? "calc(100% - 16px)" : 600,
            paddingTop: 24,
            paddingBottom: 28,
            paddingLeft: isMobile ? 16 : 28,
            paddingRight: isMobile ? 16 : 28,
            background: "var(--cs-bg)",
            boxShadow: "0px 4px 24px hsla(0, 0%, 0%, 0.04)",
            overflow: "hidden",
            borderRadius: isMobile ? "24px 24px 0 0" : 48,
            outline: "0.33px solid hsla(0, 0%, 0%, 0.12)",
            outlineOffset: "-0.33px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
            position: "relative",
            zIndex: 1,
          }}
        >
          <style>{`
            .settings-input::placeholder { color: var(--cs-text-secondary); opacity: 0.8; }
            .settings-input::-webkit-input-placeholder { color: var(--cs-text-secondary); opacity: 0.8; }
          `}</style>
          {/* Header — matches You design */}
          <div style={{ alignSelf: "stretch", position: "relative" }}>
            <h2
              style={{
                margin: 0,
                padding: 0,
                color: "var(--cs-text-primary)",
                fontSize: 16,
                fontFamily: "Inter",
                fontWeight: 400,
                lineHeight: "18px",
              }}
            >
              Settings
            </h2>
            <p
              style={{
                margin: "8px 0 0 0",
                color: "var(--cs-text-secondary)",
                fontSize: 12,
                fontFamily: "Inter",
                fontWeight: 400,
                lineHeight: "17px",
              }}
            >
              Framer CMS and AI API configuration for publishing blogs.
            </p>
            <button
              type="button"
              aria-label="Close settings"
              onClick={onClose}
              onMouseEnter={() => setIsCloseHovered(true)}
              onMouseLeave={() => setIsCloseHovered(false)}
              style={{
                position: "absolute",
                right: isMobile ? 0 : -12,
                top: -12,
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isCloseHovered ? "var(--cs-hover-strong)" : "transparent",
                borderRadius: "50%",
                border: "none",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M11.1016 0.599998L0.601562 11.1M0.601562 0.599998L11.1016 11.1" stroke="var(--cs-text-primary)" strokeOpacity="0.95" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Content — scrollable */}
          <div style={{ flex: "1 1 auto", overflowY: "auto", display: "flex", flexDirection: "column", gap: 24, minHeight: 0 }}>
            {message && (
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: 28,
                  fontSize: 14,
                  fontFamily: "Inter",
                  background: message.type === "success" ? "hsla(142, 71%, 45%, 0.15)" : "hsla(0, 84%, 50%, 0.15)",
                  color: message.type === "success" ? "hsl(142, 71%, 35%)" : "hsl(0, 84%, 45%)",
                  border: `0.33px solid ${message.type === "success" ? "hsla(142, 71%, 45%, 0.3)" : "hsla(0, 84%, 50%, 0.3)"}`,
                }}
              >
                {message.text}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Framer Project URL */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={labelStyle}>Framer Project URL</div>
                <div style={{ ...inputWrapperStyle, position: "relative" }}>
                  {config.isConfigured?.framerProjectUrl && (
                    <span style={{ position: "absolute", right: 12, fontSize: 11, color: "var(--cs-text-secondary)" }}>Configured</span>
                  )}
                  <input
                    type="text"
                    value={config.framerProjectUrl}
                    onChange={(e) => setConfig({ ...config, framerProjectUrl: e.target.value })}
                    placeholder={config.isConfigured?.framerProjectUrl ? "Enter new URL to update" : "https://framer.com/projects/..."}
                    style={inputStyle}
                    className="settings-input"
                  />
                </div>
              </div>

              {/* Framer API Key */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={labelStyle}>Framer API Key</div>
                <div style={{ ...inputWrapperStyle, position: "relative", paddingRight: 44 }}>
                  {config.isConfigured?.framerApiKey && (
                    <span style={{ position: "absolute", right: 44, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--cs-text-secondary)" }}>Configured</span>
                  )}
                  <input
                    type={showFramerKey ? "text" : "password"}
                    value={config.framerApiKey}
                    onChange={(e) => setConfig({ ...config, framerApiKey: e.target.value })}
                    placeholder={config.isConfigured?.framerApiKey ? "Enter new key to update" : "Enter Framer API key"}
                    style={inputStyle}
                    className="settings-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowFramerKey(!showFramerKey)}
                    style={{
                      position: "absolute",
                      right: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--cs-text-secondary)",
                      padding: 4,
                    }}
                    aria-label={showFramerKey ? "Hide" : "Show"}
                  >
                    {showFramerKey ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
                  </button>
                </div>
              </div>

              {/* Framer Blog Collection */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={labelStyle}>Framer Blog Collection Name</div>
                <div style={inputWrapperStyle}>
                  <input
                    type="text"
                    value={config.framerBlogCollection}
                    onChange={(e) => setConfig({ ...config, framerBlogCollection: e.target.value })}
                    placeholder="Services"
                    style={inputStyle}
                    className="settings-input"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Footer — Save / Cancel */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, flexShrink: 0 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "10px 16px",
                background: "transparent",
                border: "none",
                color: "var(--cs-text-secondary)",
                fontSize: 14,
                fontFamily: "Inter",
                cursor: "pointer",
                borderRadius: 28,
                minHeight: 44,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                background: "var(--cs-accent)",
                color: "var(--cs-bg)",
                border: "none",
                borderRadius: 28,
                fontSize: 14,
                fontFamily: "Inter",
                fontWeight: 500,
                cursor: saving ? "not-allowed" : "pointer",
                minHeight: 44,
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <Save style={{ width: 16, height: 16 }} />}
              <span>Save Settings</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
