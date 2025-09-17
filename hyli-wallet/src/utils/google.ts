export async function fetchGooglePublicKeys<T extends JsonWebKey & { kid: string }>(): Promise<{ keys: T[] }> {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    return await response.json();
}
