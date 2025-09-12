import { NextFunction, Request, Response } from 'express';

export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<any>>(
  fn: T
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
