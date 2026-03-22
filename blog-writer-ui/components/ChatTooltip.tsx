"use client";

import React from "react";

/** Matches web.tsx `Tooltip` — dark pill, Inter 12px semibold, side-position layout support. */
interface ChatTooltipProps {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

const TOOLTIP_BG = "hsl(0, 0%, 8%)"; // darkColors.backgroundDark
const TOOLTIP_FG = "hsla(0, 0%, 95%, 1)"; // darkColors.text.primary

export function ChatTooltip({ children, style }: ChatTooltipProps) {
  const [position, setPosition] = React.useState<React.CSSProperties>({
    ...style,
    visibility: "hidden",
  });
  const tooltipRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    if (!tooltipRef.current) return;

    const rect = tooltipRef.current.getBoundingClientRect();
    const parentRect = tooltipRef.current.offsetParent?.getBoundingClientRect();
    const EDGE_PADDING = 8;

    const newStyle: React.CSSProperties = {
      ...style,
      visibility: "visible",
    };

    const isSidePositioned =
      (style?.left === "100%" || style?.right === "100%") &&
      typeof style?.transform === "string" &&
      style.transform.includes("translate");

    if (parentRect && !isSidePositioned) {
      const theoreticalCenter = parentRect.left + parentRect.width / 2;
      const halfWidth = rect.width / 2;
      const theoreticalLeft = theoreticalCenter - halfWidth;
      const theoreticalRight = theoreticalCenter + halfWidth;
      const theoreticalBottom = parentRect.bottom + 8 + rect.height;

      if (theoreticalRight > window.innerWidth - EDGE_PADDING) {
        const offset = parentRect.right - (window.innerWidth - EDGE_PADDING);
        newStyle.right = `${offset}px`;
        newStyle.left = "auto";
        newStyle.transform = "translateY(8px)";
      }

      if (theoreticalLeft < EDGE_PADDING) {
        const offset = EDGE_PADDING - parentRect.left;
        newStyle.left = `${offset}px`;
        newStyle.right = "auto";
        newStyle.transform = "translateY(8px)";
      }

      if (theoreticalBottom > window.innerHeight) {
        newStyle.bottom = "100%";
        newStyle.top = "auto";
        if (newStyle.transform === "translateY(8px)") {
          newStyle.transform = "translateY(-8px)";
        } else {
          newStyle.transform = "translate(-50%, -8px)";
        }
      }
    }

    setPosition((prev) => {
      const isSame = Object.keys(newStyle).every(
        (key) =>
          newStyle[key as keyof React.CSSProperties] ===
          prev[key as keyof React.CSSProperties]
      );
      return isSame ? prev : newStyle;
    });
  }, [style, children]);

  return (
    <div
      ref={tooltipRef}
      style={{
        position: "absolute",
        background: TOOLTIP_BG,
        color: TOOLTIP_FG,
        padding: "4px 12px",
        borderRadius: 28,
        fontSize: 12,
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 600,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: 10,
        userSelect: "none",
        WebkitUserSelect: "none",
        ...position,
      }}
    >
      {children}
    </div>
  );
}
