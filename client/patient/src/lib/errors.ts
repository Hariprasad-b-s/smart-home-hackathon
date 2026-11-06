export const OFFLINE_MESSAGE = "You're offline. Check your internet connection and try again.";

/** Error thrown by the API client. `message` is already written for the patient. */
export class ApiError extends Error {
  readonly status: number;
  readonly offline: boolean;

  constructor(message: string, status: number, offline = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.offline = offline;
  }
}

export function messageForStatus(status: number): string {
  if (status === 404) return "We couldn't find that. It may have been reset.";
  if (status === 400) return "That didn't look right. Check your answers and try again.";
  if (status >= 500) return 'Something went wrong on our side. Try again in a moment.';
  return `Something went wrong (error ${status}). Try again.`;
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError(e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.', 0);
}
