import { useEffect, useState } from "react";
import { fetchConfig } from "../services/config";
import { setWalletContractName } from "../types/wallet";

export function useConfig() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await fetchConfig();
        setWalletContractName(config.contract_name);
        setIsLoading(false);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load configuration",
        );
        setIsLoading(false);
      }
    };

    loadConfig();
  }, []);

  return { isLoading, error };
}
