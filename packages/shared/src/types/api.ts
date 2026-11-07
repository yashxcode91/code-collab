/**
 * Think of ApiResponse like a physical postal envelope.
 * 
 * No matter what letter is inside (a user profile, a list of projects, or an error),
 * the outside envelope always has the exact same structure.
 * This means our frontend never has to guess how the backend is sending data.
 */
export interface ApiResponse<T = unknown> {
  // Did the request work? true = yes, false = no
  success: boolean;

  // The actual data requested (like user details, project list, etc.).
  // 'T' is a placeholder for whatever data type this specific request returns.
  // The '?' means it's optional—if there is an error, data will be empty (undefined).
  data?: T;

  // If something went wrong, this object explains the problem.
  // If the request succeeded, this will be empty (undefined).
  error?: {
    // A computer-friendly code so frontend code can check it easily (e.g., 'USER_NOT_FOUND')
    code: string;

    // A friendly human-readable sentence we can display directly to the user on screen
    message: string;

    // Optional extra details (e.g., if a form had multiple invalid fields, they list here)
    details?: unknown;
  };
}

/**
 * A Health Check is like a quick doctor checkup for our server.
 * 
 * Our frontend or monitoring tools can ping /api/health at any time
 * to verify if the server is healthy and if its databases are connected.
 */
export interface HealthCheckResponse {
  // 'ok' = all good
  // 'degraded' = server works, but something like Redis is disconnected
  // 'error' = severe problem, server cannot function properly
  status: 'ok' | 'degraded' | 'error';

  // The exact date and time this check was performed (in ISO string format)
  timestamp: string;

  // How many seconds the backend server has been running continuously without crashing
  uptime: number;

  // Quick true/false checklist showing if background services are connected
  services: {
    database: boolean; // Is PostgreSQL connected?
    redis: boolean;    // Is Redis connected?
  };
}
