import React from "react";
import { getAuthErrorMessage } from "hyli-wallet";

export const ErrorMessage: React.FC<{ error: unknown; className?: string }> = ({ error, className = "error-message" }) => {
    const errorDetails = getAuthErrorMessage(error);
    
    return (
        <div className={className}>
            <div className="error-main-message">
                {errorDetails.userMessage}
            </div>
            {errorDetails.showDetails && errorDetails.technicalMessage && (
                <div className="error-technical-details">
                    {errorDetails.technicalMessage}
                </div>
            )}
        </div>
    );
};