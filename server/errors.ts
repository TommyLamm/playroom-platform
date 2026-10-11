import { defaultErrorCode, type ErrorCode, type ErrorDetails } from '../shared/errors.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: ErrorCode = defaultErrorCode(statusCode),
    public details?: ErrorDetails,
  ) {
    super(message);
  }
}
