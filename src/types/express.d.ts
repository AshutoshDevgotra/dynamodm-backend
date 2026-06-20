import 'express';

declare global {
  namespace Express {
    // Override the built-in User type to match our JWT payload
    interface User {
      id: string;
      role: string;
      email: string;
    }
  }
}
