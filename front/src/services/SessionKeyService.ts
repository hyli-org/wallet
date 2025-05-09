import EC from 'elliptic';

const SESSION_KEY_STORAGE_KEY = 'hyle_session_key';
const PUBLIC_KEY_STORAGE_KEY = 'hyle_public_key';

class SessionKeyService {
  private ec: EC.ec;
  private sessionKey: string | null = null;
  private publicKey: string | null = null;

  constructor() {
    this.ec = new EC.ec('secp256k1');
    this.loadFromStorage();
  }

  private loadFromStorage() {
    this.sessionKey = localStorage.getItem(SESSION_KEY_STORAGE_KEY);
    this.publicKey = localStorage.getItem(PUBLIC_KEY_STORAGE_KEY);
  }

  generateSessionKey(): string {
    // Génère une paire de clés ECDSA
    const keyPair = this.ec.genKeyPair();
    
    // Stocke la clé privée
    const privateKey = keyPair.getPrivate('hex');
    if (!privateKey) {
      throw new Error('Failed to generate private key');
    }
    this.sessionKey = privateKey;

    // Stocke la clé publique
    const publicKey = keyPair.getPublic('hex');
    if (!publicKey) {
      throw new Error('Failed to generate public key');
    }
    this.publicKey = publicKey;

    // Sauvegarder dans le localStorage
    localStorage.setItem(SESSION_KEY_STORAGE_KEY, this.sessionKey);
    localStorage.setItem(PUBLIC_KEY_STORAGE_KEY, this.publicKey);
    
    return this.publicKey;
  }

  clear() {
    localStorage.removeItem(SESSION_KEY_STORAGE_KEY);
    localStorage.removeItem(PUBLIC_KEY_STORAGE_KEY);
    this.sessionKey = null;
    this.publicKey = null;
  }

  getPublicKey(): string | null {
    return this.publicKey;
  }
}

export const sessionKeyService = new SessionKeyService();