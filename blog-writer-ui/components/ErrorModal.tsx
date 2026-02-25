"use client";

import { useState } from "react";
import { X, Copy, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  error?: Error | string | unknown;
  details?: string;
}

export default function ErrorModal({
  isOpen,
  onClose,
  title = "Something went wrong",
  message,
  error,
  details,
}: ErrorModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // Build full error details
  const errorDetails = [
    message,
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error || ""),
    error instanceof Error && error.stack ? error.stack : "",
    details || "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(errorDetails);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col animate-in fade-in slide-in-from-top-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-50 flex items-center justify-center">
              <AlertCircle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-semibold text-gray-900">{title}</h2>
              <p className="text-sm text-gray-500 mt-0.5">Internal tool error</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors touch-manipulation"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {/* User-friendly message */}
          <div className="mb-6">
            <p className="text-base text-gray-700 leading-relaxed">{message}</p>
          </div>

          {/* Error details section */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700">Error Details</h3>
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors touch-manipulation"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap break-words overflow-x-auto">
                {errorDetails}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 md:p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full bg-black text-white px-4 py-2.5 rounded-lg hover:bg-gray-800 transition-colors font-medium touch-manipulation"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
