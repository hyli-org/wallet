import { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { authProviderManager } from "../providers/AuthProviderManager";
import { AuthForm } from "./auth/AuthForm";
import "./HyliWallet.css";
import type { ProviderOption } from "../hooks/useWallet";
import { useWallet, useWalletInternal } from "../hooks/useWallet";

// SVG Icons for providers
const ProviderIcons = {
    password: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="6" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
            <path
                d="M16 14C16 15.1046 16.8954 16 18 16C19.1046 16 20 15.1046 20 14C20 12.8954 19.1046 12 18 12C16.8954 12 16 12.8954 16 14Z"
                fill="currentColor"
            />
            <path d="M2 10H22" stroke="currentColor" strokeWidth="2" />
        </svg>
    ),
    google: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M21.8055 10.0415H12V14.0415H17.6515C16.827 16.3275 14.6115 17.875 12 17.875C8.8385 17.875 6.25 15.2865 6.25 12.125C6.25 8.9635 8.8385 6.375 12 6.375C13.5145 6.375 14.8695 6.9525 15.9065 7.875L18.8075 4.974C17.0565 3.342 14.6805 2.375 12 2.375C6.6165 2.375 2.25 6.7415 2.25 12.125C2.25 17.5085 6.6165 21.875 12 21.875C16.8705 21.875 21.1875 18.3405 21.1875 12.125C21.1875 11.4405 21.0585 10.7275 20.9055 10.0415H21.8055Z"
                fill="#4285F4"
            />
            <path
                d="M3.8535 7.4675L7.209 9.9335C8.0865 7.8375 9.8865 6.375 12 6.375C13.5145 6.375 14.8695 6.9525 15.9065 7.875L18.8075 4.974C17.0565 3.342 14.6805 2.375 12 2.375C8.481 2.375 5.4405 4.455 3.8535 7.4675Z"
                fill="#EA4335"
            />
            <path
                d="M12 21.875C14.6235 21.875 16.9535 20.9475 18.694 19.3755L15.513 16.692C14.481 17.417 13.2455 17.8755 12 17.875C9.399 17.875 7.19 16.3415 6.3595 14.0695L3.0265 16.651C4.596 19.7105 8.1575 21.875 12 21.875Z"
                fill="#34A853"
            />
            <path
                d="M21.1875 12.125C21.1875 11.4405 21.0585 10.7275 20.9055 10.0415H12V14.0415H17.6515C17.2555 15.1905 16.536 16.1555 15.513 16.692L18.694 19.3755C20.7435 17.4545 21.1875 14.9455 21.1875 12.125Z"
                fill="#4285F4"
            />
            <path
                d="M6.3595 14.0695C6.1095 13.3845 5.9685 12.6465 5.9685 11.875C5.9685 11.1035 6.1095 10.3655 6.3595 9.6805L3.0265 7.1C2.4195 8.5785 2.0625 10.183 2.0625 11.875C2.0625 13.567 2.4195 15.1715 3.0265 16.65L6.3595 14.0695Z"
                fill="#FBBC05"
            />
        </svg>
    ),
    github: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M12 2C6.477 2 2 6.477 2 12C2 16.419 4.865 20.166 8.839 21.489C9.339 21.582 9.525 21.276 9.525 21.012C9.525 20.775 9.517 20.088 9.513 19.255C6.728 19.878 6.138 17.857 6.138 17.857C5.681 16.705 5.029 16.399 5.029 16.399C4.121 15.758 5.098 15.771 5.098 15.771C6.101 15.841 6.63 16.821 6.63 16.821C7.521 18.341 8.969 17.905 9.543 17.65C9.635 17.014 9.899 16.579 10.188 16.341C7.976 16.099 5.65 15.239 5.65 11.379C5.65 10.225 6.038 9.285 6.65 8.554C6.546 8.303 6.205 7.268 6.75 5.903C6.75 5.903 7.587 5.636 9.5 6.848C10.3 6.634 11.15 6.527 12 6.523C12.85 6.527 13.7 6.634 14.5 6.848C16.412 5.636 17.249 5.903 17.249 5.903C17.794 7.268 17.453 8.303 17.349 8.554C17.962 9.285 18.349 10.225 18.349 11.379C18.349 15.249 16.018 16.095 13.8 16.329C14.161 16.625 14.487 17.209 14.487 18.098C14.487 19.343 14.474 20.682 14.474 21.009C14.474 21.274 14.658 21.583 15.166 21.485C19.135 20.158 22 16.414 22 12C22 6.477 17.523 2 12 2Z"
                fill="#181616"
            />
        </svg>
    ),
    x: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M17.6 8.54542C17.6 8.70173 17.6 8.85805 17.6 9.0693C17.6 13.3514 14.3636 18.2898 8.40872 18.2898C6.57745 18.2898 4.89091 17.7638 3.49091 16.8667C3.74327 16.8917 4.00036 16.9042 4.26218 16.9042C5.76727 16.9042 7.15128 16.3782 8.26909 15.5311C6.84509 15.506 5.65127 14.5839 5.24 13.3139C5.44873 13.3514 5.66218 13.369 5.87564 13.369C6.18909 13.369 6.50254 13.334 6.79055 13.269C5.30909 12.9731 4.20727 11.6781 4.20727 10.1332V10.0957C4.63636 10.3291 5.13527 10.4729 5.65127 10.4854C4.78254 9.91432 4.22182 8.95736 4.22182 7.87492C4.22182 7.29131 4.37455 6.75271 4.63636 6.28427C6.21818 8.20184 8.56218 9.44424 11.1956 9.58148C11.1382 9.34807 11.1127 9.1021 11.1127 8.86868C11.1127 7.12953 12.5093 5.73999 14.2545 5.73999C15.1636 5.73999 15.9891 6.10846 16.5753 6.71715C17.3091 6.56584 18.0062 6.30988 18.6271 5.94141C18.3927 6.69214 17.8913 7.30083 17.2276 7.6943C17.8722 7.61685 18.4978 7.44792 19.0764 7.21949C18.6311 7.84575 18.0691 8.38935 17.4273 8.84524C17.6 8.84524 17.6 8.54542 17.6 8.54542Z"
                fill="black"
            />
        </svg>
    ),
};

interface HyliWalletProps {
    /**
     * Optional render prop that gives full control over the connect button UI.
     * If not supplied, a simple default button will be rendered.
     */
    button?: (props: { onClick: () => void }) => React.ReactNode;
    /**
     * Optional explicit provider list (e.g., ["password", "google"]). If omitted, available providers will be detected automatically.
     */
    providers?: ProviderOption[];
    /**
     * UNTESTED: Optional render prop for customizing the modal content.
     * If not supplied, the default modal UI will be used.
     */
    modalContent?: (props: {
        selectedProvider: ProviderOption | null;
        setSelectedProvider: (provider: ProviderOption | null) => void;
        showLogin: boolean;
        setShowLogin: (show: boolean) => void;
        onClose: () => void;
    }) => React.ReactNode;
    /**
     * CSS class prefix for styling overrides. Default is 'hyli'
     */
    classPrefix?: string;
    /**
     * Control modal open state from parent component
     */
    isOpen?: boolean;
    /**
     * Callback when modal should close
     */
    onClose?: () => void;
}

export const HyliWallet = ({
    button,
    providers,
    modalContent,
    classPrefix = "hyli",
    isOpen: controlledIsOpen,
    onClose: controlledOnClose,
}: HyliWalletProps) => {
    const [internalIsOpen, setInternalIsOpen] = useState(false);

    // Use controlled state if provided, otherwise use internal state
    const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
    const [selectedProvider, setSelectedProvider] = useState<ProviderOption | null>(null);
    const [showLogin, setShowLogin] = useState(true);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const { wallet, logout } = useWallet();
    const { forceSessionKey } = useWalletInternal();
    const [isDarkMode, setIsDarkMode] = useState(false);

    // To prevent closing while registering or logging in
    const [lockOpen, setLockOpen] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        setIsDarkMode(mq.matches);
        const handler = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, []);

    // Centre la fenêtre au chargement
    useEffect(() => {
        if (isOpen) {
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            const modalWidth = 400;
            const modalHeight = 500;

            setPosition({
                x: (windowWidth - modalWidth) / 2,
                y: (windowHeight - modalHeight) / 2,
            });
        }
    }, [isOpen]);

    useEffect(() => {
        if (isDragging) {
            const handleMouseMove = (e: MouseEvent) => {
                const dx = e.clientX - dragStart.x;
                const dy = e.clientY - dragStart.y;

                // Limiter le déplacement aux bords de l'écran
                const maxX = window.innerWidth - 400;
                const maxY = window.innerHeight - 500;

                setPosition({
                    x: Math.max(0, Math.min(maxX, position.x + dx)),
                    y: Math.max(0, Math.min(maxY, position.y + dy)),
                });
                setDragStart({ x: e.clientX, y: e.clientY });
            };

            const handleMouseUp = () => {
                setIsDragging(false);
            };

            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);

            return () => {
                window.removeEventListener("mousemove", handleMouseMove);
                window.removeEventListener("mouseup", handleMouseUp);
            };
        }
    }, [isDragging, dragStart, position]);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.target instanceof HTMLElement && !e.target.closest(`.${classPrefix}-modal-close`)) {
            setIsDragging(true);
            setDragStart({ x: e.clientX, y: e.clientY });
        }
    };

    const handleButtonClick = () => {
        if (wallet) {
            logout();
        } else {
            if (controlledIsOpen === undefined) {
                setInternalIsOpen(true);
            }
            // If controlled, parent should handle opening via isOpen prop
        }
    };

    // Get available providers dynamically
    const availableProviders = authProviderManager.getAvailableProviders() as ProviderOption[];

    const closeModal = () => {
        if (lockOpen) {
            return;
        }
        if (controlledIsOpen === undefined) {
            setInternalIsOpen(false);
        }
        if (controlledOnClose) {
            controlledOnClose();
        }
        setSelectedProvider(null);
        setShowLogin(true);
    };

    const renderProviderButton = (providerType: ProviderOption) => {
        const provider = authProviderManager.getProvider(providerType);
        const disabled = !provider?.isEnabled();

        const config: Record<ProviderOption, { label: string; icon: React.ReactNode }> = {
            password: { label: "Password", icon: ProviderIcons.password },
            google: { label: "Google", icon: ProviderIcons.google },
            github: { label: "GitHub", icon: ProviderIcons.github },
            x: { label: "X", icon: ProviderIcons.x },
        };

        const { label, icon } = config[providerType];

        return (
            <button
                key={providerType}
                className={`provider-row${disabled ? " disabled" : ""}`}
                onClick={() => !disabled && setSelectedProvider(providerType)}
            >
                <span className={`label ${classPrefix}-provider-label`}>
                    <span className={`provider-icon ${classPrefix}-provider-icon`}>{icon}</span>
                    {label}
                </span>
                {disabled ? (
                    <span className={`coming-soon ${classPrefix}-coming-soon`}>Soon</span>
                ) : (
                    <span className={`row-arrow ${classPrefix}-row-arrow`}>›</span>
                )}
            </button>
        );
    };

    const defaultModalContent = (
        <div className={`${classPrefix}-modal`} onClick={(e) => e.stopPropagation()}>
            <div className={`${classPrefix}-modal-header`} onMouseDown={handleMouseDown}>
                <div className={`${classPrefix}-modal-logo`}>
                    <svg width="120" height="28" viewBox="0 0 931 218" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M438.309 64.7635C438.265 64.8332 438.222 64.9034 438.178 64.9733C433.718 72.0845 423.337 71.9325 419.169 64.646C419.13 64.5764 419.09 64.506 419.05 64.4361L379.267 0H314.541L374.846 99.1073C377.373 103.033 382.212 110.013 389.37 120.042C395.261 128.984 398.946 135.742 400.422 140.32V156.022L400.106 217.186H456.938V156.022C456.938 152.536 456.829 149.592 456.622 147.19V140.32C457.885 135.962 461.566 129.2 467.674 120.042L471.461 114.808C472.724 113.065 474.51 110.556 476.83 107.285C479.144 104.013 480.934 101.29 482.197 99.1073L542.502 0H477.462L438.309 64.7635Z"
                            fill="#FFFFFF"
                        />
                        <path
                            d="M636.271 0H579.756V217.187H805.769V164.853H647.325C641.22 164.853 636.271 159.905 636.271 153.8V0Z"
                            fill="#FFFFFF"
                        />
                        <path d="M930.193 0H873.678V217.187H930.193V0Z" fill="#FFFFFF" />
                        <path
                            d="M216.082 82.4269H68.1538C62.0491 82.4269 57.1002 77.4778 57.1002 71.3733V0H0.609375V217.187H57.1002V145.814C57.1002 139.709 62.0492 134.76 68.1538 134.76H216.082C222.187 134.76 227.136 139.709 227.136 145.814V217.187H283.916V0H227.136V71.3733C227.136 77.4779 222.187 82.4269 216.082 82.4269Z"
                            fill="#FFFFFF"
                        />
                    </svg>
                </div>
                <button className={`${classPrefix}-modal-close`} onClick={closeModal}>
                    &times;
                </button>
            </div>

            {selectedProvider === null && (
                <div className={`${classPrefix}-provider-selection`}>
                    <h2 className={`${classPrefix}-section-title`}>Sign in</h2>
                    <div className={`${classPrefix}-provider-list`}>
                        {(providers ?? availableProviders).map(renderProviderButton)}
                    </div>
                </div>
            )}

            {selectedProvider && (
                <div className={`${classPrefix}-password-provider-flow`}>
                    {showLogin ? (
                        <>
                            <h2 className={`${classPrefix}-auth-title`}>Log in</h2>
                            <AuthForm
                                provider={authProviderManager.getProvider(selectedProvider)!}
                                mode="login"
                                classPrefix={classPrefix}
                                closeModal={closeModal}
                                forceSessionKey={forceSessionKey}
                                setLockOpen={setLockOpen}
                            />
                            <button className={`${classPrefix}-switch-auth-button`} onClick={() => setShowLogin(false)}>
                                Don't have an account? Sign up
                            </button>
                        </>
                    ) : (
                        <>
                            <h2 className={`${classPrefix}-auth-title`}>Create account</h2>
                            <AuthForm
                                provider={authProviderManager.getProvider(selectedProvider)!}
                                mode="register"
                                classPrefix={classPrefix}
                                closeModal={closeModal}
                                forceSessionKey={forceSessionKey}
                                setLockOpen={setLockOpen}
                            />
                            <button className={`${classPrefix}-switch-auth-button`} onClick={() => setShowLogin(true)}>
                                Already have an account? Log in
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );

    const ModalContent = (
        <div className={`${classPrefix}-overlay${isDarkMode ? " dark" : ""}`} onClick={closeModal}>
            {modalContent
                ? modalContent({
                      selectedProvider,
                      setSelectedProvider,
                      showLogin,
                      setShowLogin,
                      onClose: closeModal,
                  })
                : defaultModalContent}
        </div>
    );

    return (
        <>
            {button ? (
                button({ onClick: handleButtonClick })
            ) : (
                <button className={`${classPrefix}-btn`} onClick={handleButtonClick}>
                    {wallet ? "Log Out" : "Connect Wallet"}
                </button>
            )}

            {isOpen && ReactDOM.createPortal(ModalContent, document.body)}
        </>
    );
};
