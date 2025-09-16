export async function fetchGooglePublicKey(keyId: string) {
    if (!keyId) {
        return null;
    }

    const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    const keys = await response.json();

    const key = keys.keys.find((key: { kid: string }) => key.kid === keyId);
    if (!key) {
        console.error(`Google public key with id ${keyId} not found`);
        return null;
    }

    return key;
}
