import React from "react";
import { QRCodeSVG } from "qrcode.react";
import type { QRSigningRequest } from "../../services/QRSigningService";
import "./QRCodeDisplay.css";

export type QRStatus = "waiting" | "received" | "error" | "timeout";

export interface QRCodeDisplayProps {
    signingRequest: QRSigningRequest;
    qrData: string;
    onCancel: () => void;
    status: QRStatus;
    errorMessage?: string;
    classPrefix?: string;
}

export const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({
    signingRequest,
    qrData,
    onCancel,
    status,
    errorMessage,
    classPrefix = "hyli",
}) => {
    return (
        <div className={`${classPrefix}-qr-display`}>
            {status === "waiting" && (
                <>
                    <div className={`${classPrefix}-qr-code-container`}>
                        <QRCodeSVG
                            value={qrData}
                            size={200}
                            level="M"
                            includeMargin={true}
                        />
                    </div>

                    <div className={`${classPrefix}-qr-info`}>
                        <p className={`${classPrefix}-qr-description`}>
                            {signingRequest.description}
                        </p>
                        <p className={`${classPrefix}-qr-instructions`}>
                            Scan this QR code with your Hyli App to sign
                        </p>
                    </div>

                    <button
                        type="button"
                        className={`${classPrefix}-qr-cancel-button`}
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                </>
            )}

            {status === "received" && (
                <div className={`${classPrefix}-qr-success`}>
                    <div className={`${classPrefix}-qr-success-icon`}>
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                            <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                    </div>
                    <p className={`${classPrefix}-qr-success-text`}>Signature received!</p>
                </div>
            )}

            {(status === "error" || status === "timeout") && (
                <div className={`${classPrefix}-qr-error`}>
                    <div className={`${classPrefix}-qr-error-icon`}>
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                    </div>
                    <p className={`${classPrefix}-qr-error-text`}>
                        {status === "timeout" ? "Request timed out" : errorMessage || "An error occurred"}
                    </p>
                </div>
            )}
        </div>
    );
};
