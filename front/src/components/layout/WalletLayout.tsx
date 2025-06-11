import { useRef, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Wallet } from "hyli-wallet";
import { Dashboard } from "../Dashboard";
import { useTheme } from "../../contexts/ThemeContext";
import "./WalletLayout.css";

interface WalletLayoutProps {
    wallet: Wallet;
    onLogout: () => void;
    transactions?: any[];
}

export const WalletLayout = ({ wallet, onLogout }: WalletLayoutProps) => {
    const navigate = useNavigate();
    const location = useLocation();
    const [showSettings, setShowSettings] = useState(false);
    const { theme, toggleTheme } = useTheme();

    // Check if we're on the dashboard
    const isDashboard = location.pathname === "/wallet" || location.pathname === "/wallet/balance";

    const handleSendClick = () => {
        navigate("/wallet/send");
    };

    const handleReceiveClick = () => {
        navigate("/wallet/receive");
    };

    const handleSettingsClick = () => {
        setShowSettings(!showSettings);
        return true;
    };

    const closing = useRef<any>(null);
    const abortClosing = () => {
        if (closing.current) {
            clearTimeout(closing.current);
            closing.current = null;
        }
    };
    const closeSoon = () => {
        if (closing.current) {
            clearTimeout(closing.current);
        }
        closing.current = setTimeout(() => {
            if (showSettings) setShowSettings(false);
        }, 350);
    };

    return (
        <div className="wallet-app">
            <header className="wallet-header">
                <div className="header-content">
                    <div className="header-logo" onClick={() => navigate("/wallet")}>
                        <img
                            src="https://cdn.prod.website-files.com/67feddab25a3d6e0f91ec981/680c3634a508fe47cc1c840c_hyli_svg_orange.svg"
                            alt="Hyli"
                            className="logo-img"
                        />
                    </div>

                    <div className="header-actions">
                        <button className="icon-button theme-toggle" onClick={toggleTheme}>
                            {theme === "dark" ? "☀️" : "🌙"}
                        </button>
                        <div className="settings-container">
                            <button className="icon-button settings" onClick={handleSettingsClick}>
                                ⚙️
                            </button>
                            {/* Settings Dropdown */}
                            {showSettings && (
                                <div className="settings-dropdown" onMouseEnter={abortClosing} onMouseLeave={closeSoon}>
                                    <div className="settings-menu">
                                        <button
                                            onClick={() => handleSettingsClick() && navigate("/wallet/session-keys")}
                                        >
                                            🔑 Session Keys
                                        </button>
                                        <button onClick={() => handleSettingsClick() && navigate("/wallet/history")}>
                                            📊 Full History
                                        </button>
                                        {wallet.username === "hyli" && (
                                            <button onClick={() => handleSettingsClick() && navigate("/wallet/admin")}>
                                                🛠️ Admin Panel
                                            </button>
                                        )}
                                        <div className="settings-divider" />
                                        <button
                                            className="settings-logout"
                                            onClick={() => handleSettingsClick() && onLogout()}
                                        >
                                            🚪 Sign Out
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="user-menu">
                            <div className="user-avatar">{wallet.username.charAt(0).toUpperCase()}</div>
                            <div className="user-info">
                                <span className="username">{wallet.username}</span>
                                <button className="logout-link" onClick={onLogout}>
                                    Sign out
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="wallet-main">
                {isDashboard ? (
                    <Dashboard wallet={wallet} onSendClick={handleSendClick} onReceiveClick={handleReceiveClick} />
                ) : (
                    <div className="page-container">
                        <Outlet />
                    </div>
                )}
            </main>
        </div>
    );
};
