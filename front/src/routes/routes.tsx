import { Navigate, RouteObject } from "react-router-dom";
import { Balance } from "../components/wallet/Balance";
import { Send } from "../components/wallet/Send";
import { History } from "../components/wallet/History";
import { SessionKeys } from "../components/wallet/SessionKeys";
import { WalletLayout } from "../components/layout/WalletLayout";
import { Wallet } from "hyli-wallet";
import AdminPage from "../components/AdminPage";

// Route path constants
export const ROUTES = {
    ROOT: "/",
    WALLET: "/wallet",
    BALANCE: "/wallet/balance",
    SEND: "/wallet/send",
    RECEIVE: "/wallet/receive",
    HISTORY: "/wallet/history",
    SESSION_KEYS: "/wallet/session-keys",
};

export const getPublicRoutes = (): RouteObject[] => [
    { path: ROUTES.ROOT, element: <Navigate to={ROUTES.WALLET} replace /> },
    { path: "*", element: <Navigate to={ROUTES.ROOT} replace /> },
];

export const getProtectedRoutes = (wallet: Wallet | null, transactions: any[], onLogout: () => void): RouteObject[] => [
    {
        path: ROUTES.WALLET,
        element: <WalletLayout wallet={wallet!} onLogout={onLogout} transactions={transactions} />,
        children: [
            { path: "balance", element: <Navigate to={ROUTES.WALLET} replace /> },
            { path: "send", element: <Send wallet={wallet!} /> },
            { path: "receive", element: <Balance wallet={wallet!} /> },
            { path: "history", element: <History transactions={transactions} /> },
            { path: "session-keys", element: <SessionKeys /> },
            { path: "admin", element: <AdminPage /> },
            { index: true, element: null }, // Dashboard is shown in WalletLayout
        ],
    },
];
