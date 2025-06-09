import { Navigate, RouteObject } from "react-router-dom";
import { Balance } from "../components/wallet/Balance";
import { Send } from "../components/wallet/Send";
import { History } from "../components/wallet/History";
import { SessionKeys } from "../components/wallet/SessionKeys";
import { WalletLayout } from "../components/layout/WalletLayout";
import { Wallet } from "hyli-wallet";

// Route path constants
export const ROUTES = {
    ROOT: "/",
    WALLET: "/wallet",
    BALANCE: "/wallet/balance",
    SEND: "/wallet/send",
    HISTORY: "/wallet/history",
    SESSION_KEYS: "/wallet/session-keys",
};

export const getPublicRoutes = (): RouteObject[] => [
    { path: ROUTES.ROOT, element: <Navigate to={ROUTES.BALANCE} replace /> },
    { path: "*", element: <Navigate to={ROUTES.ROOT} replace /> },
];

export const getProtectedRoutes = (wallet: Wallet | null, transactions: any[], onLogout: () => void): RouteObject[] => [
    {
        path: ROUTES.WALLET,
        element: <WalletLayout wallet={wallet!} onLogout={onLogout} />,
        children: [
            { path: "balance", element: <Balance wallet={wallet!} /> },
            { path: "send", element: <Send wallet={wallet!} /> },
            { path: "history", element: <History transactions={transactions} /> },
            { path: "session-keys", element: <SessionKeys /> },
            { index: true, element: <Navigate to="balance" replace /> },
        ],
    },
];
