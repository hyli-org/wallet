/**
 * Represents the different stages of the authentication process
 */
export type AuthStage =
  | 'idle'      // Initial state, no authentication in progress
  | 'submitting' // Authentication request is being sent
  | 'blobSent'  // Blob/proofs have been sent and we're waiting for confirmation
  | 'settled'   // Authentication has completed successfully
  | 'error';    // An error occurred during authentication
