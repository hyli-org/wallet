import { useState, useEffect, useCallback } from "react";
import { indexerService } from "../services/IndexerService";
import { AppEvent, Transaction } from "../services/WebSocketService";

export function useWalletTransactions(address: string | undefined) {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const fetchTransactions = useCallback(async () => {
        if (!address) return;

        setIsLoading(true);
        setError(null);

        try {
            const txHistory = await indexerService.getAllTransactionHistory(address);
            setTransactions(txHistory);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to fetch transaction history");
            console.error("Error fetching transactions:", err);
        } finally {
            setIsLoading(false);
        }
    }, [address]);

    const handleTxEvent = useCallback((event: AppEvent["TxEvent"]) => {
        console.log("Received transaction event:", event);
        const newTransaction: Transaction = event.tx;

        setTransactions((prevTransactions) => {
            const existingIndex = prevTransactions.findIndex((tx) => tx.id === newTransaction.id);
            if (existingIndex !== -1) {
                console.log("Updating existing transaction");
                // Update existing transaction in-place
                const updatedTransactions = [...prevTransactions];
                updatedTransactions[existingIndex] = newTransaction;
                return updatedTransactions;
            } else {
                console.log("Adding new transaction");
                // Add new transaction at the beginning of the list
                return [newTransaction, ...prevTransactions];
            }
        });
    }, []);

    useEffect(() => {
        if (address) {
            fetchTransactions();
        }
    }, [address, fetchTransactions]);

    return {
        transactions,
        isLoading,
        error,
        fetchTransactions,
        handleTxEvent,
    };
}
