import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import "./App.css";
import { WalletShowcase } from "./components/WalletShowcase";
import { useWalletBalance } from "./hooks/useWalletBalance";
import { useWalletTransactions } from "./hooks/useWalletTransactions";
import { useWebSocketConnection } from "./hooks/useWebSocketConnection";
import { getPublicRoutes, getProtectedRoutes, ROUTES } from "./routes/routes";
import { WalletProvider, useWallet } from "hyli-wallet";
import { WebSocketProvider } from "./providers/WebSocketProvider";

function AppContent() {
    const { wallet, logout } = useWallet();
    const navigate = useNavigate();

    // Use custom hooks
    const { balance, fetchBalance } = useWalletBalance(wallet?.address);
    const { transactions, handleTxEvent } = useWalletTransactions(wallet?.address);

    // Setup WebSocket connection
    useWebSocketConnection(wallet?.address, (event) => {
        handleTxEvent(event);
        // If transaction was successful, update balance
        if (event.tx.status === "Success") {
            fetchBalance();
        }
    });

    const handleLogout = () => {
        logout();
        navigate(ROUTES.ROOT);
    };

    // Generate routes based on authentication state
    const publicRoutes = getPublicRoutes();
    const protectedRoutes = getProtectedRoutes(wallet, balance, transactions, handleLogout);
    const allRoutes = [...publicRoutes, ...protectedRoutes];

    return (
        <div>
            <WalletShowcase providers={["password", "google", "github"]} />
            {wallet && (
                <Routes>
                    {allRoutes.map((route) => (
                        <Route key={route.path} path={route.path} element={route.element}>
                            {route.children?.map((childRoute) => (
                                <Route
                                    key={childRoute.path}
                                    path={childRoute.path}
                                    element={childRoute.element}
                                    index={childRoute.index}
                                />
                            ))}
                        </Route>
                    ))}
                </Routes>
            )}
        </div>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <WalletProvider
                config={{
                    nodeBaseUrl: import.meta.env.VITE_NODE_BASE_URL,
                    walletServerBaseUrl: import.meta.env.VITE_WALLET_SERVER_BASE_URL,
                    applicationWsUrl: import.meta.env.VITE_WALLET_WS_URL,
                }}
                sessionKeyConfig={{
                    duration: 60 * 60 * 1000, // 1 hour
                    whitelist: ["oranj"],
                }}
            >
                <WebSocketProvider>
                    <AppContent />
                </WebSocketProvider>
            </WalletProvider>
        </BrowserRouter>
    );
}
