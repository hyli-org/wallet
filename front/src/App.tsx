import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import "./App.css";
import { WalletShowcase } from "./components/WalletShowcase";
import { useWalletBalance } from "./hooks/useWalletBalance";
import { useWalletTransactions } from "./hooks/useWalletTransactions";
import { useWebSocketConnection } from "./hooks/useWebSocketConnection";
import { getPublicRoutes, getProtectedRoutes, ROUTES } from "./routes/routes";
import { WalletProvider, useWallet } from "hyli-wallet";
import { WebSocketProvider } from "./providers/WebSocketProvider";
import { ThemeProvider } from "./contexts/ThemeContext";
import { declareCustomElement } from "testnet-maintenance-widget";
import { ConfigService } from "./services/ConfigService";
declareCustomElement();

function AppContent() {
    const { wallet, logout } = useWallet();
    const navigate = useNavigate();

    // Use custom hooks
    const { fetchBalance } = useWalletBalance(wallet?.address);
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
    const protectedRoutes = getProtectedRoutes(wallet, transactions, handleLogout);
    const allRoutes = [...publicRoutes, ...protectedRoutes];

    return (
        <>
            {!wallet && <WalletShowcase providers={["password", "google", "metamask", "github"]} />}
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
        </>
    );
}

export default function App() {
    return (
        <ThemeProvider>
            <BrowserRouter>
                <WalletProvider
                    config={{
                        nodeBaseUrl: ConfigService.getNodeBaseUrl(),
                        walletServerBaseUrl: ConfigService.getWalletServerBaseUrl(),
                        applicationWsUrl: ConfigService.getApplicationWsUrl(),
                    }}
                    sessionKeyConfig={{
                        duration: 60 * 60 * 1000, // 1 hour
                        whitelist: ["oranj"],
                    }}
                    forceSessionKey={true}
                >
                    <WebSocketProvider>
                        {/* @ts-ignore */}
                        <maintenance-widget nodeUrl={ConfigService.getNodeBaseUrl()} />
                        <AppContent />
                    </WebSocketProvider>
                </WalletProvider>
            </BrowserRouter>
        </ThemeProvider>
    );
}
