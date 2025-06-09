import { useState, useEffect } from "react";
import { indexerService } from "../services/IndexerService";

export function useWalletBalance(address: string | undefined, token: string = "oranj") {
    const [balance, setBalance] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const fetchBalance = async () => {
        if (!address) return;

        setIsLoading(true);
        setError(null);

        try {
            const balance = await indexerService.getBalance(address, token);
            setBalance(balance);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to fetch balance");
            console.error("Error fetching balance:", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (address) {
            fetchBalance();
        }
    }, [address]);

    return { balance, isLoading, error, fetchBalance };
}
