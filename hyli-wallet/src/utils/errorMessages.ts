interface ErrorDetails {
    userMessage: string;
    technicalMessage?: string;
    showDetails?: boolean;
}

export const getAuthErrorMessage = (error: unknown): ErrorDetails => {
    const errorString = error instanceof Error ? error.message : String(error);

    // Account fetching errors
    if (errorString.includes("Fetching") && errorString.includes("account") && errorString.includes("request failed")) {
        const usernameMatch = errorString.match(/"([^"]+)"/);
        const username = usernameMatch ? usernameMatch[1] : "This";
        return {
            userMessage: `No wallet found for username "${username}". Please check your username or create a new wallet.`,
            technicalMessage: errorString,
        };
    }

    // Account creation errors
    if (errorString.includes("already exists")) {
        return {
            userMessage: "This username is already taken. Please choose a different one.",
            technicalMessage: errorString,
        };
    }

    if (errorString.includes("Invalid password") || errorString.includes("Invalid credentials")) {
        return {
            userMessage: "The password you entered is incorrect. Please try again.",
            technicalMessage: errorString,
        };
    }

    if (errorString.includes("Password must be at least")) {
        return {
            userMessage: "Your password is too short. It must be at least 8 characters long.",
            technicalMessage: errorString,
        };
    }

    if (errorString.includes("Passwords do not match")) {
        return {
            userMessage: "The passwords you entered don't match. Please make sure both passwords are the same.",
            technicalMessage: errorString,
        };
    }

    if (errorString.includes("claim invite code")) {
        return {
            userMessage: "Failed to claim invite code. It might be incorrect or already used.",
            technicalMessage: errorString,
        };
    }

    // Transaction errors
    if (errorString.includes("Transaction failed") || errorString.includes("Transaction timed out")) {
        return {
            userMessage:
                "Your transaction couldn't be completed. This might be due to network issues or insufficient funds.",
            technicalMessage: errorString,
            showDetails: true,
        };
    }

    if (errorString.includes("Insufficient balance") || errorString.includes("insufficient funds")) {
        return {
            userMessage: "You don't have enough funds to complete this transaction.",
            technicalMessage: errorString,
        };
    }

    // Session key errors
    if (errorString.includes("Failed to add session key")) {
        return {
            userMessage: "Unable to create a new session key. Please check your password and try again.",
            technicalMessage: errorString,
            showDetails: true,
        };
    }

    if (errorString.includes("Failed to remove session key")) {
        return {
            userMessage: "Unable to remove the session key. It may have already been removed or expired.",
            technicalMessage: errorString,
        };
    }

    if (errorString.includes("Private key not found")) {
        return {
            userMessage: "This session key is not available on this device. You may need to recreate it.",
            technicalMessage: errorString,
        };
    }

    if (errorString.includes("Session key is not valid") || errorString.includes("Session key expired")) {
        return {
            userMessage: "This session key has expired or is no longer valid. Please create a new one.",
            technicalMessage: errorString,
        };
    }

    // Network errors
    if (errorString.includes("Network error") || errorString.includes("fetch failed")) {
        return {
            userMessage: "Unable to connect to the network. Please check your internet connection and try again.",
            technicalMessage: errorString,
        };
    }

    if (errorString.includes("timed out") || errorString.includes("timeout")) {
        return {
            userMessage: "The operation took too long to complete. Please try again.",
            technicalMessage: errorString,
        };
    }

    // Wallet errors
    if (errorString.includes("wallet does not exist")) {
        return {
            userMessage: "No wallet found with this username. Please check your username or create a new wallet.",
            technicalMessage: errorString,
        };
    }

    if (errorString.includes("Failed to load") || errorString.includes("Failed to fetch")) {
        return {
            userMessage: "Unable to load data. Please refresh the page and try again.",
            technicalMessage: errorString,
        };
    }

    // Generic errors
    return {
        userMessage: "Something went wrong. Please try again.",
        technicalMessage: errorString,
        showDetails: true,
    };
};
