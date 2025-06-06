import React, { useState } from "react";
import { getAuthErrorMessage } from "hyli-wallet";

export const ErrorMessage: React.FC<{ error: unknown; className?: string }> = ({ error, className = "error-message" }) => {
    const [showDetails, setShowDetails] = useState(false);
    const errorDetails = getAuthErrorMessage(error);
    
    return (
        <div className={className}>
            <div className="error-main-message">
                {errorDetails.userMessage}
            </div>
            {errorDetails.showDetails && errorDetails.technicalMessage && (
                <>
                    <button 
                        className="error-details-toggle"
                        onClick={() => setShowDetails(!showDetails)}
                        style={{
                            background: "none",
                            border: "none",
                            color: "inherit",
                            cursor: "pointer",
                            textDecoration: "underline",
                            fontSize: "0.9em",
                            marginTop: "0.5em"
                        }}
                    >
                        {showDetails ? "Hide" : "Show"} details
                    </button>
                    {showDetails && (
                        <div className="error-technical-details" style={{
                            marginTop: "0.5em",
                            padding: "0.5em",
                            background: "rgba(0,0,0,0.1)",
                            borderRadius: "4px",
                            fontSize: "0.85em",
                            fontFamily: "monospace"
                        }}>
                            {errorDetails.technicalMessage}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};