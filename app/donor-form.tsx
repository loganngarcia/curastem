/**
 * Donation Form
 *
 * A high-fidelity recreation of the requested donation form UI.
 * Now integrated with Stripe Payment Links via Property Controls.
 *
 * @framerIntrinsicWidth 480
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight auto
 */
import React, { useState, useMemo, type CSSProperties, type ChangeEvent } from "react"
import { addPropertyControls, ControlType } from "framer"
import { motion, AnimatePresence } from "framer-motion"

export default function DonationForm(props) {
    const {
        baseStripeUrl,
        accentColor,
        backgroundColor,
        inputBackgroundColor,
        textColor,
        subtitleColor,
        placeholderColor,
        selectedBackgroundColor = "#FFFFFF",
        selectedTextColor = "#000000",
        selectedShadow = "0px 1px 2px 0px rgba(0, 0, 0, 0.1)",
        containerRadius,
        elementRadius,
        donateButtonRadius,
        font,
        buttonFont,
        titleFont,
        padding = "16px",
        gap = 24,
        enableGlare = true,
        glareColor = "rgba(255, 255, 255, 0.08)",
        donateTitle = "Donate",
        amountTitle = "Amount",
        donateButtonLabel = "Donate",
        customAmountPlaceholder = "Enter amount",
        style,
    } = props

    const uniqueId = useMemo(
        () => `donation-form-${Math.random().toString(36).substr(2, 9)}`,
        []
    )

    const [frequency, setFrequency] = useState("One-time")
    const [amount, setAmount] = useState("$5")
    const [customAmount, setCustomAmount] = useState("")
    const [focusedField, setFocusedField] = useState<string | null>(null)

    // Styles
    const containerStyle: CSSProperties = {
        ...style,
        width: "100%",
        padding,
        backgroundColor: backgroundColor,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderRadius: containerRadius,
        display: "flex",
        flexDirection: "column",
        gap,
        ...font,
        color: textColor,
        position: "relative",
        overflow: "visible",
    }

    const labelStyle: CSSProperties = {
        fontSize: 17,
        marginBottom: 8,
        display: "block",
        color: subtitleColor,
        ...titleFont,
    }

    const inputStyle = (name: string): CSSProperties => ({
        width: "100%",
        padding: "12px 16px",
        backgroundColor: inputBackgroundColor,
        border: `1px solid ${focusedField === name ? accentColor : "transparent"}`,
        borderRadius: elementRadius,
        color: textColor,
        outline: "none",
        fontSize: 15,
        transition: "all 0.2s ease",
        boxShadow:
            focusedField === name
                ? "0px 1px 2px 0px rgba(0, 0, 0, 0.12)"
                : "none",
        ...font,
    })

    const buttonGroupStyle: CSSProperties = {
        display: "flex",
        backgroundColor: inputBackgroundColor,
        padding: 0,
        borderRadius: elementRadius,
        gap: 0,
    }

    const toggleButtonStyle = (isSelected: boolean): CSSProperties => ({
        flex: 1,
        padding: "12px 0",
        borderRadius: elementRadius,
        border: "none",
        backgroundColor: "transparent",
        color: isSelected ? selectedTextColor : textColor,
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 500,
        transition: "color 0.2s ease",
        ...font,
        position: "relative",
        isolation: "isolate",
    })

    const amountButtonStyle = (val: string): CSSProperties => ({
        flex: 1,
        padding: "12px 0",
        borderRadius: elementRadius,
        border: "none",
        backgroundColor: inputBackgroundColor,
        color: amount === val ? selectedTextColor : placeholderColor,
        cursor: "pointer",
        fontSize: 15,
        fontWeight: 500,
        transition: "color 0.2s ease",
        ...font,
        position: "relative",
        isolation: "isolate",
    })

    return (
        <div id={uniqueId} style={containerStyle}>
            {/* Frequency Section */}
            <div>
                <span style={labelStyle}>{donateTitle}</span>
                {/* Segmented Control */}
                <div style={buttonGroupStyle}>
                    {["One-time", "Monthly"].map((opt) => {
                        const isSelected = frequency === opt
                        return (
                            <button
                                key={opt}
                                style={toggleButtonStyle(isSelected)}
                                onClick={() => setFrequency(opt)}
                            >
                                {isSelected && (
                                    <motion.div
                                        layoutId="frequency-bg"
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            right: 0,
                                            bottom: 0,
                                            backgroundColor: selectedBackgroundColor,
                                            borderRadius: elementRadius,
                                            zIndex: -1,
                                            boxShadow: selectedShadow,
                                        }}
                                        transition={{
                                            type: "spring",
                                            stiffness: 300,
                                            damping: 35,
                                        }}
                                    />
                                )}
                                <span
                                    style={{ position: "relative", zIndex: 1 }}
                                >
                                    {opt}
                                </span>
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Amount Section */}
            <div>
                <span style={labelStyle}>{amountTitle}</span>
                <div style={{ display: "flex", gap: 8 }}>
                    {["$5", "$25", "$100", "Other"].map((val) => (
                        <button
                            key={val}
                            style={amountButtonStyle(val)}
                            onClick={() => setAmount(val)}
                        >
                            {amount === val && (
                                <motion.div
                                    layoutId="amount-bg"
                                    style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        right: 0,
                                        bottom: 0,
                                        backgroundColor: selectedBackgroundColor,
                                        borderRadius: elementRadius,
                                        zIndex: -1,
                                        boxShadow: selectedShadow,
                                    }}
                                    transition={{
                                        type: "spring",
                                        stiffness: 300,
                                        damping: 35,
                                    }}
                                />
                            )}
                            <span style={{ position: "relative", zIndex: 1 }}>{val}</span>
                        </button>
                    ))}
                </div>
                <AnimatePresence initial={false}>
                    {amount === "Other" && (
                        <motion.div
                            key="custom-amount"
                            initial={{ height: 0, opacity: 0, borderRadius: elementRadius }}
                            animate={{ height: "auto", opacity: 1, borderRadius: elementRadius }}
                            exit={{ height: 0, opacity: 0, borderRadius: elementRadius }}
                            transition={{
                                type: "spring",
                                stiffness: 550,
                                damping: 48,
                                mass: 1,
                            }}
                            style={{ overflow: "hidden" }}
                        >
                            <div
                                style={{
                                    paddingTop: 8,
                                    padding: "8px 1px 1px 1px",
                                }}
                            >
                                <input
                                    style={inputStyle("customAmount")}
                                    placeholder={customAmountPlaceholder}
                                    value={customAmount}
                                    onChange={(e) => {
                                        const val = e.target.value
                                        // Strictly allow only numbers and a single decimal point
                                        if (val === "" || /^\d*\.?\d*$/.test(val)) {
                                            setCustomAmount(val)
                                        }
                                    }}
                                    inputMode="decimal"
                                    onFocus={() =>
                                        setFocusedField("customAmount")
                                    }
                                    onBlur={() => setFocusedField(null)}
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Donate Button */}
            <motion.button
                onClick={() => {
                    if (!baseStripeUrl) {
                        alert("Please configure the Stripe URL in property controls.")
                        return
                    }

                    let cents = 0
                    if (amount === "$5") cents = 500
                    else if (amount === "$25") cents = 2500
                    else if (amount === "$100") cents = 10000
                    else if (amount === "Other") {
                         // Parse custom amount. Remove currency symbols and non-numeric except decimal
                         const cleaned = customAmount.replace(/[^0-9.]/g, "")
                         const val = parseFloat(cleaned)
                         if (isNaN(val) || val <= 0) {
                             alert("Please enter a valid amount")
                             return
                         }
                         cents = Math.round(val * 100)
                    }

                    // Construct URL
                    try {
                        const url = new URL(baseStripeUrl)
                        url.searchParams.set("__prefilled_amount", cents.toString())
                        window.open(url.toString(), "_blank")
                    } catch (e) {
                        console.error("Invalid URL:", baseStripeUrl)
                        alert("Invalid Stripe URL configuration")
                    }
                }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                style={{
                    width: "100%",
                    padding: "16px",
                    backgroundColor: accentColor,
                    border: "none",
                    borderRadius: donateButtonRadius,
                    color: "#FFFFFF",
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: "pointer",
                    marginTop: 8,
                    position: "relative",
                    overflow: "hidden",
                    ...buttonFont,
                }}
            >
                <span style={{ position: "relative", zIndex: 1 }}>{donateButtonLabel}</span>
                {enableGlare && (
                    <motion.div
                        initial={{ x: "-150%" }}
                        animate={{ x: "250%" }}
                        transition={{
                            repeat: Infinity,
                            repeatDelay: 2,
                            duration: 1,
                            ease: "linear",
                        }}
                        style={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: 0,
                            width: "50%",
                            background: `linear-gradient(90deg, transparent, ${glareColor}, transparent)`,
                            zIndex: 0,
                        }}
                    />
                )}
            </motion.button>

            {/* Placeholder Styles Injection */}
            <style>
                {`
                    #${uniqueId} input::placeholder, #${uniqueId} textarea::placeholder {
                        color: ${placeholderColor} !important;
                        opacity: 1;
                    }
                    #${uniqueId} option {
                        background-color: #333;
                        color: white;
                    }
                `}
            </style>
        </div>
    )
}

addPropertyControls(DonationForm, {
    baseStripeUrl: {
        type: ControlType.String,
        title: "Stripe URL",
        defaultValue: "https://donate.stripe.com/6oUcN5bIJ3hTc0F366b7y00",
        description: "Base Stripe Donate URL (without query params)"
    },
    accentColor: {
        type: ControlType.Color,
        title: "Accent",
        defaultValue: "#0099FF",
    },
    backgroundColor: {
        type: ControlType.Color,
        title: "Background",
        defaultValue: "rgba(255, 255, 255, 0.12)",
    },
    inputBackgroundColor: {
        type: ControlType.Color,
        title: "Input Bg",
        defaultValue: "rgba(255, 255, 255, 0.24)",
    },
    textColor: {
        type: ControlType.Color,
        title: "Text",
        defaultValue: "rgba(0, 0, 0, 0.95)",
    },
    subtitleColor: {
        type: ControlType.Color,
        title: "Subtitle",
        defaultValue: "rgba(255, 255, 255, 0.65)",
    },
    placeholderColor: {
        type: ControlType.Color,
        title: "Placeholder",
        defaultValue: "rgba(0, 0, 0, 0.65)",
    },
    selectedBackgroundColor: {
        type: ControlType.Color,
        title: "Selected Bg",
        defaultValue: "#FFFFFF",
    },
    selectedTextColor: {
        type: ControlType.Color,
        title: "Selected Txt",
        defaultValue: "#000000",
    },
    selectedShadow: {
        type: ControlType.BoxShadow,
        title: "Active Shadow",
        defaultValue: "0px 1px 2px 0px rgba(0, 0, 0, 0.1)",
    },
    containerRadius: {
        type: ControlType.Number,
        title: "Radius",
        defaultValue: 28,
        min: 0,
        max: 100,
    },
    padding: {
        type: ControlType.Padding,
        title: "Padding",
        defaultValue: "16px",
    },
    gap: {
        type: ControlType.Number,
        title: "Gap",
        defaultValue: 24,
        min: 0,
        max: 100,
    },
    elementRadius: {
        type: ControlType.Number,
        title: "Elem Radius",
        defaultValue: 14,
        min: 0,
        max: 50,
    },
    donateButtonRadius: {
        type: ControlType.Number,
        title: "CTA Radius",
        defaultValue: 28,
        min: 0,
        max: 50,
    },
    titleFont: {
        type: ControlType.Font,
        title: "Label Font",
        defaultValue: {
            fontSize: 17,
            lineHeight: "1.2em",
            fontWeight: 400,
        },
        controls: "extended",
        defaultFontType: "sans-serif",
    },
    font: {
        type: ControlType.Font,
        title: "Input Font",
        defaultValue: {
            fontSize: 15,
            lineHeight: "1.4em",
            fontWeight: 400,
        },
        controls: "extended",
        defaultFontType: "sans-serif",
    },
    buttonFont: {
        type: ControlType.Font,
        title: "Button Font",
        defaultValue: {
            fontSize: 16,
            lineHeight: "1.2em",
            fontWeight: 600,
        },
        controls: "extended",
        defaultFontType: "sans-serif",
    },
    donateTitle: {
        type: ControlType.String,
        title: "Title",
        defaultValue: "Donate",
    },
    amountTitle: {
        type: ControlType.String,
        title: "Amt Label",
        defaultValue: "Amount",
    },
    donateButtonLabel: {
        type: ControlType.String,
        title: "CTA Label",
        defaultValue: "Donate",
    },
    customAmountPlaceholder: {
        type: ControlType.String,
        title: "Input Text",
        defaultValue: "Enter amount",
    },
    enableGlare: {
        type: ControlType.Boolean,
        title: "Enable Glare",
        defaultValue: true,
    },
    glareColor: {
        type: ControlType.Color,
        title: "Glare Color",
        defaultValue: "rgba(255, 255, 255, 0.08)",
    },
})